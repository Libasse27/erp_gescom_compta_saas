import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { EntitlementsService } from "../entitlements.service";
import { REQUIRED_FEATURE_KEY } from "../decorators/requires-feature.decorator";

// Toujours exécuté après JwtAuthGuard (a besoin d'un TenantContext actif) —
// même placement que PermissionsGuard. Refuse l'accès si le plan courant de
// l'entreprise n'a pas la feature activée, quel que soit ce qu'un état
// frontend prétend (CLAUDE.md §6).
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: EntitlementsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.get<string | undefined>(REQUIRED_FEATURE_KEY, context.getHandler());

    if (!required) {
      return true;
    }

    const { features } = await this.entitlements.getCurrent();

    if (!features.has(required)) {
      throw new ForbiddenException(`Fonctionnalité non disponible pour votre forfait : ${required}`);
    }

    return true;
  }
}
