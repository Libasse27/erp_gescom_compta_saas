import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { SubscriptionStatus } from "@prisma/client";
import { AuditLogService } from "../common/audit/audit-log.service";
import { EntitlementsService } from "../entitlements/entitlements.service";
import { RequestMetadata } from "../auth/auth.service";
import { CrossTenantRepository } from "../tenant/cross-tenant.repository";

// Corrige BIL-13 (docs/audit/BILLING-AUDIT.md) : CANCELLED et EXPIRED sont
// des états terminaux (subscription-state-machine.ts, ALLOWED_TRANSITIONS
// vides pour ces deux statuts) — un abonnement qui y est ne doit plus jamais
// être modifié. Garde définie ici plutôt que réutiliser
// assertSubscriptionTransition : un changement de plan ne fait pas varier le
// statut (fromStatus === toStatus dans l'événement), ce n'est donc pas une
// transition au sens de la state machine, qui rejetterait à tort tout
// changement de plan (aucun statut n'est listé comme transitionnant vers
// lui-même).
const TERMINAL_SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  SubscriptionStatus.CANCELLED,
  SubscriptionStatus.EXPIRED,
];

// Action plateforme du Super Admin (docs/PROMPT-MAITRE-SAAS.md Phase 4,
// critère "changer un plan côté Super Admin se répercute sans
// redéploiement") : passe exclusivement par CrossTenantRepository, jamais
// par TenantScopedPrismaService (le Super Admin agit hors de son propre
// tenant) ni par PrismaService en direct (CLAUDE.md §5).
@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly crossTenant: CrossTenantRepository,
    private readonly auditLog: AuditLogService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async changePlan(
    enterpriseId: string,
    newPlanId: string,
    actorUserId: string,
    reason: string | undefined,
    meta: RequestMetadata,
  ): Promise<{ subscriptionId: string }> {
    const enterprise = await this.crossTenant.findEnterpriseWithCurrentSubscription(enterpriseId);
    const subscription = enterprise?.currentSubscription;
    if (!subscription) {
      throw new NotFoundException("Aucun abonnement actif pour cette entreprise");
    }

    if (TERMINAL_SUBSCRIPTION_STATUSES.includes(subscription.status)) {
      throw new ConflictException(
        `Impossible de changer de forfait : l'abonnement est ${subscription.status}`,
      );
    }

    const newPlan = await this.crossTenant.findPlan(newPlanId);
    if (!newPlan) {
      throw new NotFoundException("Forfait introuvable");
    }

    if (subscription.planId === newPlanId) {
      throw new ConflictException("L'entreprise est déjà sur ce forfait");
    }

    // Historique immuable de la facturation passée (docs/PROMPT-MAITRE-SAAS.md
    // Phase 1) : le statut de l'abonnement n'est pas affecté par un simple
    // changement de plan, seul le plan change. Mise à jour du plan +
    // écriture de l'événement dans une seule transaction (BIL-13) : jamais
    // de plan changé sans trace dans l'historique. Proration/facturation au
    // changement de plan explicitement hors périmètre (docs/audit/BILLING-AUDIT.md
    // BIL-13, décision produit/finance non tranchée).
    await this.crossTenant.changeSubscriptionPlan(subscription.id, newPlanId, {
      fromStatus: subscription.status,
      fromPlanId: subscription.planId,
      reason,
      triggeredByUserId: actorUserId,
    });

    // Corrige BIL-17 (docs/audit/BILLING-AUDIT.md) : sans ceci, la requête
    // suivante pouvait encore voir l'ancien plan jusqu'à
    // entitlementsCacheTtlMs (5 s en production) — le changement de plan
    // n'était donc pas réellement immédiat malgré ce que documente déjà le
    // test d'intégration de ce contrôleur.
    this.entitlements.invalidate(enterpriseId);

    await this.auditLog.record({
      userId: actorUserId,
      enterpriseId,
      action: "CHANGE_PLAN",
      resource: "Subscription",
      resourceId: subscription.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { fromPlanId: subscription.planId, toPlanId: newPlanId, reason },
    });

    return { subscriptionId: subscription.id };
  }
}
