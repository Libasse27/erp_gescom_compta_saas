# Audit backend — Modules Gestion commerciale (Clients, Fournisseurs, Produits, Stock, Ventes, Achats, Facturation)

Date : 2026-08-16
Périmètre : `apps/api/src/{customers,suppliers,products,stock,sales,purchases,invoicing}`
Hors périmètre (audités séparément) : Comptabilité, Rapports.
Méthode : lecture directe du code (contrôleur → service → repository), des schémas Zod
(`packages/validation`), des schémas Prisma (`apps/api/prisma/schema.prisma`), des guards
(`PermissionsGuard`, `FeatureGuard`, `SubscriptionAccessGuard`, `JwtAuthGuard`) et des suites
de tests `*.integration.spec.ts` / `*.tenant.spec.ts` / `*.repository.spec.ts` de chaque module.
Aucun code applicatif modifié.

---

## Vue d'ensemble

Les 7 modules suivent rigoureusement le même patron architectural, cohérent avec CLAUDE.md §5/§8 :
`Controller` (validation Zod + délégation) → `Service` (orchestration + audit log) →
`Repository` (seul point d'accès Prisma, toujours via `TenantScopedPrismaService.run()`, qui
positionne `SET LOCAL app.tenant_id` par transaction et lève si `TenantContext` est absent).
`PermissionsGuard` re-résout la permission en base à chaque requête (jamais depuis le JWT).
`FeatureGuard`/`SubscriptionAccessGuard` sont posés sur chaque route (y compris lecture), pas
seulement sur les mutations. Toute ressource hors tenant renvoie 404 (jamais 403), vérifié
explicitement dans chaque repository en plus de la RLS. La pagination est bornée
(`pageSize` max 100) sur tous les endpoints de liste, aucune requête non bornée trouvée. Les
prix/TVA de vente sont toujours résolus côté serveur depuis `Product`, jamais transmis par le
client. Les erreurs utilisent les exceptions NestJS typées (`NotFoundException`,
`ConflictException`, `BadRequestException`), aucun `throw new Error()` nu dans les 7 modules.
Les tests d'intégration sont substantiels (200+ lignes/module), couvrent nominal, 400, 403
(permission ET feature), 409, et l'isolation tenant (404, liste filtrée, référence forgée
rejetée) — pas de simples tests de façade.

