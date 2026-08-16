-- Corrige ERP-AUDIT-001 (docs/audit/ERP-AUDIT.md, docs/adr/0019-idempotence-mutations-financieres-mobiles.md) :
-- même patron que 20260816160000_add_sale_idempotency_key, pour StockMovement.

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN "idempotency_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_enterprise_id_idempotency_key_key" ON "stock_movements"("enterprise_id", "idempotency_key");
