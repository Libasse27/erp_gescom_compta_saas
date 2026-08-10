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

## Module Fournisseurs — réalisé (2026-08-10)

**Classification** : à créer.

**Modèle** : `Supplier` (`apps/api/prisma/schema.prisma`), copie conforme de
`Customer` — voir `docs/database/SCHEMA.md` §5ter.

**Backend** : `apps/api/src/suppliers/` — même patron en couches que
`customers/` (`SuppliersRepository` → `SuppliersService` →
`SuppliersController`). Routes `GET/POST /suppliers`,
`GET/PATCH/DELETE /suppliers/:id` (DELETE = suppression logique).

**Écart par rapport au gabarit Clients** : le catalogue de permissions
(Phase 2) n'avait pas de clé dédiée aux fournisseurs — ajout de
`suppliers.read/create/update/delete` dans `packages/permissions`
(`permission-keys.ts` + `default-roles.ts`, `ADMIN`/`GESTIONNAIRE` en accès
complet, `MAGASINIER`/`COMPTABLE`/`LECTEUR` en lecture seule, ni
`COMMERCIAL` ni `CAISSIER` — cohérent avec leur absence de `purchases.*`).
De même, ni le menu (`apps/web/src/lib/nav-config.ts`) ni la route
`apps/web/src/app/app/` n'avaient d'entrée "Fournisseurs" — les deux ont dû
être créées, contrairement à Clients qui avait déjà son entrée + son
placeholder `ComingSoon` posés en Phase 7.2.

**Sécurité appliquée** : identique au module Clients — permissions
`suppliers.*`, feature de plan `suppliers` (booléenne, activée sur les 4
forfaits au seed), `FeatureGuard`/`SubscriptionAccessGuard`, RLS PostgreSQL
forcée sur `suppliers`, audit log (`CREATE_SUPPLIER`, `UPDATE_SUPPLIER`,
`DELETE_SUPPLIER` — trois nouvelles clés `AuditAction`, contrairement à
Clients qui avait pu réutiliser `DELETE_CLIENT` déjà présente depuis la
Phase 1).

**Décisions structurantes** : mêmes choix que Clients — suppression toujours
logique, pas de quota chiffré dans ce cycle, NINEA/RCCM format libre.
Réutilise l'enum Prisma `CustomerType` (INDIVIDUAL/COMPANY) plutôt que d'en
dupliquer un `SupplierType` identique.

**Tests** : `suppliers.integration.spec.ts`, `suppliers.tenant.spec.ts`,
`suppliers.repository.spec.ts` (copies conformes des specs Clients, mêmes
critères), plus un cas ajouté à `tenant/tenant-isolation.tenant.spec.ts`.

**Frontend** : `apps/web/src/app/app/suppliers/page.tsx` (nouveau, pas de
`ComingSoon` à remplacer) — copie de `clients/page.tsx`, entrée de menu
ajoutée dans `nav-config.ts` juste après Clients.

**Bug d'environnement rencontré (hors périmètre du module, non corrigé ici)** :
`apps/api/tsconfig.json` (`ignoreDeprecations`) oscille entre les valeurs
`"5.0"` et `"6.0"` selon l'outil qui l'inspecte — `tsc --noEmit` (utilisé par
`pnpm typecheck` et `nest build`) n'accepte que `"5.0"` avec la version de
TypeScript actuellement résolue par le monorepo, alors qu'un diagnostic
d'éditeur suggère `"6.0"`. Appliquer `"6.0"` casse `pnpm typecheck`.
Séparément, `ts-node` (utilisé par `prisma db seed` et
`create-super-admin.ts`) échoue avec `TS5103 Invalid value for
'--ignoreDeprecations'` quelle que soit la valeur — probablement une
résolution de `typescript` différente entre `ts-node` et `tsc` dans ce
monorepo pnpm. Contourné ponctuellement pour ce module en insérant les lignes
`Feature`/`PlanFeature` du seed directement en SQL (`prisma db execute`) sur
la base de dev, sans modifier `seed.ts` ni la config. À trancher via un ADR
dédié, dans le même esprit que le bug `pnpm dev`/`pnpm start` déjà documenté
en Phase 10 — les deux sont probablement liés (résolution de version
TypeScript incohérente entre les différents exécuteurs du monorepo).

