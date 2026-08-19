import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { authenticator } from "otplib";
import { AppModule } from "../app.module";
import { RawDbClient } from "../prisma/raw-db-client";
import { PasswordService } from "../auth/password.service";
import { MfaService } from "../auth/mfa.service";

// Corrige BIL-12 (docs/audit/BILLING-AUDIT.md) : jusqu'ici, aucune route
// n'existait pour éditer le catalogue de plans — seul prisma/seed.ts
// écrivait. Distinct de super-admin.integration.spec.ts (Enterprise,
// cross-tenant) : Plan/Feature/Limit ne sont pas tenant-scopées.
describe("PlansAdminController (integration)", () => {
  let app: INestApplication;
  let prisma: RawDbClient;
  let passwordService: PasswordService;
  let mfaService: MfaService;

  const createdPlanIds: string[] = [];
  const createdFeatureKeys: string[] = [];
  const createdLimitKeys: string[] = [];
  const createdUserIds: string[] = [];
  const createdEnterpriseIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = new RawDbClient();
    passwordService = app.get(PasswordService);
    mfaService = app.get(MfaService);
  });

  afterAll(async () => {
    await prisma.planFeature.deleteMany({ where: { planId: { in: createdPlanIds } } });
    await prisma.planLimit.deleteMany({ where: { planId: { in: createdPlanIds } } });
    await prisma.plan.deleteMany({ where: { id: { in: createdPlanIds } } });
    await prisma.feature.deleteMany({ where: { key: { in: createdFeatureKeys } } });
    await prisma.limit.deleteMany({ where: { key: { in: createdLimitKeys } } });
    await prisma.user.deleteMany({
      where: { OR: [{ id: { in: createdUserIds } }, { enterpriseId: { in: createdEnterpriseIds } }] },
    });
    await prisma.enterprise.deleteMany({ where: { id: { in: createdEnterpriseIds } } });
    await app.close();
  });

  // Même patron que super-admin.integration.spec.ts (MFA obligatoire pour
  // SUPER_ADMIN, CLAUDE.md §6).
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

  async function createEnterpriseAdminToken(): Promise<string> {
    const enterprise = await prisma.enterprise.create({ data: { name: `Plans Admin Test ${randomUUID()}` } });
    createdEnterpriseIds.push(enterprise.id);

    const password = "AdminPassword9!";
    const admin = await prisma.user.create({
      data: {
        email: `admin-${randomUUID()}@test.local`,
        passwordHash: await passwordService.hash(password),
        firstName: "Admin",
        lastName: "Test",
        enterpriseId: enterprise.id,
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

  function planPayload(overrides: Partial<{ code: string; name: string; priceMonthly: number }> = {}) {
    return {
      code: overrides.code ?? `PLAN_${randomUUID()}`,
      name: overrides.name ?? "Plan de test",
      priceMonthly: overrides.priceMonthly ?? 20_000,
      trialDays: 14,
    };
  }

  async function createFeature(key = `feature-${randomUUID()}`) {
    const feature = await prisma.feature.create({ data: { key, label: key } });
    createdFeatureKeys.push(feature.key);
    return feature;
  }

  async function createLimit(key = `limit-${randomUUID()}`) {
    const limit = await prisma.limit.create({ data: { key, label: key } });
    createdLimitKeys.push(limit.key);
    return limit;
  }

  async function createPlanAsSuperAdmin(token: string, overrides = {}) {
    const res = await request(app.getHttpServer())
      .post("/admin/plans")
      .set("Authorization", `Bearer ${token}`)
      .send(planPayload(overrides))
      .expect(201);
    createdPlanIds.push(res.body.id);
    return res.body;
  }

  it("rejects every /admin/plans route without authentication (401)", async () => {
    await request(app.getHttpServer()).get("/admin/plans").expect(401);
    await request(app.getHttpServer()).post("/admin/plans").send(planPayload()).expect(401);
    await request(app.getHttpServer()).patch(`/admin/plans/${randomUUID()}`).send({}).expect(401);
    await request(app.getHttpServer()).put(`/admin/plans/${randomUUID()}/features/x`).send({ enabled: true }).expect(401);
    await request(app.getHttpServer()).put(`/admin/plans/${randomUUID()}/limits/x`).send({ value: 1 }).expect(401);
  });

  it("rejects every /admin/plans route for an authenticated non-Super-Admin (403), never a silent success", async () => {
    const token = await createEnterpriseAdminToken();
    const rejectedPayload = planPayload();

    await request(app.getHttpServer()).get("/admin/plans").set("Authorization", `Bearer ${token}`).expect(403);
    await request(app.getHttpServer())
      .post("/admin/plans")
      .set("Authorization", `Bearer ${token}`)
      .send(rejectedPayload)
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/admin/plans/${randomUUID()}`)
      .set("Authorization", `Bearer ${token}`)
      .send({})
      .expect(403);

    // Aucune ligne créée malgré la tentative POST rejetée — vérifié par le
    // code unique généré pour ce test, pas par `name` (valeur générique
    // réutilisée par de nombreuses autres fixtures de la base de test).
    const plans = await prisma.plan.findMany({ where: { code: rejectedPayload.code } });
    expect(plans).toHaveLength(0);
  });

  it("creates a plan as Super Admin and logs CREATE_PLAN with useful, non-sensitive metadata", async () => {
    const token = await createSuperAdminToken();
    const payload = planPayload({ priceMonthly: 25_000 });

    const res = await request(app.getHttpServer())
      .post("/admin/plans")
      .set("Authorization", `Bearer ${token}`)
      .send(payload)
      .expect(201);
    createdPlanIds.push(res.body.id);

    expect(res.body.code).toBe(payload.code);
    expect(res.body.priceMonthly).toBe(25_000);
    expect(res.body.isActive).toBe(true);

    const logs = await prisma.auditLog.findMany({ where: { action: "CREATE_PLAN", resourceId: res.body.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0].metadata).toMatchObject({ code: payload.code, priceMonthly: 25_000 });
  });

  it("rejects an invalid create payload (400) — negative price", async () => {
    const token = await createSuperAdminToken();

    await request(app.getHttpServer())
      .post("/admin/plans")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...planPayload(), priceMonthly: -1 })
      .expect(400);
  });

  it("strips any client-supplied enterpriseId — Plan has no tenant scope to hijack", async () => {
    const token = await createSuperAdminToken();
    const foreignEnterpriseId = randomUUID();

    const res = await request(app.getHttpServer())
      .post("/admin/plans")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...planPayload(), enterpriseId: foreignEnterpriseId })
      .expect(201);
    createdPlanIds.push(res.body.id);

    expect(res.body.enterpriseId).toBeUndefined();
    const row = await prisma.plan.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row).not.toHaveProperty("enterpriseId");
  });

  it("updates a plan (price, isActive, sortOrder) and logs UPDATE_PLAN", async () => {
    const token = await createSuperAdminToken();
    const plan = await createPlanAsSuperAdmin(token);

    const res = await request(app.getHttpServer())
      .patch(`/admin/plans/${plan.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ priceMonthly: 30_000, isActive: false, sortOrder: 5 })
      .expect(200);

    expect(res.body.priceMonthly).toBe(30_000);
    expect(res.body.isActive).toBe(false);
    expect(res.body.sortOrder).toBe(5);

    const logs = await prisma.auditLog.findMany({ where: { action: "UPDATE_PLAN", resourceId: plan.id } });
    expect(logs).toHaveLength(1);
  });

  it("returns 404 when updating a plan that does not exist", async () => {
    const token = await createSuperAdminToken();

    await request(app.getHttpServer())
      .patch(`/admin/plans/${randomUUID()}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ priceMonthly: 1 })
      .expect(404);
  });

  it("GET /admin/plans includes inactive plans, unlike public GET /plans", async () => {
    const token = await createSuperAdminToken();
    const plan = await createPlanAsSuperAdmin(token, { code: `PLAN_INACTIVE_${randomUUID()}` });
    await request(app.getHttpServer())
      .patch(`/admin/plans/${plan.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ isActive: false })
      .expect(200);

    const adminList = await request(app.getHttpServer())
      .get("/admin/plans")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(adminList.body.map((p: { id: string }) => p.id)).toContain(plan.id);

    const publicList = await request(app.getHttpServer()).get("/plans").expect(200);
    expect(publicList.body.map((p: { id: string }) => p.id)).not.toContain(plan.id);
  });

  it("enables a known feature for a plan and logs UPDATE_PLAN_FEATURE", async () => {
    const token = await createSuperAdminToken();
    const plan = await createPlanAsSuperAdmin(token);
    const feature = await createFeature();

    const res = await request(app.getHttpServer())
      .put(`/admin/plans/${plan.id}/features/${feature.key}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ enabled: true })
      .expect(200);

    expect(res.body.features).toEqual([{ key: feature.key, label: feature.label, enabled: true }]);

    const logs = await prisma.auditLog.findMany({ where: { action: "UPDATE_PLAN_FEATURE", resourceId: plan.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0].metadata).toMatchObject({ featureKey: feature.key, enabled: true });
  });

  it("returns 404 for an unknown feature key — never creates one", async () => {
    const token = await createSuperAdminToken();
    const plan = await createPlanAsSuperAdmin(token);
    const unknownKey = `unknown-${randomUUID()}`;

    await request(app.getHttpServer())
      .put(`/admin/plans/${plan.id}/features/${unknownKey}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ enabled: true })
      .expect(404);

    const featureRow = await prisma.feature.findUnique({ where: { key: unknownKey } });
    expect(featureRow).toBeNull();
  });

  it("sets a numeric limit and null (illimité) for a plan, and logs UPDATE_PLAN_LIMIT", async () => {
    const token = await createSuperAdminToken();
    const plan = await createPlanAsSuperAdmin(token);
    const limit = await createLimit();

    const capped = await request(app.getHttpServer())
      .put(`/admin/plans/${plan.id}/limits/${limit.key}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ value: 50 })
      .expect(200);
    expect(capped.body.limits).toEqual([{ key: limit.key, label: limit.label, value: 50 }]);

    const unlimited = await request(app.getHttpServer())
      .put(`/admin/plans/${plan.id}/limits/${limit.key}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ value: null })
      .expect(200);
    expect(unlimited.body.limits).toEqual([{ key: limit.key, label: limit.label, value: null }]);

    const logs = await prisma.auditLog.findMany({ where: { action: "UPDATE_PLAN_LIMIT", resourceId: plan.id } });
    expect(logs).toHaveLength(2);
  });

  it("returns 404 for an unknown limit key — never creates one", async () => {
    const token = await createSuperAdminToken();
    const plan = await createPlanAsSuperAdmin(token);
    const unknownKey = `unknown-${randomUUID()}`;

    await request(app.getHttpServer())
      .put(`/admin/plans/${plan.id}/limits/${unknownKey}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ value: 10 })
      .expect(404);

    const limitRow = await prisma.limit.findUnique({ where: { key: unknownKey } });
    expect(limitRow).toBeNull();
  });

  it("rejects a limit body missing the explicit value key (400) — undefined is not accepted", async () => {
    const token = await createSuperAdminToken();
    const plan = await createPlanAsSuperAdmin(token);
    const limit = await createLimit();

    await request(app.getHttpServer())
      .put(`/admin/plans/${plan.id}/limits/${limit.key}`)
      .set("Authorization", `Bearer ${token}`)
      .send({})
      .expect(400);
  });

  it("does not regress the public GET /plans (no auth, active plans only, unaffected by admin writes)", async () => {
    const res = await request(app.getHttpServer()).get("/plans").expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    for (const plan of res.body) {
      expect(plan).not.toHaveProperty("features");
      expect(plan).not.toHaveProperty("limits");
    }
  });
});
