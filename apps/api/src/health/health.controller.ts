import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

interface HealthReport {
  status: "ok" | "error";
  database: "ok" | "error";
  uptimeSeconds: number;
  timestamp: string;
}

// Route publique, hors TenantContext par nature (docs/adr/0008-... : au même
// titre qu'AuthService/ProvisioningService, une sonde d'infra ne peut pas
// être tenant-scoped) — exclue du préfixe /v1 dans main.ts pour rester
// stable indépendamment du versionnage de l'API, comme les webhooks de
// paiement. Consommée par le healthcheck Docker (docker-compose.prod.yml)
// et, plus tard, par un load balancer/reverse proxy (Phase 10.6).
@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<HealthReport> {
    const database = await this.checkDatabase();
    const report: HealthReport = {
      status: database === "ok" ? "ok" : "error",
      database,
      uptimeSeconds: process.uptime(),
      timestamp: new Date().toISOString(),
    };

    // 503, pas 200 : un healthcheck Docker/load balancer se fie au code
    // HTTP, pas au corps de la réponse, pour décider de sortir un
    // conteneur de la rotation.
    if (report.status === "error") {
      throw new ServiceUnavailableException(report);
    }

    return report;
  }

  private async checkDatabase(): Promise<"ok" | "error"> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return "ok";
    } catch {
      return "error";
    }
  }
}
