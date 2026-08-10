import { Injectable, NotFoundException } from "@nestjs/common";
import { Customer, Prisma } from "@prisma/client";
import { TenantScopedPrismaService } from "../tenant/tenant-scoped-prisma.service";
import { CreateCustomerInput, ListCustomersQuery, UpdateCustomerInput } from "@erp/validation";

export interface CustomerListResult {
  items: Customer[];
  total: number;
  page: number;
  pageSize: number;
}

// Seul point d'accès Prisma pour le modèle Customer (CLAUDE.md §5/§8) : le
// service ne connaît que ces méthodes, jamais tx.customer.* directement.
// Toute méthode passe par TenantScopedPrismaService.run() — la RLS scope déjà
// chaque requête à l'entreprise courante, ce filtrage explicite reste en
// défense en profondeur (comme PermissionsGuard, voir tenant-scoped-prisma.service.ts).
@Injectable()
export class CustomersRepository {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  async findMany(enterpriseId: string, query: ListCustomersQuery): Promise<CustomerListResult> {
    const where: Prisma.CustomerWhereInput = {
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
        tx.customer.findMany({
          where,
          orderBy: { name: "asc" },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.customer.count({ where }),
      ]),
    );

    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async findByIdOrThrow(enterpriseId: string, id: string): Promise<Customer> {
    const customer = await this.tenantPrisma.run((tx) => tx.customer.findUnique({ where: { id } }));

    // La RLS empêche déjà de lire un client d'un autre tenant (il n'existe
    // simplement pas dans le résultat) ; cette vérification explicite
    // garantit un 404, pas une fuite d'information sur son existence ailleurs
    // (docs/PROMPT-MAITRE-SAAS.md Phase 3, critère "404 pas 403").
    if (!customer || customer.enterpriseId !== enterpriseId) {
      throw new NotFoundException("Client introuvable");
    }

    return customer;
  }

  async create(enterpriseId: string, input: CreateCustomerInput): Promise<Customer> {
    return this.tenantPrisma.run((tx) =>
      tx.customer.create({
        data: { ...input, enterpriseId },
      }),
    );
  }

  async update(enterpriseId: string, id: string, input: UpdateCustomerInput): Promise<Customer> {
    // Vérifie l'appartenance au tenant avant d'écrire (même raisonnement que
    // findByIdOrThrow) : un update "aveugle" par id seul s'appuierait
    // uniquement sur la RLS, qui affecterait alors 0 ligne sans lever
    // d'erreur explicite — on préfère un 404 clair.
    await this.findByIdOrThrow(enterpriseId, id);

    return this.tenantPrisma.run((tx) => tx.customer.update({ where: { id }, data: input }));
  }

  async deactivate(enterpriseId: string, id: string): Promise<Customer> {
    await this.findByIdOrThrow(enterpriseId, id);

    return this.tenantPrisma.run((tx) =>
      tx.customer.update({ where: { id }, data: { isActive: false } }),
    );
  }
}
