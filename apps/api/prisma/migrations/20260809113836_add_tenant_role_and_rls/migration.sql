-- Phase 3 (multi-tenancy) — voir docs/adr/0008-deux-roles-postgres-identite-vs-tenant.md
--
-- Rôle applicatif dédié aux requêtes qui s'exécutent DANS un contexte tenant
-- déjà authentifié (TenantContext). NOSUPERUSER NOBYPASSRLS NOCREATEDB
-- NOCREATEROLE, pas propriétaire des tables : Row Level Security non
-- contournable pour ce rôle (critère d'acceptation Phase 3).
--
-- Mot de passe dev-only, même logique que POSTGRES_PASSWORD dans
-- docker/docker-compose.dev.yml : à rotation obligatoire hors environnement
-- de développement local.
--
-- CREATE ROLE est global au cluster Postgres (pas par base) : ce bloc doit
-- être idempotent car cette migration s'applique à la fois sur
-- erp_saas_dev et erp_saas_test, qui partagent le même serveur Postgres.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'erp_app_tenant') THEN
    CREATE ROLE erp_app_tenant WITH LOGIN PASSWORD 'erp_tenant_dev_password'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO erp_app_tenant;

-- Table de référence plateforme partagée (aucune colonne enterpriseId) :
-- lecture seule, pas de RLS.
GRANT SELECT ON permissions TO erp_app_tenant;

-- Pas de colonne enterpriseId sur auth_tokens (voir ADR 0008) : accès
-- nécessaire pour la transaction d'invitation (InvitationsService.invite),
-- mais pas de policy RLS applicable.
GRANT SELECT, INSERT, UPDATE, DELETE ON auth_tokens TO erp_app_tenant;

-- Tables tenant : RLS forcée + policy sur chaque table possédant (ou
-- atteignant via jointure) une colonne enterprise_id.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  enterprises, roles, user_roles, role_permissions, users,
  settings, notifications, subscriptions, subscription_events,
  payments, invoices
TO erp_app_tenant;

ALTER TABLE enterprises ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprises FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON enterprises
  USING (id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON roles
  USING (enterprise_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON user_roles
  USING (role_id IN (SELECT id FROM roles WHERE enterprise_id = current_setting('app.tenant_id', true)::uuid));

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON role_permissions
  USING (role_id IN (SELECT id FROM roles WHERE enterprise_id = current_setting('app.tenant_id', true)::uuid));

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON users
  USING (enterprise_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON settings
  USING (enterprise_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notifications
  USING (enterprise_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON subscriptions
  USING (enterprise_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE subscription_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON subscription_events
  USING (subscription_id IN (SELECT id FROM subscriptions WHERE enterprise_id = current_setting('app.tenant_id', true)::uuid));

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payments
  USING (enterprise_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invoices
  USING (enterprise_id = current_setting('app.tenant_id', true)::uuid);
