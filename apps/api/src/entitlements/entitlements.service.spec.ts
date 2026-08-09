import { randomUUID } from "node:crypto";
import { SubscriptionStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { TenantContext } from "../tenant/tenant-context";
import { TenantScopedPrismaService } from "../tenant/tenant-scoped-prisma.service";
import { EntitlementsService } from "./entitlements.service";

// Résolution des entitlements (docs/PROMPT-MAITRE-SAAS.md Phase 4). Même
// style que tenant/tenant-isolation.tenant.spec.ts : instanciation directe,
// base réelle, TenantContext.run() explicite.
describe("EntitlementsService", () => {
  const prisma = new PrismaService();
  const tenantPrisma = new TenantScopedPrismaService();

  const createdEnterpriseIds: string[] = [];
  const createdPlanIds: string[] = [];
  const createdFeatureIds: string[] = [];
  const createdLimitIds: string[] = [];

  beforeAll(async () => {
    await tenantPrisma.onModuleInit();
  });

  afterAll(async () => {
    // currentSubscriptionId doit être libéré avant de pouvoir supprimer la
    // Subscription qu'il référence (FK), elle-même avant l'Enterprise.
    await prisma.enterprise.updateMany({
      where: { id: { in: createdEnterpriseIds } },
      data: { currentSubscriptionId: null },
    });
    await prisma.subscription.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.enterprise.deleteMany({ where: { id: { in: createdEnterpriseIds } } });
    await prisma.plan.deleteMany({ where: { id: { in: createdPlanIds } } });
    await prisma.feature.deleteMany({ where: { id: { in: createdFeatureIds } } });
    await prisma.limit.deleteMany({ where: { id: { in: createdLimitIds } } });
    await tenantPrisma.onModuleDestroy();
    await prisma.$disconnect();
  });

  async function createEnterpriseOnPlan(status: SubscriptionStatus) {
    const feature = await prisma.feature.create({ data: { key: `feat.${randomUUID()}`, label: "Test feature" } });
    createdFeatureIds.push(feature.id);
    const limit = await prisma.limit.create({ data: { key: `limit.${randomUUID()}`, label: "Test limit" } });
    createdLimitIds.push(limit.id);

    const plan = await prisma.plan.create({
      data: {
        code: `PLAN_${randomUUID()}`,
        name: "Plan de test",
        priceMonthly: 10_000,
        planFeatures: { create: { featureId: feature.id, enabled: true } },
        planLimits: { create: { limitId: limit.id, value: 3 } },
      },
    });
    createdPlanIds.push(plan.id);

    const enterprise = await prisma.enterprise.create({ data: { name: `Entitlements Test ${randomUUID()}` } });
    createdEnterpriseIds.push(enterprise.id);

    const subscription = await prisma.subscription.create({
      data: { enterpriseId: enterprise.id, planId: plan.id, status, startDate: new Date() },
    });
    await prisma.enterprise.update({ where: { id: enterprise.id }, data: { currentSubscriptionId: subscription.id } });

    return { enterprise, plan, feature, limit };
  }

  it("resolves the current plan's status, features and limits for the tenant in context", async () => {
    const { enterprise, plan, feature, limit } = await createEnterpriseOnPlan(SubscriptionStatus.ACTIVE);
    const service = new EntitlementsService(tenantPrisma);

    const entitlements = await TenantContext.run(
      { tenantId: enterprise.id, userId: randomUUID(), isSuperAdmin: false },
      () => service.getCurrent(),
    );

    expect(entitlements.subscriptionStatus).toBe(SubscriptionStatus.ACTIVE);
    expect(entitlements.planCode).toBe(plan.code);
    expect(entitlements.features.has(feature.key)).toBe(true);
    expect(entitlements.limits.get(limit.key)).toBe(3);
  });

  it("returns a blocked, empty entitlements snapshot for an enterprise with no subscription", async () => {
    const enterprise = await prisma.enterprise.create({ data: { name: `No Subscription ${randomUUID()}` } });
    createdEnterpriseIds.push(enterprise.id);
    const service = new EntitlementsService(tenantPrisma);

    const entitlements = await TenantContext.run(
      { tenantId: enterprise.id, userId: randomUUID(), isSuperAdmin: false },
      () => service.getCurrent(),
    );

    expect(entitlements.subscriptionStatus).toBeNull();
    expect(entitlements.features.size).toBe(0);
    expect(entitlements.limits.size).toBe(0);
  });

  it("never leaks another tenant's plan when resolving entitlements (RLS-backed)", async () => {
    const tenantA = await createEnterpriseOnPlan(SubscriptionStatus.ACTIVE);
    const tenantB = await createEnterpriseOnPlan(SubscriptionStatus.TRIAL);
    const service = new EntitlementsService(tenantPrisma);

    const seenByA = await TenantContext.run(
      { tenantId: tenantA.enterprise.id, userId: randomUUID(), isSuperAdmin: false },
      () => service.getCurrent(),
    );

    expect(seenByA.planCode).toBe(tenantA.plan.code);
    expect(seenByA.features.has(tenantB.feature.key)).toBe(false);
  });

  it("caches the resolved entitlements for the configured TTL, then re-resolves", async () => {
    const previousTtl = process.env.ENTITLEMENTS_CACHE_TTL_MS;
    process.env.ENTITLEMENTS_CACHE_TTL_MS = "60000";
    try {
      const { enterprise, plan } = await createEnterpriseOnPlan(SubscriptionStatus.ACTIVE);
      const service = new EntitlementsService(tenantPrisma);

      await TenantContext.run({ tenantId: enterprise.id, userId: randomUUID(), isSuperAdmin: false }, () =>
        service.getCurrent(),
      );

      // Changement en base directement (hors cache), simulant un changement
      // de plan pendant la fenêtre de TTL : le résultat mis en cache doit
      // rester l'ancien tant que le TTL n'a pas expiré.
      await prisma.subscription.updateMany({ where: { enterpriseId: enterprise.id }, data: { status: "SUSPENDED" } });

      const stillCached = await TenantContext.run(
        { tenantId: enterprise.id, userId: randomUUID(), isSuperAdmin: false },
        () => service.getCurrent(),
      );
      expect(stillCached.subscriptionStatus).toBe(SubscriptionStatus.ACTIVE);
      expect(stillCached.planCode).toBe(plan.code);
    } finally {
      process.env.ENTITLEMENTS_CACHE_TTL_MS = previousTtl;
    }
  });
});
