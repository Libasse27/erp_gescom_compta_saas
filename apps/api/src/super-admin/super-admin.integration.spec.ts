import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { authenticator } from "otplib";
import { AppModule } from "../app.module";
import { RawDbClient } from "../prisma/raw-db-client";
import { PasswordService } from "../auth/password.service";
import { MfaService } from "../auth/mfa.service";

// Phase 7.3 (docs/PROMPT-MAITRE-SAAS.md) : GET /admin/overview et
// GET /admin/enterprises, lecture seule cross-tenant réservée au Super Admin,
// chaque accès journalisé (CLAUDE.md §6).
describe("SuperAdminController (integration)", () => {
  let app: INestApplication;
  let prisma: RawDbClient;
  let passwordService: PasswordService;
  let mfaService: MfaService;

  const createdEnterpriseIds: string[] = [];
  const createdPlanIds: string[] = [];
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
    await prisma.enterprise.updateMany({
      where: { id: { in: createdEnterpriseIds } },
      data: { currentSubscriptionId: null },
    });
    await prisma.subscription.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.user.deleteMany({
      where: { OR: [{ enterpriseId: { in: createdEnterpriseIds } }, { id: { in: createdUserIds } }] },
    });
    await prisma.enterprise.deleteMany({ where: { id: { in: createdEnterpriseIds } } });
    await prisma.plan.deleteMany({ where: { id: { in: createdPlanIds } } });
    await app.close();
  });

  async function createSuperAdminToken(): Promise<string> {
    const secret = mfaService.generateSecret();
    const plainPassword = "SuperSecretPassw0rd!";
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

    const loginRes = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: plainPassword })
      .expect(200);
    const mfaRes = await request(app.getHttpServer())
      .post("/auth/mfa/verify")
      .send({ challengeToken: loginRes.body.challengeToken, code: authenticator.generate(secret) })
      .expect(200);

    return mfaRes.body.accessToken as string;
  }

  async function createEnterpriseWithSubscription(status: "ACTIVE" | "SUSPENDED" = "ACTIVE") {
    const enterprise = await prisma.enterprise.create({
      data: { name: `Super Admin Test ${randomUUID()}`, status },
    });
    createdEnterpriseIds.push(enterprise.id);

    const plan = await prisma.plan.create({
      data: { code: `PLAN_${randomUUID()}`, name: "Plan de test", priceMonthly: 5_000 },
    });
    createdPlanIds.push(plan.id);

    const subscription = await prisma.subscription.create({
      data: { enterpriseId: enterprise.id, planId: plan.id, status: "ACTIVE", startDate: new Date() },
    });
    await prisma.enterprise.update({ where: { id: enterprise.id }, data: { currentSubscriptionId: subscription.id } });

    return { enterprise, plan };
  }

  async function createEnterpriseAdminToken(): Promise<string> {
    const enterprise = await prisma.enterprise.create({ data: { name: `Regular Admin Test ${randomUUID()}` } });
    createdEnterpriseIds.push(enterprise.id);
    return createEnterpriseAdminTokenFor(enterprise.id);
  }

  // Variante de createEnterpriseAdminToken pour une entreprise déjà créée
  // par l'appelant (ex. via createEnterpriseWithSubscription) — nécessaire
  // pour les tests BIL-04 qui doivent suspendre cette entreprise précise.
  async function createEnterpriseAdminTokenFor(enterpriseId: string): Promise<string> {
    const password = "AdminPassword9!";
    const admin = await prisma.user.create({
      data: {
        email: `admin-${randomUUID()}@test.local`,
        passwordHash: await passwordService.hash(password),
        firstName: "Admin",
        lastName: "Test",
        enterpriseId,
        status: "ACTIVE",
      },
    });
    createdUserIds.push(admin.id);
    const loginRes = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: admin.email, password })
      .expect(200);
    return loginRes.body.accessToken as string;
  }

  it("returns platform-wide stats for the Super Admin and logs a CROSS_TENANT_ACCESS entry", async () => {
    const accessToken = await createSuperAdminToken();
    await createEnterpriseWithSubscription("ACTIVE");

    const res = await request(app.getHttpServer())
      .get("/admin/overview")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.totalEnterprises).toBeGreaterThanOrEqual(1);
    expect(typeof res.body.activeSubscriptions).toBe("number");
    expect(typeof res.body.totalRevenue).toBe("number");

    const logs = await prisma.auditLog.findMany({
      where: { action: "CROSS_TENANT_ACCESS", resource: "PlatformOverview" },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    expect(logs).toHaveLength(1);
  });

  it("lists enterprises with their plan/subscription status", async () => {
    const accessToken = await createSuperAdminToken();
    const { enterprise, plan } = await createEnterpriseWithSubscription("ACTIVE");

    const res = await request(app.getHttpServer())
      .get("/admin/enterprises")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    const entry = res.body.find((e: { id: string }) => e.id === enterprise.id);
    expect(entry).toBeDefined();
    expect(entry.planCode).toBe(plan.code);
    expect(entry.subscriptionStatus).toBe("ACTIVE");
  });

  it("rejects a non-Super-Admin on both endpoints (403)", async () => {
    const accessToken = await createEnterpriseAdminToken();

    await request(app.getHttpServer())
      .get("/admin/overview")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .get("/admin/enterprises")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(403);
  });

  it("rejects without authentication (401)", async () => {
    await request(app.getHttpServer()).get("/admin/overview").expect(401);
    await request(app.getHttpServer()).get("/admin/enterprises").expect(401);
  });

  // Régression BIL-04 (docs/audit/BILLING-AUDIT.md) : jusqu'ici, suspendre
  // une entreprise n'avait aucun effet réel — cette route n'existait pas.
  it("suspends an enterprise, revoking its users' sessions immediately and logging SUSPEND_ACCOUNT", async () => {
    const superAdminToken = await createSuperAdminToken();
    const { enterprise } = await createEnterpriseWithSubscription("ACTIVE");

    const tenantAdminToken = await createEnterpriseAdminTokenFor(enterprise.id);
    await request(app.getHttpServer())
      .get("/users/me/context")
      .set("Authorization", `Bearer ${tenantAdminToken}`)
      .expect(200);

    const res = await request(app.getHttpServer())
      .post(`/admin/enterprises/${enterprise.id}/suspend`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .expect(200);
    expect(res.body.status).toBe("SUSPENDED");

    // L'access token déjà émis (encore valide au sens de sa signature) est
    // désormais rejeté par JwtAuthGuard — pas seulement au prochain refresh.
    await request(app.getHttpServer())
      .get("/users/me/context")
      .set("Authorization", `Bearer ${tenantAdminToken}`)
      .expect(401);

    const enterpriseRow = await prisma.enterprise.findUniqueOrThrow({ where: { id: enterprise.id } });
    expect(enterpriseRow.status).toBe("SUSPENDED");

    const logs = await prisma.auditLog.findMany({
      where: { enterpriseId: enterprise.id, action: "SUSPEND_ACCOUNT" },
    });
    expect(logs).toHaveLength(1);
  });

  it("reactivates a suspended enterprise and logs REACTIVATE_ACCOUNT", async () => {
    const superAdminToken = await createSuperAdminToken();
    const { enterprise } = await createEnterpriseWithSubscription("SUSPENDED");

    const res = await request(app.getHttpServer())
      .post(`/admin/enterprises/${enterprise.id}/reactivate`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .expect(200);
    expect(res.body.status).toBe("ACTIVE");

    const enterpriseRow = await prisma.enterprise.findUniqueOrThrow({ where: { id: enterprise.id } });
    expect(enterpriseRow.status).toBe("ACTIVE");

    const logs = await prisma.auditLog.findMany({
      where: { enterpriseId: enterprise.id, action: "REACTIVATE_ACCOUNT" },
    });
    expect(logs).toHaveLength(1);
  });

  it("returns 404 when suspending an enterprise that does not exist", async () => {
    const superAdminToken = await createSuperAdminToken();

    await request(app.getHttpServer())
      .post(`/admin/enterprises/${randomUUID()}/suspend`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .expect(404);
  });

  it("rejects suspend/reactivate for a non-Super-Admin (403)", async () => {
    const accessToken = await createEnterpriseAdminToken();
    const { enterprise } = await createEnterpriseWithSubscription("ACTIVE");

    await request(app.getHttpServer())
      .post(`/admin/enterprises/${enterprise.id}/suspend`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .post(`/admin/enterprises/${enterprise.id}/reactivate`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(403);
  });
});
