import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, StockMovement } from "@prisma/client";
import { CreateStockMovementInput, ListStockMovementsQuery, ListStockQuery } from "@erp/validation";
import { TenantScopedPrismaService } from "../tenant/tenant-scoped-prisma.service";

// Vue calculée (agrégation des mouvements), pas un modèle Prisma — miroir du
// type StockLevel de @erp/types (packages/types, consommé par le frontend),
// redéfini ici comme ProductListResult/etc. dans products.repository.ts :
// le backend s'appuie sur les types générés par Prisma, pas sur @erp/types
// (dépendance frontend uniquement).
export interface StockLevel {
  productId: string;
  code: string;
  name: string;
  unit: string;
  quantityOnHand: number;
}

export interface StockLevelListResult {
  items: StockLevel[];
  total: number;
  page: number;
  pageSize: number;
}

export interface StockMovementListResult {
  items: StockMovement[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateMovementResult {
  movement: StockMovement;
  quantityOnHand: number;
}

// Seul point d'accès Prisma pour StockMovement (CLAUDE.md §5/§8). Contrairement
// à ProductsRepository/SuppliersRepository (des fiches), il n'y a pas de
// findByIdOrThrow/update/deactivate ici : StockMovement est un grand livre
// append-only, la seule écriture possible est createMovement().
@Injectable()
export class StockRepository {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  async findLevels(enterpriseId: string, query: ListStockQuery): Promise<StockLevelListResult> {
    const where: Prisma.ProductWhereInput = {
      enterpriseId,
      trackStock: true,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              { code: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const { items, total } = await this.tenantPrisma.run(async (tx) => {
      const [products, total] = await Promise.all([
        tx.product.findMany({
          where,
          orderBy: { name: "asc" },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.product.count({ where }),
      ]);

      const quantities = await this.aggregateQuantities(
        tx,
        enterpriseId,
        products.map((product) => product.id),
      );

      const items: StockLevel[] = products.map((product) => ({
        productId: product.id,
        code: product.code,
        name: product.name,
        unit: product.unit,
        quantityOnHand: quantities.get(product.id) ?? 0,
      }));

      return { items, total };
    });

    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async getLevel(enterpriseId: string, productId: string): Promise<StockLevel> {
    return this.tenantPrisma.run(async (tx) => {
      const product = await this.findTrackedProductOrThrow(tx, enterpriseId, productId);
      const quantities = await this.aggregateQuantities(tx, enterpriseId, [productId]);

      return {
        productId: product.id,
        code: product.code,
        name: product.name,
        unit: product.unit,
        quantityOnHand: quantities.get(product.id) ?? 0,
      };
    });
  }

  async findMovements(
    enterpriseId: string,
    productId: string,
    query: ListStockMovementsQuery,
  ): Promise<StockMovementListResult> {
    return this.tenantPrisma.run(async (tx) => {
      await this.findTrackedProductOrThrow(tx, enterpriseId, productId);

      const where: Prisma.StockMovementWhereInput = { enterpriseId, productId };
      const [items, total] = await Promise.all([
        tx.stockMovement.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.stockMovement.count({ where }),
      ]);

      return { items, total, page: query.page, pageSize: query.pageSize };
    });
  }

  // Serializable (voir tenant-scoped-prisma.service.ts) : cette transaction
  // lit le solde courant puis écrit un nouveau mouvement en fonction de ce
  // solde — sous ReadCommitted, deux créations concurrentes sur le même
  // produit pourraient toutes deux lire le même solde de départ et laisser
  // passer un stock négatif. Postgres fait échouer l'une des deux
  // transactions en conflit (erreur 40001 / Prisma P2034), rattrapée
  // ci-dessous en 409.
  async createMovement(enterpriseId: string, input: CreateStockMovementInput): Promise<CreateMovementResult> {
    try {
      return await this.tenantPrisma.run(
        async (tx) => {
          const product = await tx.product.findUnique({ where: { id: input.productId } });
          if (!product || product.enterpriseId !== enterpriseId) {
            throw new NotFoundException("Produit introuvable");
          }
          if (!product.trackStock) {
            throw new BadRequestException("Ce produit ne suit pas de stock");
          }

          const quantities = await this.aggregateQuantities(tx, enterpriseId, [input.productId]);
          const currentQuantity = quantities.get(input.productId) ?? 0;
          const delta = input.type === "OUT" ? -input.quantity : input.quantity;
          const nextQuantity = currentQuantity + delta;

          if (nextQuantity < 0) {
            throw new ConflictException("Stock insuffisant");
          }

          const movement = await tx.stockMovement.create({
            data: {
              enterpriseId,
              productId: input.productId,
              type: input.type,
              quantity: input.quantity,
              note: input.note,
            },
          });

          return { movement, quantityOnHand: nextQuantity };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        throw new ConflictException("Conflit de concurrence sur ce produit, veuillez réessayer");
      }
      throw error;
    }
  }

  private async findTrackedProductOrThrow(tx: Prisma.TransactionClient, enterpriseId: string, productId: string) {
    const product = await tx.product.findUnique({ where: { id: productId } });

    // Un produit inexistant, d'un autre tenant, ou qui ne suit pas de stock
    // sont traités identiquement (404) : pas de fuite d'information sur son
    // existence ailleurs, même raisonnement que ProductsRepository.
    if (!product || product.enterpriseId !== enterpriseId || !product.trackStock) {
      throw new NotFoundException("Produit introuvable ou ne suit pas de stock");
    }

    return product;
  }

  private async aggregateQuantities(
    tx: Prisma.TransactionClient,
    enterpriseId: string,
    productIds: string[],
  ): Promise<Map<string, number>> {
    if (productIds.length === 0) return new Map();

    // Une seule requête groupée (productId, type) pour toute la page, pas un
    // agrégat par produit — évite le N+1 sur GET /stock.
    const groups = await tx.stockMovement.groupBy({
      by: ["productId", "type"],
      where: { enterpriseId, productId: { in: productIds } },
      _sum: { quantity: true },
    });

    const quantities = new Map<string, number>();
    for (const group of groups) {
      const sum = group._sum.quantity ?? 0;
      const delta = group.type === "OUT" ? -sum : sum;
      quantities.set(group.productId, (quantities.get(group.productId) ?? 0) + delta);
    }

    return quantities;
  }
}
