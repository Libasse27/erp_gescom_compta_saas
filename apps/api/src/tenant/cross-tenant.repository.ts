import { Injectable } from "@nestjs/common";
import { Enterprise, Plan, Subscription, SubscriptionStatus } from "@prisma/client";
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
  ): Promise<(Enterprise & { currentSubscription: Subscription | null }) | null> {
    return this.prisma.enterprise.findUnique({
      where: { id: enterpriseId },
      include: { currentSubscription: true },
    });
  }

  findPlan(planId: string): Promise<Plan | null> {
    return this.prisma.plan.findUnique({ where: { id: planId } });
  }

  updateSubscriptionPlan(subscriptionId: string, planId: string): Promise<Subscription> {
    return this.prisma.subscription.update({ where: { id: subscriptionId }, data: { planId } });
  }

  createSubscriptionEvent(data: {
    subscriptionId: string;
    fromStatus: SubscriptionStatus;
    toStatus: SubscriptionStatus;
    fromPlanId: string;
    toPlanId: string;
    reason?: string;
    triggeredByUserId: string;
  }): Promise<{ id: string }> {
    return this.prisma.subscriptionEvent.create({ data, select: { id: true } });
  }
}
