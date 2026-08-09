-- Phase 4 (entitlements) — voir docs/adr/0008-deux-roles-postgres-identite-vs-tenant.md
--
-- plans/features/plan_features/limits/plan_limits sont un catalogue
-- plateforme partagé (aucune colonne enterprise_id), comme `permissions`
-- (migration 20260809113836) : lecture seule pour erp_app_tenant, pas de
-- RLS. EntitlementsService les lit à travers TenantScopedPrismaService
-- (jointure depuis subscriptions, qui elle est RLS) pour résoudre les
-- features/limites du plan courant de l'entreprise.
GRANT SELECT ON plans, features, plan_features, limits, plan_limits TO erp_app_tenant;
