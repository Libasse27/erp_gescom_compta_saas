import { ConflictException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { RawDbClient } from "../prisma/raw-db-client";
import { PrismaService } from "../prisma/prisma.service";
import { PlansAdminRepository } from "./plans-admin.repository";

// Contrairement à stock.repository.spec.ts/products.repository.spec.ts :
// Plan/Feature/Limit ne sont pas tenant-scopées (pas d'enterpriseId), donc
// pas de TenantContext.run ici — PrismaService (rôle identité) suffit,
// comme PlansService (lecture publique) que ce repository n'affecte pas.
describe("PlansAdminRepository", () => {
  const prisma = new PrismaService();
  const raw = new RawDbClient();
  const repository = new PlansAdminRepository(prisma);

  const createdPlanIds: string[] = [];
  const createdFeatureKeys: string[] = [];
  const createdLimitKeys: string[] = [];

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await raw.planFeature.deleteMany({ where: { planId: { in: createdPlanIds } } });
    await raw.planLimit.deleteMany({ where: { planId: { in: createdPlanIds } } });
    await raw.plan.deleteMany({ where: { id: { in: createdPlanIds } } });
    await raw.feature.deleteMany({ where: { key: { in: createdFeatureKeys } } });
    await raw.limit.deleteMany({ where: { key: { in: createdLimitKeys } } });
    await prisma.onModuleDestroy();
    await raw.$disconnect();
  });

  function planInput(overrides: Partial<{ code: string; name: string; priceMonthly: number }> = {}) {
    return {
      code: overrides.code ?? `PLAN_${randomUUID()}`,
      name: overrides.name ?? "Plan de test",
      priceMonthly: overrides.priceMonthly ?? 10_000,
      trialDays: 14,
      isActive: true,
      sortOrder: 0,
    };
  }

  async function createFeature(key = `feature-${randomUUID()}`) {
    const feature = await raw.feature.create({ data: { key, label: key } });
    createdFeatureKeys.push(feature.key);
    return feature;
  }

  async function createLimit(key = `limit-${randomUUID()}`) {
    const limit = await raw.limit.create({ data: { key, label: key } });
    createdLimitKeys.push(limit.key);
    return limit;
  }

  it("creates a plan and returns it with empty feature/limit lists", async () => {
    const input = planInput({ priceMonthly: 15_000 });
    const plan = await repository.create(input);
    createdPlanIds.push(plan.id);

    expect(plan.code).toBe(input.code);
    expect(plan.priceMonthly).toBe(15_000);
    expect(plan.isActive).toBe(true);
    expect(plan.features).toEqual([]);
    expect(plan.limits).toEqual([]);
  });

  it("rejects creating a plan with a duplicate code (409)", async () => {
    const input = planInput();
    const plan = await repository.create(input);
    createdPlanIds.push(plan.id);

    await expect(repository.create(input)).rejects.toThrow(ConflictException);
  });

  it("updates a plan's fields and rejects for a plan that does not exist", async () => {
    const plan = await repository.create(planInput({ priceMonthly: 10_000 }));
    createdPlanIds.push(plan.id);

    const updated = await repository.update(plan.id, { priceMonthly: 12_000, isActive: false });
    expect(updated.priceMonthly).toBe(12_000);
    expect(updated.isActive).toBe(false);
    expect(updated.code).toBe(plan.code); // champ non fourni : inchangé

    await expect(repository.update(randomUUID(), { priceMonthly: 1 })).rejects.toThrow(NotFoundException);
  });

  it("lists all plans including inactive ones", async () => {
    const active = await repository.create(planInput({ code: `PLAN_ACTIVE_${randomUUID()}` }));
    createdPlanIds.push(active.id);
    const inactive = await repository.create(planInput({ code: `PLAN_INACTIVE_${randomUUID()}` }));
    createdPlanIds.push(inactive.id);
    await repository.update(inactive.id, { isActive: false });

    const all = await repository.findAll();
    const ids = all.map((p) => p.id);
    expect(ids).toContain(active.id);
    expect(ids).toContain(inactive.id);
  });

  it("enables a known feature for a plan, idempotently", async () => {
    const plan = await repository.create(planInput());
    createdPlanIds.push(plan.id);
    const feature = await createFeature();

    const first = await repository.setFeature(plan.id, feature.key, true);
    expect(first.features).toEqual([{ key: feature.key, label: feature.label, enabled: true }]);

    // Rejeu (upsert) : ne duplique pas la ligne, met simplement à jour.
    const second = await repository.setFeature(plan.id, feature.key, false);
    expect(second.features).toEqual([{ key: feature.key, label: feature.label, enabled: false }]);
  });

  it("rejects setting a feature key that does not exist in the catalog (404), never creates one", async () => {
    const plan = await repository.create(planInput());
    createdPlanIds.push(plan.id);
    const unknownKey = `unknown-${randomUUID()}`;

    await expect(repository.setFeature(plan.id, unknownKey, true)).rejects.toThrow(NotFoundException);

    const featureRow = await raw.feature.findUnique({ where: { key: unknownKey } });
    expect(featureRow).toBeNull();
  });

  it("sets a numeric limit value for a plan, and accepts null (illimité)", async () => {
    const plan = await repository.create(planInput());
    createdPlanIds.push(plan.id);
    const limit = await createLimit();

    const capped = await repository.setLimit(plan.id, limit.key, 25);
    expect(capped.limits).toEqual([{ key: limit.key, label: limit.label, value: 25 }]);

    const unlimited = await repository.setLimit(plan.id, limit.key, null);
    expect(unlimited.limits).toEqual([{ key: limit.key, label: limit.label, value: null }]);
  });

  it("rejects setting a limit key that does not exist in the catalog (404), never creates one", async () => {
    const plan = await repository.create(planInput());
    createdPlanIds.push(plan.id);
    const unknownKey = `unknown-${randomUUID()}`;

    await expect(repository.setLimit(plan.id, unknownKey, 10)).rejects.toThrow(NotFoundException);

    const limitRow = await raw.limit.findUnique({ where: { key: unknownKey } });
    expect(limitRow).toBeNull();
  });

  it("rejects setFeature/setLimit for a plan that does not exist (404)", async () => {
    const feature = await createFeature();
    const limit = await createLimit();

    await expect(repository.setFeature(randomUUID(), feature.key, true)).rejects.toThrow(NotFoundException);
    await expect(repository.setLimit(randomUUID(), limit.key, 1)).rejects.toThrow(NotFoundException);
  });
});
