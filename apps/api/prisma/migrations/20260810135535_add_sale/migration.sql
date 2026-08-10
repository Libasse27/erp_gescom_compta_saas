-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'CREATE_SALE';
ALTER TYPE "AuditAction" ADD VALUE 'CONFIRM_SALE';
ALTER TYPE "AuditAction" ADD VALUE 'CANCEL_SALE';

-- CreateTable
CREATE TABLE "sales" (
    "id" UUID NOT NULL,
    "enterprise_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "status" "SaleStatus" NOT NULL DEFAULT 'DRAFT',
    "sale_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_lines" (
    "id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "enterprise_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_excluding_tax" INTEGER NOT NULL,
    "vat_rate_basis_points" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_enterprise_id_idx" ON "sales"("enterprise_id");

-- CreateIndex
CREATE INDEX "sales_enterprise_id_status_idx" ON "sales"("enterprise_id", "status");

-- CreateIndex
CREATE INDEX "sale_lines_enterprise_id_idx" ON "sale_lines"("enterprise_id");

-- CreateIndex
CREATE INDEX "sale_lines_sale_id_idx" ON "sale_lines"("sale_id");

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_enterprise_id_fkey" FOREIGN KEY ("enterprise_id") REFERENCES "enterprises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_enterprise_id_fkey" FOREIGN KEY ("enterprise_id") REFERENCES "enterprises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phase 8 (module Ventes) — voir docs/adr/0008-deux-roles-postgres-identite-vs-tenant.md.
-- sales et sale_lines sont des tables tenant comme les autres (RLS forcée),
-- même patron que customers/suppliers/products/stock_movements. sale_lines
-- a besoin de sa propre policy (une policy RLS ne traverse pas une relation).
GRANT SELECT, INSERT, UPDATE, DELETE ON sales TO erp_app_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON sale_lines TO erp_app_tenant;

ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sales
  USING (enterprise_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE sale_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sale_lines
  USING (enterprise_id = current_setting('app.tenant_id', true)::uuid);
