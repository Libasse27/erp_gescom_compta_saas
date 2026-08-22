import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Enterprise, Customer, InvoiceStatus, Prisma } from "@prisma/client";
import { CreateSalesInvoiceInput, ListSalesInvoicesQuery } from "@erp/validation";
import { TenantScopedPrismaService } from "../tenant/tenant-scoped-prisma.service";

// Vues calculées, comme SaleView/PurchaseView. Les lignes sont celles de la
// vente liée (voir schema.prisma, model SalesInvoice) — pas un modèle Prisma
// propre.
export interface SalesInvoiceLineView {
  id: string;
  productId: string;
  productCode: string;
  productName: string;
  quantity: number;
  unitPriceExcludingTax: number;
  vatRateBasisPoints: number;
  lineTotalExcludingTax: number;
  lineTotalVat: number;
  lineTotalIncludingTax: number;
}

export interface SalesInvoiceView {
  id: string;
  enterpriseId: string;
  saleId: string;
  customerId: string;
  customerName: string;
  number: string;
  status: InvoiceStatus;
  issuedAt: Date;
  paidAt: Date | null;
  voidedAt: Date | null;
  legalMentions: string;
  totalExcludingTax: number;
  totalVat: number;
  totalIncludingTax: number;
  lines: SalesInvoiceLineView[];
  createdAt: Date;
  updatedAt: Date;
}

export interface SalesInvoiceListItem {
  id: string;
  saleId: string;
  customerId: string;
  customerName: string;
  number: string;
  status: InvoiceStatus;
  issuedAt: Date;
  totalExcludingTax: number;
  totalVat: number;
  totalIncludingTax: number;
  createdAt: Date;
}

export interface SalesInvoiceListResult {
  items: SalesInvoiceListItem[];
  total: number;
  page: number;
  pageSize: number;
}

// `created: false` signale un rejeu déduplié (docs/adr/0019-...) — même
// patron que CreateSaleResult.
export interface CreateSalesInvoiceResult {
  view: SalesInvoiceView;
  created: boolean;
}

type SaleWithLinesAndCustomer = Prisma.SaleGetPayload<{
  include: { lines: { include: { product: true } }; customer: true };
}>;

interface InvoiceRow {
  id: string;
  number: string;
  status: InvoiceStatus;
  issuedAt: Date;
  paidAt: Date | null;
  voidedAt: Date | null;
  legalMentions: string;
  createdAt: Date;
  updatedAt: Date;
}

function lineTotals(quantity: number, unitPriceExcludingTax: number, vatRateBasisPoints: number) {
  const lineTotalExcludingTax = quantity * unitPriceExcludingTax;
  const lineTotalVat = Math.round((lineTotalExcludingTax * vatRateBasisPoints) / 10_000);
  return { lineTotalExcludingTax, lineTotalVat, lineTotalIncludingTax: lineTotalExcludingTax + lineTotalVat };
}

