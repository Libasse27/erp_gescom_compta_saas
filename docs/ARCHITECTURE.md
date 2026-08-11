# ARCHITECTURE.md — Architecture cible du monorepo

> Ce document décrit l'architecture cible mise en place à la Phase 0 (projet
> neuf, voir `docs/adr/0000-projet-neuf.md`). Il sera étendu au fil des phases
> suivantes (schéma de domaine en Phase 1, flux d'authentification en Phase 2,
> etc.) plutôt que remplacé.

## 1. Arborescence

```text
ERP_GESCOM_COMPTA_SAAS/
│
├── apps/
│   ├── api/            NestJS — API REST, source de vérité des règles métier
│   ├── web/             Next.js 15 (App Router) — Super Admin + espace entreprise
│   ├── mobile/          Expo (React Native) + TypeScript — scaffold Phase 9.0 (ADR 0012)
│   └── desktop/         Electron encapsulant apps/web — scaffold Phase 9.0 (ADR 0013)
│
├── packages/
│   ├── types/            Types et DTO partagés (TypeScript pur)
│   ├── validation/       Schémas Zod partagés (front + back)
│   ├── permissions/       Catalogue RBAC (permissions, rôles par défaut)
│   ├── auth/              Types/contrats d'auth partagés (payload JWT, TenantContext)
│   ├── ui/                Composants React partagés (web, et mobile/desktop si pertinent)
│   ├── utils/             Utilitaires partagés (formatFCFA, dates Africa/Dakar…)
│   └── config/            Schémas de configuration/environnement partagés
│
├── docker/               Dockerfiles et compose — peuplé en Phase 10
├── docs/                 Documentation (ce dossier)
├── scripts/              Scripts opérationnels (seed, migrations, CLI Super Admin…)
├── infra/                Infrastructure as code — peuplé en Phase 10
│
├── CLAUDE.md              Règles permanentes (chargé automatiquement)
├── package.json           Scripts racine (turbo run …)
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json     Config TS stricte partagée
└── eslint.config.js       Config ESLint flat partagée
```

## 2. Stack (voir `CLAUDE.md` §2 pour la version normative)

| Couche | Choix | Rationale (résumé — détail dans `docs/adr/`) |
|---|---|---|
| Monorepo | pnpm workspaces + Turborepo | Cache de build/test entre apps/packages, standard pour cette structure |
| API | NestJS 10 | Couches controller/service/repository natives, DI, guards pour RBAC et tenant context |
| Base de données | PostgreSQL 16 + Prisma | Row Level Security native pour l'isolation tenant structurelle, transactions ACID pour le provisioning |
| Web | Next.js 15 (App Router) | Distinction propre Super Admin / Entreprise / onboarding, SEO pour les pages publiques |
| Mobile | Expo (React Native) + TypeScript | Managed workflow, OTA updates, offline-first (3G/4G) sans dette de tooling natif — ADR 0012 |
| Desktop | Electron encapsulant `apps/web` | Réutilise 100 % du code web (BFF, écrans ERP) au lieu de dupliquer une UI native — ADR 0013 |

## 3. Flux de données (cible, mis en place progressivement)

```text
Client (web/mobile/desktop)
   │  JWT (access token, ≤15 min)
   ▼
apps/api — AuthGuard (vérifie signature + expiration)
   │  extrait { userId, enterpriseId, roles } du JWT vérifié
   ▼
TenantContext.run({ tenantId: enterpriseId, userId, roles })  [AsyncLocalStorage]
   │
   ▼
Controller (HTTP) → Service (règles métier) → Repository (Prisma)
   │
   ▼
PostgreSQL — SET LOCAL app.tenant_id = '<uuid>' (par transaction)
   │  Row Level Security filtre automatiquement chaque requête
   ▼
Résultat scopé à l'entreprise du token — jamais au-delà
```

Voir `CLAUDE.md` §5 pour le détail normatif de ce flux et les interdits
associés (accès direct au `PrismaClient`, `tenantId` reçu du client, etc.).

## 4. Dépendances entre packages

```text
apps/api     → packages/types, validation, permissions, auth, utils, config
apps/web     → packages/types, validation, permissions, ui, utils, config
apps/mobile  → packages/types, validation, permissions (ui : primitives locales, packages/ui est DOM/shadcn — ADR 0012)
apps/desktop → aucun (encapsule apps/web, qui porte déjà toutes ces dépendances — ADR 0013)
```

Aucune app ne doit dupliquer un type, un schéma de validation ou une
définition de permission déjà présent dans `packages/`.

## 5. État actuel

- **Phase 0** : scaffolding (structure, outillage typecheck/lint/test/build).
- **Phase 1** : schéma de domaine SaaS complet (`User`, `Enterprise`, RBAC,
  `Plan`/`Feature`/`Limit`, `Subscription`, `Payment`/`Invoice`, `AuditLog`,
  `Setting`, `Notification`) — voir `docs/database/SCHEMA.md`. Prisma est
  intégré à `apps/api` (`apps/api/prisma/schema.prisma`,
  `apps/api/src/prisma/`). `docker/docker-compose.dev.yml` fournit un
  PostgreSQL 16 de développement. Aucune route HTTP, aucun repository/service
  métier, aucune policy RLS à ce stade — c'est l'objet des Phases 2 et 3.
- **Phase 2** : authentification et RBAC applicatif dans `apps/api/src/auth`,
  `apps/api/src/users`, `apps/api/src/common/{audit,guards,decorators,validation}`.
  Login/MFA/refresh rotatif/logout/reset password/vérification email/
  invitations, `PermissionsGuard` (re-résolution en base à chaque requête),
  audit log, rate limiting `/auth/*`, seed du catalogue `Permission`, CLI
  `create-super-admin`. 48 tests d'intégration contre un PostgreSQL de test
  réel (`test/global-setup.js`). Pas de `/auth/register` public (Phase 6),
  pas d'UI (Phase 7).
- **Phase 3** : isolation multi-tenant dans `apps/api/src/tenant`
  (`TenantContext`, `TenantContextMiddleware`, `TenantScopedPrismaService`).
  Deux rôles PostgreSQL distincts (`erp` sans RLS pour les résolutions
  pré-tenant, `erp_app_tenant` avec RLS forcée pour tout le reste — ADR 0008)
  et une règle ESLint (`apps/api/eslint.config.js`) qui interdit
  `PrismaService`/`PrismaClient` en dehors d'une liste explicite. Suite
  `test:tenant` (5 tests) prouvant l'isolation au niveau base, pas seulement
  applicatif. Pas encore de table métier ERP à laquelle appliquer la RLS
  au-delà des tables plateforme déjà tenant-scoped (Phase 8).
- **Phase 8** : les 9 modules ERP (Clients → Rapports) migrés sur le socle
  multi-tenant, RBAC et entitlements.
- **Phase 9.0** : toutes les routes NestJS sont préfixées `/v1`
  (`docs/adr/0007-...`, rouvert). Scaffolds `apps/mobile` (Expo, ADR 0012) et
  `apps/desktop` (Electron encapsulant `apps/web`, ADR 0013) — navigation/
  fenêtre minimales, aucune fonctionnalité métier. Auth mobile, offline-first
  et écrans ERP mobile restent à construire (Phase 9.2+).
