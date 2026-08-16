import "reflect-metadata";
import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { randomUUID } from "node:crypto";
import { RawDbClient } from "../../prisma/raw-db-client";
import { TenantContext } from "../../tenant/tenant-context";
import { TenantScopedPrismaService } from "../../tenant/tenant-scoped-prisma.service";
import { EntitlementsService } from "../entitlements.service";
import { REQUIRED_FEATURE_KEY, RequiresFeature } from "../decorators/requires-feature.decorator";
import { FeatureGuard } from "./feature.guard";

// Clé unique par run de test : Feature.key est unique en base, une seule
// ligne Feature est créée pour toute la suite, seul PlanFeature.enabled
// varie d'un plan à l'autre (voir createEnterpriseOnPlan).
const FEATURE_KEY = `feat.${randomUUID()}`;

// Aucun endpoint métier ne pose encore @RequiresFeature (le premier arrivera
// avec les modules ERP, Phase 8) : ce guard est testé directement, comme
// entitlements/entitlements.service.spec.ts teste EntitlementsService sans
// passer par une route HTTP.
describe("FeatureGuard", () => {
  const prisma = new RawDbClient();
  const tenantPrisma = new TenantScopedPrismaService();
  const reflector = new Reflector();

  const createdEnterpriseIds: string[] = [];
  const createdPlanIds: string[] = [];
  let featureId: string;

  beforeAll(async () => {
    await tenantPrisma.onModuleInit();
    const feature = await prisma.feature.create({ data: { key: FEATURE_KEY, label: FEATURE_KEY } });
    featureId = feature.id;
  });

  afterAll(async () => {
    await prisma.enterprise.updateMany({
      where: { id: { in: createdEnterpriseIds } },
      data: { currentSubscriptionId: null },
    });
    await prisma.subscription.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.enterprise.deleteMany({ where: { id: { in: createdEnterpriseIds } } });
    await prisma.plan.deleteMany({ where: { id: { in: createdPlanIds } } });
    await prisma.feature.delete({ where: { id: featureId } });
    await tenantPrisma.onModuleDestroy();
    await prisma.$disconnect();
  });

  // handler factice : RequiresFeature() est un décorateur de méthode, on
  // l'applique donc à une méthode d'une classe factice, comme sur un vrai
  // contrôleur.
  class FakeController {
    @RequiresFeature(FEATURE_KEY)
    gated() {}

    ungated() {}
  }

  function contextFor(handler: () => void): ExecutionContext {
    return { getHandler: () => handler } as unknown as ExecutionContext;
  }

  // planHasFeature=undefined => le plan n'a même pas de ligne PlanFeature
  // pour FEATURE_KEY (clé absente, pas juste désactivée).
  async function createEnterpriseOnPlan(planHasFeature?: boolean) {
    const plan = await prisma.plan.create({
      data: {
        code: `PLAN_${randomUUID()}`,
        name: "Plan de test",
        priceMonthly: 5_000,
        ...(planHasFeature !== undefined
          ? { planFeatures: { create: { featureId, enabled: planHasFeature } } }
          : {}),
      },
    });
    createdPlanIds.push(plan.id);

    const enterprise = await prisma.enterprise.create({ data: { name: `Feature Guard Test ${randomUUID()}` } });
    createdEnterpriseIds.push(enterprise.id);

    const subscription = await prisma.subscription.create({
      data: { enterpriseId: enterprise.id, planId: plan.id, status: "ACTIVE", startDate: new Date() },
    });
    await prisma.enterprise.update({ where: { id: enterprise.id }, data: { currentSubscriptionId: subscription.id } });

    return enterprise;
  }

  it("allows the request when no @RequiresFeature is present on the handler", async () => {
    const enterprise = await createEnterpriseOnPlan(false);
    const guard = new FeatureGuard(reflector, new EntitlementsService(tenantPrisma));

    const allowed = await TenantContext.run({ tenantId: enterprise.id, userId: randomUUID(), isSuperAdmin: false }, () =>
      guard.canActivate(contextFor(FakeController.prototype.ungated)),
    );

    expect(allowed).toBe(true);
  });

  it("allows the request when the enterprise's plan has the required feature enabled", async () => {
    const enterprise = await createEnterpriseOnPlan(true);
    const guard = new FeatureGuard(reflector, new EntitlementsService(tenantPrisma));

    const allowed = await TenantContext.run({ tenantId: enterprise.id, userId: randomUUID(), isSuperAdmin: false }, () =>
      guard.canActivate(contextFor(FakeController.prototype.gated)),
    );

    expect(allowed).toBe(true);
  });

  it("rejects with ForbiddenException when the plan does not have the feature enabled", async () => {
    const enterprise = await createEnterpriseOnPlan(false);
    const guard = new FeatureGuard(reflector, new EntitlementsService(tenantPrisma));

    await expect(
      TenantContext.run({ tenantId: enterprise.id, userId: randomUUID(), isSuperAdmin: false }, () =>
        guard.canActivate(contextFor(FakeController.prototype.gated)),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it("rejects when the enterprise's plan simply doesn't carry the feature key at all", async () => {
    const enterprise = await createEnterpriseOnPlan();
    const guard = new FeatureGuard(reflector, new EntitlementsService(tenantPrisma));

    await expect(
      TenantContext.run({ tenantId: enterprise.id, userId: randomUUID(), isSuperAdmin: false }, () =>
        guard.canActivate(contextFor(FakeController.prototype.gated)),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it("reads the metadata under REQUIRED_FEATURE_KEY (documents the contract with RequiresFeature)", () => {
    const metadata = Reflect.getMetadata(REQUIRED_FEATURE_KEY, FakeController.prototype.gated);
    expect(metadata).toBe(FEATURE_KEY);
  });
});
