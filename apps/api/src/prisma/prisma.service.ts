import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { env } from "../config/env";

// Connexion "identité" (docs/adr/0008-deux-roles-postgres-identite-vs-tenant.md) :
// rôle erp_app_identity, NOSUPERUSER, non propriétaire des tables, BYPASSRLS
// (migration 20260816120000_add_identity_role, corrige MT-01 — voir
// docs/audit/MULTI-TENANT-AUDIT.md). Réservée aux flux pré-tenant listés
// dans cette migration ; tout code exécuté dans un TenantContext connu doit
// passer par TenantScopedPrismaService, jamais par ce service.
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ datasources: { db: { url: env.identityDatabaseUrl() } } });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
