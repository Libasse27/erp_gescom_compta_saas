import { Injectable, NotFoundException } from "@nestjs/common";
import { CrossTenantRepository } from "../tenant/cross-tenant.repository";
import { AuditLogService } from "../common/audit/audit-log.service";
import { RequestMetadata } from "../auth/auth.service";

export interface EnterpriseStatusResult {
  id: string;
  status: string;
}

export interface EnterpriseListEntry {
  id: string;
  name: string;
  status: string;
  createdAt: Date;
  planCode: string | null;
  planName: string | null;
  subscriptionStatus: string | null;
}

// Phase 7.3 (docs/PROMPT-MAITRE-SAAS.md) : vue Super Admin, lecture seule
// cross-tenant — passe exclusivement par CrossTenantRepository (CLAUDE.md §5).
// Chaque accès est journalisé (CROSS_TENANT_ACCESS) : lire les données de
// toutes les entreprises est déjà un accès cross-tenant en soi, pas
// seulement les écritures (CLAUDE.md §6).
@Injectable()
export class SuperAdminService {
  constructor(
    private readonly crossTenant: CrossTenantRepository,
    private readonly auditLog: AuditLogService,
  ) {}

  async getOverview(actorUserId: string, meta: RequestMetadata) {
    const overview = await this.crossTenant.getPlatformOverview();

    await this.auditLog.record({
      userId: actorUserId,
      action: "CROSS_TENANT_ACCESS",
      resource: "PlatformOverview",
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return overview;
  }

  async listEnterprises(actorUserId: string, meta: RequestMetadata): Promise<EnterpriseListEntry[]> {
    const enterprises = await this.crossTenant.listEnterprisesWithSubscriptions();

    await this.auditLog.record({
      userId: actorUserId,
      action: "CROSS_TENANT_ACCESS",
      resource: "Enterprise",
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { count: enterprises.length },
    });

    return enterprises.map((enterprise) => ({
      id: enterprise.id,
      name: enterprise.name,
      status: enterprise.status,
      createdAt: enterprise.createdAt,
      planCode: enterprise.currentSubscription?.plan.code ?? null,
      planName: enterprise.currentSubscription?.plan.name ?? null,
      subscriptionStatus: enterprise.currentSubscription?.status ?? null,
    }));
  }

  // Corrige BIL-04 (docs/audit/BILLING-AUDIT.md) : jusqu'ici, suspendre une
  // entreprise pour impayé ou fraude était sans effet — cette route
  // n'existait pas. Révoque immédiatement toute session en cours (voir
  // CrossTenantRepository.revokeAllRefreshTokensForEnterprise) plutôt que
  // de compter uniquement sur JwtAuthGuard/le prochain refresh.
  async suspendEnterprise(
    actorUserId: string,
    enterpriseId: string,
    meta: RequestMetadata,
  ): Promise<EnterpriseStatusResult> {
    const existing = await this.crossTenant.findEnterpriseWithCurrentSubscription(enterpriseId);
    if (!existing) {
      throw new NotFoundException("Entreprise introuvable");
    }

    const updated = await this.crossTenant.setEnterpriseStatus(enterpriseId, "SUSPENDED");
    await this.crossTenant.revokeAllRefreshTokensForEnterprise(enterpriseId);

    await this.auditLog.record({
      userId: actorUserId,
      enterpriseId,
      action: "SUSPEND_ACCOUNT",
      resource: "Enterprise",
      resourceId: enterpriseId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { id: updated.id, status: updated.status };
  }

  // Ne restaure aucune session révoquée par suspendEnterprise : un
  // utilisateur de l'entreprise réactivée doit simplement se reconnecter,
  // comme après n'importe quelle déconnexion — pas de résurrection de
  // jeton déjà invalidé.
  async reactivateEnterprise(
    actorUserId: string,
    enterpriseId: string,
    meta: RequestMetadata,
  ): Promise<EnterpriseStatusResult> {
    const existing = await this.crossTenant.findEnterpriseWithCurrentSubscription(enterpriseId);
    if (!existing) {
      throw new NotFoundException("Entreprise introuvable");
    }

    const updated = await this.crossTenant.setEnterpriseStatus(enterpriseId, "ACTIVE");

    await this.auditLog.record({
      userId: actorUserId,
      enterpriseId,
      action: "REACTIVATE_ACCOUNT",
      resource: "Enterprise",
      resourceId: enterpriseId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { id: updated.id, status: updated.status };
  }
}
