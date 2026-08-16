import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { AppModule } from "../app.module";
import { RawDbClient } from "../prisma/raw-db-client";
import { DEFAULT_ROLE_NAMES, DEFAULT_ROLE_PERMISSIONS, PERMISSION_KEYS } from "@erp/permissions";
import { SYSCOHADA_ACCOUNT_CLASSES } from "./syscohada-chart-of-accounts";

// Phase 6 (docs/PROMPT-MAITRE-SAAS.md) : provisioning automatique — une
// seule transaction (docs/adr/0003-...), idempotence par l'unicité de
// l'email, plan comptable SYSCOHADA initialisé.
describe("ProvisioningController — POST /auth/register (integration)", () => {
  let app: INestApplication;
  let prisma: RawDbClient;

  const createdEnterpriseIds: string[] = [];
  const createdPlanIds: string[] = [];
  const createdUserEmails: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = new RawDbClient();

    // Catalogue complet requis (DEFAULT_ROLE_PERMISSIONS couvre toutes les
    // clés) : le seed global (prisma db seed) ne tourne pas automatiquement
    // pour les tests, chaque suite upserte ce dont elle a besoin (comme
    // "users.manage" ailleurs) — jamais supprimé, catalogue partagé entre
    // suites parallèles.
    for (const key of PERMISSION_KEYS) {
      await prisma.permission.upsert({ where: { key }, create: { key }, update: {} });
    }
  });

  afterAll(async () => {
    await prisma.enterprise.updateMany({
      where: { id: { in: createdEnterpriseIds } },
      data: { currentSubscriptionId: null },
    });
    await prisma.account.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.setting.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.notification.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.subscription.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.userRole.deleteMany({ where: { role: { enterpriseId: { in: createdEnterpriseIds } } } });
    await prisma.rolePermission.deleteMany({ where: { role: { enterpriseId: { in: createdEnterpriseIds } } } });
    await prisma.role.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.authToken.deleteMany({ where: { user: { email: { in: createdUserEmails } } } });
    await prisma.user.deleteMany({ where: { email: { in: createdUserEmails } } });
    await prisma.enterprise.deleteMany({ where: { id: { in: createdEnterpriseIds } } });
    await prisma.plan.deleteMany({ where: { id: { in: createdPlanIds } } });
    await app.close();
  });

  async function createPlan(trialDays = 14) {
    const plan = await prisma.plan.create({
      data: { code: `PLAN_${randomUUID()}`, name: "Plan de test", priceMonthly: 10_000, trialDays },
    });
    createdPlanIds.push(plan.id);
    return plan;
  }

  function registerPayload(overrides: Partial<Record<string, unknown>> = {}) {
    const email = `founder-${randomUUID()}@test.local`;
    createdUserEmails.push(email);
    return {
      firstName: "Awa",
      lastName: "Diop",
      email,
      password: "FoundingPassw0rd!",
      enterpriseName: `Ma Société ${randomUUID()}`,
      country: "SN",
      ...overrides,
    };
  }

  it("provisions a full enterprise in one call: subscription, ADMIN role, SYSCOHADA accounts, settings, tokens", async () => {
    const plan = await createPlan(14);
    const payload = registerPayload({ planId: plan.id });

    const res = await request(app.getHttpServer()).post("/auth/register").send(payload).expect(201);

    expect(typeof res.body.accessToken).toBe("string");
    expect(typeof res.body.refreshToken).toBe("string");

    const user = await prisma.user.findUniqueOrThrow({ where: { email: payload.email } });
    createdEnterpriseIds.push(user.enterpriseId!);
    expect(user.status).toBe("ACTIVE");
    expect(user.emailVerifiedAt).toBeNull();

    const enterprise = await prisma.enterprise.findUniqueOrThrow({ where: { id: user.enterpriseId! } });
    expect(enterprise.name).toBe(payload.enterpriseName);
    expect(enterprise.currentSubscriptionId).not.toBeNull();

    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { id: enterprise.currentSubscriptionId! },
    });
    expect(subscription.status).toBe("TRIAL");
    expect(subscription.planId).toBe(plan.id);
    expect(subscription.trialEndDate).not.toBeNull();
    const daysUntilTrialEnd = Math.round(
      (subscription.trialEndDate!.getTime() - subscription.startDate.getTime()) / 86_400_000,
    );
    expect(daysUntilTrialEnd).toBe(14);

    const roles = await prisma.role.findMany({ where: { enterpriseId: enterprise.id } });
    expect(roles.map((r) => r.name).sort()).toEqual([...DEFAULT_ROLE_NAMES].sort());
    expect(roles.every((r) => r.isSystem)).toBe(true);

    const adminRole = roles.find((r) => r.name === "ADMIN")!;
    const adminPermissions = await prisma.rolePermission.findMany({ where: { roleId: adminRole.id } });
    expect(adminPermissions).toHaveLength(DEFAULT_ROLE_PERMISSIONS.ADMIN.length);

    const userRole = await prisma.userRole.findUniqueOrThrow({
      where: { userId_roleId: { userId: user.id, roleId: adminRole.id } },
    });
    expect(userRole).toBeDefined();

    const accounts = await prisma.account.findMany({ where: { enterpriseId: enterprise.id }, orderBy: { code: "asc" } });
    expect(accounts.map((a) => ({ code: a.code, label: a.label }))).toEqual([...SYSCOHADA_ACCOUNT_CLASSES]);

    const setting = await prisma.setting.findUniqueOrThrow({
      where: { scope_enterpriseId_key: { scope: "ENTERPRISE", enterpriseId: enterprise.id, key: "commercial.defaults" } },
    });
    expect(setting.value).toMatchObject({ currency: "XOF", locale: "fr-SN", timezone: "Africa/Dakar" });

    const verificationTokens = await prisma.authToken.findMany({
      where: { userId: user.id, type: "EMAIL_VERIFICATION" },
    });
    expect(verificationTokens).toHaveLength(1);

    const welcomeNotifications = await prisma.notification.findMany({
      where: { userId: user.id, type: "WELCOME" },
    });
    expect(welcomeNotifications).toHaveLength(1);

    const auditLogs = await prisma.auditLog.findMany({
      where: { enterpriseId: enterprise.id, action: "ENTERPRISE_PROVISIONED" },
    });
    expect(auditLogs).toHaveLength(1);

    const accessToken = res.body.accessToken as string;
    const meRes = await request(app.getHttpServer()).get("/auth/me").set("Authorization", `Bearer ${accessToken}`).expect(200);
    expect(meRes.body.id).toBe(user.id);
  });

  it("is idempotent on email: a replay with the same email is rejected and creates nothing", async () => {
    const plan = await createPlan();
    const payload = registerPayload({ planId: plan.id });

    await request(app.getHttpServer()).post("/auth/register").send(payload).expect(201);
    const firstUser = await prisma.user.findUniqueOrThrow({ where: { email: payload.email } });
    createdEnterpriseIds.push(firstUser.enterpriseId!);

    const secondAttemptEnterpriseName = `Duplicate Attempt ${randomUUID()}`;
    await request(app.getHttpServer())
      .post("/auth/register")
      .send({ ...payload, enterpriseName: secondAttemptEnterpriseName })
      .expect(409);

    const orphanEnterprise = await prisma.enterprise.findFirst({ where: { name: secondAttemptEnterpriseName } });
    expect(orphanEnterprise).toBeNull();

    const usersWithEmail = await prisma.user.count({ where: { email: payload.email } });
    expect(usersWithEmail).toBe(1);
  });

  it("rejects an unknown planId and leaves no orphaned enterprise", async () => {
    const payload = registerPayload({ planId: randomUUID() });

    await request(app.getHttpServer()).post("/auth/register").send(payload).expect(404);

    const orphanEnterprise = await prisma.enterprise.findFirst({ where: { name: payload.enterpriseName } });
    expect(orphanEnterprise).toBeNull();
    const orphanUser = await prisma.user.findUnique({ where: { email: payload.email } });
    expect(orphanUser).toBeNull();
  });

  it("rejects a duplicate NINEA within the same country and leaves no orphaned rows", async () => {
    const plan = await createPlan();
    const sharedNinea = `NINEA-${randomUUID()}`;

    const first = registerPayload({ planId: plan.id, ninea: sharedNinea, country: "SN" });
    await request(app.getHttpServer()).post("/auth/register").send(first).expect(201);
    const firstUser = await prisma.user.findUniqueOrThrow({ where: { email: first.email } });
    createdEnterpriseIds.push(firstUser.enterpriseId!);

    const second = registerPayload({ planId: plan.id, ninea: sharedNinea, country: "SN" });
    await request(app.getHttpServer()).post("/auth/register").send(second).expect(409);

    const orphanUser = await prisma.user.findUnique({ where: { email: second.email } });
    expect(orphanUser).toBeNull();
    const orphanEnterprise = await prisma.enterprise.findFirst({ where: { name: second.enterpriseName } });
    expect(orphanEnterprise).toBeNull();
  });
});
