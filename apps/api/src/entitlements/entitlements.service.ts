import { Injectable } from "@nestjs/common";
import { SubscriptionStatus } from "@prisma/client";
import { env } from "../config/env";
import { TenantContext } from "../tenant/tenant-context";
import { TenantScopedPrismaService } from "../tenant/tenant-scoped-prisma.service";

export interface Entitlements {
  subscriptionStatus: SubscriptionStatus | null;
  planCode: string | null;
  features: ReadonlySet<string>;
  // value = null => illimité ; clé absente => aucune limite définie pour ce
  // plan (traité comme illimité, voir LimitGuard).
  limits: ReadonlyMap<string, number | null>;
}

const NO_SUBSCRIPTION: Entitlements = {
  subscriptionStatus: null,
  planCode: null,
  features: new Set(),
  limits: new Map(),
};

// Point d'application unique des entitlements (docs/PROMPT-MAITRE-SAAS.md
// Phase 4) : résout à chaque requête l'abonnement/plan courant de
// l'entreprise du TenantContext actif. Jamais mis en cache dans le JWT
// (docs/adr/0005-stockage-entitlements.md) — seulement un court cache
// mémoire par processus pour borner la charge Postgres.
@Injectable()
export class EntitlementsService {
  private readonly cache = new Map<string, { value: Entitlements; expiresAt: number }>();

  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  async getCurrent(): Promise<Entitlements> {
    const tenantId = TenantContext.getRequiredTenantId();

    const cached = this.cache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const value = await this.resolve(tenantId);
    const ttl = env.entitlementsCacheTtlMs();
    if (ttl > 0) {
      this.cache.set(tenantId, { value, expiresAt: Date.now() + ttl });
    }
    return value;
  }

  private async resolve(tenantId: string): Promise<Entitlements> {
    return this.tenantPrisma.run(async (tx) => {
      const enterprise = await tx.enterprise.findUnique({
        where: { id: tenantId },
        include: {
          currentSubscription: {
            include: {
              plan: {
                include: {
                  planFeatures: { include: { feature: true } },
                  planLimits: { include: { limit: true } },
                },
              },
            },
          },
        },
      });

      const subscription = enterprise?.currentSubscription;
      if (!subscription) {
        return NO_SUBSCRIPTION;
      }

      const { plan } = subscription;

      return {
        subscriptionStatus: subscription.status,
        planCode: plan.code,
        features: new Set(plan.planFeatures.filter((pf) => pf.enabled).map((pf) => pf.feature.key)),
        limits: new Map(plan.planLimits.map((pl) => [pl.limit.key, pl.value])),
      };
    });
  }
}
