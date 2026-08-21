import { Injectable } from "@nestjs/common";
import { Enterprise, EnterpriseStatus, Payment, PaymentProvider, Plan, Subscription, SubscriptionStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

// Seul point d'accès autorisé pour une route Super Admin qui doit lire ou
// écrire les données d'une entreprise arbitraire, en dehors de tout
// TenantContext (CLAUDE.md §5 — "route Super Admin qui traverse les tenants
// sans passer par un CrossTenantRepository explicite"). Utilise la connexion
// d'identité (rôle `erp`, sans RLS) : légitime ici, le Super Admin agissant
// précisément en dehors d'un tenant. Chaque appelant reste responsable de
// journaliser l'action dans l'audit log (docs/adr/0008-...).
//
// Pas de logique métier ici (validation, machine à états...) : ça reste le
// rôle du service appelant (CLAUDE.md §8, couche repository = accès données
// uniquement).
@Injectable()
export class CrossTenantRepository {
  constructor(private readonly prisma: PrismaService) {}

  findEnterpriseWithCurrentSubscription(
    enterpriseId: string,
  ): Promise<(Enterprise & { currentSubscription: (Subscription & { plan: Plan }) | null }) | null> {
    return this.prisma.enterprise.findUnique({
      where: { id: enterpriseId },
      include: { currentSubscription: { include: { plan: true } } },
    });
  }

  findPlan(planId: string): Promise<Plan | null> {
    return this.prisma.plan.findUnique({ where: { id: planId } });
  }

  // Corrige BIL-13 (docs/audit/BILLING-AUDIT.md) : la mise à jour du plan et
  // l'écriture de l'événement d'historique doivent réussir ou échouer
  // ensemble — un abonnement dont le plan a changé sans trace dans
  // SubscriptionEvent viole l'objectif d'historique immuable de facturation
  // (OHADA). Le statut n'est pas affecté par un changement de plan
  // (fromStatus === toStatus dans l'événement) : ce n'est pas de la logique
  // métier, seulement la frontière transactionnelle des deux écritures que
  // SubscriptionsService.changePlan doit composer.
  changeSubscriptionPlan(
    subscriptionId: string,
    newPlanId: string,
    event: {
      fromStatus: SubscriptionStatus;
      fromPlanId: string;
      reason?: string;
      triggeredByUserId?: string;
    },
  ): Promise<Subscription> {
    return this.prisma.$transaction(async (tx) => {
      const subscription = await tx.subscription.update({
        where: { id: subscriptionId },
        data: { planId: newPlanId },
      });

      await tx.subscriptionEvent.create({
        data: {
          subscriptionId,
          fromStatus: event.fromStatus,
          toStatus: event.fromStatus,
          fromPlanId: event.fromPlanId,
          toPlanId: newPlanId,
          reason: event.reason,
          triggeredByUserId: event.triggeredByUserId,
        },
      });

      return subscription;
    });
  }

  createSubscriptionEvent(data: {
    subscriptionId: string;
    fromStatus: SubscriptionStatus;
    toStatus: SubscriptionStatus;
    fromPlanId?: string;
    toPlanId?: string;
    reason?: string;
    triggeredByUserId?: string;
  }): Promise<{ id: string }> {
    return this.prisma.subscriptionEvent.create({ data, select: { id: true } });
  }

  // Corrige BIL-03 (docs/audit/BILLING-AUDIT.md) : source de vérité pour
  // SubscriptionLifecycleService — un essai expire dès que trialEndDate est
  // dépassée, indépendamment de toute action utilisateur.
  findExpirableTrialSubscriptions(now: Date): Promise<Subscription[]> {
    return this.prisma.subscription.findMany({
      where: { status: "TRIAL", trialEndDate: { lt: now } },
    });
  }

  // renewalDate porte l'échéance de grâce pendant PAST_DUE (repoussée par
  // PaymentWebhookService à chaque échec, voir payments-webhook.service.ts),
  // pas la date de renouvellement normale d'un abonnement ACTIVE.
  findOverdueGracePeriodSubscriptions(now: Date): Promise<Subscription[]> {
    return this.prisma.subscription.findMany({
      where: { status: "PAST_DUE", renewalDate: { lt: now } },
    });
  }

  // Compare-and-swap (même patron que PaymentWebhookService, BIL-01) : un
  // appelant qui a lu `fromStatus` dans un batch en mémoire (voir
  // SubscriptionLifecycleService) peut trouver, au moment d'écrire, que le
  // statut a déjà changé entre-temps (ex. un webhook de paiement concurrent
  // a fait passer PAST_DUE -> ACTIVE) — `count: 0` signale ce cas, jamais
  // d'écrasement d'un état plus frais.
  updateSubscriptionStatus(
    subscriptionId: string,
    fromStatus: SubscriptionStatus,
    toStatus: SubscriptionStatus,
  ): Promise<{ count: number }> {
    return this.prisma.subscription.updateMany({
      where: { id: subscriptionId, status: fromStatus },
      data: { status: toStatus },
    });
  }

  // Amorce un Payment(PENDING) — tient lieu de flux de checkout réel, qui
  // n'existe pas avant la Phase 6/7 (docs/PROMPT-MAITRE-SAAS.md Phase 5).
  // expiresAt (BIL-19) est posée une seule fois ici par l'appelant
  // (PaymentsBootstrapService), jamais recalculée par ce repository.
  createPendingPayment(data: {
    enterpriseId: string;
    subscriptionId: string;
    provider: PaymentProvider;
    providerReference: string;
    amount: number;
    currency: string;
    expiresAt: Date;
  }): Promise<Payment> {
    return this.prisma.payment.create({ data: { ...data, status: "PENDING" } });
  }

  // Corrige BIL-19 (docs/audit/BILLING-AUDIT.md) : source de vérité pour
  // PaymentLifecycleService — un paiement PENDING dont l'intention n'a
  // jamais été honorée avant expiresAt.
  findExpirablePendingPayments(now: Date): Promise<Payment[]> {
    return this.prisma.payment.findMany({
      where: { status: "PENDING", expiresAt: { lt: now } },
    });
  }

  // Compare-and-swap (même patron que updateSubscriptionStatus, BIL-03) :
  // count === 0 signale qu'un autre traitement concurrent (webhook de
  // paiement, ou une autre exécution du job) a déjà résolu ce Payment entre
  // la lecture batch et cette écriture — jamais d'écrasement d'un état plus
  // frais (SUCCEEDED/FAILED), jamais de double transition.
  expirePendingPayment(paymentId: string): Promise<{ count: number }> {
    return this.prisma.payment.updateMany({
      where: { id: paymentId, status: "PENDING" },
      data: { status: "EXPIRED" },
    });
  }

  // Corrige BIL-04 (docs/audit/BILLING-AUDIT.md) : jusqu'ici, aucune route
  // ne pouvait jamais faire passer Enterprise.status à SUSPENDED — cette
  // méthode et la suivante sont le seul point d'écriture.
  setEnterpriseStatus(enterpriseId: string, status: EnterpriseStatus): Promise<Enterprise> {
    return this.prisma.enterprise.update({ where: { id: enterpriseId }, data: { status } });
  }

  // Coupe l'accès immédiatement, sans attendre l'expiration naturelle de
  // l'access token en cours (≤15 min) ni le prochain refresh — complète
  // JwtAuthGuard (revalidation par requête, cache court) plutôt que de
  // s'y substituer : les deux se recouvrent volontairement (défense en
  // profondeur), pas un remplacement l'un de l'autre.
  revokeAllRefreshTokensForEnterprise(enterpriseId: string): Promise<{ count: number }> {
    return this.prisma.refreshToken.updateMany({
      where: { user: { enterpriseId }, status: { not: "REVOKED" } },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
  }

  // Phase 7.3 — vue Super Admin.
  listEnterprisesWithSubscriptions(): Promise<
    (Enterprise & { currentSubscription: (Subscription & { plan: Plan }) | null })[]
  > {
    return this.prisma.enterprise.findMany({
      include: { currentSubscription: { include: { plan: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async getPlatformOverview(): Promise<{
    totalEnterprises: number;
    activeEnterprises: number;
    suspendedEnterprises: number;
    newEnterprisesLast30Days: number;
    totalUsers: number;
    activeSubscriptions: number;
    expiredSubscriptions: number;
    pendingPayments: number;
    failedPayments: number;
    totalRevenue: number;
  }> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3_600_000);

    const [
      totalEnterprises,
      activeEnterprises,
      suspendedEnterprises,
      newEnterprisesLast30Days,
      totalUsers,
      activeSubscriptions,
      expiredSubscriptions,
      pendingPayments,
      failedPayments,
      revenue,
    ] = await Promise.all([
      this.prisma.enterprise.count(),
      this.prisma.enterprise.count({ where: { status: "ACTIVE" } }),
      this.prisma.enterprise.count({ where: { status: "SUSPENDED" } }),
      this.prisma.enterprise.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      this.prisma.user.count({ where: { enterpriseId: { not: null } } }),
      this.prisma.enterprise.count({ where: { currentSubscription: { status: "ACTIVE" } } }),
      this.prisma.enterprise.count({ where: { currentSubscription: { status: "EXPIRED" } } }),
      this.prisma.payment.count({ where: { status: "PENDING" } }),
      this.prisma.payment.count({ where: { status: "FAILED" } }),
      this.prisma.payment.aggregate({ where: { status: "SUCCEEDED" }, _sum: { amount: true } }),
    ]);

    return {
      totalEnterprises,
      activeEnterprises,
      suspendedEnterprises,
      newEnterprisesLast30Days,
      totalUsers,
      activeSubscriptions,
      expiredSubscriptions,
      pendingPayments,
      failedPayments,
      totalRevenue: revenue._sum.amount ?? 0,
    };
  }
}
