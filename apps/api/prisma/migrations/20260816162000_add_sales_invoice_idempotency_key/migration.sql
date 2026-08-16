-- Corrige MOBILE AUDIT-001/ERP-001 (docs/adr/0019-idempotence-mutations-financieres-mobiles.md) :
-- même patron que 20260816160000_add_sale_idempotency_key, pour SalesInvoice.
-- Distincte de la contrainte @unique déjà existante sur sale_id (une facture
-- par vente) : deux protections indépendantes.

-- AlterTable
ALTER TABLE "sales_invoices" ADD COLUMN "idempotency_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoices_enterprise_id_idempotency_key_key" ON "sales_invoices"("enterprise_id", "idempotency_key");
