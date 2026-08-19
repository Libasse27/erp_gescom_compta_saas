import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, PurchaseStatus } from "@prisma/client";
import { CreatePurchaseInput, ListPurchasesQuery } from "@erp/validation";
import { TenantScopedPrismaService } from "../tenant/tenant-scoped-prisma.service";
import { runWithSerializableRetry } from "../common/serializable-retry";
import { StockRepository } from "../stock/stock.repository";

// Vues calculées, comme SaleView/SaleLineView dans sales.repository.ts.
export interface PurchaseLineView {
  id: string;
  productId: string;
  productCode: string;
  productName: string;
  quantity: number;
  unitCostExcludingTax: number;
  vatRateBasisPoints: number;
  lineTotalExcludingTax: number;
  lineTotalVat: number;
  lineTotalIncludingTax: number;
}

export interface PurchaseView {
  id: string;
  enterpriseId: string;
  supplierId: string;
  supplierName: string;
  status: PurchaseStatus;
  purchaseDate: Date;
  notes: string | null;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  totalExcludingTax: number;
  totalVat: number;
  totalIncludingTax: number;
  lines: PurchaseLineView[];
  createdAt: Date;
  updatedAt: Date;
}

export interface PurchaseListItem {
  id: string;
  supplierId: string;
  supplierName: string;
  status: PurchaseStatus;
  purchaseDate: Date;
  totalExcludingTax: number;
  totalVat: number;
  totalIncludingTax: number;
  linesCount: number;
  createdAt: Date;
}

export interface PurchaseListResult {
  items: PurchaseListItem[];
  total: number;
  page: number;
  pageSize: number;
}

// `created: false` signale un rejeu déduplié (docs/adr/0019-...) — même
// patron que CreateSaleResult.
export interface CreatePurchaseResult {
  view: PurchaseView;
  created: boolean;
}

function lineTotals(quantity: number, unitCostExcludingTax: number, vatRateBasisPoints: number) {
  const lineTotalExcludingTax = quantity * unitCostExcludingTax;
  const lineTotalVat = Math.round((lineTotalExcludingTax * vatRateBasisPoints) / 10_000);
  return { lineTotalExcludingTax, lineTotalVat, lineTotalIncludingTax: lineTotalExcludingTax + lineTotalVat };
}

