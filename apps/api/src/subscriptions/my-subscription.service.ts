import { Injectable, NotFoundException } from "@nestjs/common";
import { TenantScopedPrismaService } from "../tenant/tenant-scoped-prisma.service";
import { TenantContext } from "../tenant/tenant-context";

export interface MySubscription {
  planCode: string;
  planName: string;
  priceMonthly: number;
  priceYearly: number | null;
  maxUsers: number | null;
  status: string;
  startDate: Date;
  trialEndDate: Date | null;
  renewalDate: Date | null;
  cancelledAt: Date | null;
}

// Lecture seule, tenant-scoped (docs/PROMPT-MAITRE-SAAS.md Phase 7.2) — pour
// la page Abonnement de l'espace entreprise. Le changement de plan lui-même
// reste une action Super Admin (SubscriptionsService, Phase 4).
@Injectable()
export class MySubscriptionService {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  async getCurrent(): Promise<MySubscription> {
    const tenantId = TenantContext.getRequiredTenantId();

    const enterprise = await this.tenantPrisma.run((tx) =>
      tx.enterprise.findUnique({
        where: { id: tenantId },
        include: {
          currentSubscription: {
            include: {
              plan: { include: { planLimits: { where: { limit: { key: "users" } }, include: { limit: true } } } },
            },
          },
        },
      }),
    );

    const subscription = enterprise?.currentSubscription;
    if (!subscription) {
      throw new NotFoundException("Aucun abonnement actif pour cette entreprise");
    }

    const { plan } = subscription;

    return {
      planCode: plan.code,
      planName: plan.name,
      priceMonthly: plan.priceMonthly,
      priceYearly: plan.priceYearly,
      maxUsers: plan.planLimits[0]?.value ?? null,
      status: subscription.status,
      startDate: subscription.startDate,
      trialEndDate: subscription.trialEndDate,
      renewalDate: subscription.renewalDate,
      cancelledAt: subscription.cancelledAt,
    };
  }
}
