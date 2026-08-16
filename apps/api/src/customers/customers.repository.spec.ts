import { NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { RawDbClient } from "../prisma/raw-db-client";
import { TenantContext } from "../tenant/tenant-context";
import { TenantScopedPrismaService } from "../tenant/tenant-scoped-prisma.service";
import { CustomersRepository } from "./customers.repository";

// Comme feature.guard.spec.ts : testé directement contre une base réelle
// (via TenantContext.run), sans passer par une route HTTP — la pagination et
// la recherche sont des préoccupations du repository, pas du contrôleur.
describe("CustomersRepository", () => {
  const prisma = new RawDbClient();
  const tenantPrisma = new TenantScopedPrismaService();
  const repository = new CustomersRepository(tenantPrisma);

  const createdEnterpriseIds: string[] = [];

  beforeAll(async () => {
    await tenantPrisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.customer.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.enterprise.deleteMany({ where: { id: { in: createdEnterpriseIds } } });
    await tenantPrisma.onModuleDestroy();
    await prisma.$disconnect();
  });

  async function createEnterprise() {
    const enterprise = await prisma.enterprise.create({ data: { name: `Customers Repo Test ${randomUUID()}` } });
    createdEnterpriseIds.push(enterprise.id);
    return enterprise;
  }

  function asTenant<T>(enterpriseId: string, fn: () => Promise<T>): Promise<T> {
    return TenantContext.run({ tenantId: enterpriseId, userId: randomUUID(), isSuperAdmin: false }, fn);
  }

  it("paginates results and reports the total independently of the page size", async () => {
    const enterprise = await createEnterprise();
    await asTenant(enterprise.id, async () => {
      for (let i = 0; i < 5; i += 1) {
        await repository.create(enterprise.id, { type: "COMPANY", name: `Client ${i}`, country: "Sénégal" });
      }

      const firstPage = await repository.findMany(enterprise.id, { page: 1, pageSize: 2 });
      expect(firstPage.items).toHaveLength(2);
      expect(firstPage.total).toBe(5);

      const secondPage = await repository.findMany(enterprise.id, { page: 2, pageSize: 2 });
      expect(secondPage.items).toHaveLength(2);
      expect(secondPage.items.map((c) => c.id)).not.toEqual(firstPage.items.map((c) => c.id));
    });
  });

  it("filters by case-insensitive search on name and email", async () => {
    const enterprise = await createEnterprise();
    await asTenant(enterprise.id, async () => {
      await repository.create(enterprise.id, {
        type: "COMPANY",
        name: "Sénégal Distribution SARL",
        email: "contact@senegaldistrib.sn",
        country: "Sénégal",
      });
      await repository.create(enterprise.id, { type: "INDIVIDUAL", name: "Awa Diop", country: "Sénégal" });

      const byName = await repository.findMany(enterprise.id, { page: 1, pageSize: 20, search: "distribution" });
      expect(byName.items.map((c) => c.name)).toEqual(["Sénégal Distribution SARL"]);

      const byEmail = await repository.findMany(enterprise.id, { page: 1, pageSize: 20, search: "SENEGALDISTRIB" });
      expect(byEmail.items.map((c) => c.name)).toEqual(["Sénégal Distribution SARL"]); // recherche insensible à la casse

      const noMatch = await repository.findMany(enterprise.id, { page: 1, pageSize: 20, search: "introuvable" });
      expect(noMatch.total).toBe(0);
    });
  });

  it("excludes deactivated customers when isActive=true is requested, and only returns them when isActive=false", async () => {
    const enterprise = await createEnterprise();
    await asTenant(enterprise.id, async () => {
      const active = await repository.create(enterprise.id, { type: "COMPANY", name: "Actif SARL", country: "Sénégal" });
      const toDeactivate = await repository.create(enterprise.id, {
        type: "COMPANY",
        name: "Inactif SARL",
        country: "Sénégal",
      });
      await repository.deactivate(enterprise.id, toDeactivate.id);

      const activeOnly = await repository.findMany(enterprise.id, { page: 1, pageSize: 20, isActive: true });
      expect(activeOnly.items.map((c) => c.id)).toEqual([active.id]);

      const inactiveOnly = await repository.findMany(enterprise.id, { page: 1, pageSize: 20, isActive: false });
      expect(inactiveOnly.items.map((c) => c.id)).toEqual([toDeactivate.id]);
    });
  });

  it("throws NotFoundException when reading a customer that belongs to another enterprise", async () => {
    const enterpriseA = await createEnterprise();
    const enterpriseB = await createEnterprise();

    const customerB = await asTenant(enterpriseB.id, () =>
      repository.create(enterpriseB.id, { type: "COMPANY", name: "Tenant B SARL", country: "Sénégal" }),
    );

    await expect(
      asTenant(enterpriseA.id, () => repository.findByIdOrThrow(enterpriseA.id, customerB.id)),
    ).rejects.toThrow(NotFoundException);
  });
});