Deux réserves transversales majeures ressortent : (1) aucun mécanisme d'idempotence sur les
endpoints mutants (contrainte explicite de CLAUDE.md §7 vu le contexte réseau 3G/4G), et
(2) les cycles Ventes/Achats/Facturation sont volontairement réduits à un sous-ensemble minimal
du processus métier réel (pas de livraison, pas de réception, pas de facture fournisseur, pas
de paiement partiel, pas d'avoir) — ce n'est pas un bug caché mais un périmètre fonctionnel
nettement plus étroit que ce qu'un ERP commercial complet est censé couvrir, et cela n'est pas
signalé comme tel dans les commits ("Phase 8 complete").

---

### AUDIT-001
- **Sévérité** : HIGH
- **Composant** : Stock, Ventes, Achats, Facturation (tous les endpoints mutants POST/PATCH)
- **Description** : Aucun mécanisme de clé d'idempotence n'existe sur les routes mutantes
  (`POST /stock/movements`, `POST /sales`, `POST /sales/:id/confirm`, `POST /purchases`,
  `POST /purchases/:id/confirm`, `POST /invoices`, `POST /invoices/:id/mark-paid`). Recherche
  exhaustive de "Idempotency"/"idempotenc" dans `apps/api/src` : aucune occurrence dans ces
  modules (seulement dans les webhooks de paiement, hors périmètre).
- **Impact** : Sur un réseau 3G/4G intermittent (contexte explicite du produit, CLAUDE.md §7),
  un retry client (timeout perçu, double-tap utilisateur) sur `POST /stock/movements` ou
  `POST /sales/:id/confirm` peut créer deux mouvements de stock ou décrémenter deux fois le
  stock pour un seul événement logique. `POST /sales` peut créer deux ventes brouillon
  dupliquées pour une même saisie.
- **Risque** : Écarts de stock silencieux, ventes/achats dupliqués nécessitant une correction
  manuelle a posteriori, particulièrement critique pour Stock où l'invariant "jamais négatif"
  ne protège pas contre une duplication de sens identique (deux OUT valides consomment le
  double du stock réel).
- **Fichiers** : `apps/api/src/stock/stock.controller.ts:73-84`,
  `apps/api/src/sales/sales.controller.ts:46-70`,
  `apps/api/src/purchases/purchases.controller.ts:44-68`,
  `apps/api/src/invoicing/invoicing.controller.ts`
- **Solution** : Introduire un header `Idempotency-Key` obligatoire sur ces routes, table
  dédiée `(enterpriseId, key, endpoint) -> résultat`, retour du résultat mis en cache si la clé
  a déjà été traitée (cf. règle d'or générique déjà appliquée aux webhooks de paiement, à
  généraliser).
- **Priorité** : P1
- **Statut** : OUVERT

---

### AUDIT-002
- **Sévérité** : MEDIUM
- **Composant** : Achats (`purchases`)
- **Description** : Le cycle métier réellement implémenté est `DRAFT -> CONFIRMED | CANCELLED`
  uniquement (`apps/api/prisma/schema.prisma:683-687`). `confirm()` crée directement un
  mouvement de stock `IN` pour la quantité totale commandée, au moment de la confirmation de
  la commande — il n'existe aucune notion de réception (`GoodsReceipt`), partielle ou complète,
  aucune facture fournisseur (`PurchaseInvoice`), aucun paiement fournisseur. Recherche
  `PurchaseInvoice|SupplierPayment|GoodsReceipt|reception` dans `apps/api/src` : 0 résultat
  applicatif. Le commentaire du schéma le confirme explicitement : "Pas de facture fournisseur
  dans ce cycle".
- **Impact** : Le stock est crédité dès la confirmation d'une commande fournisseur, avant toute
  réception physique des marchandises — contraire au principe demandé par l'audit ("réception
  confirmée → stock IN"). Une commande confirmée mais jamais livrée laisse un stock
  artificiellement gonflé sans mécanisme de correction dédié (seul un mouvement `ADJUSTMENT`
  manuel permettrait de rattraper). Par construction, la question "double réception" ne se pose
  pas car il n'y a pas de réception — mais c'est une absence de fonctionnalité, pas une garantie.
- **Risque** : Écart stock théorique/physique en production dès qu'un délai existe entre
  commande et livraison (cas normal en logistique UEMOA). Absence de suivi du passif fournisseur
  (aucune facture, aucun paiement) empêche tout rapprochement comptable Achats.
- **Fichiers** : `apps/api/src/purchases/purchases.repository.ts:181-217`,
  `apps/api/prisma/schema.prisma:683-693`
- **Solution** : Décision produit à valider avec `architect` — soit ce périmètre réduit est
  assumé (ADR à rédiger explicitement, ce qui n'existe pas aujourd'hui), soit il faut ajouter un
  état intermédiaire `CONFIRMED -> RECEIVED` (partiel/total) qui déclenche le mouvement IN à la
  réception plutôt qu'à la confirmation, plus un module facture fournisseur/paiement.
- **Priorité** : P2
- **Statut** : OUVERT

---

### AUDIT-003
- **Sévérité** : MEDIUM
- **Composant** : Facturation (`invoicing`)
- **Description** : `SalesInvoice.status` est un simple enum `ISSUED | PAID | VOID`
  (`apps/api/prisma/schema.prisma:777`), sans aucune notion de paiement partiel (pas de modèle
  `Payment`/ligne de règlement liée à une facture) ni d'avoir/note de crédit
  (`CreditNote`). `markPaid()` bascule directement en `PAID` en une seule opération binaire
  (`apps/api/src/invoicing/invoicing.repository.ts:219-233`) ; `void()` change juste le statut
  d'une facture `ISSUED` en `VOID` sans document légal de contrepartie
  (`apps/api/src/invoicing/invoicing.repository.ts:235-249`).
- **Impact** : Impossible d'enregistrer un règlement partiel (cas fréquent en usage
  Mobile Money/UEMOA — versements échelonnés). L'annulation d'une facture émise ne produit
  aucune trace de type avoir, ce qui pose un problème vis-à-vis de la traçabilité comptable
  SYSCOHADA/OHADA attendue (CLAUDE.md §7) : une facture légalement émise doit normalement être
  corrigée par un avoir, pas simplement désactivée par changement de statut.
