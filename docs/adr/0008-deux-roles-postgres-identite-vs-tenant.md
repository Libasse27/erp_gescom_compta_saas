# 0008 — Deux rôles PostgreSQL : identité pré-tenant vs sessions scopées tenant

> **Amendement 2026-08-16** — voir
> `docs/adr/0018-role-identite-bypassrls-non-superuser.md`. Le rôle
> "identité" décrit ci-dessous n'est plus `erp` (superuser/propriétaire des
> tables, interdit par `CLAUDE.md` §5 — constat MT-01) mais un rôle dédié
> `erp_app_identity` (NOSUPERUSER, non propriétaire, BYPASSRLS). Le
> raisonnement de ce document (pourquoi une connexion hors RLS est
> nécessaire pour ces flux) reste valable ; seul le rôle Postgres utilisé
> pour l'incarner a changé.

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

## Mise à jour — 2026-08-20 (BIL-18, docs/audit/BILLING-AUDIT.md)
`PaymentWebhookService` n'apparaît pas dans la liste d'origine ci-dessus —
son usage de la connexion identité a été constaté après coup (MT-01,
`docs/audit/MULTI-TENANT-AUDIT.md`), pas explicitement autorisé par cet ADR
au moment de sa rédaction. BIL-18 a réexaminé ce cas précisément.

**Pourquoi ce service reste sur la connexion identité pour tout son
traitement, pas seulement la résolution initiale du tenant** : la première
requête (`payment.findUnique` par `(provider, providerReference)`, une
colonne `@unique`) est un cas pré-tenant légitime au sens de cet ADR — le
tenant n'est pas encore connu. Une fois `payment.enterpriseId` résolu, le
tenant EST connu ; on pourrait imaginer basculer la suite du traitement vers
`TenantScopedPrismaService`. Ce n'est **pas** fait, parce que la suite du
traitement (compare-and-swap du statut du paiement, transition de statut de
l'abonnement, création de `SubscriptionEvent`, génération de facture)
s'exécute dans **une seule transaction SQL atomique**
(`payments-webhook.service.ts`, `this.prisma.$transaction(...)`) — une
garantie acquise et durcie par BIL-01 (compare-and-swap), BIL-08 (transitions
TRIAL) et BIL-09 (traçabilité des rejets). `PrismaService` et
`TenantScopedPrismaService` sont deux `PrismaClient` sur deux connexions
Postgres distinctes : ils ne peuvent pas partager une transaction. Scinder le
traitement casserait cette atomicité (risque de paiement confirmé sans
abonnement mis à jour, ou l'inverse, en cas d'échec entre les deux
connexions) pour un gain marginal — le tenant est de toute façon déjà
correctement scopé par le code (jamais par le payload, voir
`payments-webhook.service.ts:74-92`).

**Cela ne constitue pas une fuite inter-tenant démontrée.** Aucune requête de
ce service ne fait de liste **non scopée** — la seule requête en forme de
liste (`notifyEnterprise`, `user.findFirst({ where: { enterpriseId, status:
"ACTIVE" } })`) est filtrée par un `enterpriseId` déjà résolu depuis le
`Payment` trouvé par clé unique, jamais depuis une entrée non vérifiée.
`payments-webhook.integration.spec.ts` porte désormais un test dédié (deux
entreprises traitées par des webhooks concurrents, aucune donnée de l'une
n'apparaît jamais dans le traitement de l'autre) qui joue le rôle de filet
de sécurité applicatif à la place du filet RLS absent sur cette connexion
pour ce flux précis.

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
