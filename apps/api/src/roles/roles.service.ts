import { Injectable } from "@nestjs/common";
import { TenantScopedPrismaService } from "../tenant/tenant-scoped-prisma.service";

export interface RoleSummary {
  id: string;
  name: string;
}

// Lecture seule, tenant-scoped — alimente le sélecteur de rôle du
// formulaire d'invitation (docs/PROMPT-MAITRE-SAAS.md Phase 7.2).
@Injectable()
export class RolesService {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  async listEnterpriseRoles(): Promise<RoleSummary[]> {
    const roles = await this.tenantPrisma.run((tx) =>
      tx.role.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    );
    return roles;
  }
}
