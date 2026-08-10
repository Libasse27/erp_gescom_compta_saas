import { NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { TenantContext } from "../tenant/tenant-context";
import { TenantScopedPrismaService } from "../tenant/tenant-scoped-prisma.service";
import { SuppliersRepository } from "./suppliers.repository";

// Comme customers.repository.spec.ts : testé directement contre une base
// réelle (via TenantContext.run), sans passer par une route HTTP.
describe("SuppliersRepository", () => {
  const prisma = new PrismaService();
  const tenantPrisma = new TenantScopedPrismaService();
  const repository = new SuppliersRepository(tenantPrisma);

  const createdEnterpriseIds: string[] = [];

  beforeAll(async () => {
    await tenantPrisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.supplier.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.enterprise.deleteMany({ where: { id: { in: createdEnterpriseIds } } });
    await tenantPrisma.onModuleDestroy();
    await prisma.$disconnect();
  });

  async function createEnterprise() {
    const enterprise = await prisma.enterprise.create({ data: { name: `Suppliers Repo Test ${randomUUID()}` } });
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
        await repository.create(enterprise.id, { type: "COMPANY", name: `Fournisseur ${i}`, country: "Sénégal" });
      }

      const firstPage = await repository.findMany(enterprise.id, { page: 1, pageSize: 2 });
      expect(firstPage.items).toHaveLength(2);
      expect(firstPage.total).toBe(5);

      const secondPage = await repository.findMany(enterprise.id, { page: 2, pageSize: 2 });
      expect(secondPage.items).toHaveLength(2);
      expect(secondPage.items.map((s) => s.id)).not.toEqual(firstPage.items.map((s) => s.id));
    });
  });

  it("filters by case-insensitive search on name and email", async () => {
    const enterprise = await createEnterprise();
    await asTenant(enterprise.id, async () => {
      await repository.create(enterprise.id, {
        type: "COMPANY",
        name: "Import Export Sénégal SARL",
        email: "contact@importexport.sn",
        country: "Sénégal",
      });
      await repository.create(enterprise.id, { type: "INDIVIDUAL", name: "Moussa Fall", country: "Sénégal" });

      const byName = await repository.findMany(enterprise.id, { page: 1, pageSize: 20, search: "export" });
      expect(byName.items.map((s) => s.name)).toEqual(["Import Export Sénégal SARL"]);

      const byEmail = await repository.findMany(enterprise.id, { page: 1, pageSize: 20, search: "IMPORTEXPORT" });
      expect(byEmail.items.map((s) => s.name)).toEqual(["Import Export Sénégal SARL"]); // recherche insensible à la casse

      const noMatch = await repository.findMany(enterprise.id, { page: 1, pageSize: 20, search: "introuvable" });
      expect(noMatch.total).toBe(0);
    });
  });

  it("excludes deactivated suppliers when isActive=true is requested, and only returns them when isActive=false", async () => {
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
      expect(activeOnly.items.map((s) => s.id)).toEqual([active.id]);

      const inactiveOnly = await repository.findMany(enterprise.id, { page: 1, pageSize: 20, isActive: false });
      expect(inactiveOnly.items.map((s) => s.id)).toEqual([toDeactivate.id]);
    });
  });

  it("throws NotFoundException when reading a supplier that belongs to another enterprise", async () => {
    const enterpriseA = await createEnterprise();
    const enterpriseB = await createEnterprise();

    const supplierB = await asTenant(enterpriseB.id, () =>
      repository.create(enterpriseB.id, { type: "COMPANY", name: "Tenant B SARL", country: "Sénégal" }),
    );

    await expect(
      asTenant(enterpriseA.id, () => repository.findByIdOrThrow(enterpriseA.id, supplierB.id)),
    ).rejects.toThrow(NotFoundException);
  });
});
