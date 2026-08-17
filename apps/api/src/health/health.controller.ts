import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

interface LivenessReport {
  status: "ok";
  uptimeSeconds: number;
  timestamp: string;
}

interface ReadinessReport {
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
//
// /health/live et /health/ready sont distincts (P-06, docs/audit/PRODUCTION-READINESS.md) :
// liveness ne vérifie aucune dépendance externe (sert à décider un
// redémarrage du process), readiness vérifie Postgres (sert à décider une
// sortie de rotation). /health reste un alias de /health/ready pour ne pas
// casser le healthcheck Docker existant.
@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("live")
  live(): LivenessReport {
    return { status: "ok", uptimeSeconds: process.uptime(), timestamp: new Date().toISOString() };
  }

  @Get("ready")
  async ready(): Promise<ReadinessReport> {
    return this.buildReadinessReport();
  }

  @Get()
  async check(): Promise<ReadinessReport> {
    return this.buildReadinessReport();
  }

  private async buildReadinessReport(): Promise<ReadinessReport> {
    const database = await this.checkDatabase();
    const report: ReadinessReport = {
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
