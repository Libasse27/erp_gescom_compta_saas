import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { Subscription, SubscriptionStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditLogService } from "../common/audit/audit-log.service";
import { NotificationsService } from "../notifications/notifications.service";
import { env } from "../config/env";
import {
  assertSubscriptionTransition,
  InvalidSubscriptionTransitionError,
} from "../subscriptions/subscription-state-machine";
import { InvoiceGenerationService } from "./invoice-generation.service";
import { PaymentProviderRegistry } from "./providers/payment-provider.registry";

export interface WebhookResult {
  outcome: "processed" | "ignored_already_processed";
  paymentId: string;
}

// Flux pré-tenant (webhook sans JWT, docs/adr/0008-...) : connexion
// d'identité, chaque enterpriseId/subscriptionId est re-vérifié contre le
// Payment déjà en base, jamais accepté depuis le payload du webhook lui-même
// (CLAUDE.md §6). Idempotence par (provider, providerReference) — champ
// unique en base (docs/PROMPT-MAITRE-SAAS.md Phase 5).
@Injectable()
export class PaymentWebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: PaymentProviderRegistry,
    private readonly invoiceGeneration: InvoiceGenerationService,
    private readonly notifications: NotificationsService,
    private readonly auditLog: AuditLogService,
  ) {}

  async handle(
    providerParam: string,
    rawBody: Buffer,
    signatureHeader: string | undefined,
    timestampHeader: string | undefined,
  ): Promise<WebhookResult> {
    const provider = this.registry.resolveProvider(providerParam);
    const adapter = this.registry.get(provider);

    if (!adapter.verifySignature(rawBody, signatureHeader, timestampHeader)) {
      throw new UnauthorizedException("Signature de webhook invalide");
    }

    const event = adapter.parseEvent(rawBody);

    const payment = await this.prisma.payment.findUnique({
      where: { provider_providerReference: { provider, providerReference: event.providerReference } },
    });

    // Jamais inventer un paiement à partir du seul webhook : il doit déjà
    // avoir été amorcé (PENDING) par un flux connu de la plateforme
    // (docs/PROMPT-MAITRE-SAAS.md Phase 5, "ne jamais activer un abonnement
    // sur la seule redirection du navigateur" — même logique pour un webhook
    // sans paiement amorcé correspondant).
    if (!payment) {
      throw new NotFoundException("Aucun paiement en attente pour cette référence");
    }

    // Rejoué (2e, 3e appel du même événement) : no-op idempotent, pas une erreur
    // — un fournisseur de paiement s'attend à un succès sur un webhook rejoué.
    if (payment.status !== "PENDING") {
      return { outcome: "ignored_already_processed", paymentId: payment.id };
    }

    if (payment.amount !== event.amount || payment.currency !== event.currency) {
      throw new BadRequestException("Le montant du webhook ne correspond pas au paiement en attente");
    }

    if (!payment.subscriptionId) {
      throw new ConflictException("Paiement sans abonnement associé");
    }

    let subscriptionAfter: Subscription | null;
    try {
      subscriptionAfter = await this.prisma.$transaction(async (tx) => {
        // Compare-and-swap atomique (BIL-01, docs/audit/BILLING-AUDIT.md) : la
        // lecture faite plus haut (hors transaction) ne fait que court-circuiter
        // le cas courant (rejeu déjà traité), elle n'est jamais la garantie
        // d'unicité. Deux livraisons concurrentes du même événement peuvent
        // toutes deux passer ce premier contrôle ; seule celle dont l'UPDATE
        // matche encore status="PENDING" au moment de s'exécuter (verrouillage
        // de ligne Postgres) obtient count=1 et poursuit — l'autre obtient
        // count=0 et s'arrête ici, sans dupliquer l'abonnement ni la facture.
        const { count } = await tx.payment.updateMany({
          where: { id: payment.id, status: "PENDING" },
          data: {
            status: event.status,
            paidAt: event.status === "SUCCEEDED" ? new Date() : null,
          },
        });
        if (count === 0) {
          return null;
        }
        const updatedPayment = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });

        const subscription = await tx.subscription.findUniqueOrThrow({ where: { id: payment.subscriptionId! } });
        const enterprise = await tx.enterprise.findUniqueOrThrow({ where: { id: payment.enterpriseId } });

        const targetStatus: SubscriptionStatus =
          event.status === "SUCCEEDED" ? SubscriptionStatus.ACTIVE : SubscriptionStatus.PAST_DUE;

        let subscription2 = subscription;
        if (subscription.status !== targetStatus) {
          assertSubscriptionTransition(subscription.status, targetStatus);

          subscription2 = await tx.subscription.update({
            where: { id: subscription.id },
            data: {
              status: targetStatus,
              renewalDate:
                targetStatus === SubscriptionStatus.PAST_DUE
                  ? new Date(Date.now() + env.paymentGracePeriodDays() * 24 * 3_600_000)
                  : subscription.renewalDate,
            },
          });

          await tx.subscriptionEvent.create({
            data: {
              subscriptionId: subscription.id,
              fromStatus: subscription.status,
              toStatus: targetStatus,
              fromPlanId: subscription.planId,
              toPlanId: subscription.planId,
              reason: event.status === "SUCCEEDED" ? "payment_succeeded" : "payment_failed",
            },
          });
        } else if (targetStatus === SubscriptionStatus.PAST_DUE) {
          // Échecs répétés pendant qu'on est déjà PAST_DUE : la période de
          // grâce repart, mais ce n'est pas une transition de statut (donc
          // pas de SubscriptionEvent, cf. self-transition rejetée par la
          // machine à états).
          subscription2 = await tx.subscription.update({
            where: { id: subscription.id },
            data: { renewalDate: new Date(Date.now() + env.paymentGracePeriodDays() * 24 * 3_600_000) },
          });
        }

        if (event.status === "SUCCEEDED") {
          await this.invoiceGeneration.generateForPayment(tx, {
            enterprise,
            subscriptionId: subscription.id,
            paymentId: updatedPayment.id,
            amount: updatedPayment.amount,
            currency: updatedPayment.currency,
          });
        }

        return subscription2;
      });
    } catch (error) {
      if (error instanceof InvalidSubscriptionTransitionError) {
        throw new ConflictException(error.message);
      }
      throw error;
    }

    if (subscriptionAfter === null) {
      // Perdant du compare-and-swap (BIL-01) : une autre livraison concurrente
      // du même événement a déjà tout traité (abonnement, facture, audit,
      // notification) — ne pas dupliquer ces effets de bord.
      return { outcome: "ignored_already_processed", paymentId: payment.id };
    }

    await this.auditLog.record({
      enterpriseId: payment.enterpriseId,
      action: "PAYMENT",
      resource: "Payment",
      resourceId: payment.id,
      metadata: { provider, providerReference: event.providerReference, status: event.status },
    });

    await this.notifyEnterprise(payment.enterpriseId, event.status, subscriptionAfter);

    return { outcome: "processed", paymentId: payment.id };
  }

  private async notifyEnterprise(
    enterpriseId: string,
    status: "SUCCEEDED" | "FAILED",
    subscription: Subscription,
  ): Promise<void> {
    const recipient = await this.prisma.user.findFirst({
      where: { enterpriseId, status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
    });

    if (!recipient) {
      return;
    }

    if (status === "SUCCEEDED") {
      await this.notifications.notify({
        userId: recipient.id,
        enterpriseId,
        type: "PAYMENT_CONFIRMED",
        to: recipient.email,
        subject: "Paiement confirmé",
        body: "Votre paiement a été confirmé, votre abonnement est actif.",
      });
    } else {
      await this.notifications.notify({
        userId: recipient.id,
        enterpriseId,
        type: "PAYMENT_FAILED",
        to: recipient.email,
        subject: "Échec de paiement",
        body: `Votre paiement a échoué. Votre abonnement passe en statut "en attente de paiement" jusqu'au ${subscription.renewalDate?.toLocaleDateString("fr-SN") ?? "prochain renouvellement"}.`,
      });
    }
  }
}
