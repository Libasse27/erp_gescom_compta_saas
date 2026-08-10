# AUDIT.md — Inventaire des modules ERP (Phase 8)

> Prévu dès la Phase 0 par `docs/PROMPT-MAITRE-SAAS.md`, mais sans objet tant
> qu'aucun module métier n'existait (projet neuf, pas de legacy à auditer —
> voir `docs/adr/0000-projet-neuf.md`). Créé au fil de la Phase 8, un module
> par entrée, classification : **à conserver / à améliorer / à refactoriser /
> à migrer / à supprimer / à créer**. Tous les modules ERP de ce projet étant
> neufs, la classification est systématiquement **à créer** — ce document sert
> surtout à tracer l'ordre de migration réel et les décisions prises par
> module, pas à arbitrer entre code existant et code à jeter.

## Ordre de migration (Phase 8)

Clients → Fournisseurs → Produits → Stock → Ventes → Achats → Facturation →
Comptabilité → Rapports. Rationale : Clients/Fournisseurs sont des entités
autonomes (aucune dépendance) et établissent le patron d'architecture
(repository/RLS/tests/entitlements) réutilisé par les modules suivants ;
Produits/Stock avant Ventes/Achats (qui les référencent) ; Facturation après
Ventes ; Comptabilité après Facturation ; Rapports en dernier (agrège tout).

## Module Clients — réalisé (2026-08-10)

**Classification** : à créer.

**Modèle** : `Customer` (`apps/api/prisma/schema.prisma`), voir
`docs/database/SCHEMA.md` §5bis pour le détail.

**Backend** : `apps/api/src/customers/` — `CustomersRepository` (seul point
d'accès Prisma) → `CustomersService` → `CustomersController`. Routes
`GET/POST /customers`, `GET/PATCH/DELETE /customers/:id` (DELETE = suppression
logique).

**Sécurité appliquée** :
- Permissions `clients.read/create/update/delete` (catalogue déjà présent
  dans `packages/permissions` depuis la Phase 2, jamais consommé avant ce
  module).
- Feature de plan `clients` (booléenne, activée sur les 4 forfaits au seed) —
  premier consommateur réel de `@RequiresFeature`/`FeatureGuard` (Phase 4,
  jusque-là seulement testé directement).
- `SubscriptionAccessGuard` — premier consommateur réel hors module `users`.
- RLS PostgreSQL forcée sur `customers`, même patron que `accounts` (Phase 6).
- Audit log sur création/modification/désactivation (`CREATE_CUSTOMER`,
  `UPDATE_CUSTOMER`, `DELETE_CLIENT` réutilisé pour la désactivation — clé
  déjà présente dans `AuditAction` depuis la Phase 1, jamais consommée avant).

**Décisions structurantes** (pas d'ADR dédiée, décisions de portée module) :
- Suppression toujours logique (`isActive=false`), jamais physique — les
  futurs modules Ventes/Facturation référenceront `customerId` en FK.
- Pas de quota chiffré (`Limit`) dans ce cycle : seule la feature booléenne
  est posée. Un quota `maxClients` par forfait sera ajouté dans une passe
  "entitlements ERP" dédiée une fois la grille tarifaire réelle validée.
- NINEA/RCCM : format libre (pas de regex), même choix que
  `Enterprise.ninea/rccm` (Phase 1) — aucune règle de format officielle n'est
  encore documentée dans le projet.

**Tests** : `customers.integration.spec.ts` (CRUD nominal, validation, 403
permission manquante, 403 feature désactivée, régression `?isActive=false`),
`customers.tenant.spec.ts` (404 cross-tenant, liste jamais cross-tenant,
`enterpriseId` forgé sans effet), `customers.repository.spec.ts` (pagination,
recherche, filtre actif/inactif), plus un cas ajouté à la suite partagée
`tenant/tenant-isolation.tenant.spec.ts` (RLS bas niveau).

**Frontend** : `apps/web/src/app/app/clients/page.tsx` — remplace le
placeholder `ComingSoon` : liste paginée/recherche/filtre, formulaire unique
création+édition (`CustomerForm`), désactivation avec confirmation inline
(pas de `window.confirm()` ni de composant `Dialog` — aucun des deux
n'existait déjà dans `apps/web/src/components/ui/`, évite d'introduire une
dépendance non triviale pour ce premier module).

**Bug découvert et corrigé en cours de route** : `listCustomersQuerySchema`
utilisait initialement `z.coerce.boolean()` pour `isActive`, qui aurait
silencieusement inversé le filtre `?isActive=false` (`Boolean("false") ===
true` en JS). Remplacé par un `z.enum(["true","false"]).transform(...)`
explicite ; couvert par un test de régression dans
`customers.integration.spec.ts`.