function buildLegalMentions(enterprise: Enterprise, customer: Customer): string {
  return [
    `Émis par : ${enterprise.legalName ?? enterprise.name}${enterprise.ninea ? ` — NINEA : ${enterprise.ninea}` : ""}${enterprise.rccm ? ` — RCCM : ${enterprise.rccm}` : ""}`,
    enterprise.address ? `Adresse : ${enterprise.address}${enterprise.city ? `, ${enterprise.city}` : ""}` : null,
    `Client : ${customer.name}${customer.ninea ? ` — NINEA : ${customer.ninea}` : ""}${customer.rccm ? ` — RCCM : ${customer.rccm}` : ""}`,
    "TVA conforme à la réglementation en vigueur (UEMOA).",
    "Montants exprimés en FCFA (XOF).",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

// Seul point d'accès Prisma pour SalesInvoice (CLAUDE.md §5/§8). Module 7 de
// la Phase 8 : contrairement à SalesRepository/PurchasesRepository, ne crée
// jamais ses propres lignes — compose une Sale déjà CONFIRMED (immuable) via
// tx.sale, ne modifie jamais cette vente.
@Injectable()
export class InvoicingRepository {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  async create(
    enterpriseId: string,
    input: CreateSalesInvoiceInput,
    idempotencyKey?: string,
  ): Promise<CreateSalesInvoiceResult> {
    return this.tenantPrisma.run(async (tx) => {
      // Corrige MOBILE AUDIT-001/ERP-001 (docs/adr/0019-...). Vérifié avant
      // la contrainte "une facture par vente" ci-dessous : un rejeu portant
      // la même clé doit renvoyer la facture déjà émise, jamais l'erreur
      // "Cette vente est déjà facturée" (qui reste le comportement correct
      // pour une seconde tentative de facturation sans la même clé).
      if (idempotencyKey) {
        const existingByKey = await tx.salesInvoice.findFirst({
          where: { enterpriseId, idempotencyKey },
          include: { sale: { include: { lines: { include: { product: true } }, customer: true } } },
        });
        if (existingByKey) {
          return { view: this.toInvoiceView(existingByKey, existingByKey.sale), created: false };
        }
      }

      const sale = await tx.sale.findUnique({
        where: { id: input.saleId },
        include: { lines: { include: { product: true } }, customer: true },
      });

      // 404 pas 403 (même raisonnement que SalesRepository) : pas de fuite
      // d'information sur l'existence d'une vente d'un autre tenant.
      if (!sale || sale.enterpriseId !== enterpriseId) {
        throw new NotFoundException("Vente introuvable");
      }
      if (sale.status !== "CONFIRMED") {
        throw new BadRequestException("Seule une vente confirmée peut être facturée");
      }

      const existing = await tx.salesInvoice.findUnique({ where: { saleId: sale.id } });
      if (existing) {
        throw new ConflictException("Cette vente est déjà facturée");
      }

      const enterprise = await tx.enterprise.findUniqueOrThrow({ where: { id: enterpriseId } });

      // Numérotation séquentielle par tenant, sans trou, résistante à la
      // concurrence — même patron qu'InvoiceGenerationService
      // (apps/api/src/payments/invoice-generation.service.ts), compteur
      // dédié (SalesInvoiceCounter) distinct d'InvoiceCounter (facturation
      // SaaS plateforme).
      const rows = await tx.$queryRaw<{ last_number: number }[]>`
        INSERT INTO sales_invoice_counters (enterprise_id, last_number, updated_at)
        VALUES (${enterpriseId}::uuid, 1, now())
        ON CONFLICT (enterprise_id)
        DO UPDATE SET last_number = sales_invoice_counters.last_number + 1, updated_at = now()
        RETURNING last_number
      `;
      const sequenceNumber = rows[0]!.last_number;
      const number = `FACT-${enterpriseId.slice(0, 8).toUpperCase()}-${String(sequenceNumber).padStart(6, "0")}`;

      try {
        const invoice = await tx.salesInvoice.create({
          data: {
            enterpriseId,
            saleId: sale.id,
            number,
            legalMentions: buildLegalMentions(enterprise, sale.customer),
            idempotencyKey: idempotencyKey ?? null,
          },
        });

        return { view: this.toInvoiceView(invoice, sale), created: true };
      } catch (error) {
        // Corrige BIL-23 (docs/audit/BILLING-AUDIT.md) : le check TOCTOU
        // ci-dessus (`existing = await tx.salesInvoice.findUnique(...)`) ne
        // protège pas une vraie course concurrente — deux créations quasi
        // simultanées pour la même vente, sans Idempotency-Key (en-tête
        // optionnel, voir invoicing.controller.ts), peuvent toutes deux
        // dépasser ce check.
        //
        // Sous contention réelle, l'échec de cet INSERT peut remonter sous
        // plusieurs formes Prisma selon le timing exact — pas seulement
        // P2002 (violation de la contrainte unique `sale_id`) mais aussi,
        // par exemple, P2028 (timeout de la transaction interactive,
        // atteint pendant l'attente du verrou posé par le concurrent qui
        // gagne la course sur `sales_invoice_counters` — observé sur CI,
        // jamais reproduit en local même à 8 requêtes concurrentes,
        // cohérent avec un runner plus lent/chargé). Énumérer les codes
        // Prisma possibles sous contention serait fragile et
        // structurellement incomplet. On vérifie donc l'état réel en base :
        // si une facture correspondante existe désormais, c'est la preuve
        // directe qu'une requête concurrente a gagné, quelle que soit la
        // raison exacte de l'échec de notre propre tentative — jamais
        // l'inverse : si aucune facture correspondante n'existe, l'erreur
        // originale est relancée telle quelle (jamais de conversion
        // arbitraire d'un timeout, d'une panne Postgres ou d'une autre
        // erreur en 409 métier).
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          if (idempotencyKey) {
            const existingByKey = await tx.salesInvoice.findFirst({
              where: { enterpriseId, idempotencyKey },
              include: { sale: { include: { lines: { include: { product: true } }, customer: true } } },
            });
            if (existingByKey) {
              return { view: this.toInvoiceView(existingByKey, existingByKey.sale), created: false };
            }
          }

          const existingBySale = await tx.salesInvoice.findUnique({ where: { saleId: sale.id } });
          if (existingBySale) {
            throw new ConflictException("Cette vente est déjà facturée");
          }
        }
        throw error;
      }
    });
  }

  async findMany(enterpriseId: string, query: ListSalesInvoicesQuery): Promise<SalesInvoiceListResult> {
    const where: Prisma.SalesInvoiceWhereInput = {
      enterpriseId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { number: { contains: query.search, mode: "insensitive" } },
              { sale: { customer: { name: { contains: query.search, mode: "insensitive" } } } },
            ],
          }
        : {}),
    };

    const [invoices, total] = await this.tenantPrisma.run((tx) =>
      Promise.all([
        tx.salesInvoice.findMany({
          where,
          include: { sale: { include: { lines: true, customer: true } } },
          orderBy: { createdAt: "desc" },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.salesInvoice.count({ where }),
      ]),
    );

    const items: SalesInvoiceListItem[] = invoices.map((invoice) => {
      const totals = invoice.sale.lines.reduce(
        (acc, line) => {
          const t = lineTotals(line.quantity, line.unitPriceExcludingTax, line.vatRateBasisPoints);
          return {
            totalExcludingTax: acc.totalExcludingTax + t.lineTotalExcludingTax,
            totalVat: acc.totalVat + t.lineTotalVat,
            totalIncludingTax: acc.totalIncludingTax + t.lineTotalIncludingTax,
          };
        },
        { totalExcludingTax: 0, totalVat: 0, totalIncludingTax: 0 },
      );

      return {
        id: invoice.id,
        saleId: invoice.saleId,
        customerId: invoice.sale.customerId,
        customerName: invoice.sale.customer.name,
        number: invoice.number,
        status: invoice.status,
        issuedAt: invoice.issuedAt,
        createdAt: invoice.createdAt,
        ...totals,
      };
    });

    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async findByIdOrThrow(enterpriseId: string, invoiceId: string): Promise<SalesInvoiceView> {
    return this.tenantPrisma.run(async (tx) => {
      const invoice = await this.getInvoiceOrThrow(tx, enterpriseId, invoiceId);
      return this.toInvoiceView(invoice, invoice.sale);
    });
  }

  async markPaid(enterpriseId: string, invoiceId: string): Promise<SalesInvoiceView> {
    return this.tenantPrisma.run(async (tx) => {
      const invoice = await this.getInvoiceOrThrow(tx, enterpriseId, invoiceId);
      if (invoice.status !== "ISSUED") {
        throw new ConflictException("Seule une facture émise peut être marquée payée");
      }

      const paid = await tx.salesInvoice.update({
        where: { id: invoiceId },
        data: { status: "PAID", paidAt: new Date() },
      });

      return this.toInvoiceView(paid, invoice.sale);
    });
  }

  async void(enterpriseId: string, invoiceId: string): Promise<SalesInvoiceView> {
    return this.tenantPrisma.run(async (tx) => {
      const invoice = await this.getInvoiceOrThrow(tx, enterpriseId, invoiceId);
      if (invoice.status !== "ISSUED") {
        throw new BadRequestException("Seule une facture émise peut être annulée");
      }

      const voided = await tx.salesInvoice.update({
        where: { id: invoiceId },
        data: { status: "VOID", voidedAt: new Date() },
      });

      return this.toInvoiceView(voided, invoice.sale);
    });
  }

  private async getInvoiceOrThrow(tx: Prisma.TransactionClient, enterpriseId: string, invoiceId: string) {
    const invoice = await tx.salesInvoice.findUnique({
      where: { id: invoiceId },
      include: { sale: { include: { lines: { include: { product: true } }, customer: true } } },
    });

    // 404 pas 403 (même raisonnement que SalesRepository) : pas de fuite
    // d'information sur l'existence d'une facture d'un autre tenant.
    if (!invoice || invoice.enterpriseId !== enterpriseId) {
      throw new NotFoundException("Facture introuvable");
    }

    return invoice;
  }

  private toInvoiceView(invoice: InvoiceRow, sale: SaleWithLinesAndCustomer): SalesInvoiceView {
    const lines: SalesInvoiceLineView[] = sale.lines.map((line) => ({
      id: line.id,
      productId: line.productId,
      productCode: line.product.code,
      productName: line.product.name,
      quantity: line.quantity,
      unitPriceExcludingTax: line.unitPriceExcludingTax,
      vatRateBasisPoints: line.vatRateBasisPoints,
      ...lineTotals(line.quantity, line.unitPriceExcludingTax, line.vatRateBasisPoints),
    }));

    const totals = lines.reduce(
      (acc, line) => ({
        totalExcludingTax: acc.totalExcludingTax + line.lineTotalExcludingTax,
        totalVat: acc.totalVat + line.lineTotalVat,
        totalIncludingTax: acc.totalIncludingTax + line.lineTotalIncludingTax,
      }),
      { totalExcludingTax: 0, totalVat: 0, totalIncludingTax: 0 },
    );

    return {
      id: invoice.id,
      enterpriseId: sale.enterpriseId,
      saleId: sale.id,
      customerId: sale.customerId,
      customerName: sale.customer.name,
      number: invoice.number,
      status: invoice.status,
      issuedAt: invoice.issuedAt,
      paidAt: invoice.paidAt,
      voidedAt: invoice.voidedAt,
      legalMentions: invoice.legalMentions,
      lines,
      createdAt: invoice.createdAt,
      updatedAt: invoice.updatedAt,
      ...totals,
    };
  }
}
