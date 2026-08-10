/*
  Warnings:

  - Added the required column `updated_at` to the `accounts` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'CREATE_ACCOUNT';
ALTER TYPE "AuditAction" ADD VALUE 'UPDATE_ACCOUNT';
ALTER TYPE "AuditAction" ADD VALUE 'CREATE_JOURNAL_ENTRY';

-- AlterTable
-- Backfill des 32 lignes existantes (les 8 classes racines SYSCOHADA par
-- entreprise déjà provisionnée) avec CURRENT_TIMESTAMP au lieu d'un DEFAULT
-- permanent : updated_at doit refléter la dernière modification réelle
-- ensuite (géré par @updatedAt côté Prisma), pas silencieusement rester sur
-- une valeur par défaut.
ALTER TABLE "accounts" ADD COLUMN     "updated_at" TIMESTAMP(3);
UPDATE "accounts" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
ALTER TABLE "accounts" ALTER COLUMN "updated_at" SET NOT NULL;

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL,
    "enterprise_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "entry_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reference" TEXT,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entry_lines" (
    "id" UUID NOT NULL,
    "journal_entry_id" UUID NOT NULL,
    "enterprise_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "label" TEXT,
    "debit_amount" INTEGER NOT NULL DEFAULT 0,
    "credit_amount" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entry_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entry_counters" (
    "enterprise_id" UUID NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journal_entry_counters_pkey" PRIMARY KEY ("enterprise_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_number_key" ON "journal_entries"("number");

-- CreateIndex
CREATE INDEX "journal_entries_enterprise_id_idx" ON "journal_entries"("enterprise_id");

-- CreateIndex
CREATE INDEX "journal_entries_enterprise_id_entry_date_idx" ON "journal_entries"("enterprise_id", "entry_date");

-- CreateIndex
CREATE INDEX "journal_entry_lines_enterprise_id_idx" ON "journal_entry_lines"("enterprise_id");

-- CreateIndex
CREATE INDEX "journal_entry_lines_journal_entry_id_idx" ON "journal_entry_lines"("journal_entry_id");

-- CreateIndex
CREATE INDEX "journal_entry_lines_account_id_idx" ON "journal_entry_lines"("account_id");

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_enterprise_id_fkey" FOREIGN KEY ("enterprise_id") REFERENCES "enterprises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_enterprise_id_fkey" FOREIGN KEY ("enterprise_id") REFERENCES "enterprises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry_counters" ADD CONSTRAINT "journal_entry_counters_enterprise_id_fkey" FOREIGN KEY ("enterprise_id") REFERENCES "enterprises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phase 8 (module Comptabilité) — voir docs/adr/0008-deux-roles-postgres-identite-vs-tenant.md.
-- journal_entries, journal_entry_lines et journal_entry_counters sont des
-- tables tenant comme les autres (RLS forcée), même patron que
-- sales_invoices/sales_invoice_counters (module Facturation). accounts a
-- déjà sa policy depuis la migration Phase 6 (add_account...), pas besoin
-- de la reposer ici.
GRANT SELECT, INSERT, UPDATE, DELETE ON journal_entries TO erp_app_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON journal_entry_lines TO erp_app_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON journal_entry_counters TO erp_app_tenant;

ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON journal_entries
  USING (enterprise_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE journal_entry_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entry_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON journal_entry_lines
  USING (enterprise_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE journal_entry_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entry_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON journal_entry_counters
  USING (enterprise_id = current_setting('app.tenant_id', true)::uuid);
