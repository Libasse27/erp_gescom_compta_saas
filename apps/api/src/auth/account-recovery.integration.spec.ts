import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { AppModule } from "../app.module";
import { RawDbClient } from "../prisma/raw-db-client";
import { PasswordService } from "./password.service";
import { AccountRecoveryService } from "./account-recovery.service";
import { MAIL_SENDER, MailMessage, MailSender } from "../notifications/mail-sender";

class CapturingMailSender implements MailSender {
  public sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }

  lastTokenFor(email: string): string {
    const message = [...this.sent].reverse().find((m) => m.to === email);
    if (!message) {
      throw new Error(`Aucun email capturé pour ${email}`);
    }
    const match = /: (\S+)$/.exec(message.body);
    if (!match?.[1]) {
      throw new Error("Jeton introuvable dans le corps de l'email capturé");
    }
    return match[1];
  }
}

describe("Account recovery (integration)", () => {
  let app: INestApplication;
  let prisma: RawDbClient;
  let passwordService: PasswordService;
  let accountRecoveryService: AccountRecoveryService;
  const mailSender = new CapturingMailSender();

  const createdEnterpriseIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAIL_SENDER)
      .useValue(mailSender)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = new RawDbClient();
    passwordService = app.get(PasswordService);
    accountRecoveryService = app.get(AccountRecoveryService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.enterprise.deleteMany({ where: { id: { in: createdEnterpriseIds } } });
    await app.close();
  });

  async function createTestUser() {
    const enterprise = await prisma.enterprise.create({
      data: { name: `Recovery Test ${randomUUID()}` },
    });
    createdEnterpriseIds.push(enterprise.id);

    const user = await prisma.user.create({
      data: {
        email: `recovery-${randomUUID()}@test.local`,
        passwordHash: await passwordService.hash("OldPassword9!"),
        firstName: "Test",
        lastName: "User",
        enterpriseId: enterprise.id,
        status: "ACTIVE",
      },
    });

    return { user, enterprise };
  }

  it("returns the same generic message whether the email exists or not", async () => {
    const { user } = await createTestUser();

    const resKnown = await request(app.getHttpServer())
      .post("/auth/forgot-password")
      .send({ email: user.email })
      .expect(200);

    const resUnknown = await request(app.getHttpServer())
      .post("/auth/forgot-password")
      .send({ email: "does-not-exist@test.local" })
      .expect(200);

    expect(resKnown.body.message).toBe(resUnknown.body.message);
  });

  it("resets the password with a valid token, revokes existing sessions, and blocks reuse of the token", async () => {
    const { user } = await createTestUser();

    const loginBefore = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: "OldPassword9!" })
      .expect(200);

    await request(app.getHttpServer()).post("/auth/forgot-password").send({ email: user.email }).expect(200);
    const resetToken = mailSender.lastTokenFor(user.email);

    await request(app.getHttpServer())
      .post("/auth/reset-password")
      .send({ token: resetToken, newPassword: "BrandNewPassword9!" })
      .expect(204);

    // L'ancienne session (émise avant le reset) doit être révoquée.
    await request(app.getHttpServer())
      .post("/auth/refresh")
      .send({ refreshToken: loginBefore.body.refreshToken })
      .expect(401);

    // L'ancien mot de passe ne fonctionne plus, le nouveau oui.
    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: "OldPassword9!" })
      .expect(401);

    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: "BrandNewPassword9!" })
      .expect(200);

    // Le jeton de reset est à usage unique.
    await request(app.getHttpServer())
      .post("/auth/reset-password")
      .send({ token: resetToken, newPassword: "AnotherPassword9!" })
      .expect(401);

    const completedLogs = await prisma.auditLog.findMany({
      where: { userId: user.id, action: "PASSWORD_RESET_COMPLETED" },
    });
    expect(completedLogs).toHaveLength(1);
  });

  it("rejects an expired or unknown reset token", async () => {
    await request(app.getHttpServer())
      .post("/auth/reset-password")
      .send({ token: "not-a-real-token", newPassword: "WhateverPassword9!" })
      .expect(401);
  });

  it("verifies email with a token issued internally and marks emailVerifiedAt", async () => {
    const { user } = await createTestUser();
    expect(user.emailVerifiedAt).toBeNull();

    const token = await accountRecoveryService.issueEmailVerificationToken(user.id);

    await request(app.getHttpServer()).post("/auth/verify-email").send({ token }).expect(204);

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.emailVerifiedAt).not.toBeNull();

    const verifiedLogs = await prisma.auditLog.findMany({ where: { userId: user.id, action: "EMAIL_VERIFIED" } });
    expect(verifiedLogs).toHaveLength(1);

    // Le jeton est à usage unique.
    await request(app.getHttpServer()).post("/auth/verify-email").send({ token }).expect(401);
  });
});
