import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { Subscription, SubscriptionStatus } from "@prisma/client";
import { AuditLogService } from "../common/audit/audit-log.service";
import { CrossTenantRepository } from "../tenant/cross-tenant.repository";
import { assertSubscriptionTransition } from "./subscription-state-machine";

// Corrige BIL-03 (docs/audit/BILLING-AUDIT.md) : jusqu'ici, aucun code du
// dépôt ne produisait jamais les transitions TRIAL->EXPIRED ni
// PAST_DUE->SUSPENDED — un essai gratuit ne se terminait jamais, un impayé
// ne restreignait jamais rien. Idempotent par construction : chaque
// transition sort le Subscription concerné du filtre de la requête
// suivante (status déjà changé), une exécution répétée ne retraite jamais
// deux fois la même ligne.
@Injectable()
export class SubscriptionLifecycleService {
  private readonly logger = new Logger(SubscriptionLifecycleService.name);

  constructor(
    private readonly crossTenant: CrossTenantRepository,
    private readonly auditLog: AuditLogService,
  ) {}

  // Horaire plutôt que quotidien : borne à quelques dizaines de minutes
  // maximum la fenêtre pendant laquelle un essai expiré ou une grâce
  // dépassée garde encore un accès complet, sans charge Postgres
  // perceptible (une poignée de lignes scannées par index par exécution).
  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    await this.expireTrials();
    await this.suspendOverdueGracePeriods();
  }

  async expireTrials(): Promise<number> {
    const subscriptions = await this.crossTenant.findExpirableTrialSubscriptions(new Date());
    for (const subscription of subscriptions) {
      await this.transition(subscription, SubscriptionStatus.EXPIRED, "trial_expired", "EXPIRE_TRIAL");
    }
    return subscriptions.length;
  }

  async suspendOverdueGracePeriods(): Promise<number> {
    const subscriptions = await this.crossTenant.findOverdueGracePeriodSubscriptions(new Date());
    for (const subscription of subscriptions) {
      await this.transition(subscription, SubscriptionStatus.SUSPENDED, "grace_period_expired", "SUSPEND_SUBSCRIPTION");
    }
    return subscriptions.length;
  }

  // Une transition qui échoue (ex. état modifié entre la lecture batch et
  // l'écriture) ne doit jamais interrompre le traitement des autres
  // abonnements du même passage — chacun est indépendant.
  private async transition(
    subscription: Subscription,
    toStatus: SubscriptionStatus,
    reason: string,
    auditAction: "EXPIRE_TRIAL" | "SUSPEND_SUBSCRIPTION",
  ): Promise<void> {
    try {
      assertSubscriptionTransition(subscription.status, toStatus);

      // Compare-and-swap (même patron que PaymentWebhookService, BIL-01) :
      // `subscription.status` vient d'une lecture batch en mémoire, pas
      // d'une lecture fraîche juste avant l'écriture. Si un webhook de
      // paiement concurrent a déjà fait progresser ce même abonnement entre
      // les deux, `count` vaut 0 — ne jamais écraser cet état plus frais,
      // ni écrire un SubscriptionEvent/AuditLog pour une transition qui n'a
      // pas eu lieu.
      const { count } = await this.crossTenant.updateSubscriptionStatus(
        subscription.id,
        subscription.status,
        toStatus,
      );
      if (count === 0) {
        this.logger.warn(
          `Transition ${subscription.status} -> ${toStatus} ignorée pour l'abonnement ${subscription.id} : statut déjà modifié entre-temps par un autre traitement`,
        );
        return;
      }

      await this.crossTenant.createSubscriptionEvent({
        subscriptionId: subscription.id,
        fromStatus: subscription.status,
        toStatus,
        reason,
      });
      await this.auditLog.record({
        enterpriseId: subscription.enterpriseId,
        action: auditAction,
        resource: "Subscription",
        resourceId: subscription.id,
        metadata: { fromStatus: subscription.status, toStatus, reason },
      });
    } catch (error) {
      this.logger.error(
        `Échec de la transition ${subscription.status} -> ${toStatus} pour l'abonnement ${subscription.id}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
