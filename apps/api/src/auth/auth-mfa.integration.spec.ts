import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { authenticator } from "otplib";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { AppModule } from "../app.module";
import { RawDbClient } from "../prisma/raw-db-client";
import { PasswordService } from "./password.service";
import { MfaService } from "./mfa.service";

describe("Auth MFA (integration)", () => {
  let app: INestApplication;
  let prisma: RawDbClient;
  let passwordService: PasswordService;
  let mfaService: MfaService;

  const createdUserIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = new RawDbClient();
    passwordService = app.get(PasswordService);
    mfaService = app.get(MfaService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await app.close();
  });

  // Reproduit ce que fera scripts/create-super-admin.ts : un Super Admin
  // n'a jamais enterpriseId renseigné et a toujours la MFA déjà activée.
  async function createSuperAdmin(plainPassword = "SuperSecretPassw0rd!") {
    const secret = mfaService.generateSecret();
    const user = await prisma.user.create({
      data: {
        email: `super-${randomUUID()}@platform.test`,
        passwordHash: await passwordService.hash(plainPassword),
        firstName: "Super",
        lastName: "Admin",
        isSuperAdmin: true,
        enterpriseId: null,
        status: "ACTIVE",
        mfaEnabled: true,
        mfaSecret: mfaService.encryptSecret(secret),
      },
    });
    createdUserIds.push(user.id);
    return { user, plainPassword, secret };
  }

  it("requires MFA after a correct password for a Super Admin, without issuing tokens yet", async () => {
    const { user, plainPassword } = await createSuperAdmin();

    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: plainPassword })
      .expect(200);

    expect(res.body.mfaRequired).toBe(true);
    expect(typeof res.body.challengeToken).toBe("string");
    expect(res.body.accessToken).toBeUndefined();

    // Aucune session tant que le second facteur n'est pas vérifié.
    const loginLogs = await prisma.auditLog.findMany({ where: { userId: user.id, action: "LOGIN" } });
    expect(loginLogs).toHaveLength(0);
  });

  it("issues tokens on a valid TOTP code and records LOGIN with mfa metadata", async () => {
    const { user, plainPassword, secret } = await createSuperAdmin();

    const loginRes = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: plainPassword })
      .expect(200);

    const code = authenticator.generate(secret);

    const mfaRes = await request(app.getHttpServer())
      .post("/auth/mfa/verify")
      .send({ challengeToken: loginRes.body.challengeToken, code })
      .expect(200);

    expect(typeof mfaRes.body.accessToken).toBe("string");
    expect(typeof mfaRes.body.refreshToken).toBe("string");

    const loginLogs = await prisma.auditLog.findMany({ where: { userId: user.id, action: "LOGIN" } });
    expect(loginLogs).toHaveLength(1);
    expect((loginLogs[0]!.metadata as { mfa?: boolean } | null)?.mfa).toBe(true);

    const meRes = await request(app.getHttpServer())
      .get("/auth/me")
      .set("Authorization", `Bearer ${mfaRes.body.accessToken}`)
      .expect(200);
    expect(meRes.body.id).toBe(user.id);
  });

  it("rejects an invalid TOTP code and records MFA_CHALLENGE_FAILED without issuing tokens", async () => {
    const { user, plainPassword } = await createSuperAdmin();

    const loginRes = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: plainPassword })
      .expect(200);

    await request(app.getHttpServer())
      .post("/auth/mfa/verify")
      .send({ challengeToken: loginRes.body.challengeToken, code: "000000" })
      .expect(401);

    const failedLogs = await prisma.auditLog.findMany({
      where: { userId: user.id, action: "MFA_CHALLENGE_FAILED" },
    });
    expect(failedLogs).toHaveLength(1);
  });

  it("rejects a challenge token reused after another user's login (cross-account defense)", async () => {
    const first = await createSuperAdmin();
    const second = await createSuperAdmin();

    const firstLogin = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: first.user.email, password: first.plainPassword })
      .expect(200);

    // Le challengeToken de "first" ne doit jamais valider le code TOTP de "second".
    const secondCode = authenticator.generate(second.secret);

    await request(app.getHttpServer())
      .post("/auth/mfa/verify")
      .send({ challengeToken: firstLogin.body.challengeToken, code: secondCode })
      .expect(401);
  });
});
