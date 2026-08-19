import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { RawDbClient } from "../prisma/raw-db-client";
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
  const prisma = new RawDbClient();
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

  // create() renvoie désormais { view, created } (docs/adr/0019-...) : ce
  // dépouilleur garde la majorité des tests lisibles sans changement
  // supplémentaire.
  async function createPurchase(
    enterpriseId: string,
    input: Parameters<PurchasesRepository["create"]>[1],
    idempotencyKey?: string,
  ) {
    const { view } = await repository.create(enterpriseId, input, idempotencyKey);
    return view;
  }

  it("creates a DRAFT purchase, resolving the product's VAT and using the given cost, computing totals", async () => {
    const enterprise = await createEnterprise();
    const supplier = await createSupplier(enterprise.id);
    const product = await createProduct(enterprise.id);

    const purchase = await asTenant(enterprise.id, () =>
      createPurchase(enterprise.id, {
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
      createPurchase(enterprise.id, {
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
      createPurchase(enterprise.id, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 8, unitCostExcludingTax: 500 }],
      }),
    );
    const confirmed = await asTenant(enterprise.id, () => repository.confirm(enterprise.id, purchase.id));
    expect(confirmed.status).toBe("CONFIRMED");

    const level = await asTenant(enterprise.id, () => stockRepository.getLevel(enterprise.id, product.id));
    expect(level.quantityOnHand).toBe(8);
  });

  // Câblage de runWithSerializableRetry — même patron que
  // sales.repository.spec.ts : simule un P2034 persistant sur toutes les
  // tentatives, vérifie uniquement que le contrat 409 existant survit à
  // l'ajout du wrapper (la retry logic elle-même est testée en isolation
  // dans common/serializable-retry.spec.ts).
  it("still surfaces a 409 ConflictException after exhausting retries on a persistent P2034", async () => {
    const enterprise = await createEnterprise();
    const supplier = await createSupplier(enterprise.id);
    const product = await createProduct(enterprise.id, { trackStock: false });
    const purchase = await asTenant(enterprise.id, () =>
      createPurchase(enterprise.id, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 1, unitCostExcludingTax: 10 }],
      }),
    );

    const persistentConflict = new Prisma.PrismaClientKnownRequestError(
      "Transaction failed due to a write conflict or a deadlock. Please retry your transaction",
      { code: "P2034", clientVersion: "test" },
    );
    const runSpy = jest.spyOn(tenantPrisma, "run").mockRejectedValue(persistentConflict);

    await expect(asTenant(enterprise.id, () => repository.confirm(enterprise.id, purchase.id))).rejects.toThrow(
      ConflictException,
    );
    expect(runSpy).toHaveBeenCalledTimes(3); // maxAttempts par défaut de runWithSerializableRetry

    runSpy.mockRestore();
  });

  it("confirm works for a product that does not track stock (no movement created)", async () => {
    const enterprise = await createEnterprise();
    const supplier = await createSupplier(enterprise.id);
    const product = await createProduct(enterprise.id, { trackStock: false });

    const purchase = await asTenant(enterprise.id, () =>
      createPurchase(enterprise.id, {
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
      createPurchase(enterprise.id, {
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
      createPurchase(enterprise.id, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 1, unitCostExcludingTax: 10 }],
      }),
    );
    const cancelled = await asTenant(enterprise.id, () => repository.cancel(enterprise.id, draft.id));
    expect(cancelled.status).toBe("CANCELLED");

    const confirmedPurchase = await asTenant(enterprise.id, () =>
      createPurchase(enterprise.id, {
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
        createPurchase(enterpriseA.id, {
          supplierId: supplierA.id,
          lines: [{ productId: productB.id, quantity: 1, unitCostExcludingTax: 10 }],
        }),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  // Régression MOBILE AUDIT-001/ERP-001 (docs/adr/0019-...) — même patron
  // que sales.repository.spec.ts.
  it("returns the same purchase without creating a duplicate when the same idempotency key is replayed", async () => {
    const enterprise = await createEnterprise();
    const supplier = await createSupplier(enterprise.id);
    const product = await createProduct(enterprise.id);
    const key = randomUUID();
    const input = { supplierId: supplier.id, lines: [{ productId: product.id, quantity: 2, unitCostExcludingTax: 500 }] };

    const first = await asTenant(enterprise.id, () => repository.create(enterprise.id, input, key));
    const second = await asTenant(enterprise.id, () => repository.create(enterprise.id, input, key));

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.view.id).toBe(first.view.id);

    const purchases = await prisma.purchase.findMany({ where: { enterpriseId: enterprise.id } });
    expect(purchases).toHaveLength(1);
  });

  it("creates two distinct purchases when the idempotency key differs", async () => {
    const enterprise = await createEnterprise();
    const supplier = await createSupplier(enterprise.id);
    const product = await createProduct(enterprise.id);
    const input = { supplierId: supplier.id, lines: [{ productId: product.id, quantity: 1, unitCostExcludingTax: 10 }] };

    const first = await asTenant(enterprise.id, () => createPurchase(enterprise.id, input, randomUUID()));
    const second = await asTenant(enterprise.id, () => createPurchase(enterprise.id, input, randomUUID()));

    expect(first.id).not.toBe(second.id);
    const purchases = await prisma.purchase.findMany({ where: { enterpriseId: enterprise.id } });
    expect(purchases).toHaveLength(2);
  });

  it("throws NotFoundException when reading a purchase that belongs to another enterprise", async () => {
    const enterpriseA = await createEnterprise();
    const enterpriseB = await createEnterprise();
    const supplierB = await createSupplier(enterpriseB.id);
    const productB = await createProduct(enterpriseB.id);

    const purchaseB = await asTenant(enterpriseB.id, () =>
      createPurchase(enterpriseB.id, {
        supplierId: supplierB.id,
        lines: [{ productId: productB.id, quantity: 1, unitCostExcludingTax: 10 }],
      }),
    );

    await expect(
      asTenant(enterpriseA.id, () => repository.findByIdOrThrow(enterpriseA.id, purchaseB.id)),
    ).rejects.toThrow(NotFoundException);
  });
});
