import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PermissionKey } from "@erp/permissions";
import { PrismaService } from "../../prisma/prisma.service";
import { RequestWithUser } from "../../auth/guards/jwt-auth.guard";
import { REQUIRED_PERMISSION_KEY } from "../decorators/require-permission.decorator";

// Toujours exécuté après JwtAuthGuard (a besoin de request.user). Re-résout
// la permission en base à chaque requête — jamais depuis le JWT ou un
// quelconque état envoyé par le client (CLAUDE.md §6).
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
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

    const grantCount = await this.prisma.rolePermission.count({
      where: {
        permission: { key: required },
        role: {
          enterpriseId: user.enterpriseId,
          userRoles: { some: { userId: user.id } },
        },
      },
    });

    if (grantCount === 0) {
      throw new ForbiddenException("Permission refusée");
    }

    return true;
  }
}
