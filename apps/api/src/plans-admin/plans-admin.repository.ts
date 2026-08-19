import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { CreatePlanInput, UpdatePlanInput } from "@erp/validation";
import { PrismaService } from "../prisma/prisma.service";

export interface PlanFeatureView {
  key: string;
  label: string;
  enabled: boolean;
}

export interface PlanLimitView {
  key: string;
  label: string;
  value: number | null;
}

export interface PlanAdminView {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceMonthly: number;
  priceYearly: number | null;
  trialDays: number;
  isActive: boolean;
  sortOrder: number;
  features: PlanFeatureView[];
  limits: PlanLimitView[];
  createdAt: Date;
  updatedAt: Date;
}

const PLAN_WITH_CATALOG_INCLUDE = {
  planFeatures: { include: { feature: true } },
  planLimits: { include: { limit: true } },
} satisfies Prisma.PlanInclude;

type PlanWithCatalog = Prisma.PlanGetPayload<{ include: typeof PLAN_WITH_CATALOG_INCLUDE }>;

// Seul point d'accès Prisma pour Plan/Feature/Limit/PlanFeature/PlanLimit
// (CLAUDE.md §8). Ces tables ne sont pas tenant-scopées (pas d'enterpriseId,
// voir schema.prisma) — catalogue plateforme global, comme `permissions` —
// donc PrismaService (rôle identité), jamais TenantScopedPrismaService ni
// CrossTenantRepository (réservé aux tables tenant traversées en cross-tenant,
// ce que Plan n'est pas). Même pattern d'accès que PlansService (lecture
// publique), qui reste inchangé : ce repository ne le remplace pas, il ajoute
// le chemin d'écriture Super Admin qui n'existait pas (BIL-12).
@Injectable()
export class PlansAdminRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<PlanAdminView[]> {
    const plans = await this.prisma.plan.findMany({
      orderBy: { sortOrder: "asc" },
      include: PLAN_WITH_CATALOG_INCLUDE,
    });
    return plans.map((plan) => this.toView(plan));
  }

  async findByIdOrThrow(id: string): Promise<PlanAdminView> {
    const plan = await this.prisma.plan.findUnique({ where: { id }, include: PLAN_WITH_CATALOG_INCLUDE });
    if (!plan) {
      throw new NotFoundException("Plan introuvable");
    }
    return this.toView(plan);
  }

  async create(input: CreatePlanInput): Promise<PlanAdminView> {
    try {
      const plan = await this.prisma.plan.create({
        data: input,
        include: PLAN_WITH_CATALOG_INCLUDE,
      });
      return this.toView(plan);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Ce code de plan est déjà utilisé");
      }
      throw error;
    }
  }

  async update(id: string, input: UpdatePlanInput): Promise<PlanAdminView> {
    await this.findByIdOrThrow(id);

    try {
      const plan = await this.prisma.plan.update({
        where: { id },
        data: input,
        include: PLAN_WITH_CATALOG_INCLUDE,
      });
      return this.toView(plan);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Ce code de plan est déjà utilisé");
      }
      throw error;
    }
  }

  // Refuse toute clé qui n'existe pas déjà dans le catalogue stable (BIL-12) :
  // jamais de création dynamique de Feature ici, contrairement à
  // provisioning/seed.ts qui reste le seul point d'entrée du catalogue de
  // clés lui-même (même raisonnement que PERMISSION_KEYS).
  async setFeature(planId: string, featureKey: string, enabled: boolean): Promise<PlanAdminView> {
    await this.findByIdOrThrow(planId);

    const feature = await this.prisma.feature.findUnique({ where: { key: featureKey } });
    if (!feature) {
      throw new NotFoundException(`Feature inconnue : ${featureKey}`);
    }

    await this.prisma.planFeature.upsert({
      where: { planId_featureId: { planId, featureId: feature.id } },
      create: { planId, featureId: feature.id, enabled },
      update: { enabled },
    });

    return this.findByIdOrThrow(planId);
  }

  // Même garde que setFeature, pour le catalogue de limites.
  async setLimit(planId: string, limitKey: string, value: number | null): Promise<PlanAdminView> {
    await this.findByIdOrThrow(planId);

    const limit = await this.prisma.limit.findUnique({ where: { key: limitKey } });
    if (!limit) {
      throw new NotFoundException(`Limite inconnue : ${limitKey}`);
    }

    await this.prisma.planLimit.upsert({
      where: { planId_limitId: { planId, limitId: limit.id } },
      create: { planId, limitId: limit.id, value },
      update: { value },
    });

    return this.findByIdOrThrow(planId);
  }

  private toView(plan: PlanWithCatalog): PlanAdminView {
    return {
      id: plan.id,
      code: plan.code,
      name: plan.name,
      description: plan.description,
      priceMonthly: plan.priceMonthly,
      priceYearly: plan.priceYearly,
      trialDays: plan.trialDays,
      isActive: plan.isActive,
      sortOrder: plan.sortOrder,
      features: plan.planFeatures.map((pf) => ({ key: pf.feature.key, label: pf.feature.label, enabled: pf.enabled })),
      limits: plan.planLimits.map((pl) => ({ key: pl.limit.key, label: pl.limit.label, value: pl.value })),
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
    };
  }
}
