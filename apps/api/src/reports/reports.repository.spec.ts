import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { TenantContext } from "../tenant/tenant-context";
import { TenantScopedPrismaService } from "../tenant/tenant-scoped-prisma.service";
import { CustomersRepository } from "../customers/customers.repository";
import { SuppliersRepository } from "../suppliers/suppliers.repository";
import { ProductsRepository } from "../products/products.repository";
import { StockRepository } from "../stock/stock.repository";
import { SalesRepository } from "../sales/sales.repository";
import { PurchasesRepository } from "../purchases/purchases.repository";
import { AccountsRepository } from "../accounting/accounts.repository";
import { JournalRepository } from "../accounting/journal.repository";
import { ReportsRepository } from "./reports.repository";

// Testé directement contre une base réelle, réutilisant les repositories
// déjà testés des modules agrégés (Ventes, Achats, Comptabilité) pour
// préparer les fixtures — même patron que
// purchases.repository.spec.ts/invoicing.repository.spec.ts.
describe("ReportsRepository", () => {
  const prisma = new PrismaService();
  const tenantPrisma = new TenantScopedPrismaService();
  const customersRepository = new CustomersRepository(tenantPrisma);
  const suppliersRepository = new SuppliersRepository(tenantPrisma);
  const productsRepository = new ProductsRepository(tenantPrisma);
  const stockRepository = new StockRepository(tenantPrisma);
  const salesRepository = new SalesRepository(tenantPrisma, stockRepository);
  const purchasesRepository = new PurchasesRepository(tenantPrisma, stockRepository);
  const accountsRepository = new AccountsRepository(tenantPrisma);
  const journalRepository = new JournalRepository(tenantPrisma);
  const repository = new ReportsRepository(tenantPrisma);

  const createdEnterpriseIds: string[] = [];

  beforeAll(async () => {
    await tenantPrisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.journalEntryLine.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.journalEntry.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.journalEntryCounter.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.account.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.saleLine.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.sale.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.purchaseLine.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.purchase.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.product.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.customer.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.supplier.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.enterprise.deleteMany({ where: { id: { in: createdEnterpriseIds } } });
    await tenantPrisma.onModuleDestroy();
    await prisma.$disconnect();
  });

  async function createEnterprise() {
    const enterprise = await prisma.enterprise.create({ data: { name: `Reports Repo Test ${randomUUID()}` } });
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

  function createSupplier(enterpriseId: string) {
    return asTenant(enterpriseId, () =>
      suppliersRepository.create(enterpriseId, { type: "COMPANY", name: "Fournisseur test", country: "Sénégal" }),
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

  it("only counts CONFIRMED sales within the period in the sales report", async () => {
    const enterprise = await createEnterprise();
    const customer = await createCustomer(enterprise.id);
    const product = await createProduct(enterprise.id);

    const confirmedSale = await asTenant(enterprise.id, () =>
      salesRepository.create(enterprise.id, { customerId: customer.id, lines: [{ productId: product.id, quantity: 2 }] }),
    );
    await asTenant(enterprise.id, () => salesRepository.confirm(enterprise.id, confirmedSale.id));

    // Vente DRAFT : ne doit jamais apparaître dans le rapport.
    await asTenant(enterprise.id, () =>
      salesRepository.create(enterprise.id, { customerId: customer.id, lines: [{ productId: product.id, quantity: 100 }] }),
    );

    const report = await asTenant(enterprise.id, () =>
      repository.salesReport(enterprise.id, { dateFrom: undefined, dateTo: undefined }),
    );

    expect(report.count).toBe(1);
    expect(report.totalExcludingTax).toBe(2_000); // 2 x 1000
    expect(report.totalVat).toBe(360); // 18% de 2000
    expect(report.totalIncludingTax).toBe(2_360);
    expect(report.byDay).toHaveLength(1);
    expect(report.byDay[0].count).toBe(1);
  });

  it("excludes sales outside the requested period", async () => {
    const enterprise = await createEnterprise();
    const customer = await createCustomer(enterprise.id);
    const product = await createProduct(enterprise.id);

    const sale = await asTenant(enterprise.id, () =>
      salesRepository.create(enterprise.id, { customerId: customer.id, lines: [{ productId: product.id, quantity: 1 }] }),
    );
    await asTenant(enterprise.id, () => salesRepository.confirm(enterprise.id, sale.id));

    const farFuture = new Date(Date.now() + 365 * 24 * 3600 * 1000);
    const report = await asTenant(enterprise.id, () =>
      repository.salesReport(enterprise.id, { dateFrom: farFuture, dateTo: farFuture }),
    );

    expect(report.count).toBe(0);
    expect(report.totalIncludingTax).toBe(0);
  });

  it("only counts CONFIRMED purchases within the period in the purchases report", async () => {
    const enterprise = await createEnterprise();
    const supplier = await createSupplier(enterprise.id);
    const product = await createProduct(enterprise.id);

    const confirmedPurchase = await asTenant(enterprise.id, () =>
      purchasesRepository.create(enterprise.id, {
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: 3, unitCostExcludingTax: 500 }],
      }),
    );
    await asTenant(enterprise.id, () => purchasesRepository.confirm(enterprise.id, confirmedPurchase.id));

    const report = await asTenant(enterprise.id, () =>
      repository.purchasesReport(enterprise.id, { dateFrom: undefined, dateTo: undefined }),
    );

    expect(report.count).toBe(1);
    expect(report.totalExcludingTax).toBe(1_500); // 3 x 500
    expect(report.totalVat).toBe(270); // 18% de 1500
    expect(report.totalIncludingTax).toBe(1_770);
  });

  it("computes an income statement from class 6/7 journal entry lines, ignoring other classes", async () => {
    const enterprise = await createEnterprise();
    const bank = await asTenant(enterprise.id, () => accountsRepository.create(enterprise.id, { code: "521000", label: "Banque" }));
    const sales = await asTenant(enterprise.id, () => accountsRepository.create(enterprise.id, { code: "701000", label: "Ventes" }));
    const purchases = await asTenant(enterprise.id, () => accountsRepository.create(enterprise.id, { code: "601000", label: "Achats" }));

    // Vente : débit banque (classe 5, hors compte de résultat), crédit ventes (classe 7).
    await asTenant(enterprise.id, () =>
      journalRepository.create(enterprise.id, {
        description: "Vente",
        lines: [
          { accountId: bank.id, debitAmount: 10_000, creditAmount: 0 },
          { accountId: sales.id, debitAmount: 0, creditAmount: 10_000 },
        ],
      }),
    );
    // Achat : débit achats (classe 6), crédit banque (classe 5, hors compte de résultat).
    await asTenant(enterprise.id, () =>
      journalRepository.create(enterprise.id, {
        description: "Achat",
        lines: [
          { accountId: purchases.id, debitAmount: 4_000, creditAmount: 0 },
          { accountId: bank.id, debitAmount: 0, creditAmount: 4_000 },
        ],
      }),
    );

    const statement = await asTenant(enterprise.id, () =>
      repository.incomeStatement(enterprise.id, { dateFrom: undefined, dateTo: undefined }),
    );

    expect(statement.totalRevenue).toBe(10_000);
    expect(statement.totalExpenses).toBe(4_000);
    expect(statement.netResult).toBe(6_000);
    expect(statement.revenueByAccount).toEqual([
      expect.objectContaining({ accountCode: "701000", amount: 10_000 }),
    ]);
    expect(statement.expensesByAccount).toEqual([
      expect.objectContaining({ accountCode: "601000", amount: 4_000 }),
    ]);
    // La ligne banque (classe 5) ne doit apparaître dans aucun des deux tableaux.
    const allAccountIds = [...statement.revenueByAccount, ...statement.expensesByAccount].map((l) => l.accountId);
    expect(allAccountIds).not.toContain(bank.id);
  });
});
