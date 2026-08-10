import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { TenantContext } from "../tenant/tenant-context";
import { TenantScopedPrismaService } from "../tenant/tenant-scoped-prisma.service";
import { CustomersRepository } from "../customers/customers.repository";
import { ProductsRepository } from "../products/products.repository";
import { StockRepository } from "../stock/stock.repository";
import { SalesRepository } from "./sales.repository";

// Comme products.repository.spec.ts : testé directement contre une base
// réelle (via TenantContext.run), sans passer par une route HTTP.
// Customers/ProductsRepository préparent les fixtures (réutilise les modules
// déjà testés plutôt que de dupliquer leur logique de création).
describe("SalesRepository", () => {
  const prisma = new PrismaService();
  const tenantPrisma = new TenantScopedPrismaService();
  const customersRepository = new CustomersRepository(tenantPrisma);
  const productsRepository = new ProductsRepository(tenantPrisma);
  const stockRepository = new StockRepository(tenantPrisma);
  const repository = new SalesRepository(tenantPrisma, stockRepository);

  const createdEnterpriseIds: string[] = [];

  beforeAll(async () => {
    await tenantPrisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.saleLine.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.sale.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.stockMovement.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.product.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.customer.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.enterprise.deleteMany({ where: { id: { in: createdEnterpriseIds } } });
    await tenantPrisma.onModuleDestroy();
    await prisma.$disconnect();
  });

  async function createEnterprise() {
    const enterprise = await prisma.enterprise.create({ data: { name: `Sales Repo Test ${randomUUID()}` } });
    createdEnterpriseIds.push(enterprise.id);
    return enterprise;
  }

  function asTenant<T>(enterpriseId: string, fn: () => Promise<T>): Promise<T> {
    return TenantContext.run({ tenantId: enterpriseId, userId: randomUUID(), isSuperAdmin: false }, fn);
  }

  function createCustomer(enterpriseId: string) {
    return asTenant(enterpriseId, () =>
      customersRepository.create(enterpriseId, { type: "COMPANY", name: "Client test", country: "Sénégal" }),
    );
  }

  function createProduct(enterpriseId: string, overrides: { trackStock?: boolean; price?: number } = {}) {
    return asTenant(enterpriseId, () =>
      productsRepository.create(enterpriseId, {
        code: `SKU-${randomUUID()}`,
        name: "Produit test",
        unit: "pièce",
        sellingPriceExcludingTax: overrides.price ?? 1_000,
        vatRateBasisPoints: 1_800,
        trackStock: overrides.trackStock ?? true,
      }),
    );
  }

  it("creates a DRAFT sale, snapshotting the product's price/VAT and computing totals", async () => {
    const enterprise = await createEnterprise();
    const customer = await createCustomer(enterprise.id);
    const product = await createProduct(enterprise.id, { price: 1_000 });

    const sale = await asTenant(enterprise.id, () =>
      repository.create(enterprise.id, { customerId: customer.id, lines: [{ productId: product.id, quantity: 3 }] }),
    );

    expect(sale.status).toBe("DRAFT");
    expect(sale.lines).toHaveLength(1);
    expect(sale.lines[0].unitPriceExcludingTax).toBe(1_000);
    expect(sale.lines[0].vatRateBasisPoints).toBe(1_800);
    expect(sale.lines[0].lineTotalExcludingTax).toBe(3_000); // 3 x 1000
    expect(sale.lines[0].lineTotalVat).toBe(540); // 18% de 3000
    expect(sale.lines[0].lineTotalIncludingTax).toBe(3_540);
    expect(sale.totalExcludingTax).toBe(3_000);
    expect(sale.totalVat).toBe(540);
    expect(sale.totalIncludingTax).toBe(3_540);
  });

  it("does not let a later product price change affect an already-created sale line (price snapshot)", async () => {
    const enterprise = await createEnterprise();
    const customer = await createCustomer(enterprise.id);
    const product = await createProduct(enterprise.id, { price: 1_000 });

    const sale = await asTenant(enterprise.id, () =>
      repository.create(enterprise.id, { customerId: customer.id, lines: [{ productId: product.id, quantity: 1 }] }),
    );

    await asTenant(enterprise.id, () =>
      productsRepository.update(enterprise.id, product.id, { sellingPriceExcludingTax: 5_000 }),
    );

    const reloaded = await asTenant(enterprise.id, () => repository.findByIdOrThrow(enterprise.id, sale.id));
    expect(reloaded.lines[0].unitPriceExcludingTax).toBe(1_000);
  });

  it("confirm decrements stock for trackStock=true lines and rejects when stock is insufficient", async () => {
    const enterprise = await createEnterprise();
    const customer = await createCustomer(enterprise.id);
    const product = await createProduct(enterprise.id, { trackStock: true });

    await asTenant(enterprise.id, () =>
      stockRepository.createMovement(enterprise.id, { productId: product.id, type: "IN", quantity: 5 }),
    );

    const shortSale = await asTenant(enterprise.id, () =>
      repository.create(enterprise.id, { customerId: customer.id, lines: [{ productId: product.id, quantity: 10 }] }),
    );
    await expect(asTenant(enterprise.id, () => repository.confirm(enterprise.id, shortSale.id))).rejects.toThrow(
      ConflictException,
    );

    const okSale = await asTenant(enterprise.id, () =>
      repository.create(enterprise.id, { customerId: customer.id, lines: [{ productId: product.id, quantity: 5 }] }),
    );
    const confirmed = await asTenant(enterprise.id, () => repository.confirm(enterprise.id, okSale.id));
    expect(confirmed.status).toBe("CONFIRMED");

    const level = await asTenant(enterprise.id, () => stockRepository.getLevel(enterprise.id, product.id));
    expect(level.quantityOnHand).toBe(0); // 5 reçus - 5 vendus
  });

  it("confirm does not require stock for a product that does not track stock", async () => {
    const enterprise = await createEnterprise();
    const customer = await createCustomer(enterprise.id);
    const product = await createProduct(enterprise.id, { trackStock: false });

    const sale = await asTenant(enterprise.id, () =>
      repository.create(enterprise.id, { customerId: customer.id, lines: [{ productId: product.id, quantity: 100 }] }),
    );

    const confirmed = await asTenant(enterprise.id, () => repository.confirm(enterprise.id, sale.id));
    expect(confirmed.status).toBe("CONFIRMED");
  });

  it("rejects confirming a sale that is not DRAFT", async () => {
    const enterprise = await createEnterprise();
    const customer = await createCustomer(enterprise.id);
    const product = await createProduct(enterprise.id, { trackStock: false });

    const sale = await asTenant(enterprise.id, () =>
      repository.create(enterprise.id, { customerId: customer.id, lines: [{ productId: product.id, quantity: 1 }] }),
    );
    await asTenant(enterprise.id, () => repository.confirm(enterprise.id, sale.id));

    await expect(asTenant(enterprise.id, () => repository.confirm(enterprise.id, sale.id))).rejects.toThrow(
      ConflictException,
    );
  });

  it("cancels a DRAFT sale but rejects cancelling a CONFIRMED one", async () => {
    const enterprise = await createEnterprise();
    const customer = await createCustomer(enterprise.id);
    const product = await createProduct(enterprise.id, { trackStock: false });

    const draft = await asTenant(enterprise.id, () =>
      repository.create(enterprise.id, { customerId: customer.id, lines: [{ productId: product.id, quantity: 1 }] }),
    );
    const cancelled = await asTenant(enterprise.id, () => repository.cancel(enterprise.id, draft.id));
    expect(cancelled.status).toBe("CANCELLED");

    const confirmedSale = await asTenant(enterprise.id, () =>
      repository.create(enterprise.id, { customerId: customer.id, lines: [{ productId: product.id, quantity: 1 }] }),
    );
    await asTenant(enterprise.id, () => repository.confirm(enterprise.id, confirmedSale.id));

    await expect(asTenant(enterprise.id, () => repository.cancel(enterprise.id, confirmedSale.id))).rejects.toThrow(
      BadRequestException,
    );
  });

  it("rejects creating a sale that references a product from another tenant", async () => {
    const enterpriseA = await createEnterprise();
    const enterpriseB = await createEnterprise();
    const customerA = await createCustomer(enterpriseA.id);
    const productB = await createProduct(enterpriseB.id);

    await expect(
      asTenant(enterpriseA.id, () =>
        repository.create(enterpriseA.id, { customerId: customerA.id, lines: [{ productId: productB.id, quantity: 1 }] }),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it("throws NotFoundException when reading a sale that belongs to another enterprise", async () => {
    const enterpriseA = await createEnterprise();
    const enterpriseB = await createEnterprise();
    const customerB = await createCustomer(enterpriseB.id);
    const productB = await createProduct(enterpriseB.id);

    const saleB = await asTenant(enterpriseB.id, () =>
      repository.create(enterpriseB.id, { customerId: customerB.id, lines: [{ productId: productB.id, quantity: 1 }] }),
    );

    await expect(asTenant(enterpriseA.id, () => repository.findByIdOrThrow(enterpriseA.id, saleB.id))).rejects.toThrow(
      NotFoundException,
    );
  });
});
