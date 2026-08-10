import { Injectable, NotFoundException } from "@nestjs/common";
import { Supplier, Prisma } from "@prisma/client";
import { TenantScopedPrismaService } from "../tenant/tenant-scoped-prisma.service";
import { CreateSupplierInput, ListSuppliersQuery, UpdateSupplierInput } from "@erp/validation";

export interface SupplierListResult {
  items: Supplier[];
  total: number;
  page: number;
  pageSize: number;
}

// Seul point d'accès Prisma pour le modèle Supplier (CLAUDE.md §5/§8) : le
// service ne connaît que ces méthodes, jamais tx.supplier.* directement.
// Toute méthode passe par TenantScopedPrismaService.run() — la RLS scope déjà
// chaque requête à l'entreprise courante, ce filtrage explicite reste en
// défense en profondeur (comme PermissionsGuard, voir tenant-scoped-prisma.service.ts).
@Injectable()
export class SuppliersRepository {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  async findMany(enterpriseId: string, query: ListSuppliersQuery): Promise<SupplierListResult> {
    const where: Prisma.SupplierWhereInput = {
      enterpriseId,
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              { email: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.tenantPrisma.run((tx) =>
      Promise.all([
        tx.supplier.findMany({
          where,
          orderBy: { name: "asc" },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.supplier.count({ where }),
      ]),
    );

    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async findByIdOrThrow(enterpriseId: string, id: string): Promise<Supplier> {
    const supplier = await this.tenantPrisma.run((tx) => tx.supplier.findUnique({ where: { id } }));

    // La RLS empêche déjà de lire un fournisseur d'un autre tenant (il
    // n'existe simplement pas dans le résultat) ; cette vérification
    // explicite garantit un 404, pas une fuite d'information sur son
    // existence ailleurs (docs/PROMPT-MAITRE-SAAS.md Phase 3, critère
    // "404 pas 403").
    if (!supplier || supplier.enterpriseId !== enterpriseId) {
      throw new NotFoundException("Fournisseur introuvable");
    }

    return supplier;
  }

  async create(enterpriseId: string, input: CreateSupplierInput): Promise<Supplier> {
    return this.tenantPrisma.run((tx) =>
      tx.supplier.create({
        data: { ...input, enterpriseId },
      }),
    );
  }

  async update(enterpriseId: string, id: string, input: UpdateSupplierInput): Promise<Supplier> {
    // Vérifie l'appartenance au tenant avant d'écrire (même raisonnement que
    // findByIdOrThrow) : un update "aveugle" par id seul s'appuierait
    // uniquement sur la RLS, qui affecterait alors 0 ligne sans lever
    // d'erreur explicite — on préfère un 404 clair.
    await this.findByIdOrThrow(enterpriseId, id);

    return this.tenantPrisma.run((tx) => tx.supplier.update({ where: { id }, data: input }));
  }

  async deactivate(enterpriseId: string, id: string): Promise<Supplier> {
    await this.findByIdOrThrow(enterpriseId, id);

    return this.tenantPrisma.run((tx) =>
      tx.supplier.update({ where: { id }, data: { isActive: false } }),
    );
  }
}
