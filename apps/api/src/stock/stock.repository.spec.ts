import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { RawDbClient } from "../prisma/raw-db-client";
import { TenantContext } from "../tenant/tenant-context";
import { TenantScopedPrismaService } from "../tenant/tenant-scoped-prisma.service";
import { ProductsRepository } from "../products/products.repository";
import { StockRepository } from "./stock.repository";

// Comme products.repository.spec.ts : testé directement contre une base
// réelle (via TenantContext.run), sans passer par une route HTTP.
// ProductsRepository sert uniquement à préparer les produits nécessaires aux
// mouvements (réutilise le module déjà testé plutôt que de dupliquer sa
// logique de création).
describe("StockRepository", () => {
  const prisma = new RawDbClient();
  const tenantPrisma = new TenantScopedPrismaService();
  const productsRepository = new ProductsRepository(tenantPrisma);
  const repository = new StockRepository(tenantPrisma);

  const createdEnterpriseIds: string[] = [];

  beforeAll(async () => {
    await tenantPrisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.stockMovement.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.product.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.enterprise.deleteMany({ where: { id: { in: createdEnterpriseIds } } });
    await tenantPrisma.onModuleDestroy();
    await prisma.$disconnect();
  });

  async function createEnterprise() {
    const enterprise = await prisma.enterprise.create({ data: { name: `Stock Repo Test ${randomUUID()}` } });
    createdEnterpriseIds.push(enterprise.id);
    return enterprise;
  }

  function asTenant<T>(enterpriseId: string, fn: () => Promise<T>): Promise<T> {
    return TenantContext.run({ tenantId: enterpriseId, userId: randomUUID(), isSuperAdmin: false }, fn);
  }

  function createTrackedProduct(enterpriseId: string, trackStock = true) {
    return asTenant(enterpriseId, () =>
      productsRepository.create(enterpriseId, {
        code: `SKU-${randomUUID()}`,
        name: "Produit test",
        unit: "pièce",
        sellingPriceExcludingTax: 1_000,
        vatRateBasisPoints: 1_800,
        trackStock,
      }),
    );
  }

  it("computes quantityOnHand by aggregating IN, OUT and ADJUSTMENT movements", async () => {
    const enterprise = await createEnterprise();
    const product = await createTrackedProduct(enterprise.id);

    await asTenant(enterprise.id, async () => {
      await repository.createMovement(enterprise.id, { productId: product.id, type: "IN", quantity: 100 });
      await repository.createMovement(enterprise.id, { productId: product.id, type: "OUT", quantity: 30 });
      const result = await repository.createMovement(enterprise.id, {
        productId: product.id,
        type: "ADJUSTMENT",
        quantity: -5,
      });

      expect(result.quantityOnHand).toBe(65); // 100 - 30 - 5

      const level = await repository.getLevel(enterprise.id, product.id);
      expect(level.quantityOnHand).toBe(65);
    });
  });

  it("rejects a movement that would bring the stock below zero", async () => {
    const enterprise = await createEnterprise();
    const product = await createTrackedProduct(enterprise.id);

    await asTenant(enterprise.id, async () => {
      await repository.createMovement(enterprise.id, { productId: product.id, type: "IN", quantity: 10 });

      await expect(
        repository.createMovement(enterprise.id, { productId: product.id, type: "OUT", quantity: 11 }),
      ).rejects.toThrow(ConflictException);
    });
  });

  it("rejects a movement on a product that does not track stock", async () => {
    const enterprise = await createEnterprise();
    const product = await createTrackedProduct(enterprise.id, false);

    await asTenant(enterprise.id, () =>
      expect(
        repository.createMovement(enterprise.id, { productId: product.id, type: "IN", quantity: 10 }),
      ).rejects.toThrow(BadRequestException),
    );
  });

  it("throws NotFoundException when reading the level of a product that belongs to another enterprise", async () => {
    const enterpriseA = await createEnterprise();
    const enterpriseB = await createEnterprise();
    const productB = await createTrackedProduct(enterpriseB.id);

    await expect(asTenant(enterpriseA.id, () => repository.getLevel(enterpriseA.id, productB.id))).rejects.toThrow(
      NotFoundException,
    );
  });

  it("lists movements for a product, most recent first", async () => {
    const enterprise = await createEnterprise();
    const product = await createTrackedProduct(enterprise.id);

    await asTenant(enterprise.id, async () => {
      await repository.createMovement(enterprise.id, {
        productId: product.id,
        type: "IN",
        quantity: 10,
        note: "Réception 1",
      });
      await repository.createMovement(enterprise.id, {
        productId: product.id,
        type: "IN",
        quantity: 5,
        note: "Réception 2",
      });

      const movements = await repository.findMovements(enterprise.id, product.id, { page: 1, pageSize: 20 });
      expect(movements.total).toBe(2);
      // Pas de dépendance à l'ordre exact entre deux insertions rapprochées
      // (résolution timestamp(3) = milliseconde, ordre non garanti en cas
      // d'égalité) : on vérifie la non-décroissance plutôt qu'un ordre strict.
      expect(movements.items[0].createdAt.getTime()).toBeGreaterThanOrEqual(movements.items[1].createdAt.getTime());
      expect(movements.items.map((m) => m.note).sort()).toEqual(["Réception 1", "Réception 2"]);
    });
  });

  it("only counts products with trackStock=true in the paginated stock level list", async () => {
    const enterprise = await createEnterprise();
    const tracked = await createTrackedProduct(enterprise.id);
    await createTrackedProduct(enterprise.id, false);

    await asTenant(enterprise.id, async () => {
      const levels = await repository.findLevels(enterprise.id, { page: 1, pageSize: 20 });
      expect(levels.items.map((l) => l.productId)).toEqual([tracked.id]);
    });
  });
});
