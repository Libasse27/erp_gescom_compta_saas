import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export interface PublicPlan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceMonthly: number;
  priceYearly: number | null;
  trialDays: number;
  maxUsers: number | null;
}

// Catalogue plateforme, lecture seule, public (route sans JwtAuthGuard) : la
// même connexion d'identité que le reste des lookups pré-tenant
// (docs/adr/0008-...), mais ici parce qu'aucun tenant n'existe pas encore
// pour la même raison que ProvisioningService — pas parce que la donnée est
// tenant-scoped (elle ne l'est pas, comme `permissions`).
@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService) {}

  async listActive(): Promise<PublicPlan[]> {
    const plans = await this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      include: { planLimits: { where: { limit: { key: "users" } }, include: { limit: true } } },
    });

    return plans.map((plan) => ({
      id: plan.id,
      code: plan.code,
      name: plan.name,
      description: plan.description,
      priceMonthly: plan.priceMonthly,
      priceYearly: plan.priceYearly,
      trialDays: plan.trialDays,
      maxUsers: plan.planLimits[0]?.value ?? null,
    }));
  }
}
