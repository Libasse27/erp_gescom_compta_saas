-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'ENTERPRISE_PROVISIONED';

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "enterprise_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accounts_enterprise_id_idx" ON "accounts"("enterprise_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_enterprise_id_code_key" ON "accounts"("enterprise_id", "code");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_enterprise_id_fkey" FOREIGN KEY ("enterprise_id") REFERENCES "enterprises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phase 6 (provisioning) — voir docs/adr/0008-deux-roles-postgres-identite-vs-tenant.md.
-- accounts est une table tenant comme les autres (RLS forcée). Son seul
-- écrivain aujourd'hui est ProvisioningService, sur la connexion d'identité
-- (flux pré-tenant : le provisioning crée le tenant lui-même, aucun
-- TenantContext ne peut exister avant que l'entreprise n'existe) — la RLS
-- reste posée par cohérence structurelle, comme invoice_counters.
GRANT SELECT, INSERT, UPDATE, DELETE ON accounts TO erp_app_tenant;

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON accounts
  USING (enterprise_id = current_setting('app.tenant_id', true)::uuid);
