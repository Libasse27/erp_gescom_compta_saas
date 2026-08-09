import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Prisma } from "@prisma/client";
import { TenantScopedPrismaService } from "../../tenant/tenant-scoped-prisma.service";
import { EntitlementsService } from "../entitlements.service";
import { WITHIN_LIMIT_KEY } from "../decorators/within-limit.decorator";

// Un compteur d'usage par clé de limite. Phase 8 en ajoutera d'autres
// (products, clients, storage) au fil de la migration des modules ERP —
// aucun changement requis dans le guard lui-même pour les ajouter.
const USAGE_COUNTERS: Record<string, (tx: Prisma.TransactionClient) => Promise<number>> = {
  users: (tx) => tx.user.count(),
};

// Même placement que PermissionsGuard/FeatureGuard (après JwtAuthGuard).
// Absence de PlanLimit pour la clé demandée = pas de contrainte pour ce plan
// (comportement permissif, cohérent avec value=null="illimité" sur
// PlanLimit — voir schema.prisma).
@Injectable()
export class LimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: EntitlementsService,
    private readonly tenantPrisma: TenantScopedPrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const limitKey = this.reflector.get<string | undefined>(WITHIN_LIMIT_KEY, context.getHandler());

    if (!limitKey) {
      return true;
    }

    const { limits } = await this.entitlements.getCurrent();
    const max = limits.get(limitKey);

    if (max === undefined || max === null) {
      return true;
    }

    const counter = USAGE_COUNTERS[limitKey];
    if (!counter) {
      throw new Error(`LimitGuard : aucun compteur d'usage enregistré pour la clé "${limitKey}"`);
    }

    const usage = await this.tenantPrisma.run((tx) => counter(tx));

    if (usage >= max) {
      throw new ForbiddenException(`Quota atteint pour "${limitKey}" (limite : ${max})`);
    }

    return true;
  }
}
