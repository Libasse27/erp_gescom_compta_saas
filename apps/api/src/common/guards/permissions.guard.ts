import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PermissionKey } from "@erp/permissions";
import { TenantScopedPrismaService } from "../../tenant/tenant-scoped-prisma.service";
import { RequestWithUser } from "../../auth/guards/jwt-auth.guard";
import { REQUIRED_PERMISSION_KEY } from "../decorators/require-permission.decorator";

// Toujours exécuté après JwtAuthGuard (a besoin de request.user) et après
// TenantContextMiddleware (a besoin d'un TenantContext actif, voir
// tenant/tenant-scoped-prisma.service.ts). Re-résout la permission en base
// à chaque requête, à travers la connexion RLS — jamais depuis le JWT ou un
// quelconque état envoyé par le client (CLAUDE.md §6).
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenantPrisma: TenantScopedPrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.get<PermissionKey | undefined>(REQUIRED_PERMISSION_KEY, context.getHandler());

    if (!required) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    // Un Super Admin n'a pas de rôle RBAC tenant : ces routes ne le
    // concernent pas (il opère via des routes plateforme dédiées).
    if (!user?.enterpriseId) {
      throw new ForbiddenException("Permission refusée");
    }

    const grantCount = await this.tenantPrisma.run((tx) =>
      tx.rolePermission.count({
        where: {
          permission: { key: required },
          role: {
            enterpriseId: user.enterpriseId as string,
            userRoles: { some: { userId: user.id } },
          },
        },
      }),
    );

    if (grantCount === 0) {
      throw new ForbiddenException("Permission refusée");
    }

    return true;
  }
}
