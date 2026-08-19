import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, SaleStatus } from "@prisma/client";
import { CreateSaleInput, ListSalesQuery } from "@erp/validation";
import { TenantScopedPrismaService } from "../tenant/tenant-scoped-prisma.service";
import { runWithSerializableRetry } from "../common/serializable-retry";
import { StockRepository } from "../stock/stock.repository";

// Vues calculées (jointures + totaux dérivés des lignes), pas des modèles
// Prisma directs — même raisonnement que StockLevel dans
// stock.repository.ts : le TTC/TVA ne sont jamais stockés, calculés ici.
export interface SaleLineView {
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

export interface SaleView {
  id: string;
  enterpriseId: string;
  customerId: string;
  customerName: string;
  status: SaleStatus;
  saleDate: Date;
  notes: string | null;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  totalExcludingTax: number;
  totalVat: number;
  totalIncludingTax: number;
  lines: SaleLineView[];
  createdAt: Date;
  updatedAt: Date;
}

export interface SaleListItem {
  id: string;
  customerId: string;
  customerName: string;
  status: SaleStatus;
  saleDate: Date;
  totalExcludingTax: number;
  totalVat: number;
  totalIncludingTax: number;
  linesCount: number;
  createdAt: Date;
}

export interface SaleListResult {
  items: SaleListItem[];
  total: number;
  page: number;
  pageSize: number;
}

// `created: false` signale un rejeu déduplié (docs/adr/0019-...) : le
// contrôleur renvoie quand même 201 (indiscernable d'un premier succès pour
// l'appelant), mais le service ne doit pas ré-émettre d'entrée d'audit log
// pour une écriture qui n'a pas eu lieu.
export interface CreateSaleResult {
  view: SaleView;
  created: boolean;
}

function lineTotals(quantity: number, unitPriceExcludingTax: number, vatRateBasisPoints: number) {
  const lineTotalExcludingTax = quantity * unitPriceExcludingTax;
  const lineTotalVat = Math.round((lineTotalExcludingTax * vatRateBasisPoints) / 10_000);
  return { lineTotalExcludingTax, lineTotalVat, lineTotalIncludingTax: lineTotalExcludingTax + lineTotalVat };
}

// Seul point d'accès Prisma pour Sale/SaleLine (CLAUDE.md §5/§8). Contrairement
// à ProductsRepository/StockRepository, ce repository compose StockRepository
// (confirm() décrémente le stock) plutôt que de dupliquer la garde stock
// négatif — voir StockRepository.applyMovement.
@Injectable()
export class SalesRepository {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly stockRepository: StockRepository,
  ) {}

  async create(enterpriseId: string, input: CreateSaleInput, idempotencyKey?: string): Promise<CreateSaleResult> {
    return this.tenantPrisma.run(async (tx) => {
      // Corrige MOBILE AUDIT-001/ERP-001 (docs/adr/0019-...) : un rejeu de
      // la file hors-ligne mobile (réponse perdue après un succès serveur)
      // ne doit jamais créer une deuxième vente. Recherche d'abord, avant
      // toute validation client/produit — un rejeu ne doit pas échouer si
      // le client a entre-temps été désactivé, par exemple.
      if (idempotencyKey) {
        const existing = await tx.sale.findFirst({
          where: { enterpriseId, idempotencyKey },
          include: { lines: { include: { product: true } }, customer: true },
        });
        if (existing) {
          return { view: this.toSaleView(existing), created: false };
        }
      }

      const customer = await tx.customer.findUnique({ where: { id: input.customerId } });
      if (!customer || customer.enterpriseId !== enterpriseId) {
        throw new NotFoundException("Client introuvable");
      }

      const productIds = [...new Set(input.lines.map((line) => line.productId))];
      const products = await tx.product.findMany({ where: { id: { in: productIds } } });
      const productsById = new Map(products.map((product) => [product.id, product]));

      for (const productId of productIds) {
        const product = productsById.get(productId);
        if (!product || product.enterpriseId !== enterpriseId) {
          throw new NotFoundException(`Produit introuvable : ${productId}`);
        }
      }

      try {
        const sale = await tx.sale.create({
          data: {
            enterpriseId,
            customerId: input.customerId,
            notes: input.notes,
            idempotencyKey: idempotencyKey ?? null,
            lines: {
              create: input.lines.map((line) => {
                const product = productsById.get(line.productId)!;
                return {
                  enterpriseId,
                  productId: line.productId,
                  quantity: line.quantity,
                  unitPriceExcludingTax: product.sellingPriceExcludingTax,
                  vatRateBasisPoints: product.vatRateBasisPoints,
                };
              }),
            },
          },
          include: { lines: { include: { product: true } }, customer: true },
        });

        return { view: this.toSaleView(sale), created: true };
      } catch (error) {
        // Filet de concurrence : deux rejeux quasi simultanés de la même
        // mutation hors-ligne perdent la course au findFirst ci-dessus mais
        // pas à la contrainte unique — le perdant récupère la vente créée
        // par le gagnant plutôt que de propager une erreur (même patron que
        // journal_entry_counters via ON CONFLICT).
        if (idempotencyKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const existing = await tx.sale.findFirst({
            where: { enterpriseId, idempotencyKey },
            include: { lines: { include: { product: true } }, customer: true },
          });
          if (existing) {
            return { view: this.toSaleView(existing), created: false };
          }
        }
        throw error;
      }
    });
  }

