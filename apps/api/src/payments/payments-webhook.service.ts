import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { PaymentProvider, Subscription, SubscriptionStatus } from "@prisma/client";
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
import { PaymentWebhookEvent } from "./providers/payment-provider.types";

export interface WebhookResult {
  outcome: "processed" | "ignored_already_processed" | "status_conflict";
  paymentId: string;
}

// Flux pré-tenant (webhook sans JWT, docs/adr/0008-...) : connexion
// d'identité, chaque enterpriseId/subscriptionId est re-vérifié contre le
// Payment déjà en base, jamais accepté depuis le payload du webhook lui-même
// (CLAUDE.md §6). Idempotence par (provider, providerReference) — champ
// unique en base (docs/PROMPT-MAITRE-SAAS.md Phase 5).
@Injectable()
export class PaymentWebhookService {
  private readonly logger = new Logger(PaymentWebhookService.name);

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
      // BIL-09 (docs/audit/BILLING-AUDIT.md) : providerReference pas encore
      // connu à ce stade (signature vérifiée avant tout parsing du corps).
      await this.auditRejection({ httpStatus: 401, reason: "invalid_signature_or_timestamp", provider, rawBody });
      throw new UnauthorizedException("Signature de webhook invalide");
    }

    // Un corps syntaxiquement invalide (JSON cassé) n'atteint jamais ce
    // bloc : le body-parser Express (activé par rawBody: true, main.ts) le
    // rejette en amont avec sa propre erreur 400, avant même le routage
    // Nest. Ce qui reste réellement atteignable ici, c'est un JSON valide
    // dont la forme ne correspond pas au schéma attendu (paymentWebhookEventSchema).
    let event: PaymentWebhookEvent;
    try {
      event = adapter.parseEvent(rawBody);
    } catch (error) {
      await this.auditRejection({ httpStatus: 400, reason: "malformed_body", provider, rawBody });
      throw error;
    }

    const payment = await this.prisma.payment.findUnique({
      where: { provider_providerReference: { provider, providerReference: event.providerReference } },
    });

    // Jamais inventer un paiement à partir du seul webhook : il doit déjà
    // avoir été amorcé (PENDING) par un flux connu de la plateforme
    // (docs/PROMPT-MAITRE-SAAS.md Phase 5, "ne jamais activer un abonnement
    // sur la seule redirection du navigateur" — même logique pour un webhook
    // sans paiement amorcé correspondant).
    if (!payment) {
      await this.auditRejection({
        httpStatus: 404,
        reason: "unknown_payment_reference",
        provider,
        rawBody,
        providerReference: event.providerReference,
      });
      throw new NotFoundException("Aucun paiement en attente pour cette référence");
    }

    if (payment.status !== "PENDING") {
      // event.status normalisé par l'adaptateur (SUCCEEDED/FAILED, voir
      // HmacPaymentProviderAdapter.parseEvent) — comparable tel quel à
      // payment.status (PaymentStatus Prisma).
      if (event.status === payment.status) {
        // Rejoué (2e, 3e appel du même événement) : no-op idempotent, pas une
        // erreur — un fournisseur de paiement s'attend à un succès sur un
        // webhook rejoué.
        return { outcome: "ignored_already_processed", paymentId: payment.id };
      }

      // BIL-07 (docs/audit/BILLING-AUDIT.md) : un événement différent sur un
      // paiement déjà résolu (ex. SUCCEEDED après un FAILED déjà enregistré)
      // n'est jamais un simple rejeu — c'est une anomalie financière
      // potentielle (encaissement réel jamais reflété). Ne jamais
      // l'activer/facturer automatiquement a posteriori (date d'effet et
      // période déjà écoulée ambiguës) : on répond 200 (pas de retentatives
      // en boucle côté fournisseur) tout en la rendant détectable —
      // AuditLog + log structuré, jamais un succès silencieux.
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          metadata: {
            conflictingEvent: {
              status: event.status,
              detectedAgainstStatus: payment.status,
              receivedAt: new Date().toISOString(),
            },
          },
        },
      });

      await this.auditLog.record({
        enterpriseId: payment.enterpriseId,
        action: "PAYMENT",
        resource: "Payment",
        resourceId: payment.id,
        metadata: {
          anomaly: true,
          severity: "high",
          reason: "status_conflict_after_terminal_state",
          provider,
          providerReference: event.providerReference,
          previousStatus: payment.status,
          incomingStatus: event.status,
        },
      });

      this.logger.error(
        `Webhook de paiement en conflit : paiement ${payment.id} déjà ${payment.status}, ` +
          `événement entrant ${event.status} (provider=${provider}, ref=${event.providerReference}). ` +
          "Aucune transition automatique effectuée — réconciliation manuelle requise.",
      );

      return { outcome: "status_conflict", paymentId: payment.id };
    }

    if (payment.amount !== event.amount || payment.currency !== event.currency) {
      await this.auditRejection({
        httpStatus: 400,
        reason: "amount_or_currency_mismatch",
        provider,
        rawBody,
        providerReference: event.providerReference,
        enterpriseId: payment.enterpriseId,
        paymentId: payment.id,
      });
      throw new BadRequestException("Le montant du webhook ne correspond pas au paiement en attente");
    }

    if (!payment.subscriptionId) {
      await this.auditRejection({
        httpStatus: 409,
        reason: "payment_without_subscription",
        provider,
        rawBody,
        providerReference: event.providerReference,
        enterpriseId: payment.enterpriseId,
        paymentId: payment.id,
      });
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

        // BIL-08 (docs/audit/BILLING-AUDIT.md) : un échec pendant l'essai
        // n'a aucune conséquence sur le statut — l'entreprise n'a jamais été
        // facturée, elle reste TRIAL jusqu'à trialEndDate. TRIAL → PAST_DUE
        // n'est de toute façon pas une transition autorisée par la machine à
        // états (subscription-state-machine.ts) ; viser PAST_DUE ici la
        // ferait échouer et bloquerait le paiement en PENDING indéfiniment.
        const targetStatus: SubscriptionStatus | null =
          event.status === "SUCCEEDED"
            ? SubscriptionStatus.ACTIVE
            : subscription.status === SubscriptionStatus.TRIAL
              ? null
              : SubscriptionStatus.PAST_DUE;

        let subscription2 = subscription;
        if (targetStatus !== null && subscription.status !== targetStatus) {
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
        await this.auditRejection({
          httpStatus: 409,
          reason: "invalid_subscription_transition",
          provider,
          rawBody,
          providerReference: event.providerReference,
          enterpriseId: payment.enterpriseId,
          paymentId: payment.id,
        });
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

  // BIL-09 (docs/audit/BILLING-AUDIT.md) : chaque rejet devient détectable —
  // jamais le corps brut ni aucun secret, uniquement une empreinte SHA-256
  // (aucune valeur ajoutée à conserver le corps en clair pour un rejet, et
  // CLAUDE.md §6 interdit d'écrire un secret/payload sensible dans un log ou
  // un audit). Ne remplace ni BIL-01 (idempotence, compare-and-swap
  // transactionnel) ni BIL-06 (fraîcheur du timestamp) — ceci ne fait que
  // rendre visibles des rejets qui existaient déjà.
  private async auditRejection(params: {
    httpStatus: number;
    reason: string;
    provider: PaymentProvider;
    rawBody: Buffer;
    providerReference?: string;
    enterpriseId?: string;
    paymentId?: string;
  }): Promise<void> {
    const bodyHash = createHash("sha256").update(params.rawBody).digest("hex");

    await this.auditLog.record({
      enterpriseId: params.enterpriseId,
      action: "PAYMENT_WEBHOOK_REJECTED",
      resource: "PaymentWebhook",
      resourceId: params.paymentId,
      metadata: {
        httpStatus: params.httpStatus,
        reason: params.reason,
        provider: params.provider,
        providerReference: params.providerReference,
        bodyHash,
      },
    });

    this.logger.warn(
      `Webhook de paiement rejeté (${params.httpStatus}) : ${params.reason} ` +
        `(provider=${params.provider}${params.providerReference ? `, ref=${params.providerReference}` : ""}).`,
    );
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
      // BIL-08 : un échec pendant l'essai ne met pas l'abonnement en attente
      // de paiement (il reste TRIAL) — le message ne doit pas prétendre le
      // contraire.
      const body =
        subscription.status === "TRIAL"
          ? `Votre paiement a échoué. Votre période d'essai continue jusqu'au ${subscription.trialEndDate?.toLocaleDateString("fr-SN") ?? "sa date prévue"} — vous pouvez réessayer à tout moment.`
          : `Votre paiement a échoué. Votre abonnement passe en statut "en attente de paiement" jusqu'au ${subscription.renewalDate?.toLocaleDateString("fr-SN") ?? "prochain renouvellement"}.`;

      await this.notifications.notify({
        userId: recipient.id,
        enterpriseId,
        type: "PAYMENT_FAILED",
        to: recipient.email,
        subject: "Échec de paiement",
        body,
      });
    }
  }
}
