# 0018 — Rôle "identité" non-superuser/non-propriétaire (BYPASSRLS), amendement de l'ADR 0008

## Statut
Tranché — 2026-08-16 (corrige un écart trouvé en Phase 9.5.1, voir
`docs/audit/MULTI-TENANT-AUDIT.md`, constat MT-01)

## Contexte
`docs/adr/0008-deux-roles-postgres-identite-vs-tenant.md` avait tranché,
pour les flux pré-tenant (login par email, refresh par hash de jeton, reset
password, provisioning, webhooks de paiement, notifications, audit log,
health check, accès cross-tenant Super Admin), l'usage du rôle Postgres
`erp` — c'est-à-dire `POSTGRES_USER`, le rôle bootstrap de l'image
`postgres:16-alpine`, qui est à la fois **superuser du cluster** et
**propriétaire de toutes les tables**.

L'audit de Phase 9.5.1 (MT-01) a confirmé que ce choix fonctionne
correctement — RLS bien conçue, aucune fuite inter-tenant démontrée — mais
qu'il enfreint littéralement l'interdit explicite de `CLAUDE.md` §5 : « un
rôle applicatif Postgres superuser/propriétaire de table utilisé par l'API »
figure dans la liste des interdits absolus, sans exception pour un usage
jugé sûr en pratique. Il a aussi constaté que l'usage réel avait dérivé
au-delà de la liste que l'ADR-0008 avait explicitement autorisée
(`NotificationsService`, `PaymentWebhookService`, `PlansService`,
`ProvisioningService`, `HealthController`, `CrossTenantRepository`
utilisent la même connexion, sans que l'ADR-0008 les ait couverts).

## Décision
Remplacer le rôle `erp` par un nouveau rôle dédié `erp_app_identity` comme
connexion de `PrismaService`, avec les attributs suivants :

```sql
CREATE ROLE erp_app_identity WITH LOGIN PASSWORD '...'
  NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS NOREPLICATION;
```

- **`NOSUPERUSER`** et **non propriétaire des tables** (le compte
  propriétaire, `erp`, n'est plus utilisé que par `prisma migrate
  deploy`/`migrate dev`, jamais par l'API en fonctionnement) : satisfait
  littéralement l'interdit de `CLAUDE.md` §5.
- **`BYPASSRLS`** : nécessaire et volontaire. Les flux pré-tenant ne peuvent
  structurellement pas satisfaire `current_setting('app.tenant_id')` (le
  tenant n'est pas encore connu), donc une policy RLS classique retournerait
  zéro ligne. `BYPASSRLS` est un attribut de rôle Postgres **distinct** de
  `SUPERUSER` et de l'ownership : un rôle `BYPASSRLS` non-superuser/non-
  propriétaire reste entièrement soumis aux `GRANT` table par table et à
  toutes les contraintes SQL (`CHECK`, `UNIQUE`, clés étrangères) — seule la
  policy RLS elle-même est ignorée. C'est une réduction de privilège réelle
  par rapport à l'ancien rôle `erp`, qui ignorait aussi les `GRANT` (un
  superuser n'a besoin d'aucune permission explicite).
- **Périmètre de tables inchangé** : `erp_app_identity` obtient exactement
  les tables déjà touchées par le code existant (voir migration
  `20260816120000_add_identity_role` pour la liste vérifiée), ni plus ni
  moins — aucune extension de fonctionnalité, uniquement un changement de
  rôle de connexion.
- Un test de garde (`tenant-isolation.tenant.spec.ts`, à côté de
  l'équivalent déjà existant pour `erp_app_tenant`) vérifie via `pg_roles`/
  `pg_tables` que `erp_app_identity` n'est ni superuser ni propriétaire —
  pour que toute régression future (ex. un déploiement qui recrée le rôle
  sans `NOSUPERUSER`) échoue en CI plutôt que de passer inaperçue.

## Conséquences
- Chaque service listé par l'ADR-0008 (`AuthService`,
  `AccountRecoveryService`, `InvitationsService.acceptInvitation`,
  `AuditLogService`) et chaque service qui utilisait la même connexion sans
  y être explicitement autorisé (`NotificationsService`,
  `PaymentWebhookService`, `PlansService`, `ProvisioningService`,
  `HealthController`, `CrossTenantRepository`) continue de fonctionner sans
  changement de code — seule la chaîne de connexion change
  (`IDENTITY_DATABASE_URL` au lieu de `DATABASE_URL`).
- `DATABASE_URL` change de sens : ce n'est plus la connexion runtime de
  l'API, uniquement celle des migrations Prisma. Tout script ou outil qui
  supposerait encore que `DATABASE_URL` sert de connexion applicative doit
  être corrigé.
- Ce changement ne règle pas, à lui seul, le fait que six des dix
  consommateurs de cette connexion n'étaient pas couverts par le
  raisonnement « lookup par clé unique, jamais de liste » de l'ADR-0008
  (constat MT-01, section « Impact »). C'est un sujet distinct, à traiter
  service par service (voir `docs/audit/PROJECT-AUDIT.md` §7, points 1-2) :
  ce correctif retire l'exemption RLS *inconditionnelle* du superuser,
  remplacée par une exemption *conditionnée à des GRANT explicites et
  auditables* — une réduction de surface, pas une élimination du besoin de
  revue au cas par cas de chaque service.
- Alternative écartée : réécrire les flux pré-tenant (notamment le login par
  email) pour passer par `TenantScopedPrismaService`. Impossible sans
  introduire une table/index séparé hors RLS pour la résolution
  email→tenant, ce qui aurait changé l'architecture de données pour un
  correctif censé rester ciblé — écartée pour cette phase, à reconsidérer si
  un futur audit trouve `BYPASSRLS` insuffisant.
