# 0002 — Point d'application de l'isolation tenant

## Statut
Tranché — 2026-08-09

## Contexte
Deux mécanismes pour garantir qu'une requête ne retourne jamais de données
hors tenant :
1. Un plugin/middleware ORM applicatif (ex. plugin Mongoose, middleware
   Prisma) qui injecte automatiquement le filtre `tenantId`.
2. Row Level Security PostgreSQL, appliquée au niveau du moteur de base, avec
   le `tenantId` positionné par transaction via `current_setting`.

Le choix de PostgreSQL comme SGBD (stack, §2 `CLAUDE.md`) rend l'option RLS
disponible nativement.

## Décision
**Défense en profondeur, deux couches** :
1. **RLS PostgreSQL** comme garantie ultime : `FORCE ROW LEVEL SECURITY` sur
   chaque table tenant, policy sur `current_setting('app.tenant_id')`. Le rôle
   applicatif Postgres n'est ni `superuser` ni propriétaire des tables (sinon
   RLS est contournable par défaut).
2. **Contexte de requête applicatif** : `AsyncLocalStorage` (`TenantContext`)
   alimenté uniquement depuis le JWT vérifié côté serveur, jamais depuis le
   body/query/headers. Chaque transaction Prisma exécute
   `SET LOCAL app.tenant_id = '<uuid>'` en ouverture.
3. Un repository de base scopé (Prisma Client Extension) refuse toute requête
   sur un modèle tenant exécutée hors `TenantContext`, en complément défensif
   de la RLS — pas en remplacement.

## Conséquences
- Même un bug applicatif qui oublierait de filtrer par tenant ne peut pas fuir
  de données : la RLS bloque au niveau base.
- Accès direct au `PrismaClient` en dehors d'un repository est interdit
  (`CLAUDE.md` §5) — vérifié par lint/test statique en Phase 3.
- Les routes Super Admin qui doivent traverser les tenants utilisent un
  `CrossTenantRepository` explicite, avec un rôle Postgres dédié capable de
  bypasser la RLS (`BYPASSRLS`), et chaque accès est journalisé dans
  l'audit log.
- La suite `test:tenant` (Phase 3) valide les deux couches indépendamment.
