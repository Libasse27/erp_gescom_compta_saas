import { randomUUID } from "node:crypto";
import { SubscriptionStatus } from "@prisma/client";
import { RawDbClient } from "../prisma/raw-db-client";
import { TenantContext } from "../tenant/tenant-context";
import { TenantScopedPrismaService } from "../tenant/tenant-scoped-prisma.service";
import { EntitlementsService } from "./entitlements.service";

// Résolution des entitlements (docs/PROMPT-MAITRE-SAAS.md Phase 4). Même
// style que tenant/tenant-isolation.tenant.spec.ts : instanciation directe,
// base réelle, TenantContext.run() explicite.
describe("EntitlementsService", () => {
  const prisma = new RawDbClient();
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

  // Le libellé d'origine ("...then re-resolves") ne démontrait jamais la
  // seconde moitié de son propre énoncé (BIL-17, docs/audit/BILLING-AUDIT.md)
  // — cette version couvre effectivement les deux : reste en cache dans la
  // fenêtre TTL, se ré-résout une fois le TTL dépassé. TTL fixé à la valeur
  // par défaut de production (entitlementsCacheTtlMs, env.ts) plutôt qu'une
  // valeur arbitraire, pour simuler fidèlement le comportement réel.
  // Date.now() mocké (pas de setTimeout/attente réelle, pas de fake timers
  // globaux qui interféreraient avec les appels Prisma réels de ce test).
  it("keeps serving the cached value within the TTL window, then re-resolves once it has elapsed", async () => {
    const previousTtl = process.env.ENTITLEMENTS_CACHE_TTL_MS;
    const productionTtlMs = 5000;
    process.env.ENTITLEMENTS_CACHE_TTL_MS = String(productionTtlMs);
    const nowSpy = jest.spyOn(Date, "now");
    try {
      const { enterprise, plan } = await createEnterpriseOnPlan(SubscriptionStatus.ACTIVE);
      const service = new EntitlementsService(tenantPrisma);

      const baseTime = Date.now();
      nowSpy.mockReturnValue(baseTime);
      await TenantContext.run({ tenantId: enterprise.id, userId: randomUUID(), isSuperAdmin: false }, () =>
        service.getCurrent(),
      );

      // Changement en base directement (hors cache), simulant un changement
      // de plan pendant la fenêtre de TTL.
      await prisma.subscription.updateMany({ where: { enterpriseId: enterprise.id }, data: { status: "SUSPENDED" } });

      nowSpy.mockReturnValue(baseTime + productionTtlMs - 1);
      const stillCached = await TenantContext.run(
        { tenantId: enterprise.id, userId: randomUUID(), isSuperAdmin: false },
        () => service.getCurrent(),
      );
      expect(stillCached.subscriptionStatus).toBe(SubscriptionStatus.ACTIVE);
      expect(stillCached.planCode).toBe(plan.code);

      nowSpy.mockReturnValue(baseTime + productionTtlMs + 1);
      const reResolved = await TenantContext.run(
        { tenantId: enterprise.id, userId: randomUUID(), isSuperAdmin: false },
        () => service.getCurrent(),
      );
      expect(reResolved.subscriptionStatus).toBe(SubscriptionStatus.SUSPENDED);
    } finally {
      nowSpy.mockRestore();
      process.env.ENTITLEMENTS_CACHE_TTL_MS = previousTtl;
    }
  });

  // BIL-17 : invalidate() élimine la fenêtre de dérive du TTL au lieu
  // d'attendre son expiration passive — appelé par SubscriptionsService et
  // PaymentWebhookService à chaque changement de plan/statut effectif.
  it("invalidate() forces the next call to re-resolve, even within the TTL window", async () => {
    const previousTtl = process.env.ENTITLEMENTS_CACHE_TTL_MS;
    process.env.ENTITLEMENTS_CACHE_TTL_MS = "60000";
    try {
      const { enterprise } = await createEnterpriseOnPlan(SubscriptionStatus.ACTIVE);
      const service = new EntitlementsService(tenantPrisma);

      await TenantContext.run({ tenantId: enterprise.id, userId: randomUUID(), isSuperAdmin: false }, () =>
        service.getCurrent(),
      );
      await prisma.subscription.updateMany({ where: { enterpriseId: enterprise.id }, data: { status: "SUSPENDED" } });

      service.invalidate(enterprise.id);

      const afterInvalidate = await TenantContext.run(
        { tenantId: enterprise.id, userId: randomUUID(), isSuperAdmin: false },
        () => service.getCurrent(),
      );
      expect(afterInvalidate.subscriptionStatus).toBe(SubscriptionStatus.SUSPENDED);
    } finally {
      process.env.ENTITLEMENTS_CACHE_TTL_MS = previousTtl;
    }
  });

  it("invalidate() is a silent no-op when nothing was cached for that tenant", () => {
    const service = new EntitlementsService(tenantPrisma);
    expect(() => service.invalidate(randomUUID())).not.toThrow();
  });

  // BIL-17 : sous la borne mémoire, le comportement de cache normal est
  // inchangé — l'éviction ne doit se déclencher qu'au-delà de la limite,
  // jamais prématurément.
  it("keeps entries cached when the entry count stays under the memory bound", async () => {
    const previousTtl = process.env.ENTITLEMENTS_CACHE_TTL_MS;
    const previousMax = process.env.ENTITLEMENTS_CACHE_MAX_ENTRIES;
    process.env.ENTITLEMENTS_CACHE_TTL_MS = "60000";
    process.env.ENTITLEMENTS_CACHE_MAX_ENTRIES = "5";
    try {
      const service = new EntitlementsService(tenantPrisma);
      const tenantA = await createEnterpriseOnPlan(SubscriptionStatus.ACTIVE);
      const tenantB = await createEnterpriseOnPlan(SubscriptionStatus.ACTIVE);

      await TenantContext.run({ tenantId: tenantA.enterprise.id, userId: randomUUID(), isSuperAdmin: false }, () =>
        service.getCurrent(),
      );
      await TenantContext.run({ tenantId: tenantB.enterprise.id, userId: randomUUID(), isSuperAdmin: false }, () =>
        service.getCurrent(),
      );

      await prisma.subscription.updateMany({
        where: { enterpriseId: tenantA.enterprise.id },
        data: { status: "SUSPENDED" },
      });

      const stillCached = await TenantContext.run(
        { tenantId: tenantA.enterprise.id, userId: randomUUID(), isSuperAdmin: false },
        () => service.getCurrent(),
      );
      expect(stillCached.subscriptionStatus).toBe(SubscriptionStatus.ACTIVE);
    } finally {
      process.env.ENTITLEMENTS_CACHE_TTL_MS = previousTtl;
      process.env.ENTITLEMENTS_CACHE_MAX_ENTRIES = previousMax;
    }
  });

  // BIL-17 : au-delà de la borne, l'entrée la plus ancienne (LRU) est
  // évincée — la Map ne grossit jamais indéfiniment avec le nombre de
  // tenants déjà résolus une fois.
  it("evicts the oldest entry once the memory bound is exceeded", async () => {
    const previousTtl = process.env.ENTITLEMENTS_CACHE_TTL_MS;
    const previousMax = process.env.ENTITLEMENTS_CACHE_MAX_ENTRIES;
    process.env.ENTITLEMENTS_CACHE_TTL_MS = "60000";
    process.env.ENTITLEMENTS_CACHE_MAX_ENTRIES = "2";
    try {
      const service = new EntitlementsService(tenantPrisma);
      const tenantA = await createEnterpriseOnPlan(SubscriptionStatus.ACTIVE);
      const tenantB = await createEnterpriseOnPlan(SubscriptionStatus.ACTIVE);
      const tenantC = await createEnterpriseOnPlan(SubscriptionStatus.ACTIVE);

      // Remplit le cache à sa capacité (2), dans l'ordre A puis B.
      await TenantContext.run({ tenantId: tenantA.enterprise.id, userId: randomUUID(), isSuperAdmin: false }, () =>
        service.getCurrent(),
      );
      await TenantContext.run({ tenantId: tenantB.enterprise.id, userId: randomUUID(), isSuperAdmin: false }, () =>
        service.getCurrent(),
      );
      // C dépasse la borne : A (le plus ancien) doit être évincé.
      await TenantContext.run({ tenantId: tenantC.enterprise.id, userId: randomUUID(), isSuperAdmin: false }, () =>
        service.getCurrent(),
      );

      await prisma.subscription.updateMany({
        where: { enterpriseId: tenantA.enterprise.id },
        data: { status: "SUSPENDED" },
      });

      const resolvedAgain = await TenantContext.run(
        { tenantId: tenantA.enterprise.id, userId: randomUUID(), isSuperAdmin: false },
        () => service.getCurrent(),
      );
      // Si A était encore en cache (comme dans le test précédent), on
      // reverrait ACTIVE : ici on doit voir la valeur fraîche, preuve que
      // l'entrée a bien été évincée plutôt que simplement pas encore expirée.
      expect(resolvedAgain.subscriptionStatus).toBe(SubscriptionStatus.SUSPENDED);
    } finally {
      process.env.ENTITLEMENTS_CACHE_TTL_MS = previousTtl;
      process.env.ENTITLEMENTS_CACHE_MAX_ENTRIES = previousMax;
    }
  });
});
