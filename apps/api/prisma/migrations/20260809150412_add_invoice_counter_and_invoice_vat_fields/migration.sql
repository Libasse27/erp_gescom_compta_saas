/*
  Warnings:

  - Added the required column `amount_excluding_tax` to the `invoices` table without a default value. This is not possible if the table is not empty.
  - Added the required column `legal_mentions` to the `invoices` table without a default value. This is not possible if the table is not empty.
  - Added the required column `vat_amount` to the `invoices` table without a default value. This is not possible if the table is not empty.
  - Added the required column `vat_rate_basis_points` to the `invoices` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "amount_excluding_tax" INTEGER NOT NULL,
ADD COLUMN     "legal_mentions" TEXT NOT NULL,
ADD COLUMN     "vat_amount" INTEGER NOT NULL,
ADD COLUMN     "vat_rate_basis_points" INTEGER NOT NULL;

-- CreateTable
CREATE TABLE "invoice_counters" (
    "enterprise_id" UUID NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_counters_pkey" PRIMARY KEY ("enterprise_id")
);

-- AddForeignKey
ALTER TABLE "invoice_counters" ADD CONSTRAINT "invoice_counters_enterprise_id_fkey" FOREIGN KEY ("enterprise_id") REFERENCES "enterprises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phase 5 (paiements/facturation) — voir docs/adr/0008-deux-roles-postgres-identite-vs-tenant.md.
-- invoice_counters est une table tenant comme les autres (RLS forcée),
-- même si son seul écrivain aujourd'hui (PaymentWebhookService) passe par
-- la connexion d'identité, flux pré-tenant sans TenantContext (webhook sans
-- JWT) — cohérence structurelle plutôt qu'exception, en prévision d'un futur
-- accès en lecture depuis un contexte tenant authentifié (Phase 7/8).
GRANT SELECT, INSERT, UPDATE, DELETE ON invoice_counters TO erp_app_tenant;

ALTER TABLE invoice_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invoice_counters
  USING (enterprise_id = current_setting('app.tenant_id', true)::uuid);
