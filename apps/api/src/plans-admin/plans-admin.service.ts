import { Injectable } from "@nestjs/common";
import { CreatePlanInput, UpdatePlanInput } from "@erp/validation";
import { AuditLogService } from "../common/audit/audit-log.service";
import { RequestMetadata } from "../auth/auth.service";
import { PlansAdminRepository, PlanAdminView } from "./plans-admin.repository";

// Corrige BIL-12 (docs/audit/BILLING-AUDIT.md) : jusqu'ici, éditer le
// catalogue plateforme exigeait une intervention manuelle en base (interdit
// par CLAUDE.md §3). Chaque écriture est journalisée (CLAUDE.md §6) ; la
// lecture (list/get) ne l'est pas — contrairement à SuperAdminService
// (Enterprise), lire le catalogue de plans n'expose aucune donnée d'une
// entreprise tierce, ce n'est pas un accès cross-tenant.
@Injectable()
export class PlansAdminService {
  constructor(
    private readonly plansAdminRepository: PlansAdminRepository,
    private readonly auditLog: AuditLogService,
  ) {}

  list(): Promise<PlanAdminView[]> {
    return this.plansAdminRepository.findAll();
  }

  async create(actorUserId: string, input: CreatePlanInput, meta: RequestMetadata): Promise<PlanAdminView> {
    const plan = await this.plansAdminRepository.create(input);

    await this.auditLog.record({
      userId: actorUserId,
      action: "CREATE_PLAN",
      resource: "Plan",
      resourceId: plan.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { code: plan.code, name: plan.name, priceMonthly: plan.priceMonthly, isActive: plan.isActive },
    });

    return plan;
  }

  async update(
    actorUserId: string,
    planId: string,
    input: UpdatePlanInput,
    meta: RequestMetadata,
  ): Promise<PlanAdminView> {
    const plan = await this.plansAdminRepository.update(planId, input);

    await this.auditLog.record({
      userId: actorUserId,
      action: "UPDATE_PLAN",
      resource: "Plan",
      resourceId: plan.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { changes: input },
    });

    return plan;
  }

  async setFeature(
    actorUserId: string,
    planId: string,
    featureKey: string,
    enabled: boolean,
    meta: RequestMetadata,
  ): Promise<PlanAdminView> {
    const plan = await this.plansAdminRepository.setFeature(planId, featureKey, enabled);

    await this.auditLog.record({
      userId: actorUserId,
      action: "UPDATE_PLAN_FEATURE",
      resource: "PlanFeature",
      resourceId: plan.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { planCode: plan.code, featureKey, enabled },
    });

    return plan;
  }

  async setLimit(
    actorUserId: string,
    planId: string,
    limitKey: string,
    value: number | null,
    meta: RequestMetadata,
  ): Promise<PlanAdminView> {
    const plan = await this.plansAdminRepository.setLimit(planId, limitKey, value);

    await this.auditLog.record({
      userId: actorUserId,
      action: "UPDATE_PLAN_LIMIT",
      resource: "PlanLimit",
      resourceId: plan.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { planCode: plan.code, limitKey, value },
    });

    return plan;
  }
}
