-- Corrige MT-01 (docs/audit/MULTI-TENANT-AUDIT.md, Phase 9.5.1) : la
-- connexion "identité" décrite par docs/adr/0008-deux-roles-postgres-identite-vs-tenant.md
-- utilisait jusqu'ici le rôle `erp` (= POSTGRES_USER), superuser et
-- propriétaire de toutes les tables — interdit explicite de CLAUDE.md §5
-- ("un rôle applicatif Postgres superuser/propriétaire de table utilisé par
-- l'API"). Ce nouveau rôle reprend exactement le même périmètre fonctionnel
-- que l'ADR-0008 (AuthService, AccountRecoveryService,
-- InvitationsService.acceptInvitation, ProvisioningService,
-- PaymentWebhookService, NotificationsService, AuditLogService,
-- CrossTenantRepository, HealthController, PlansService — voir
-- docs/audit/MULTI-TENANT-AUDIT.md MT-01 pour la liste vérifiée dans le
-- code) mais sans SUPERUSER ni ownership.
--
-- BYPASSRLS est nécessaire et volontaire : ces flux s'exécutent avant qu'un
-- tenant soit connu (login par email, webhook de paiement sans JWT,
-- provisioning d'une entreprise qui n'existe pas encore) et ne peuvent donc
-- pas satisfaire current_setting('app.tenant_id') comme erp_app_tenant.
-- BYPASSRLS reste un privilège Postgres distinct de SUPERUSER et de
-- l'ownership : un rôle BYPASSRLS non-superuser/non-propriétaire reste
-- soumis aux GRANT table par table ci-dessous (contrairement à un
-- superuser, qui ignore toute permission), et à toute contrainte SQL
-- (CHECK, UNIQUE, FK). Le rôle propriétaire (`erp`) n'est plus censé servir
-- qu'à l'exécution des migrations (`prisma migrate deploy`), jamais à
-- l'exécution de l'API elle-même.
--
-- CREATE ROLE est global au cluster Postgres (pas par base) : ce bloc doit
-- être idempotent, comme la migration 20260809113836_add_tenant_role_and_rls
-- dont il reprend le même style (cluster partagé entre erp_saas_dev et
-- erp_saas_test).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'erp_app_identity') THEN
    CREATE ROLE erp_app_identity WITH LOGIN PASSWORD 'erp_identity_dev_password'
      NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS NOREPLICATION;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO erp_app_identity;

-- Catalogue plateforme, lecture seule — même périmètre que erp_app_tenant
-- (migrations 20260809113836 et 20260809150000).
GRANT SELECT ON permissions, plans, features, plan_features, limits, plan_limits TO erp_app_identity;

-- Journal d'audit : append-only, jamais UPDATE/DELETE (CLAUDE.md §6). Une
-- partie des écritures se produit avant qu'un tenant soit connu (ex.
-- LOGIN_FAILED sur un email inconnu), voir docs/adr/0008-... §"Cas
-- particulier — AuditLogService".
GRANT SELECT, INSERT ON audit_logs TO erp_app_identity;

-- Tables effectivement touchées par les flux pré-tenant identifiés dans
-- docs/audit/MULTI-TENANT-AUDIT.md (MT-01) : chaque requête re-vérifie déjà
-- son périmètre en code (recherche par colonne @unique, ou écriture de
-- lignes fraîchement créées dans la même transaction — jamais une liste
-- ouverte). Ce GRANT autorise l'accès à la table ; il ne filtre pas les
-- lignes, RLS étant ignorée par ce rôle via BYPASSRLS.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  users, auth_tokens, refresh_tokens,
  enterprises, subscriptions, subscription_events,
  payments, invoices, invoice_counters,
  notifications, accounts, settings,
  roles, role_permissions, user_roles
TO erp_app_identity;