## Module Produits — réalisé (2026-08-10)

**Classification** : à créer.

**Modèle** : `Product` (`apps/api/prisma/schema.prisma`) — contrairement à
`Customer`/`Supplier` (des tiers), pas une copie : voir
`docs/database/SCHEMA.md` §5quater pour le détail des champs.

**Backend** : `apps/api/src/products/` — même patron en couches que
`customers/`/`suppliers/` (`ProductsRepository` → `ProductsService` →
`ProductsController`). Routes `GET/POST /products`,
`GET/PATCH/DELETE /products/:id` (DELETE = suppression logique).

**Écart par rapport au gabarit** (inverse de Fournisseurs) : aucun écart —
les permissions `products.read/create/update/delete`
(`packages/permissions`) et l'entrée de menu + route `/app/products`
existaient déjà, posées par anticipation dès les Phases 2 et 7.2 (comme
`clients.*`). Seules deux clés `AuditAction` ont dû être ajoutées
(`CREATE_PRODUCT`, `DELETE_PRODUCT` — `UPDATE_PRODUCT` existait déjà depuis
la Phase 1).

**Sécurité appliquée** : identique aux modules Clients/Fournisseurs —
permissions `products.*`, feature de plan `products` (booléenne, activée sur
les 4 forfaits au seed), `FeatureGuard`/`SubscriptionAccessGuard`, RLS
PostgreSQL forcée sur `products`, audit log
(`CREATE_PRODUCT`/`UPDATE_PRODUCT`/`DELETE_PRODUCT`).

**Décision structurante propre à ce module** : `code` unique **par tenant**
(`@@unique([enterpriseId, code])`) — première contrainte d'unicité métier sur
un modèle ERP de ce projet. Conflit mappé en `ConflictException` (409) côté
repository plutôt que de laisser fuiter l'erreur Prisma `P2002` brute, même
patron que la gestion NINEA/RCCM du `ProvisioningService` (Phase 6). Prix
stocké HT (`sellingPriceExcludingTax`, entier XOF) + `vatRateBasisPoints`
(points de base, défaut 1800 = 18 %) ; le TTC n'est jamais stocké, calculé à
l'affichage. Suppression toujours logique, comme les deux modules précédents.

**Tests** : `products.integration.spec.ts` (CRUD nominal, validation, 403
permission manquante, 403 feature désactivée, 409 code dupliqué — cas propre
à ce module, absent des gabarits Clients/Fournisseurs qui n'ont pas de
contrainte d'unicité), `products.tenant.spec.ts`, `products.repository.spec.ts`
(pagination, recherche nom/code/code-barres, filtre actif/inactif, 409 sur
code dupliqué dans le même tenant, code réutilisable entre tenants
différents) — pas de cas ajouté à `tenant/tenant-isolation.tenant.spec.ts`
(la suite partagée couvre déjà le patron RLS générique via Clients/Fournisseurs,
aucune spécificité `Product` à y ajouter).

**Frontend** : `apps/web/src/app/app/products/page.tsx` — remplace le
placeholder `ComingSoon`, copie de `suppliers/page.tsx` adaptée aux champs
produit (prix HT formaté `formatFCFA`, TVA affichée en %, colonne « Stock
suivi »). `ProductForm` (`apps/web/src/components/product-form.tsx`) ajoute
deux champs numériques (`type="number"`, `valueAsNumber`) et une case à
cocher native (`trackStock`) — premiers de ce type dans le monorepo, aucun
composant `Checkbox`/`NumberInput` dédié n'existait déjà dans
`apps/web/src/components/ui/`.

Vérifié par `pnpm typecheck`/`lint`/`test`/`test:tenant`/`build` (monorepo
complet, 171 tests API dont 15 nouveaux pour Produits) et un build de
production `apps/web` réel (page `/app/products` passée de 182 B à 5.31 kB).
