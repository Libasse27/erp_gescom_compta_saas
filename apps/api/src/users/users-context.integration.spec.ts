import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { AppModule } from "../app.module";
import { RawDbClient } from "../prisma/raw-db-client";
import { PasswordService } from "../auth/password.service";

// Phase 7.2 (docs/PROMPT-MAITRE-SAAS.md) : GET /users/me/context pilote le
// menu frontend (Rôle × Permissions × Plan) et GET /users alimente la page
// Utilisateurs — tous deux tenant-scoped, lecture seule.
describe("UsersController — me/context & list (integration)", () => {
  let app: INestApplication;
  let prisma: RawDbClient;
  let passwordService: PasswordService;

  const createdEnterpriseIds: string[] = [];
  const createdPlanIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = new RawDbClient();
    passwordService = app.get(PasswordService);
  });

  afterAll(async () => {
    await prisma.enterprise.updateMany({
      where: { id: { in: createdEnterpriseIds } },
      data: { currentSubscriptionId: null },
    });
    await prisma.subscription.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.user.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.role.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.enterprise.deleteMany({ where: { id: { in: createdEnterpriseIds } } });
    await prisma.plan.deleteMany({ where: { id: { in: createdPlanIds } } });
    await app.close();
  });

  async function permission(key: string) {
    return prisma.permission.upsert({ where: { key }, create: { key }, update: {} });
  }

  async function createEnterpriseWithSubscription(planCode: string) {
    const enterprise = await prisma.enterprise.create({ data: { name: `Context Test ${randomUUID()}` } });
    createdEnterpriseIds.push(enterprise.id);

    const plan = await prisma.plan.create({ data: { code: planCode, name: planCode, priceMonthly: 5_000 } });
    createdPlanIds.push(plan.id);

    const subscription = await prisma.subscription.create({
      data: { enterpriseId: enterprise.id, planId: plan.id, status: "ACTIVE", startDate: new Date() },
    });
    await prisma.enterprise.update({ where: { id: enterprise.id }, data: { currentSubscriptionId: subscription.id } });

    return enterprise;
  }

  async function userWithRole(enterpriseId: string, roleName: string, permissionKeys: string[]) {
    const role = await prisma.role.create({ data: { enterpriseId, name: roleName } });
    for (const key of permissionKeys) {
      const perm = await permission(key);
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
    }

    const password = "MemberPassword9!";
    const user = await prisma.user.create({
      data: {
        email: `user-${randomUUID()}@test.local`,
        passwordHash: await passwordService.hash(password),
        firstName: "Test",
        lastName: "User",
        enterpriseId,
        status: "ACTIVE",
      },
    });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });

    return { user, password, role };
  }

  async function accessTokenFor(email: string, password: string): Promise<string> {
    const res = await request(app.getHttpServer()).post("/auth/login").send({ email, password }).expect(200);
    return res.body.accessToken;
  }

  it("returns the current user's permissions and plan on GET /users/me/context", async () => {
    const enterprise = await createEnterpriseWithSubscription(`PLAN_${randomUUID()}`);
    const { user, password } = await userWithRole(enterprise.id, "ADMIN", ["users.manage", "clients.read"]);
    const accessToken = await accessTokenFor(user.email, password);

    const res = await request(app.getHttpServer())
      .get("/users/me/context")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.permissions.sort()).toEqual(["clients.read", "users.manage"]);
    expect(res.body.subscriptionStatus).toBe("ACTIVE");
    expect(typeof res.body.planCode).toBe("string");
  });

  it("rejects GET /users/me/context without authentication (401)", async () => {
    await request(app.getHttpServer()).get("/users/me/context").expect(401);
  });

  it("lists enterprise users with their roles for a caller with users.manage", async () => {
    const enterprise = await createEnterpriseWithSubscription(`PLAN_${randomUUID()}`);
    const { user: admin, password } = await userWithRole(enterprise.id, "ADMIN", ["users.manage"]);
    const { user: member } = await userWithRole(enterprise.id, "LECTEUR", ["reports.read"]);
    const accessToken = await accessTokenFor(admin.email, password);

    const res = await request(app.getHttpServer())
      .get("/users")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    const emails = res.body.map((u: { email: string }) => u.email);
    expect(emails).toContain(admin.email);
    expect(emails).toContain(member.email);

    const memberEntry = res.body.find((u: { email: string }) => u.email === member.email);
    expect(memberEntry.roles).toEqual(["LECTEUR"]);
  });

  it("only lists users from the caller's own enterprise (tenant isolation)", async () => {
    const enterpriseA = await createEnterpriseWithSubscription(`PLAN_A_${randomUUID()}`);
    const enterpriseB = await createEnterpriseWithSubscription(`PLAN_B_${randomUUID()}`);
    const { user: adminA, password } = await userWithRole(enterpriseA.id, "ADMIN", ["users.manage"]);
    const { user: userB } = await userWithRole(enterpriseB.id, "ADMIN", ["users.manage"]);
    const accessToken = await accessTokenFor(adminA.email, password);

    const res = await request(app.getHttpServer())
      .get("/users")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    const emails = res.body.map((u: { email: string }) => u.email);
    expect(emails).toContain(adminA.email);
    expect(emails).not.toContain(userB.email);
  });

  it("rejects GET /users for a caller without users.manage (403)", async () => {
    const enterprise = await createEnterpriseWithSubscription(`PLAN_${randomUUID()}`);
    const { user, password } = await userWithRole(enterprise.id, "LECTEUR", ["reports.read"]);
    const accessToken = await accessTokenFor(user.email, password);

    await request(app.getHttpServer()).get("/users").set("Authorization", `Bearer ${accessToken}`).expect(403);
  });
});
