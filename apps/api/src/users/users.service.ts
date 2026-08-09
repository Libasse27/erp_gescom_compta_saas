import { ForbiddenException, Injectable } from "@nestjs/common";
import { TenantScopedPrismaService } from "../tenant/tenant-scoped-prisma.service";
import { EntitlementsService } from "../entitlements/entitlements.service";

export interface UserContext {
  permissions: string[];
  planCode: string | null;
  subscriptionStatus: string | null;
  features: string[];
}

export interface EnterpriseUserSummary {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  roles: string[];
  createdAt: Date;
}

// Lecture seule, tenant-scoped (docs/PROMPT-MAITRE-SAAS.md Phase 7.2) : pilote
// le menu frontend (Rôle × Permissions × Plan, jamais codé en dur côté client)
// et la page Utilisateurs.
@Injectable()
export class UsersService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async getMyContext(userId: string, enterpriseId: string | null): Promise<UserContext> {
    if (!enterpriseId) {
      throw new ForbiddenException("Réservé aux comptes entreprise");
    }

    const rolePermissions = await this.tenantPrisma.run((tx) =>
      tx.rolePermission.findMany({
        where: { role: { userRoles: { some: { userId } } } },
        select: { permission: { select: { key: true } } },
      }),
    );

    const entitlements = await this.entitlements.getCurrent();

    return {
      permissions: [...new Set(rolePermissions.map((rp) => rp.permission.key))],
      planCode: entitlements.planCode,
      subscriptionStatus: entitlements.subscriptionStatus,
      features: [...entitlements.features],
    };
  }

  async listEnterpriseUsers(): Promise<EnterpriseUserSummary[]> {
    const users = await this.tenantPrisma.run((tx) =>
      tx.user.findMany({
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          status: true,
          createdAt: true,
          userRoles: { select: { role: { select: { name: true } } } },
        },
        orderBy: { createdAt: "asc" },
      }),
    );

    return users.map((user) => ({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      status: user.status,
      createdAt: user.createdAt,
      roles: user.userRoles.map((ur) => ur.role.name),
    }));
  }
}