  async findMany(enterpriseId: string, query: ListSalesQuery): Promise<SaleListResult> {
    const where: Prisma.SaleWhereInput = {
      enterpriseId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { customer: { name: { contains: query.search, mode: "insensitive" } } } : {}),
    };

    const [sales, total] = await this.tenantPrisma.run((tx) =>
      Promise.all([
        tx.sale.findMany({
          where,
          include: { lines: true, customer: true },
          orderBy: { createdAt: "desc" },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.sale.count({ where }),
      ]),
    );

    const items: SaleListItem[] = sales.map((sale) => {
      const totals = sale.lines.reduce(
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
        id: sale.id,
        customerId: sale.customerId,
        customerName: sale.customer.name,
        status: sale.status,
        saleDate: sale.saleDate,
        linesCount: sale.lines.length,
        createdAt: sale.createdAt,
        ...totals,
      };
    });

    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async findByIdOrThrow(enterpriseId: string, saleId: string): Promise<SaleView> {
    return this.tenantPrisma.run(async (tx) => {
      const sale = await this.getSaleOrThrow(tx, enterpriseId, saleId);
      return this.toSaleView(sale);
    });
  }

  // Serializable, comme StockRepository.createMovement : décrémente le stock
  // de chaque ligne trackStock=true dans LA MÊME transaction que le passage
  // à CONFIRMED — sale confirmée + stock décrémenté doivent réussir ou
  // échouer ensemble, jamais l'un sans l'autre. runWithSerializableRetry
  // absorbe les P2034 transitoires (même raisonnement que
  // StockRepository.createMovement) avant l'échec persistant en 409.
  async confirm(enterpriseId: string, saleId: string): Promise<SaleView> {
    try {
      return await runWithSerializableRetry(() =>
        this.tenantPrisma.run(
          async (tx) => {
            const sale = await this.getSaleOrThrow(tx, enterpriseId, saleId);
            if (sale.status !== "DRAFT") {
              throw new ConflictException("Seule une vente en brouillon peut être confirmée");
            }

            for (const line of sale.lines) {
              if (line.product.trackStock) {
                await this.stockRepository.applyMovement(tx, enterpriseId, {
                  productId: line.productId,
                  type: "OUT",
                  quantity: line.quantity,
                  note: `Vente ${sale.id}`,
                });
              }
            }

            const confirmed = await tx.sale.update({
              where: { id: saleId },
              data: { status: "CONFIRMED", confirmedAt: new Date() },
              include: { lines: { include: { product: true } }, customer: true },
            });

            return this.toSaleView(confirmed);
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        throw new ConflictException("Conflit de concurrence, veuillez réessayer");
      }
      throw error;
    }
  }

  async cancel(enterpriseId: string, saleId: string): Promise<SaleView> {
    return this.tenantPrisma.run(async (tx) => {
      const sale = await this.getSaleOrThrow(tx, enterpriseId, saleId);
      if (sale.status !== "DRAFT") {
        throw new BadRequestException("Seule une vente en brouillon peut être annulée");
      }

      const cancelled = await tx.sale.update({
        where: { id: saleId },
        data: { status: "CANCELLED", cancelledAt: new Date() },
        include: { lines: { include: { product: true } }, customer: true },
      });

      return this.toSaleView(cancelled);
    });
  }

  private async getSaleOrThrow(tx: Prisma.TransactionClient, enterpriseId: string, saleId: string) {
    const sale = await tx.sale.findUnique({
      where: { id: saleId },
      include: { lines: { include: { product: true } }, customer: true },
    });

    // 404 pas 403 (même raisonnement que ProductsRepository/StockRepository) :
    // pas de fuite d'information sur l'existence d'une vente d'un autre tenant.
    if (!sale || sale.enterpriseId !== enterpriseId) {
      throw new NotFoundException("Vente introuvable");
    }

    return sale;
  }

  private toSaleView(
    sale: Prisma.SaleGetPayload<{ include: { lines: { include: { product: true } }; customer: true } }>,
  ): SaleView {
    const lines: SaleLineView[] = sale.lines.map((line) => ({
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
      id: sale.id,
      enterpriseId: sale.enterpriseId,
      customerId: sale.customerId,
      customerName: sale.customer.name,
      status: sale.status,
      saleDate: sale.saleDate,
      notes: sale.notes,
      confirmedAt: sale.confirmedAt,
      cancelledAt: sale.cancelledAt,
      lines,
      createdAt: sale.createdAt,
      updatedAt: sale.updatedAt,
      ...totals,
    };
  }
}
