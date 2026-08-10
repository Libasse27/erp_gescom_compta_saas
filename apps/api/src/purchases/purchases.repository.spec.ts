import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { TenantContext } from "../tenant/tenant-context";
import { TenantScopedPrismaService } from "../tenant/tenant-scoped-prisma.service";
import { SuppliersRepository } from "../suppliers/suppliers.repository";
import { ProductsRepository } from "../products/products.repository";
import { StockRepository } from "../stock/stock.repository";
import { PurchasesRepository } from "./purchases.repository";

// Miroir de sales.repository.spec.ts (module 5) : testé directement contre
// une base réelle, sans passer par une route HTTP. Suppliers/ProductsRepository
// préparent les fixtures. Différence principale avec Sales : confirm()
// incrémente le stock (jamais de garde "stock insuffisant" côté achat), et
// unitCostExcludingTax est fourni par l'appelant plutôt que résolu depuis
// Product.
describe("PurchasesRepository", () => {
  const prisma = new PrismaService();
  const tenantPrisma = new TenantScopedPrismaService();
  const suppliersRepository = new SuppliersRepository(tenantPrisma);
  const productsRepository = new ProductsRepository(tenantPrisma);
  const stockRepository = new StockRepository(tenantPrisma);
  const repository = new PurchasesRepository(tenantPrisma, stockRepository);

  const createdEnterpriseIds: string[] = [];

  beforeAll(async () => {
    await tenantPrisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.purchaseLine.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.purchase.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.stockMovement.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.product.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.supplier.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.enterprise.deleteMany({ where: { id: { in: createdEnterpriseIds } } });
    await tenantPrisma.onModuleDestroy();
    await prisma.$disconnect();
  });

  async function createEnterprise() {
    const enterprise = await prisma.enterprise.create({ data: { name: `Purchases Repo Test ${randomUUID()}` } });
    createdEnterpriseIds.push(enterprise.id);
    return enterprise;
  }

  function asTenant<T>(enterpriseId: string, fn: () => Promise<T>): Promise<T> {
    return TenantContext.run({ tenantId: enterpriseId, userId: randomUUID(), isSuperAdmin: false }, fn);
  }

  function createSupplier(enterpriseId: string) {
    return asTenant(enterpriseId, () =>
      suppliersRepository.create(enterpriseId, { type: "COMPANY", name: "Fournisseur test", country: "Sénégal" }),
    );
  }

  function createProduct(enterpriseId: string, overrides: { trackStock?: boolean; vatRateBasisPoints?: number } = {}) {
    return asTenant(enterpriseId, () =>
      productsRepository.create(enterpriseId, {
        code: `SKU-${randomUUID()}`,
        name: "Produit test",
        unit: "pièce",
        sellingPriceExcludingTax: 1_000,
        vatRateBasisPoints: overrides.vatRateBasisPoints ?? 1_800,
        trackStock: overrides.trackStock ?? true,
      }),
    );
  }

  it("creates a DRAFT purchase, resolving the product's VAT and using the given cost, computing totals", async () => {
    const enterprise = await createEnterprise();
    const supplier = await createSupplier(enterprise.id);
    const product = await createProduct(enterprise.id);

    const purchase = await asTenant(enterprise.id, () =>
      repository.create(enterprise.id, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 3, unitCostExcludingTax: 700 }],
      }),
    );

    expect(purchase.status).toBe("DRAFT");
    expect(purchase.lines).toHaveLength(1);
    expect(purchase.lines[0].unitCostExcludingTax).toBe(700);
    expect(purchase.lines[0].vatRateBasisPoints).toBe(1_800);
    expect(purchase.lines[0].lineTotalExcludingTax).toBe(2_100); // 3 x 700
    expect(purchase.lines[0].lineTotalVat).toBe(378); // 18% de 2100
    expect(purchase.lines[0].lineTotalIncludingTax).toBe(2_478);
    expect(purchase.totalExcludingTax).toBe(2_100);
    expect(purchase.totalVat).toBe(378);
    expect(purchase.totalIncludingTax).toBe(2_478);
  });

  it("does not let a later product VAT rate change affect an already-created purchase line (VAT snapshot)", async () => {
    const enterprise = await createEnterprise();
    const supplier = await createSupplier(enterprise.id);
    const product = await createProduct(enterprise.id, { vatRateBasisPoints: 1_800 });

    const purchase = await asTenant(enterprise.id, () =>
      repository.create(enterprise.id, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 1, unitCostExcludingTax: 500 }],
      }),
    );

    await asTenant(enterprise.id, () =>
      productsRepository.update(enterprise.id, product.id, { vatRateBasisPoints: 0 }),
    );

    const reloaded = await asTenant(enterprise.id, () => repository.findByIdOrThrow(enterprise.id, purchase.id));
    expect(reloaded.lines[0].vatRateBasisPoints).toBe(1_800);
  });

  it("confirm increments stock for trackStock=true lines (never blocked by insufficient stock)", async () => {
    const enterprise = await createEnterprise();
    const supplier = await createSupplier(enterprise.id);
    const product = await createProduct(enterprise.id, { trackStock: true });

    const purchase = await asTenant(enterprise.id, () =>
      repository.create(enterprise.id, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 8, unitCostExcludingTax: 500 }],
      }),
    );
    const confirmed = await asTenant(enterprise.id, () => repository.confirm(enterprise.id, purchase.id));
    expect(confirmed.status).toBe("CONFIRMED");

    const level = await asTenant(enterprise.id, () => stockRepository.getLevel(enterprise.id, product.id));
    expect(level.quantityOnHand).toBe(8);
  });

  it("confirm works for a product that does not track stock (no movement created)", async () => {
    const enterprise = await createEnterprise();
    const supplier = await createSupplier(enterprise.id);
    const product = await createProduct(enterprise.id, { trackStock: false });

    const purchase = await asTenant(enterprise.id, () =>
      repository.create(enterprise.id, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 100, unitCostExcludingTax: 10 }],
      }),
    );

    const confirmed = await asTenant(enterprise.id, () => repository.confirm(enterprise.id, purchase.id));
    expect(confirmed.status).toBe("CONFIRMED");
  });

  it("rejects confirming a purchase that is not DRAFT", async () => {
    const enterprise = await createEnterprise();
    const supplier = await createSupplier(enterprise.id);
    const product = await createProduct(enterprise.id, { trackStock: false });

    const purchase = await asTenant(enterprise.id, () =>
      repository.create(enterprise.id, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 1, unitCostExcludingTax: 10 }],
      }),
    );
    await asTenant(enterprise.id, () => repository.confirm(enterprise.id, purchase.id));

    await expect(asTenant(enterprise.id, () => repository.confirm(enterprise.id, purchase.id))).rejects.toThrow(
      ConflictException,
    );
  });

  it("cancels a DRAFT purchase but rejects cancelling a CONFIRMED one", async () => {
    const enterprise = await createEnterprise();
    const supplier = await createSupplier(enterprise.id);
    const product = await createProduct(enterprise.id, { trackStock: false });

    const draft = await asTenant(enterprise.id, () =>
      repository.create(enterprise.id, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 1, unitCostExcludingTax: 10 }],
      }),
    );
    const cancelled = await asTenant(enterprise.id, () => repository.cancel(enterprise.id, draft.id));
    expect(cancelled.status).toBe("CANCELLED");

    const confirmedPurchase = await asTenant(enterprise.id, () =>
      repository.create(enterprise.id, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 1, unitCostExcludingTax: 10 }],
      }),
    );
    await asTenant(enterprise.id, () => repository.confirm(enterprise.id, confirmedPurchase.id));

    await expect(
      asTenant(enterprise.id, () => repository.cancel(enterprise.id, confirmedPurchase.id)),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects creating a purchase that references a product from another tenant", async () => {
    const enterpriseA = await createEnterprise();
    const enterpriseB = await createEnterprise();
    const supplierA = await createSupplier(enterpriseA.id);
    const productB = await createProduct(enterpriseB.id);

    await expect(
      asTenant(enterpriseA.id, () =>
        repository.create(enterpriseA.id, {
          supplierId: supplierA.id,
          lines: [{ productId: productB.id, quantity: 1, unitCostExcludingTax: 10 }],
        }),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it("throws NotFoundException when reading a purchase that belongs to another enterprise", async () => {
    const enterpriseA = await createEnterprise();
    const enterpriseB = await createEnterprise();
    const supplierB = await createSupplier(enterpriseB.id);
    const productB = await createProduct(enterpriseB.id);

    const purchaseB = await asTenant(enterpriseB.id, () =>
      repository.create(enterpriseB.id, {
        supplierId: supplierB.id,
        lines: [{ productId: productB.id, quantity: 1, unitCostExcludingTax: 10 }],
      }),
    );

    await expect(
      asTenant(enterpriseA.id, () => repository.findByIdOrThrow(enterpriseA.id, purchaseB.id)),
    ).rejects.toThrow(NotFoundException);
  });
});
