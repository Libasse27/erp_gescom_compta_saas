-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'CREATE_PURCHASE';
ALTER TYPE "AuditAction" ADD VALUE 'CONFIRM_PURCHASE';
ALTER TYPE "AuditAction" ADD VALUE 'CANCEL_PURCHASE';

-- CreateTable
CREATE TABLE "purchases" (
    "id" UUID NOT NULL,
    "enterprise_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'DRAFT',
    "purchase_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_lines" (
    "id" UUID NOT NULL,
    "purchase_id" UUID NOT NULL,
    "enterprise_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_cost_excluding_tax" INTEGER NOT NULL,
    "vat_rate_basis_points" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchases_enterprise_id_idx" ON "purchases"("enterprise_id");

-- CreateIndex
CREATE INDEX "purchases_enterprise_id_status_idx" ON "purchases"("enterprise_id", "status");

-- CreateIndex
CREATE INDEX "purchase_lines_enterprise_id_idx" ON "purchase_lines"("enterprise_id");

-- CreateIndex
CREATE INDEX "purchase_lines_purchase_id_idx" ON "purchase_lines"("purchase_id");

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_enterprise_id_fkey" FOREIGN KEY ("enterprise_id") REFERENCES "enterprises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_enterprise_id_fkey" FOREIGN KEY ("enterprise_id") REFERENCES "enterprises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phase 8 (module Achats) — voir docs/adr/0008-deux-roles-postgres-identite-vs-tenant.md.
-- purchases et purchase_lines sont des tables tenant comme les autres (RLS
-- forcée), même patron que sales/sale_lines. purchase_lines a besoin de sa
-- propre policy (une policy RLS ne traverse pas une relation).
GRANT SELECT, INSERT, UPDATE, DELETE ON purchases TO erp_app_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON purchase_lines TO erp_app_tenant;

ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON purchases
  USING (enterprise_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE purchase_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON purchase_lines
  USING (enterprise_id = current_setting('app.tenant_id', true)::uuid);
