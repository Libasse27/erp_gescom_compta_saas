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

## Module Stock — réalisé (2026-08-10)

**Classification** : à créer.

**Écart structurant par rapport au gabarit** : contrairement à
Clients/Fournisseurs/Produits (des fiches, CRUD + suppression logique),
Stock n'est pas une entité mais un **grand livre de mouvements**. Aucune
quantité en stock n'est stockée sur `Product` : elle se calcule par
agrégation des `StockMovement` (`groupBy` Prisma par `type`), jamais stockée
— même principe que le TTC produit (module Produits). `StockMovement` est
append-only comme `AuditLog` : pas de route `PATCH`/`DELETE`, une correction
d'inventaire se fait via un nouveau mouvement `ADJUSTMENT`. Voir
`docs/database/SCHEMA.md` §5quinquies pour le détail des champs.

**Backend** : `apps/api/src/stock/` — `StockRepository` (seul point d'accès
Prisma) → `StockService` → `StockController`. Routes `GET /stock` (niveaux
paginés), `GET /stock/:productId` (niveau d'un produit), `GET
/stock/:productId/movements` (historique paginé), `POST /stock/movements`
(création d'un mouvement) — pas de `PATCH`/`DELETE`.

**Décision structurante propre à ce module — garde stock jamais négatif sous
concurrence** : la création d'un mouvement calcule le solde courant puis le
nouveau solde dans la même transaction et rejette (409) un résultat négatif.
Sous l'isolation `ReadCommitted` (défaut des autres modules), deux créations
concurrentes sur le même produit pourraient toutes deux lire le même solde
de départ et laisser passer un stock négatif (race condition classique
lecture-puis-écriture). Décision : élever cette transaction spécifique en
isolation `Serializable`, qui fait échouer l'une des deux transactions en
conflit côté Postgres (erreur `40001` / Prisma `P2034`), rattrapée en 409.
`TenantScopedPrismaService.run()` (`apps/api/src/tenant/`) accepte
désormais un `isolationLevel` optionnel pour cela — changement
rétrocompatible, tous les autres appelants gardent `ReadCommitted` par
défaut.

**Écart par rapport au gabarit** : aucun sur les permissions/route
(contrairement à Fournisseurs) — `stock.read/create/update/delete`
(`packages/permissions`) et l'entrée de menu `/app/stock` existaient déjà
(anticipées Phases 2/7.2). `stock.update`/`stock.delete` restent non
consommées (pas de route update/delete). Une seule nouvelle clé
`AuditAction` (`CREATE_STOCK_MOVEMENT`).

**Sécurité appliquée** : permissions `stock.read`/`stock.create`, feature de
plan `stock` (booléenne, activée sur les 4 forfaits au seed),
`FeatureGuard`/`SubscriptionAccessGuard`, RLS PostgreSQL forcée sur
`stock_movements`, audit log (`CREATE_STOCK_MOVEMENT`).

**Tests** : `stock.repository.spec.ts` (agrégation multi-mouvements,
rejet stock négatif, produit `trackStock=false` rejeté, isolation tenant sur
l'agrégat, pas de N+1 sur la liste), `stock.integration.spec.ts` (CRUD
mouvement, 400 quantité invalide, 400 produit sans suivi de stock, 409 stock
insuffisant, 403 permission manquante, 403 feature désactivée),
`stock.tenant.spec.ts` (404 cross-tenant, liste jamais cross-tenant,
`productId` d'un autre tenant rejeté en 404 plutôt que scopé silencieusement
— équivalent naturel du cas « `enterpriseId` forgé » des modules précédents,
qui n'a pas de sens ici puisque Stock n'a pas de route de création de
fiche), plus un cas ajouté à `tenant/tenant-isolation.tenant.spec.ts`.

**Frontend** : `apps/web/src/app/app/stock/page.tsx` — remplace le
placeholder `ComingSoon` : liste des niveaux de stock (recherche/pagination),
`StockMovementForm` (choix du produit par `<select>` à plat sur les 100
premiers produits suivis, pas de recherche async dans ce cycle — aucun
composant de ce type n'existait déjà), historique paginé par produit affiché
sous la liste après sélection.

Vérifié par `pnpm typecheck`/`lint`/`test`/`test:tenant`/`build` (monorepo
complet) et un build de production `apps/web` réel.

## Module Ventes — réalisé (2026-08-10)

**Classification** : à créer.

**Écart structurant par rapport au gabarit** : première entité ERP **à
lignes** (`Sale` + `SaleLine`), pas une copie des modules précédents. `Sale`
n'est pas une facture — la Facturation (module ultérieur, distinct) en fera
un document légal à partir d'une vente confirmée. Cycle de vie minimal :
`DRAFT -> CONFIRMED | CANCELLED`, `CONFIRMED` terminal dans ce cycle (pas de
retour en arrière). Aucun total stocké : `totalExcludingTax`/`totalVat`/
`totalIncludingTax` calculés à la lecture à partir des lignes, même principe
que Stock/Produits. Voir `docs/database/SCHEMA.md` §5sexies pour le détail.

**Backend** : `apps/api/src/sales/` — `SalesRepository` (seul point d'accès
Prisma) → `SalesService` → `SalesController`. Routes `GET /sales`,
`GET /sales/:id`, `POST /sales` (création DRAFT), `POST /sales/:id/confirm`,
`POST /sales/:id/cancel` — pas de `PATCH`/`DELETE` (lignes immuables).

**Décision structurante — prix figé côté serveur, jamais côté client** :
`unitPriceExcludingTax`/`vatRateBasisPoints` de chaque ligne sont résolus
depuis `Product` au moment de la création, le client ne transmet que
`productId`/`quantity` — jamais de valeur monétaire acceptée du client
(`CLAUDE.md` §6). Un changement de prix catalogue après coup n'altère jamais
l'historique des ventes déjà créées. Pas de remise/prix personnalisé dans ce
cycle.

**Décision structurante — confirmation compose Stock plutôt que de dupliquer
sa logique** : `StockRepository.applyMovement()` (extrait de
`createMovement()`, module Stock) est réutilisé par `SalesRepository.confirm()`
pour décrémenter chaque ligne `trackStock=true`, **dans la même transaction
`Serializable`** que le passage à `CONFIRMED` — vente confirmée et stock
décrémenté réussissent ou échouent ensemble ; 409 si une ligne dépasse le
stock disponible. `StockModule` exporte désormais `StockRepository` pour
cette composition cross-module (`SalesModule` l'importe).

**Écart par rapport au gabarit** : aucun sur permissions/feature —
`sales.read/create/update/delete` et l'entrée de menu `/app/sales`
existaient déjà (anticipées Phases 2/7.2). `confirm`/`cancel` mappées sur
`sales.update`/`sales.delete` (même patron que la désactivation logique de
Produits mappée sur `products.delete`). Trois nouvelles clés `AuditAction`
(`CREATE_SALE`, `CONFIRM_SALE`, `CANCEL_SALE`).

**Sécurité appliquée** : permissions `sales.*`, feature de plan `sales`
(booléenne, activée sur les 4 forfaits au seed),
`FeatureGuard`/`SubscriptionAccessGuard`, RLS PostgreSQL forcée sur `sales`
et `sale_lines` (policy distincte sur chaque table — RLS ne traverse pas une
relation), audit log.

**Tests** : `sales.repository.spec.ts` (instantané prix/TVA à la création,
non-régression si le prix produit change ensuite, décrémentation de stock à
la confirmation, 409 stock insuffisant, produit `trackStock=false` sans
garde stock, rejet confirmation hors DRAFT, annulation limitée à DRAFT,
rejet client/produit d'un autre tenant), `sales.integration.spec.ts` (cycle
de vie complet create→confirm avec effet de bord stock vérifié directement
via Prisma, 409 stock insuffisant, 400 lignes vides, 400 annulation d'une
vente déjà confirmée, 403 permission manquante, 403 feature désactivée),
`sales.tenant.spec.ts` (404 cross-tenant, liste jamais cross-tenant,
`customerId`/`productId` d'un autre tenant rejetés en 404 — équivalent
naturel du cas « enterpriseId forgé », deux variantes ici puisque le body a
deux références externes), plus un cas ajouté à
`tenant/tenant-isolation.tenant.spec.ts`.

**Frontend** : `apps/web/src/app/app/sales/page.tsx` — remplace le
placeholder `ComingSoon` : liste des ventes (recherche par client,
filtre par statut, pagination), `SaleForm` (client + lignes dynamiques via
`useFieldArray` de react-hook-form — première utilisation de ce hook dans le
monorepo, réutilise `useCustomers`/`useProducts` existants pour les listes
déroulantes), actions Confirmer/Annuler sur les ventes `DRAFT`, détail avec
lignes et totaux HT/TVA/TTC affiché sous la liste après sélection.

Vérifié par `pnpm typecheck`/`lint`/`test`/`test:tenant`/`build` (monorepo
complet) et un build de production `apps/web` réel.
