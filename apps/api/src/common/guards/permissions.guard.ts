import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PermissionKey } from "@erp/permissions";
import { TenantScopedPrismaService } from "../../tenant/tenant-scoped-prisma.service";
import { RequestWithUser } from "../../auth/guards/jwt-auth.guard";
import { REQUIRED_PERMISSION_KEY } from "../decorators/require-permission.decorator";
import { NO_PERMISSION_REQUIRED_KEY } from "../decorators/no-permission-required.decorator";

// Toujours exécuté après JwtAuthGuard (a besoin de request.user) et après
// TenantContextMiddleware (a besoin d'un TenantContext actif, voir
// tenant/tenant-scoped-prisma.service.ts). Re-résout la permission en base
// à chaque requête, à travers la connexion RLS — jamais depuis le JWT ou un
// quelconque état envoyé par le client (CLAUDE.md §6).
//
// Corrige RBAC-01 (docs/audit/RBAC-AUDIT.md) : fail-closed par défaut. Une
// route sous ce guard sans @RequirePermission ni @NoPermissionRequired()
// explicite est désormais refusée (403), au lieu d'être ouverte à tout
// utilisateur authentifié par simple oubli de décorateur.
// getAllAndOverride (handler puis classe) au lieu de get(..., getHandler())
// seul : un @RequirePermission posé au niveau classe n'est plus
// silencieusement ignoré.
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenantPrisma: TenantScopedPrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<PermissionKey | undefined>(REQUIRED_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required) {
      const exempted = this.reflector.getAllAndOverride<boolean | undefined>(NO_PERMISSION_REQUIRED_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);

      if (exempted) {
        return true;
      }

      throw new ForbiddenException("Permission refusée");
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
