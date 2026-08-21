import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { Payment } from "@prisma/client";
import { AuditLogService } from "../common/audit/audit-log.service";
import { CrossTenantRepository } from "../tenant/cross-tenant.repository";

// Corrige BIL-19 (docs/audit/BILLING-AUDIT.md) : un Payment PENDING amorcé
// (checkout) restait activable indéfiniment par un webhook signé, quelle que
// soit son ancienneté. Même patron que SubscriptionLifecycleService (BIL-03) :
// purge proactive horaire, idempotente par construction (chaque transition
// sort le Payment concerné du filtre de la requête suivante), en complément
// du rejet réactif posé dans PaymentWebhookService pour la fenêtre entre
// deux exécutions du job.
@Injectable()
export class PaymentLifecycleService {
  private readonly logger = new Logger(PaymentLifecycleService.name);

  constructor(
    private readonly crossTenant: CrossTenantRepository,
    private readonly auditLog: AuditLogService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    await this.expirePendingPayments();
  }

  async expirePendingPayments(): Promise<number> {
    const payments = await this.crossTenant.findExpirablePendingPayments(new Date());
    let expiredCount = 0;
    for (const payment of payments) {
      if (await this.expire(payment)) {
        expiredCount += 1;
      }
    }
    return expiredCount;
  }

  // Une transition qui échoue (ex. déjà résolu par un webhook concurrent
  // entre la lecture batch et l'écriture) ne doit jamais interrompre le
  // traitement des autres paiements du même passage.
  private async expire(payment: Payment): Promise<boolean> {
    try {
      const { count } = await this.crossTenant.expirePendingPayment(payment.id);
      if (count === 0) {
        this.logger.warn(
          `Expiration ignorée pour le paiement ${payment.id} : statut déjà modifié entre-temps par un autre traitement`,
        );
        return false;
      }

      await this.auditLog.record({
        enterpriseId: payment.enterpriseId,
        action: "EXPIRE_PAYMENT",
        resource: "Payment",
        resourceId: payment.id,
        metadata: {
          reason: "pending_payment_expired",
          provider: payment.provider,
          providerReference: payment.providerReference,
          expiresAt: payment.expiresAt?.toISOString(),
        },
      });
      return true;
    } catch (error) {
      this.logger.error(
        `Échec de l'expiration du paiement ${payment.id}`,
        error instanceof Error ? error.stack : undefined,
      );
      return false;
    }
  }
}
