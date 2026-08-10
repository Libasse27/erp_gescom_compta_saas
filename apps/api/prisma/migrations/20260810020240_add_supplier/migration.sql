-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'CREATE_SUPPLIER';
ALTER TYPE "AuditAction" ADD VALUE 'UPDATE_SUPPLIER';
ALTER TYPE "AuditAction" ADD VALUE 'DELETE_SUPPLIER';

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "enterprise_id" UUID NOT NULL,
    "type" "CustomerType" NOT NULL DEFAULT 'COMPANY',
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT NOT NULL DEFAULT 'Sénégal',
    "ninea" TEXT,
    "rccm" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "suppliers_enterprise_id_idx" ON "suppliers"("enterprise_id");

-- CreateIndex
CREATE INDEX "suppliers_enterprise_id_is_active_idx" ON "suppliers"("enterprise_id", "is_active");

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_enterprise_id_fkey" FOREIGN KEY ("enterprise_id") REFERENCES "enterprises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phase 8 (module Fournisseurs) — voir docs/adr/0008-deux-roles-postgres-identite-vs-tenant.md.
-- suppliers est une table tenant comme les autres (RLS forcée), même patron
-- que customers (migration 20260809235329_add_customer).
GRANT SELECT, INSERT, UPDATE, DELETE ON suppliers TO erp_app_tenant;

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON suppliers
  USING (enterprise_id = current_setting('app.tenant_id', true)::uuid);
