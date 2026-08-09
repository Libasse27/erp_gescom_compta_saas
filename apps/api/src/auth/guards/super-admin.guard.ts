import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { RequestWithUser } from "./jwt-auth.guard";

// Toujours après JwtAuthGuard (a besoin de request.user). Réservé aux routes
// plateforme qui traversent les tenants (ex. changement de plan d'une
// entreprise arbitraire) — re-vérifie isSuperAdmin depuis le JWT signé
// côté serveur, jamais depuis une info envoyée par le client (CLAUDE.md §6).
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest<RequestWithUser>();

    if (!user?.isSuperAdmin) {
      throw new ForbiddenException("Réservé au Super Admin");
    }

    return true;
  }
}
