# 0008 — Deux rôles PostgreSQL : identité pré-tenant vs sessions scopées tenant

## Statut
Tranché — 2026-08-09

## Contexte
`docs/adr/0002-point-application-isolation.md` prévoyait la Row Level
Security PostgreSQL comme garantie ultime d'isolation tenant, avec le
`tenantId` positionné par transaction via `current_setting('app.tenant_id')`.

En implémentant la Phase 3, un cas non couvert par ce schéma initial est
apparu : plusieurs flux d'authentification doivent chercher un utilisateur
**avant qu'un tenant soit connu** :
- `POST /auth/login` : recherche par `email`, à travers toutes les entreprises
  (c'est justement ce qui détermine le tenant).
- `POST /auth/refresh`, `/auth/mfa/verify` : recherche par hash de jeton
  unique (`RefreshToken.tokenHash`), sans colonne `enterpriseId` sur la table.
- `POST /auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email`,
  `POST /users/accept-invitation` : recherche par hash de jeton unique
  (`AuthToken.tokenHash`), même situation.
- Scripts (`prisma/seed.ts`, `scripts/create-super-admin.ts`) : opèrent hors
  de toute requête HTTP, donc hors de tout `TenantContext`.

Une policy RLS unique `enterprise_id = current_setting('app.tenant_id')`
appliquée globalement casserait tous ces flux : impossible de trouver un
utilisateur par email si on ne peut interroger que "son" tenant, qu'on ne
connaît pas encore.

## Décision
Deux rôles applicatifs PostgreSQL distincts, donc deux connexions Prisma :

1. **`erp`** (rôle existant depuis la Phase 1/2, celui de `DATABASE_URL`,
   inchangé — pas de renommage) — **sans RLS**. Utilisé exclusivement par :
   - `AuthService` (login, refresh, mfa/verify, logout, `/auth/me`)
   - `AccountRecoveryService` (forgot/reset password, verify-email)
   - `InvitationsService.acceptInvitation` (recherche par jeton, pas encore
     de tenant authentifié)
   - `prisma/seed.ts`, `scripts/create-super-admin.ts`

   Sûr malgré l'absence de RLS : ces requêtes ne font **jamais de liste** —
   uniquement des lookups par colonne `@unique` (email, tokenHash) ou par
   `id` déjà connu. Aucune de ces requêtes ne peut structurellement retourner
   des lignes d'un autre tenant que celui ciblé par la clé unique elle-même.

2. **`erp_app_tenant`** (nouveau) — `NOSUPERUSER NOBYPASSRLS`, non
   propriétaire des tables, `FORCE ROW LEVEL SECURITY` sur chaque table
   tenant. Utilisé par tout code qui s'exécute **à l'intérieur** d'une
   session déjà authentifiée et dont le tenant est donc connu et vérifié
   (`TenantContext`) : `InvitationsService.invite()` aujourd'hui, tous les
   futurs repositories des modules ERP (Phase 8).

3. **Cas particulier — `AuditLogService`** : reste sur `erp` (rôle 1),
   exempté de la règle ESLint. `AuditLog.enterpriseId` est nullable et une
   partie significative des écritures se produit **avant** qu'un tenant soit
   connu (ex. `LOGIN_FAILED` sur un email inconnu — aucune entreprise à
   scoper). Forcer ce service sur `erp_app_tenant` casserait ces appels
   (`TenantContext.getRequiredTenantId()` lèverait). `audit_logs` n'a pas de
   RLS pour l'instant : aucun endpoint ne lit encore les logs d'une
   entreprise via une requête scopée tenant — à réévaluer quand un tel
   endpoint existera (probablement Phase 7, écran d'audit côté entreprise).

## Conséquences
- Deux `PrismaClient` distincts dans `apps/api` : `PrismaService` (rôle
  identité, inchangé) et `TenantScopedPrismaService` (nouveau, rôle tenant).
- `TenantScopedPrismaService` refuse toute requête hors `TenantContext`
  (lève une erreur plutôt que d'exécuter sans `SET LOCAL app.tenant_id`).
- Une règle ESLint interdit d'importer `PrismaService` en dehors de la
  liste explicite ci-dessus — tout nouveau code tenant doit passer par
  `TenantScopedPrismaService`.
- `refresh_tokens` et `auth_tokens` restent hors RLS (pas de colonne
  `enterpriseId`) : leur isolation repose sur l'unicité cryptographique du
  hash et la vérification explicite `userId` déjà codée dans
  `AuthService`/`AccountRecoveryService`/`InvitationsService`.
- Alternative écartée : un seul rôle avec une policy RLS permissive pour les
  routes pré-tenant (`USING (true)` conditionnelle). Écartée car elle
  mélangerait deux niveaux de confiance dans le même rôle Postgres — un bug
  de policy affecterait alors aussi bien les lookups d'identité que les
  données métier tenant, alors que la séparation en deux rôles rend chaque
  niveau de confiance vérifiable indépendamment (`\du` liste explicitement
  quel rôle a RLS forcée).
