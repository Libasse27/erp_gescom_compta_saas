-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'CREATE_PRODUCT';
ALTER TYPE "AuditAction" ADD VALUE 'DELETE_PRODUCT';

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "enterprise_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'pièce',
    "category" TEXT,
    "barcode" TEXT,
    "selling_price_excluding_tax" INTEGER NOT NULL,
    "vat_rate_basis_points" INTEGER NOT NULL DEFAULT 1800,
    "track_stock" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "products_enterprise_id_idx" ON "products"("enterprise_id");

-- CreateIndex
CREATE INDEX "products_enterprise_id_is_active_idx" ON "products"("enterprise_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "products_enterprise_id_code_key" ON "products"("enterprise_id", "code");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_enterprise_id_fkey" FOREIGN KEY ("enterprise_id") REFERENCES "enterprises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phase 8 (module Produits) — voir docs/adr/0008-deux-roles-postgres-identite-vs-tenant.md.
-- products est une table tenant comme les autres (RLS forcée), même patron
-- que customers/suppliers.
GRANT SELECT, INSERT, UPDATE, DELETE ON products TO erp_app_tenant;

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON products
  USING (enterprise_id = current_setting('app.tenant_id', true)::uuid);