// Seul point d'accès Prisma pour Purchase/PurchaseLine (CLAUDE.md §5/§8).
// Module 6 de la Phase 8, miroir structurel de SalesRepository : compose
// StockRepository (confirm() incrémente le stock, IN au lieu de OUT) plutôt
// que de dupliquer la logique de mouvement.
@Injectable()
export class PurchasesRepository {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly stockRepository: StockRepository,
  ) {}

  async create(
    enterpriseId: string,
    input: CreatePurchaseInput,
    idempotencyKey?: string,
  ): Promise<CreatePurchaseResult> {
    return this.tenantPrisma.run(async (tx) => {
      // Corrige MOBILE AUDIT-001/ERP-001 (docs/adr/0019-...) — même patron
      // que SalesRepository.create.
      if (idempotencyKey) {
        const existing = await tx.purchase.findFirst({
          where: { enterpriseId, idempotencyKey },
          include: { lines: { include: { product: true } }, supplier: true },
        });
        if (existing) {
          return { view: this.toPurchaseView(existing), created: false };
        }
      }

      const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
      if (!supplier || supplier.enterpriseId !== enterpriseId) {
        throw new NotFoundException("Fournisseur introuvable");
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
        const purchase = await tx.purchase.create({
          data: {
            enterpriseId,
            supplierId: input.supplierId,
            notes: input.notes,
            idempotencyKey: idempotencyKey ?? null,
            lines: {
              create: input.lines.map((line) => {
                const product = productsById.get(line.productId)!;
                return {
                  enterpriseId,
                  productId: line.productId,
                  quantity: line.quantity,
                  unitCostExcludingTax: line.unitCostExcludingTax,
                  vatRateBasisPoints: product.vatRateBasisPoints,
                };
              }),
            },
          },
          include: { lines: { include: { product: true } }, supplier: true },
        });

        return { view: this.toPurchaseView(purchase), created: true };
      } catch (error) {
        if (idempotencyKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const existing = await tx.purchase.findFirst({
            where: { enterpriseId, idempotencyKey },
            include: { lines: { include: { product: true } }, supplier: true },
          });
          if (existing) {
            return { view: this.toPurchaseView(existing), created: false };
          }
        }
        throw error;
      }
    });
  }

  async findMany(enterpriseId: string, query: ListPurchasesQuery): Promise<PurchaseListResult> {
    const where: Prisma.PurchaseWhereInput = {
      enterpriseId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { supplier: { name: { contains: query.search, mode: "insensitive" } } } : {}),
    };

    const [purchases, total] = await this.tenantPrisma.run((tx) =>
      Promise.all([
        tx.purchase.findMany({
          where,
          include: { lines: true, supplier: true },
          orderBy: { createdAt: "desc" },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.purchase.count({ where }),
      ]),
    );

    const items: PurchaseListItem[] = purchases.map((purchase) => {
      const totals = purchase.lines.reduce(
        (acc, line) => {
          const t = lineTotals(line.quantity, line.unitCostExcludingTax, line.vatRateBasisPoints);
          return {
            totalExcludingTax: acc.totalExcludingTax + t.lineTotalExcludingTax,
            totalVat: acc.totalVat + t.lineTotalVat,
            totalIncludingTax: acc.totalIncludingTax + t.lineTotalIncludingTax,
          };
        },
        { totalExcludingTax: 0, totalVat: 0, totalIncludingTax: 0 },
      );

      return {
        id: purchase.id,
        supplierId: purchase.supplierId,
        supplierName: purchase.supplier.name,
        status: purchase.status,
        purchaseDate: purchase.purchaseDate,
        linesCount: purchase.lines.length,
        createdAt: purchase.createdAt,
        ...totals,
      };
    });

    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async findByIdOrThrow(enterpriseId: string, purchaseId: string): Promise<PurchaseView> {
    return this.tenantPrisma.run(async (tx) => {
      const purchase = await this.getPurchaseOrThrow(tx, enterpriseId, purchaseId);
      return this.toPurchaseView(purchase);
    });
  }

  // Serializable, comme SalesRepository.confirm : incrémente le stock de
  // chaque ligne trackStock=true dans LA MÊME transaction que le passage à
  // CONFIRMED. Contrairement à une vente, un achat confirmé ne peut jamais
  // échouer pour cause de stock insuffisant (un mouvement IN ne fait
  // qu'augmenter le solde) — la transaction Serializable reste nécessaire
  // pour la cohérence concurrente du solde lu par applyMovement, pas pour
  // une garde métier. runWithSerializableRetry absorbe les P2034 transitoires
  // (même raisonnement que StockRepository.createMovement) avant l'échec
  // persistant en 409.
  async confirm(enterpriseId: string, purchaseId: string): Promise<PurchaseView> {
    try {
      return await runWithSerializableRetry(() =>
        this.tenantPrisma.run(
          async (tx) => {
            const purchase = await this.getPurchaseOrThrow(tx, enterpriseId, purchaseId);
            if (purchase.status !== "DRAFT") {
              throw new ConflictException("Seul un achat en brouillon peut être confirmé");
            }

            for (const line of purchase.lines) {
              if (line.product.trackStock) {
                await this.stockRepository.applyMovement(tx, enterpriseId, {
                  productId: line.productId,
                  type: "IN",
                  quantity: line.quantity,
                  note: `Achat ${purchase.id}`,
                });
              }
            }

            const confirmed = await tx.purchase.update({
              where: { id: purchaseId },
              data: { status: "CONFIRMED", confirmedAt: new Date() },
              include: { lines: { include: { product: true } }, supplier: true },
            });

            return this.toPurchaseView(confirmed);
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

  async cancel(enterpriseId: string, purchaseId: string): Promise<PurchaseView> {
    return this.tenantPrisma.run(async (tx) => {
      const purchase = await this.getPurchaseOrThrow(tx, enterpriseId, purchaseId);
      if (purchase.status !== "DRAFT") {
        throw new BadRequestException("Seul un achat en brouillon peut être annulé");
      }

      const cancelled = await tx.purchase.update({
        where: { id: purchaseId },
        data: { status: "CANCELLED", cancelledAt: new Date() },
        include: { lines: { include: { product: true } }, supplier: true },
      });

      return this.toPurchaseView(cancelled);
    });
  }

  private async getPurchaseOrThrow(tx: Prisma.TransactionClient, enterpriseId: string, purchaseId: string) {
    const purchase = await tx.purchase.findUnique({
      where: { id: purchaseId },
      include: { lines: { include: { product: true } }, supplier: true },
    });

    // 404 pas 403 (même raisonnement que SalesRepository) : pas de fuite
    // d'information sur l'existence d'un achat d'un autre tenant.
    if (!purchase || purchase.enterpriseId !== enterpriseId) {
      throw new NotFoundException("Achat introuvable");
    }

    return purchase;
  }

  private toPurchaseView(
    purchase: Prisma.PurchaseGetPayload<{ include: { lines: { include: { product: true } }; supplier: true } }>,
  ): PurchaseView {
    const lines: PurchaseLineView[] = purchase.lines.map((line) => ({
      id: line.id,
      productId: line.productId,
      productCode: line.product.code,
      productName: line.product.name,
      quantity: line.quantity,
      unitCostExcludingTax: line.unitCostExcludingTax,
      vatRateBasisPoints: line.vatRateBasisPoints,
      ...lineTotals(line.quantity, line.unitCostExcludingTax, line.vatRateBasisPoints),
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
      id: purchase.id,
      enterpriseId: purchase.enterpriseId,
      supplierId: purchase.supplierId,
      supplierName: purchase.supplier.name,
      status: purchase.status,
      purchaseDate: purchase.purchaseDate,
      notes: purchase.notes,
      confirmedAt: purchase.confirmedAt,
      cancelledAt: purchase.cancelledAt,
      lines,
      createdAt: purchase.createdAt,
      updatedAt: purchase.updatedAt,
      ...totals,
    };
  }
}