- **Risque** : Fonctionnalité métier incomplète pour un usage réel en production ; risque de
  non-conformité comptable si `VOID` est utilisé comme substitut d'avoir sans piste d'audit
  correspondante côté comptabilité (module audité séparément, à croiser).
- **Fichiers** : `apps/api/prisma/schema.prisma:764-805`,
  `apps/api/src/invoicing/invoicing.repository.ts:219-249`
- **Solution** : Remonter à `architect` — barème/traitement comptable des avoirs et paiements
  partiels étant une règle métier fiscale/comptable, à ne pas improviser (cf. règle d'escalade
  du mandat).
- **Priorité** : P2
- **Statut** : OUVERT

---

### AUDIT-004
- **Sévérité** : MEDIUM
- **Composant** : Ventes (`sales`)
- **Description** : `cancel()` n'autorise l'annulation que depuis `DRAFT`
  (`apps/api/src/sales/sales.repository.ts:218-233`), donc aucune transition illégale n'est
  possible (CONFIRMED est terminal côté API : ni re-brouillonnage, ni annulation, ni retour
  arrière). C'est cohérent et bien gardé — mais cela signifie aussi qu'une vente confirmée
  (donc avec stock déjà décrémenté) ne peut jamais être annulée/retournée via l'API : aucun
  mouvement de stock correctif (retour client) n'est possible pour une vente déjà confirmée.
- **Impact** : Un cas d'usage courant (retour marchandise après confirmation, erreur de saisie
  détectée après confirmation) n'a aucun chemin applicatif — la seule voie de contournement est
  un mouvement `ADJUSTMENT` manuel déconnecté de la vente d'origine, sans lien traçable entre le
  retour et la vente source.
- **Risque** : Fonctionnel plus que sécurité — écart entre besoin métier réel et couverture API,
  à db évaluer avec le métier avant mise en production commerciale.
- **Fichiers** : `apps/api/src/sales/sales.repository.ts:180-233`
- **Solution** : Décision produit — si les retours sont hors périmètre pour l'instant, le
  documenter explicitement (ADR) plutôt que de le laisser implicite dans un commentaire de code.
- **Priorité** : P3
- **Statut** : OUVERT

---

### AUDIT-005
- **Sévérité** : LOW
- **Composant** : Stock, Ventes, Achats (protection anti-survente / race condition)
- **Description** : La protection contre la survente concurrente repose sur
  `Prisma.TransactionIsolationLevel.Serializable` + capture de l'erreur `P2034` mappée en 409
  (`apps/api/src/stock/stock.repository.ts:136-148`, repris à l'identique dans
  `sales.repository.ts:180-216` et `purchases.repository.ts:181-217`). Le mécanisme est
  correctement conçu (lecture-puis-écriture d'un invariant partagé sous isolation
  sérialisable). Cependant, aucun test (`stock.integration.spec.ts`,
  `sales.integration.spec.ts`, `purchases.integration.spec.ts`) ne déclenche réellement deux
  requêtes concurrentes pour vérifier que l'une des deux échoue bien en 409 plutôt que de
  laisser passer un stock négatif — recherche "concurrent" dans les 3 fichiers de test : 0
  résultat.
- **Impact** : La garantie anti-survente n'est validée qu'en lecture de code, pas par un test
  reproductible en CI. Une régression future (ex. isolation Serializable retirée par erreur,
  mauvaise gestion de la sous-transaction dans `applyMovement` appelé depuis
  `SalesRepository.confirm`) ne serait pas détectée automatiquement.
