import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Product, Prisma } from "@prisma/client";
import { TenantScopedPrismaService } from "../tenant/tenant-scoped-prisma.service";
import { CreateProductInput, ListProductsQuery, UpdateProductInput } from "@erp/validation";

export interface ProductListResult {
  items: Product[];
  total: number;
  page: number;
  pageSize: number;
}

// Seul point d'accès Prisma pour le modèle Product (CLAUDE.md §5/§8) : le
// service ne connaît que ces méthodes, jamais tx.product.* directement.
// Toute méthode passe par TenantScopedPrismaService.run() — la RLS scope déjà
// chaque requête à l'entreprise courante, ce filtrage explicite reste en
// défense en profondeur (comme PermissionsGuard, voir tenant-scoped-prisma.service.ts).
@Injectable()
export class ProductsRepository {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  async findMany(enterpriseId: string, query: ListProductsQuery): Promise<ProductListResult> {
    const where: Prisma.ProductWhereInput = {
      enterpriseId,
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              { code: { contains: query.search, mode: "insensitive" } },
              { barcode: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.tenantPrisma.run((tx) =>
      Promise.all([
        tx.product.findMany({
          where,
          orderBy: { name: "asc" },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.product.count({ where }),
      ]),
    );

    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async findByIdOrThrow(enterpriseId: string, id: string): Promise<Product> {
    const product = await this.tenantPrisma.run((tx) => tx.product.findUnique({ where: { id } }));

    // La RLS empêche déjà de lire un produit d'un autre tenant (il n'existe
    // simplement pas dans le résultat) ; cette vérification explicite
    // garantit un 404, pas une fuite d'information sur son existence
    // ailleurs (docs/PROMPT-MAITRE-SAAS.md Phase 3, critère "404 pas 403").
    if (!product || product.enterpriseId !== enterpriseId) {
      throw new NotFoundException("Produit introuvable");
    }

    return product;
  }

  async create(enterpriseId: string, input: CreateProductInput): Promise<Product> {
    return this.withUniqueCodeConflictMapped(() =>
      this.tenantPrisma.run((tx) =>
        tx.product.create({
          data: { ...input, enterpriseId },
        }),
      ),
    );
  }

  async update(enterpriseId: string, id: string, input: UpdateProductInput): Promise<Product> {
    // Vérifie l'appartenance au tenant avant d'écrire (même raisonnement que
    // findByIdOrThrow) : un update "aveugle" par id seul s'appuierait
    // uniquement sur la RLS, qui affecterait alors 0 ligne sans lever
    // d'erreur explicite — on préfère un 404 clair.
    await this.findByIdOrThrow(enterpriseId, id);

    return this.withUniqueCodeConflictMapped(() =>
      this.tenantPrisma.run((tx) => tx.product.update({ where: { id }, data: input })),
    );
  }

  async deactivate(enterpriseId: string, id: string): Promise<Product> {
    await this.findByIdOrThrow(enterpriseId, id);

    return this.tenantPrisma.run((tx) =>
      tx.product.update({ where: { id }, data: { isActive: false } }),
    );
  }

  // @@unique([enterpriseId, code]) : premier cas, sur les modules ERP, où une
  // création/modification peut échouer pour une raison métier (code déjà
  // utilisé dans le tenant) plutôt qu'une erreur de validation de schéma —
  // mappé explicitement en 409, jamais une erreur Prisma brute qui fuiterait
  // (même patron que ProvisioningService pour NINEA/RCCM).
  private async withUniqueCodeConflictMapped<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Ce code produit est déjà utilisé");
      }
      throw error;
    }
  }
}
