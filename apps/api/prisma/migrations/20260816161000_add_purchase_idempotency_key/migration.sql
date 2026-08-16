-- Corrige MOBILE AUDIT-001/ERP-001 (docs/adr/0019-idempotence-mutations-financieres-mobiles.md) :
-- même patron que 20260816160000_add_sale_idempotency_key, pour Purchase.

-- AlterTable
ALTER TABLE "purchases" ADD COLUMN "idempotency_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "purchases_enterprise_id_idempotency_key_key" ON "purchases"("enterprise_id", "idempotency_key");
