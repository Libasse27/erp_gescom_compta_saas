-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'MARK_INVOICE_PAID';
ALTER TYPE "AuditAction" ADD VALUE 'VOID_INVOICE';

-- CreateTable
CREATE TABLE "sales_invoices" (
    "id" UUID NOT NULL,
    "enterprise_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMP(3),
    "voided_at" TIMESTAMP(3),
    "legal_mentions" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_invoice_counters" (
    "enterprise_id" UUID NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_invoice_counters_pkey" PRIMARY KEY ("enterprise_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoices_sale_id_key" ON "sales_invoices"("sale_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoices_number_key" ON "sales_invoices"("number");

-- CreateIndex
CREATE INDEX "sales_invoices_enterprise_id_idx" ON "sales_invoices"("enterprise_id");

-- CreateIndex
CREATE INDEX "sales_invoices_enterprise_id_status_idx" ON "sales_invoices"("enterprise_id", "status");

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_enterprise_id_fkey" FOREIGN KEY ("enterprise_id") REFERENCES "enterprises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_counters" ADD CONSTRAINT "sales_invoice_counters_enterprise_id_fkey" FOREIGN KEY ("enterprise_id") REFERENCES "enterprises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phase 8 (module Facturation) — voir docs/adr/0008-deux-roles-postgres-identite-vs-tenant.md.
-- sales_invoices et sales_invoice_counters sont des tables tenant comme les
-- autres (RLS forcée), même patron qu'invoice_counters (Phase 5).
GRANT SELECT, INSERT, UPDATE, DELETE ON sales_invoices TO erp_app_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON sales_invoice_counters TO erp_app_tenant;

ALTER TABLE sales_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sales_invoices
  USING (enterprise_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE sales_invoice_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_invoice_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sales_invoice_counters
  USING (enterprise_id = current_setting('app.tenant_id', true)::uuid);