- **Risque** : Risque de régression silencieuse sur l'invariant le plus critique du module
  Stock.
- **Fichiers** : `apps/api/src/stock/stock.integration.spec.ts`,
  `apps/api/src/sales/sales.integration.spec.ts`,
  `apps/api/src/purchases/purchases.integration.spec.ts`
- **Solution** : Ajouter un test d'intégration qui lance N requêtes `Promise.all` concurrentes
  visant à survendre un même produit (stock initial fixé), et assertit qu'exactement une
  échoue en 409 et que le solde final reste cohérent (jamais négatif).
- **Priorité** : P2
- **Statut** : OUVERT

---

### AUDIT-006
- **Sévérité** : LOW
- **Composant** : Clients, Fournisseurs, Produits, Stock (exposition de réponse)
- **Description** : Les repositories retournent directement le type Prisma généré
  (`Customer`, `Product`, etc.) et les contrôleurs le renvoient tel quel sans couche DTO/mapper
  dédiée (ex. `apps/api/src/customers/customers.repository.ts:19,51-63`). Aucune donnée
  sensible n'est exposée dans les champs observés (pas de mot de passe, pas de token) — les
  modèles concernés sont de simples fiches métier (nom, adresse, NINEA/RCCM, etc.), donc le
  risque réel est faible. Sales/Purchases/Invoicing, eux, utilisent bien des vues calculées
  dédiées (`SaleView`, `PurchaseView`, `SalesInvoiceView`), pas le modèle Prisma brut.
- **Impact** : Écart de convention entre modules « fiche » (retour brut) et modules
  « transaction » (vue dédiée) ; si un champ interne sensible était ajouté un jour à `Customer`/
  `Product`/`Supplier` (ex. marge fournisseur, note interne confidentielle), il serait exposé
  par défaut sans revue explicite.
- **Risque** : Faible aujourd'hui, dette de conception qui peut devenir un vrai risque de fuite
  au premier champ sensible ajouté sans discipline DTO.
- **Fichiers** : `apps/api/src/customers/customers.repository.ts`,
  `apps/api/src/suppliers/suppliers.repository.ts`,
  `apps/api/src/products/products.repository.ts`
- **Solution** : Non bloquant à ce stade ; à uniformiser avec le patron déjà en place dans
  Sales/Purchases/Invoicing (vue dédiée) lors d'une prochaine itération sur ces 3 modules.
- **Priorité** : P3
- **Statut** : OUVERT

---

## Synthèse par module

| Module | CRUD+Zod | Permissions | Isolation tenant | Entitlement | Pagination/liste | Transactions/erreurs | Tests |
|---|---|---|---|---|---|---|---|
| Clients | OK | OK | OK (repo + RLS) | OK | OK (bornée) | OK | Substantiels |
| Fournisseurs | OK | OK | OK (repo + RLS) | OK | OK (bornée) | OK | Substantiels |
| Produits | OK | OK | OK (repo + RLS) | OK | OK (bornée) | OK (409 code dupliqué) | Substantiels |
| Stock | OK (append-only) | OK | OK (repo + RLS) | OK | OK (bornée) | OK (Serializable+409), pas d'idempotence, pas de test concurrence | Substantiels |
| Ventes | OK (cycle réduit) | OK | OK (repo + RLS) | OK | OK (bornée) | OK, pas d'idempotence, pas de retour post-confirmation | Substantiels |
| Achats | OK (cycle réduit, pas de réception) | OK | OK (repo + RLS) | OK | OK (bornée) | OK, pas d'idempotence | Substantiels |
| Facturation | OK (pas de paiement partiel/avoir) | OK | OK (repo + RLS) | OK | OK (bornée) | Numérotation atomique OK, pas d'idempotence | Substantiels |

Aucun module n'est « production-ready » sans lever au moins AUDIT-001 (idempotence) et statuer
explicitement (ADR) sur AUDIT-002/003/004 avec `architect`, dont les périmètres fonctionnels
réduits doivent être une décision assumée et documentée, pas un silence de commit.
