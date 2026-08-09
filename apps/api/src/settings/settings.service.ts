import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { TenantScopedPrismaService } from "../tenant/tenant-scoped-prisma.service";

export interface SettingSummary {
  key: string;
  value: Prisma.JsonValue;
  updatedAt: Date;
}

// Lecture seule, tenant-scoped — Phase 7.2. L'édition (formulaires de
// configuration) n'existe pas encore : aucun besoin concret identifié tant
// que les modules ERP (Phase 8) n'ont rien à paramétrer.
@Injectable()
export class SettingsService {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  async listEnterpriseSettings(): Promise<SettingSummary[]> {
    const settings = await this.tenantPrisma.run((tx) =>
      tx.setting.findMany({
        where: { scope: "ENTERPRISE" },
        select: { key: true, value: true, updatedAt: true },
        orderBy: { key: "asc" },
      }),
    );
    return settings;
  }
}
