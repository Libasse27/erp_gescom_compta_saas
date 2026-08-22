import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
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

  // InvoicingRepository.create() renvoie désormais { view, created }
  // (docs/adr/0019-...) : ce dépouilleur garde la majorité des tests
  // lisibles sans changement supplémentaire.
  async function createInvoice(
    enterpriseId: string,
    input: Parameters<InvoicingRepository["create"]>[1],
    idempotencyKey?: string,
  ) {
    const { view } = await repository.create(enterpriseId, input, idempotencyKey);
    return view;
  }

  it("issues an invoice for a CONFIRMED sale, matching its totals, with a sequential number", async () => {
    const enterprise = await createEnterprise();
    const sale = await createConfirmedSale(enterprise.id, 3);

    const invoice = await asTenant(enterprise.id, () => createInvoice(enterprise.id, { saleId: sale.id }));

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

    const invoiceA = await asTenant(enterprise.id, () => createInvoice(enterprise.id, { saleId: saleA.id }));
    const invoiceB = await asTenant(enterprise.id, () => createInvoice(enterprise.id, { saleId: saleB.id }));

    expect(invoiceA.number.endsWith("000001")).toBe(true);
    expect(invoiceB.number.endsWith("000002")).toBe(true);
  });

  it("rejects invoicing a sale that is not CONFIRMED", async () => {
    const enterprise = await createEnterprise();
    const draft = await createDraftSale(enterprise.id);

    await expect(
      asTenant(enterprise.id, () => createInvoice(enterprise.id, { saleId: draft.id })),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects invoicing a sale that is already invoiced", async () => {
    const enterprise = await createEnterprise();
    const sale = await createConfirmedSale(enterprise.id);
    await asTenant(enterprise.id, () => createInvoice(enterprise.id, { saleId: sale.id }));

    await expect(
      asTenant(enterprise.id, () => createInvoice(enterprise.id, { saleId: sale.id })),
    ).rejects.toThrow(ConflictException);
  });

  it("rejects invoicing a sale from another tenant", async () => {
    const enterpriseA = await createEnterprise();
    const enterpriseB = await createEnterprise();
    const saleB = await createConfirmedSale(enterpriseB.id);

    await expect(
      asTenant(enterpriseA.id, () => createInvoice(enterpriseA.id, { saleId: saleB.id })),
    ).rejects.toThrow(NotFoundException);
  });

  it("marks an ISSUED invoice as PAID, and rejects marking it paid twice", async () => {
    const enterprise = await createEnterprise();
    const sale = await createConfirmedSale(enterprise.id);
    const invoice = await asTenant(enterprise.id, () => createInvoice(enterprise.id, { saleId: sale.id }));

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
      createInvoice(enterprise.id, { saleId: saleForVoid.id }),
    );
    const voided = await asTenant(enterprise.id, () => repository.void(enterprise.id, invoiceToVoid.id));
    expect(voided.status).toBe("VOID");
    expect(voided.voidedAt).not.toBeNull();

    const salePaid = await createConfirmedSale(enterprise.id);
    const invoicePaid = await asTenant(enterprise.id, () => createInvoice(enterprise.id, { saleId: salePaid.id }));
    await asTenant(enterprise.id, () => repository.markPaid(enterprise.id, invoicePaid.id));

    await expect(asTenant(enterprise.id, () => repository.void(enterprise.id, invoicePaid.id))).rejects.toThrow(
      BadRequestException,
    );
  });

  // Régression MOBILE AUDIT-001/ERP-001 (docs/adr/0019-...) : un rejeu de la
  // même clé doit renvoyer la facture déjà émise, jamais l'erreur "déjà
  // facturée" (qui reste correcte pour une tentative sans la même clé).
  it("returns the same invoice without creating a duplicate when the same idempotency key is replayed", async () => {
    const enterprise = await createEnterprise();
    const sale = await createConfirmedSale(enterprise.id);
    const key = randomUUID();

    const first = await asTenant(enterprise.id, () => repository.create(enterprise.id, { saleId: sale.id }, key));
    const second = await asTenant(enterprise.id, () => repository.create(enterprise.id, { saleId: sale.id }, key));

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.view.id).toBe(first.view.id);

    const invoices = await prisma.salesInvoice.findMany({ where: { enterpriseId: enterprise.id } });
    expect(invoices).toHaveLength(1);
  });

  it("still rejects a genuine second invoicing attempt without a matching idempotency key", async () => {
    const enterprise = await createEnterprise();
    const sale = await createConfirmedSale(enterprise.id);

    await asTenant(enterprise.id, () => createInvoice(enterprise.id, { saleId: sale.id }, randomUUID()));

    await expect(
      asTenant(enterprise.id, () => repository.create(enterprise.id, { saleId: sale.id }, randomUUID())),
    ).rejects.toThrow(ConflictException);
  });

  // Régression BIL-23 (docs/audit/BILLING-AUDIT.md) : deux créations
  // réellement concurrentes (Promise.all, pas séquentielles) pour la même
  // vente, sans Idempotency-Key — le check TOCTOU ne suffit pas à lui seul
  // à empêcher les deux requêtes de dépasser la lecture. Sous contention
  // réelle, l'échec de l'INSERT perdant peut remonter sous plusieurs formes
  // Prisma selon le timing exact (P2002 le plus souvent en local, P2028
  // observé sur CI sous contention plus forte — voir invoicing.repository.ts) :
  // ce test ne présume donc pas laquelle, il vérifie seulement le résultat
  // métier attendu dans tous les cas.
  it("resolves a genuine concurrent race without an idempotency key into exactly one success and one 409, never a raw error", async () => {
    const enterprise = await createEnterprise();
    const sale = await createConfirmedSale(enterprise.id);

    const results = await Promise.allSettled([
      asTenant(enterprise.id, () => repository.create(enterprise.id, { saleId: sale.id })),
      asTenant(enterprise.id, () => repository.create(enterprise.id, { saleId: sale.id })),
    ]);

    const fulfilled = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof repository.create>>> => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ConflictException);
    expect((rejected[0].reason as ConflictException).message).toBe("Cette vente est déjà facturée");

    const invoices = await prisma.salesInvoice.findMany({ where: { enterpriseId: enterprise.id } });
    expect(invoices).toHaveLength(1);
  });

  // Régression BIL-23 : preuve déterministe (pas de vraie concurrence
  // temporisée, non reproductible de façon fiable) que la conversion en 409
  // dépend de l'état réel en base, pas d'un pattern-matching sur un code
  // d'erreur Prisma précis. Ici l'erreur simulée (P2028, code arbitraire
  // sans rapport avec une contrainte réelle) n'a normalement rien à voir
  // avec "sale_id" ni "idempotency_key" — seule la présence d'une facture
  // concurrente pour cette vente justifie la conversion.
  it("converts a simulated write error into the business 409 only because a matching invoice now exists", async () => {
    const enterprise = await createEnterprise();
    const sale = await createConfirmedSale(enterprise.id);

    const simulatedError = new Prisma.PrismaClientKnownRequestError(
      "Transaction API error: Transaction already closed: The timeout for this transaction was exceeded.",
      { code: "P2028", clientVersion: "test" },
    );

    // 1er appel findUnique : check TOCTOU (aucune facture concurrente encore
    // visible). 2e appel : re-vérification dans le catch, après l'échec
    // simulé de l'écriture — c'est là qu'une facture "concurrente" apparaît.
    const findUniqueMock = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "concurrent-invoice-id" });
    const findFirstMock = jest.fn();
    const createMock = jest.fn().mockRejectedValue(simulatedError);

    const fakeTx = {
      sale: { findUnique: (args: Parameters<typeof prisma.sale.findUnique>[0]) => prisma.sale.findUnique(args) },
      enterprise: {
        findUniqueOrThrow: (args: Parameters<typeof prisma.enterprise.findUniqueOrThrow>[0]) =>
          prisma.enterprise.findUniqueOrThrow(args),
      },
      salesInvoice: { findUnique: findUniqueMock, findFirst: findFirstMock, create: createMock },
      $queryRaw: jest.fn().mockResolvedValue([{ last_number: 1 }]),
    } as unknown as Prisma.TransactionClient;

    const fakeTenantPrisma = {
      run: (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => callback(fakeTx),
    } as unknown as TenantScopedPrismaService;

    const fakeRepository = new InvoicingRepository(fakeTenantPrisma);

    await expect(fakeRepository.create(enterprise.id, { saleId: sale.id })).rejects.toThrow(ConflictException);
    // Pas de clé d'idempotence fournie : la branche findFirst (idempotencyKey)
    // ne doit jamais être atteinte, seule la branche saleId doit l'être.
    expect(findFirstMock).not.toHaveBeenCalled();
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(findUniqueMock).toHaveBeenCalledTimes(2);
  });

  it("throws NotFoundException when reading an invoice that belongs to another enterprise", async () => {
    const enterpriseA = await createEnterprise();
    const enterpriseB = await createEnterprise();
    const saleB = await createConfirmedSale(enterpriseB.id);
    const invoiceB = await asTenant(enterpriseB.id, () => createInvoice(enterpriseB.id, { saleId: saleB.id }));

    await expect(
      asTenant(enterpriseA.id, () => repository.findByIdOrThrow(enterpriseA.id, invoiceB.id)),
    ).rejects.toThrow(NotFoundException);
  });
});
