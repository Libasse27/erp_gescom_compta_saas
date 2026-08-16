import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { AppModule } from "../app.module";
import { RawDbClient } from "../prisma/raw-db-client";
import { PasswordService } from "../auth/password.service";
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

describe("Invitations + PermissionsGuard (integration)", () => {
  let app: INestApplication;
  let prisma: RawDbClient;
  let passwordService: PasswordService;
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
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.role.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.enterprise.deleteMany({ where: { id: { in: createdEnterpriseIds } } });
    await app.close();
  });

  async function permission(key: string) {
    return prisma.permission.upsert({
      where: { key },
      create: { key },
      update: {},
    });
  }

  async function enterpriseWithRole(roleName: string, permissionKeys: string[]) {
    const enterprise = await prisma.enterprise.create({ data: { name: `Invite Test ${randomUUID()}` } });
    createdEnterpriseIds.push(enterprise.id);

    const role = await prisma.role.create({ data: { enterpriseId: enterprise.id, name: roleName } });
    for (const key of permissionKeys) {
      const perm = await permission(key);
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
    }

    return { enterprise, role };
  }

  async function userWithRole(enterpriseId: string, roleId: string, password = "MemberPassword9!") {
    const user = await prisma.user.create({
      data: {
        email: `member-${randomUUID()}@test.local`,
        passwordHash: await passwordService.hash(password),
        firstName: "Test",
        lastName: "Member",
        enterpriseId,
        status: "ACTIVE",
      },
    });
    await prisma.userRole.create({ data: { userId: user.id, roleId } });
    return { user, password };
  }

  async function accessTokenFor(email: string, password: string): Promise<string> {
    const res = await request(app.getHttpServer()).post("/auth/login").send({ email, password }).expect(200);
    return res.body.accessToken;
  }

  it("allows a user with users.manage to invite a new user in their own enterprise", async () => {
    const { enterprise, role: adminRole } = await enterpriseWithRole("ADMIN_TEST", ["users.manage"]);
    const { role: memberRole } = { role: await prisma.role.create({ data: { enterpriseId: enterprise.id, name: "LECTEUR_TEST" } }) };
    const { user: admin, password } = await userWithRole(enterprise.id, adminRole.id);

    const accessToken = await accessTokenFor(admin.email, password);
    const inviteeEmail = `invitee-${randomUUID()}@test.local`;

    await request(app.getHttpServer())
      .post("/users/invite")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ email: inviteeEmail, firstName: "New", lastName: "Member", roleId: memberRole.id })
      .expect(201);

    const invitee = await prisma.user.findUniqueOrThrow({ where: { email: inviteeEmail } });
    expect(invitee.status).toBe("PENDING_INVITE");
    expect(invitee.enterpriseId).toBe(enterprise.id);

    const invitedLogs = await prisma.auditLog.findMany({ where: { userId: invitee.id, action: "USER_INVITED" } });
    expect(invitedLogs).toHaveLength(1);

    const invitationToken = mailSender.lastTokenFor(inviteeEmail);
    const acceptRes = await request(app.getHttpServer())
      .post("/users/accept-invitation")
      .send({ token: invitationToken, password: "BrandNewMemberPassw0rd!" })
      .expect(200);

    expect(typeof acceptRes.body.accessToken).toBe("string");

    const activated = await prisma.user.findUniqueOrThrow({ where: { id: invitee.id } });
    expect(activated.status).toBe("ACTIVE");
    expect(activated.emailVerifiedAt).not.toBeNull();

    const acceptedLogs = await prisma.auditLog.findMany({
      where: { userId: invitee.id, action: "INVITATION_ACCEPTED" },
    });
    expect(acceptedLogs).toHaveLength(1);

    // Le jeton d'invitation est à usage unique.
    await request(app.getHttpServer())
      .post("/users/accept-invitation")
      .send({ token: invitationToken, password: "AnotherAttempt9!" })
      .expect(401);
  });

  it("rejects invite from a user without users.manage (403)", async () => {
    const { enterprise, role: readerRole } = await enterpriseWithRole("LECTEUR_ONLY", ["clients.read"]);
    const { role: memberRole } = { role: await prisma.role.create({ data: { enterpriseId: enterprise.id, name: "MEMBER" } }) };
    const { user: reader, password } = await userWithRole(enterprise.id, readerRole.id);

    const accessToken = await accessTokenFor(reader.email, password);

    await request(app.getHttpServer())
      .post("/users/invite")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        email: `blocked-${randomUUID()}@test.local`,
        firstName: "No",
        lastName: "Access",
        roleId: memberRole.id,
      })
      .expect(403);
  });

  it("rejects invite without a Bearer token (401)", async () => {
    const { role: memberRole } = await enterpriseWithRole("ANON_TEST", []);

    await request(app.getHttpServer())
      .post("/users/invite")
      .send({ email: `anon-${randomUUID()}@test.local`, firstName: "A", lastName: "B", roleId: memberRole.id })
      .expect(401);
  });

  it("rejects a roleId belonging to another enterprise, even with users.manage (403)", async () => {
    const { enterprise: enterpriseA, role: adminRoleA } = await enterpriseWithRole("ADMIN_A", ["users.manage"]);
    const { role: roleB } = await enterpriseWithRole("ROLE_B", []);
    const { user: adminA, password } = await userWithRole(enterpriseA.id, adminRoleA.id);

    const accessToken = await accessTokenFor(adminA.email, password);

    await request(app.getHttpServer())
      .post("/users/invite")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ email: `cross-${randomUUID()}@test.local`, firstName: "Cross", lastName: "Tenant", roleId: roleB.id })
      .expect(403);
  });

  it("rejects inviting an email that already has an account (409)", async () => {
    const { enterprise, role: adminRole } = await enterpriseWithRole("ADMIN_DUP", ["users.manage"]);
    const { role: memberRole } = { role: await prisma.role.create({ data: { enterpriseId: enterprise.id, name: "MEMBER_DUP" } }) };
    const { user: admin, password } = await userWithRole(enterprise.id, adminRole.id);
    const { user: existingUser } = await userWithRole(enterprise.id, memberRole.id);

    const accessToken = await accessTokenFor(admin.email, password);

    await request(app.getHttpServer())
      .post("/users/invite")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ email: existingUser.email, firstName: "Dup", lastName: "User", roleId: memberRole.id })
      .expect(409);
  });
});
