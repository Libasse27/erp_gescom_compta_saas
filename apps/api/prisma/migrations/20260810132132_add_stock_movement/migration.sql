-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('IN', 'OUT', 'ADJUSTMENT');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'CREATE_STOCK_MOVEMENT';

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "enterprise_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_movements_enterprise_id_product_id_idx" ON "stock_movements"("enterprise_id", "product_id");

-- CreateIndex
CREATE INDEX "stock_movements_enterprise_id_created_at_idx" ON "stock_movements"("enterprise_id", "created_at");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_enterprise_id_fkey" FOREIGN KEY ("enterprise_id") REFERENCES "enterprises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phase 8 (module Stock) — voir docs/adr/0008-deux-roles-postgres-identite-vs-tenant.md.
-- stock_movements est une table tenant comme les autres (RLS forcée), même
-- patron que customers/suppliers/products. Pas d'UPDATE/DELETE dans le GRANT
-- au-delà du strict nécessaire : la table est append-only côté application
-- (aucune route ne modifie/supprime un mouvement), mais UPDATE/DELETE restent
-- accordés comme pour les autres tables tenant — l'immutabilité est une
-- garantie applicative (pas de route), pas une contrainte de droits SQL.
GRANT SELECT, INSERT, UPDATE, DELETE ON stock_movements TO erp_app_tenant;

ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stock_movements
  USING (enterprise_id = current_setting('app.tenant_id', true)::uuid);
