-- Corrige MOBILE AUDIT-001/ERP-001 (docs/adr/0019-idempotence-mutations-financieres-mobiles.md) :
-- déduplication des créations de vente rejouées (en-tête Idempotency-Key).
-- Colonne nullable : Postgres ne considère jamais deux NULL comme égaux dans
-- une contrainte UNIQUE, donc une création sans clé (ex. apps/web) n'est
-- jamais bloquée par des lignes NULL répétées — pas besoin d'index partiel.

-- AlterTable
ALTER TABLE "sales" ADD COLUMN "idempotency_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "sales_enterprise_id_idempotency_key_key" ON "sales"("enterprise_id", "idempotency_key");
