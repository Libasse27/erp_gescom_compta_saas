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

  async create(enterpriseId: string, input: CreateSalesInvoiceInput): Promise<SalesInvoiceView> {
    return this.tenantPrisma.run(async (tx) => {
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

      const invoice = await tx.salesInvoice.create({
        data: {
          enterpriseId,
          saleId: sale.id,
          number,
          legalMentions: buildLegalMentions(enterprise, sale.customer),
        },
      });

      return this.toInvoiceView(invoice, sale);
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
