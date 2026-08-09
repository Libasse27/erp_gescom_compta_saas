import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { env } from "../config/env";
import { TenantContext } from "./tenant-context";

// Connexion dédiée au rôle Postgres erp_app_tenant (RLS forcée, voir
// docs/adr/0008-...). Toute requête sur une table tenant doit passer par
// run() : SET LOCAL app.tenant_id est positionné à l'intérieur d'une
// transaction, donc scopé à cette seule opération — sûr même avec un pool
// de connexions partagé entre requêtes concurrentes (une connexion réutilisée
// pour une autre requête ne "voit" jamais ce SET LOCAL, il expire au COMMIT).
@Injectable()
export class TenantScopedPrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly client: PrismaClient;

  constructor() {
    this.client = new PrismaClient({
      datasources: { db: { url: env.tenantDatabaseUrl() } },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }

  // Lève si TenantContext n'est pas actif (Phase 3, critère "requête hors
  // TenantContext rejetée") — jamais d'exécution "par défaut" non scopée.
  // async (pas juste un `return`) pour que ce throw synchrone devienne bien
  // une Promise rejetée, pas une exception lancée avant même l'obtention
  // d'une Promise par l'appelant.
  async run<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const tenantId = TenantContext.getRequiredTenantId();

    return this.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return callback(tx);
    });
  }
}
