-- CreateTable
CREATE TABLE "onboarding_states" (
    "enterprise_id" UUID NOT NULL,
    "current_step" INTEGER NOT NULL DEFAULT 5,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_states_pkey" PRIMARY KEY ("enterprise_id")
);

-- AddForeignKey
ALTER TABLE "onboarding_states" ADD CONSTRAINT "onboarding_states_enterprise_id_fkey" FOREIGN KEY ("enterprise_id") REFERENCES "enterprises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phase 7.4 (onboarding) — voir docs/adr/0008-deux-roles-postgres-identite-vs-tenant.md.
-- onboarding_states est une table tenant comme les autres (RLS forcée),
-- lue/écrite exclusivement depuis un contexte tenant authentifié (contrairement
-- à invoice_counters/accounts dont l'écrivain historique est pré-tenant).
GRANT SELECT, INSERT, UPDATE, DELETE ON onboarding_states TO erp_app_tenant;

ALTER TABLE onboarding_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_states FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON onboarding_states
  USING (enterprise_id = current_setting('app.tenant_id', true)::uuid);
