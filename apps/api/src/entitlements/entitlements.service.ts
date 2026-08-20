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
//
// Corrige BIL-17 (docs/audit/BILLING-AUDIT.md) : le TTL seul bornait la
// fraîcheur (jusqu'à entitlementsCacheTtlMs de dérive après un changement de
// plan/statut) mais pas la mémoire (une entrée expirée reste dans la Map
// jusqu'à sa prochaine lecture, jamais purgée si le tenant ne revient
// jamais). Deux mécanismes indépendants, l'un ne remplaçant pas l'autre :
// invalidate() élimine la fenêtre de dérive (appelée par
// SubscriptionsService.changePlan et PaymentWebhookService à chaque
// changement effectif) ; l'éviction LRU dans store() borne la taille de la
// Map indépendamment du TTL. JwtAuthGuard.statusCache partage la même
// faiblesse structurelle mais reste hors périmètre de ce correctif
// (traitement séparé si nécessaire).
@Injectable()
export class EntitlementsService {
  private readonly cache = new Map<string, { value: Entitlements; expiresAt: number }>();

  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  async getCurrent(): Promise<Entitlements> {
    const tenantId = TenantContext.getRequiredTenantId();

    const cached = this.cache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) {
      // LRU : une Map JS préserve l'ordre d'insertion ; delete puis set
      // replace cette entrée en position la plus récente, sans quoi une
      // clé souvent relue resterait "la plus ancienne" et serait évincée en
      // premier malgré un usage actif.
      this.cache.delete(tenantId);
      this.cache.set(tenantId, cached);
      return cached.value;
    }

    const value = await this.resolve(tenantId);
    const ttl = env.entitlementsCacheTtlMs();
    if (ttl > 0) {
      this.store(tenantId, { value, expiresAt: Date.now() + ttl });
    }
    return value;
  }

  // Appelé par SubscriptionsService.changePlan et PaymentWebhookService à
  // chaque changement de plan/statut effectif (BIL-17) : élimine la fenêtre
  // de dérive du TTL au lieu d'attendre son expiration passive. Silencieux
  // si rien n'était en cache pour ce tenant (delete sur une Map ne lève
  // jamais).
  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
  }

  private store(tenantId: string, entry: { value: Entitlements; expiresAt: number }): void {
    const maxEntries = env.entitlementsCacheMaxEntries();
    if (this.cache.size >= maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(tenantId, entry);
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
