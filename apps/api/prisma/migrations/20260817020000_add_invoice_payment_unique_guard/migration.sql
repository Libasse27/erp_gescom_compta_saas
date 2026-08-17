-- Corrige BIL-02 (docs/audit/BILLING-AUDIT.md) : garde d'unicité au niveau
-- base entre une facture SaaS (invoices) et le paiement qui l'a générée —
-- au plus une Invoice par Payment, même en cas de régression applicative
-- future. Colonne nullable, additive, non destructive : aucune facture
-- existante n'a de payment_id (NULL), et Postgres autorise un nombre
-- quelconque de NULL dans une colonne UNIQUE (pas de conflit au déploiement).

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN "payment_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "invoices_payment_id_key" ON "invoices"("payment_id");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
