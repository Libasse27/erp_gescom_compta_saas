import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { CreatePendingPaymentInput } from "@erp/validation";
import { AuditLogService } from "../common/audit/audit-log.service";
import { RequestMetadata } from "../auth/auth.service";
import { CrossTenantRepository } from "../tenant/cross-tenant.repository";

// Amorce un Payment(PENDING) côté Super Admin — tient lieu de flux de
// checkout réel (Phase 6/7 non encore construits), voir
// docs/PROMPT-MAITRE-SAAS.md Phase 5.
@Injectable()
export class PaymentsBootstrapService {
  constructor(
    private readonly crossTenant: CrossTenantRepository,
    private readonly auditLog: AuditLogService,
  ) {}

  async createPendingPayment(
    enterpriseId: string,
    input: CreatePendingPaymentInput,
    actorUserId: string,
    meta: RequestMetadata,
  ): Promise<{ paymentId: string }> {
    const enterprise = await this.crossTenant.findEnterpriseWithCurrentSubscription(enterpriseId);
    if (!enterprise?.currentSubscription) {
      throw new NotFoundException("Aucun abonnement actif pour cette entreprise");
    }

    // BIL-05 : le montant n'est jamais accepté depuis la requête, il est
    // dérivé du prix du plan de l'abonnement en cours (CLAUDE.md §6).
    const plan = enterprise.currentSubscription.plan;
    const amount = input.billingPeriod === "MONTHLY" ? plan.priceMonthly : plan.priceYearly;
    if (amount === null || amount === undefined) {
      throw new ConflictException("Ce plan ne propose pas de facturation annuelle");
    }
    const currency = enterprise.currency;

    const payment = await this.crossTenant.createPendingPayment({
      enterpriseId,
      subscriptionId: enterprise.currentSubscription.id,
      provider: input.provider,
      providerReference: input.providerReference,
      amount,
      currency,
    });

    await this.auditLog.record({
      userId: actorUserId,
      enterpriseId,
      action: "PAYMENT",
      resource: "Payment",
      resourceId: payment.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        status: "PENDING",
        provider: input.provider,
        providerReference: input.providerReference,
        billingPeriod: input.billingPeriod,
        amount,
        currency,
      },
    });

    return { paymentId: payment.id };
  }
}
