import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { RawDbClient } from "../prisma/raw-db-client";
import { TenantContext } from "../tenant/tenant-context";
import { TenantScopedPrismaService } from "../tenant/tenant-scoped-prisma.service";
import { CustomersRepository } from "../customers/customers.repository";
import { ProductsRepository } from "../products/products.repository";
import { StockRepository } from "../stock/stock.repository";
import { SalesRepository } from "../sales/sales.repository";
import { InvoicingRepository } from "./invoicing.repository";

// Miroir de sales.repository.spec.ts/purchases.repository.spec.ts : testé
// directement contre une base réelle. Réutilise SalesRepository pour
// préparer une vente CONFIRMED (seule fixture pertinente pour ce module,
// qui ne fait que composer une vente déjà existante).
describe("InvoicingRepository", () => {
  const prisma = new RawDbClient();
  const tenantPrisma = new TenantScopedPrismaService();
  const customersRepository = new CustomersRepository(tenantPrisma);
  const productsRepository = new ProductsRepository(tenantPrisma);
  const stockRepository = new StockRepository(tenantPrisma);
  const salesRepository = new SalesRepository(tenantPrisma, stockRepository);
  const repository = new InvoicingRepository(tenantPrisma);

  const createdEnterpriseIds: string[] = [];

  beforeAll(async () => {
    await tenantPrisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.salesInvoice.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.salesInvoiceCounter.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.saleLine.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.sale.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.product.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.customer.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.enterprise.deleteMany({ where: { id: { in: createdEnterpriseIds } } });
    await tenantPrisma.onModuleDestroy();
    await prisma.$disconnect();
  });

  async function createEnterprise() {
    const suffix = randomUUID().slice(0, 8);
    const enterprise = await prisma.enterprise.create({
      data: { name: `Invoicing Repo Test ${randomUUID()}`, legalName: "Ma Société SARL", ninea: suffix, rccm: `SN-DKR-2026-A-${suffix}` },
    });
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

  function createProduct(enterpriseId: string) {
    return asTenant(enterpriseId, () =>
      productsRepository.create(enterpriseId, {
        code: `SKU-${randomUUID()}`,
        name: "Produit test",
        unit: "pièce",
        sellingPriceExcludingTax: 1_000,
        vatRateBasisPoints: 1_800,
        trackStock: false,
      }),
    );
  }

  async function createConfirmedSale(enterpriseId: string, quantity = 2) {
    const customer = await createCustomer(enterpriseId);
    const product = await createProduct(enterpriseId);
    // SalesRepository.create() renvoie désormais { view, created }
    // (docs/adr/0019-...) : seule la vente (view) intéresse ces fixtures.
    const { view: sale } = await asTenant(enterpriseId, () =>
      salesRepository.create(enterpriseId, { customerId: customer.id, lines: [{ productId: product.id, quantity }] }),
    );
    return asTenant(enterpriseId, () => salesRepository.confirm(enterpriseId, sale.id));
  }

  async function createDraftSale(enterpriseId: string) {
    const customer = await createCustomer(enterpriseId);
    const product = await createProduct(enterpriseId);
    const { view: sale } = await asTenant(enterpriseId, () =>
      salesRepository.create(enterpriseId, { customerId: customer.id, lines: [{ productId: product.id, quantity: 1 }] }),
    );
    return sale;
  }

  it("issues an invoice for a CONFIRMED sale, matching its totals, with a sequential number", async () => {
    const enterprise = await createEnterprise();
    const sale = await createConfirmedSale(enterprise.id, 3);

    const invoice = await asTenant(enterprise.id, () => repository.create(enterprise.id, { saleId: sale.id }));

    expect(invoice.status).toBe("ISSUED");
    expect(invoice.saleId).toBe(sale.id);
    expect(invoice.customerId).toBe(sale.customerId);
    expect(invoice.lines).toHaveLength(1);
    expect(invoice.totalExcludingTax).toBe(sale.totalExcludingTax);
    expect(invoice.totalVat).toBe(sale.totalVat);
    expect(invoice.totalIncludingTax).toBe(sale.totalIncludingTax);
    expect(invoice.number).toMatch(new RegExp(`^FACT-${enterprise.id.slice(0, 8).toUpperCase()}-\\d{6}$`));
    expect(invoice.legalMentions).toContain("Ma Société SARL");
  });

  it("numbers invoices sequentially per tenant, without gaps", async () => {
    const enterprise = await createEnterprise();
    const saleA = await createConfirmedSale(enterprise.id);
    const saleB = await createConfirmedSale(enterprise.id);

    const invoiceA = await asTenant(enterprise.id, () => repository.create(enterprise.id, { saleId: saleA.id }));
    const invoiceB = await asTenant(enterprise.id, () => repository.create(enterprise.id, { saleId: saleB.id }));

    expect(invoiceA.number.endsWith("000001")).toBe(true);
    expect(invoiceB.number.endsWith("000002")).toBe(true);
  });

  it("rejects invoicing a sale that is not CONFIRMED", async () => {
    const enterprise = await createEnterprise();
    const draft = await createDraftSale(enterprise.id);

    await expect(
      asTenant(enterprise.id, () => repository.create(enterprise.id, { saleId: draft.id })),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects invoicing a sale that is already invoiced", async () => {
    const enterprise = await createEnterprise();
    const sale = await createConfirmedSale(enterprise.id);
    await asTenant(enterprise.id, () => repository.create(enterprise.id, { saleId: sale.id }));

    await expect(
      asTenant(enterprise.id, () => repository.create(enterprise.id, { saleId: sale.id })),
    ).rejects.toThrow(ConflictException);
  });

  it("rejects invoicing a sale from another tenant", async () => {
    const enterpriseA = await createEnterprise();
    const enterpriseB = await createEnterprise();
    const saleB = await createConfirmedSale(enterpriseB.id);

    await expect(
      asTenant(enterpriseA.id, () => repository.create(enterpriseA.id, { saleId: saleB.id })),
    ).rejects.toThrow(NotFoundException);
  });

  it("marks an ISSUED invoice as PAID, and rejects marking it paid twice", async () => {
    const enterprise = await createEnterprise();
    const sale = await createConfirmedSale(enterprise.id);
    const invoice = await asTenant(enterprise.id, () => repository.create(enterprise.id, { saleId: sale.id }));

    const paid = await asTenant(enterprise.id, () => repository.markPaid(enterprise.id, invoice.id));
    expect(paid.status).toBe("PAID");
    expect(paid.paidAt).not.toBeNull();

    await expect(asTenant(enterprise.id, () => repository.markPaid(enterprise.id, invoice.id))).rejects.toThrow(
      ConflictException,
    );
  });

  it("voids an ISSUED invoice, but rejects voiding a PAID one", async () => {
    const enterprise = await createEnterprise();
    const saleForVoid = await createConfirmedSale(enterprise.id);
    const invoiceToVoid = await asTenant(enterprise.id, () =>
      repository.create(enterprise.id, { saleId: saleForVoid.id }),
    );
    const voided = await asTenant(enterprise.id, () => repository.void(enterprise.id, invoiceToVoid.id));
    expect(voided.status).toBe("VOID");
    expect(voided.voidedAt).not.toBeNull();

    const salePaid = await createConfirmedSale(enterprise.id);
    const invoicePaid = await asTenant(enterprise.id, () => repository.create(enterprise.id, { saleId: salePaid.id }));
    await asTenant(enterprise.id, () => repository.markPaid(enterprise.id, invoicePaid.id));

    await expect(asTenant(enterprise.id, () => repository.void(enterprise.id, invoicePaid.id))).rejects.toThrow(
      BadRequestException,
    );
  });

  it("throws NotFoundException when reading an invoice that belongs to another enterprise", async () => {
    const enterpriseA = await createEnterprise();
    const enterpriseB = await createEnterprise();
    const saleB = await createConfirmedSale(enterpriseB.id);
    const invoiceB = await asTenant(enterpriseB.id, () => repository.create(enterpriseB.id, { saleId: saleB.id }));

    await expect(
      asTenant(enterpriseA.id, () => repository.findByIdOrThrow(enterpriseA.id, invoiceB.id)),
    ).rejects.toThrow(NotFoundException);
  });
});
