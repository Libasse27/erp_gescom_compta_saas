import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditLogService } from "../common/audit/audit-log.service";
import { RequestMetadata } from "../auth/auth.service";
import { CrossTenantRepository } from "../tenant/cross-tenant.repository";

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

    const newPlan = await this.crossTenant.findPlan(newPlanId);
    if (!newPlan) {
      throw new NotFoundException("Forfait introuvable");
    }

    if (subscription.planId === newPlanId) {
      throw new ConflictException("L'entreprise est déjà sur ce forfait");
    }

    await this.crossTenant.updateSubscriptionPlan(subscription.id, newPlanId);

    // Historique immuable de la facturation passée (docs/PROMPT-MAITRE-SAAS.md
    // Phase 1) : le statut de l'abonnement n'est pas affecté par un simple
    // changement de plan, seul le plan change.
    await this.crossTenant.createSubscriptionEvent({
      subscriptionId: subscription.id,
      fromStatus: subscription.status,
      toStatus: subscription.status,
      fromPlanId: subscription.planId,
      toPlanId: newPlanId,
      reason,
      triggeredByUserId: actorUserId,
    });

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
