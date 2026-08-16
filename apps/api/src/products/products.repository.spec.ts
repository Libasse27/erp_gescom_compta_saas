import { ConflictException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { RawDbClient } from "../prisma/raw-db-client";
import { TenantContext } from "../tenant/tenant-context";
import { TenantScopedPrismaService } from "../tenant/tenant-scoped-prisma.service";
import { ProductsRepository } from "./products.repository";

// Comme suppliers.repository.spec.ts : testé directement contre une base
// réelle (via TenantContext.run), sans passer par une route HTTP.
describe("ProductsRepository", () => {
  const prisma = new RawDbClient();
  const tenantPrisma = new TenantScopedPrismaService();
  const repository = new ProductsRepository(tenantPrisma);

  const createdEnterpriseIds: string[] = [];

  beforeAll(async () => {
    await tenantPrisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.enterprise.deleteMany({ where: { id: { in: createdEnterpriseIds } } });
    await tenantPrisma.onModuleDestroy();
    await prisma.$disconnect();
  });

  async function createEnterprise() {
    const enterprise = await prisma.enterprise.create({ data: { name: `Products Repo Test ${randomUUID()}` } });
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
        await repository.create(enterprise.id, {
          code: `SKU-${i}-${randomUUID()}`,
          name: `Produit ${i}`,
          unit: "pièce",
          sellingPriceExcludingTax: 1_000,
          vatRateBasisPoints: 1_800,
          trackStock: true,
        });
      }

      const firstPage = await repository.findMany(enterprise.id, { page: 1, pageSize: 2 });
      expect(firstPage.items).toHaveLength(2);
      expect(firstPage.total).toBe(5);

      const secondPage = await repository.findMany(enterprise.id, { page: 2, pageSize: 2 });
      expect(secondPage.items).toHaveLength(2);
      expect(secondPage.items.map((p) => p.id)).not.toEqual(firstPage.items.map((p) => p.id));
    });
  });

  it("filters by case-insensitive search on name, code and barcode", async () => {
    const enterprise = await createEnterprise();
    await asTenant(enterprise.id, async () => {
      await repository.create(enterprise.id, {
        code: `IMPORT-${randomUUID()}`,
        name: "Riz brisé importé 25kg",
        barcode: "6001234567890",
        unit: "sac",
        sellingPriceExcludingTax: 15_000,
        vatRateBasisPoints: 1_800,
        trackStock: true,
      });
      await repository.create(enterprise.id, {
        code: `LOCAL-${randomUUID()}`,
        name: "Mil local 1kg",
        unit: "kg",
        sellingPriceExcludingTax: 500,
        vatRateBasisPoints: 1_800,
        trackStock: true,
      });

      const byName = await repository.findMany(enterprise.id, { page: 1, pageSize: 20, search: "brisé" });
      expect(byName.items.map((p) => p.name)).toEqual(["Riz brisé importé 25kg"]);

      const byBarcode = await repository.findMany(enterprise.id, { page: 1, pageSize: 20, search: "6001234567890" });
      expect(byBarcode.items.map((p) => p.name)).toEqual(["Riz brisé importé 25kg"]);

      const noMatch = await repository.findMany(enterprise.id, { page: 1, pageSize: 20, search: "introuvable" });
      expect(noMatch.total).toBe(0);
    });
  });

  it("excludes deactivated products when isActive=true is requested, and only returns them when isActive=false", async () => {
    const enterprise = await createEnterprise();
    await asTenant(enterprise.id, async () => {
      const active = await repository.create(enterprise.id, {
        code: `ACTIF-${randomUUID()}`,
        name: "Actif",
        unit: "pièce",
        sellingPriceExcludingTax: 1_000,
        vatRateBasisPoints: 1_800,
        trackStock: true,
      });
      const toDeactivate = await repository.create(enterprise.id, {
        code: `INACTIF-${randomUUID()}`,
        name: "Inactif",
        unit: "pièce",
        sellingPriceExcludingTax: 1_000,
        vatRateBasisPoints: 1_800,
        trackStock: true,
      });
      await repository.deactivate(enterprise.id, toDeactivate.id);

      const activeOnly = await repository.findMany(enterprise.id, { page: 1, pageSize: 20, isActive: true });
      expect(activeOnly.items.map((p) => p.id)).toEqual([active.id]);

      const inactiveOnly = await repository.findMany(enterprise.id, { page: 1, pageSize: 20, isActive: false });
      expect(inactiveOnly.items.map((p) => p.id)).toEqual([toDeactivate.id]);
    });
  });

  it("throws NotFoundException when reading a product that belongs to another enterprise", async () => {
    const enterpriseA = await createEnterprise();
    const enterpriseB = await createEnterprise();

    const productB = await asTenant(enterpriseB.id, () =>
      repository.create(enterpriseB.id, {
        code: `B-${randomUUID()}`,
        name: "Produit de B",
        unit: "pièce",
        sellingPriceExcludingTax: 1_000,
        vatRateBasisPoints: 1_800,
        trackStock: true,
      }),
    );

    await expect(
      asTenant(enterpriseA.id, () => repository.findByIdOrThrow(enterpriseA.id, productB.id)),
    ).rejects.toThrow(NotFoundException);
  });

  it("throws ConflictException when creating a product with a code already used in the same tenant", async () => {
    const enterprise = await createEnterprise();
    await asTenant(enterprise.id, async () => {
      const code = `DUP-${randomUUID()}`;
      await repository.create(enterprise.id, {
        code,
        name: "Premier",
        unit: "pièce",
        sellingPriceExcludingTax: 1_000,
        vatRateBasisPoints: 1_800,
        trackStock: true,
      });

      await expect(
        repository.create(enterprise.id, {
          code,
          name: "Second",
          unit: "pièce",
          sellingPriceExcludingTax: 2_000,
          vatRateBasisPoints: 1_800,
          trackStock: true,
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  it("allows the same code to be reused across different tenants", async () => {
    const enterpriseA = await createEnterprise();
    const enterpriseB = await createEnterprise();
    const code = `SHARED-${randomUUID()}`;

    await asTenant(enterpriseA.id, () =>
      repository.create(enterpriseA.id, {
        code,
        name: "Produit A",
        unit: "pièce",
        sellingPriceExcludingTax: 1_000,
        vatRateBasisPoints: 1_800,
        trackStock: true,
      }),
    );

    await expect(
      asTenant(enterpriseB.id, () =>
        repository.create(enterpriseB.id, {
          code,
          name: "Produit B",
          unit: "pièce",
          sellingPriceExcludingTax: 1_000,
          vatRateBasisPoints: 1_800,
          trackStock: true,
        }),
      ),
    ).resolves.toBeDefined();
  });
});
