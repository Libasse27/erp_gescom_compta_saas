# 0019 — Clé d'idempotence pour les créations financières rejouées depuis la file mobile hors-ligne

## Statut
Proposé — 2026-08-16 (corrige MOBILE AUDIT-001 / ERP-001,
`docs/audit/MOBILE-AUDIT.md`, `docs/audit/ERP-AUDIT.md`)

## Contexte

`docs/adr/0014-offline-sync-mobile.md` (Phase 9.3) avait déjà identifié ce
problème et l'avait explicitement reporté : « Bloquant pour toute mutation
financière (paiement, écriture comptable) : clé d'idempotence générée à
l'enqueue, envoyée en en-tête, déduplication côté API à ajouter. » Les
Phases 9.8 à 9.11 (Ventes, Achats, Facturation, Comptabilité mobiles) ont
depuis câblé des écritures financières réelles sur `enqueueMutation` sans
que cette décision reportée ne soit tranchée.

Mécanisme actuel (`apps/mobile/src/lib/offline/mutation-queue.ts`) : une
mutation en attente est rejouée à l'identique (même `path`, même `body`,
aucun en-tête distinctif) tant qu'elle n'obtient pas une réponse HTTP
exploitable. Si le serveur traite la requête avec succès mais que la
réponse est perdue (timeout client 15 s, coupure réseau juste après
émission — scénario courant en 3G/4G, CLAUDE.md §7), `processOne` remet la
mutation en `pending` exactement comme une panne réseau simple, et la
rejoue au prochain passage. Pour les endpoints de création pure — `POST
/sales`, `POST /purchases`, `POST /invoices`, `POST
/accounting/journal-entries` — rien côté API ne détecte le doublon :
chaque rejeu réussi crée un nouveau document, avec son propre UUID serveur.
Les endpoints de transition d'état (`confirm`, `cancel`, `mark-paid`) sont
hors de ce périmètre : un rejeu y échoue déjà de façon visible (409/400,
transition déjà effectuée), pas de corruption silencieuse.

Contraintes héritées de l'ADR-0014, non renégociées ici :
- Le serveur reste seul générateur d'identifiant — la clé d'idempotence est
  une clé de **déduplication**, jamais un identifiant métier fourni par le
  client.
- Aucun champ `version`/concurrence optimiste n'existe côté serveur — hors
  périmètre, ADR distinct si nécessaire (AUDIT-002).
- Le seul mécanisme d'idempotence déjà présent dans le dépôt est celui des
  webhooks de paiement (Phase 5) : une contrainte unique
  `@@unique([provider, providerReference])` sur `Payment`, vérifiée en
  amont de l'écriture — un précédent direct pour la décision ci-dessous,
  pas un mécanisme générique de cache de réponse.

## Décision

**Contrainte unique par tenant sur chaque modèle de création concerné,
alimentée par un en-tête `Idempotency-Key`** — pas de table générique de
clés d'idempotence avec cache de réponse.

### Côté mobile

- `enqueueMutation`/`insertMutation` (`apps/mobile/src/lib/offline/db.ts`)
  génère un UUID (`crypto.randomUUID()` ou équivalent Expo) **une seule
  fois, à l'insertion en SQLite**, stocké dans une nouvelle colonne
  `idempotency_key` de `mutation_queue`. Généré pour **toutes** les
  mutations en file, pas seulement celles ciblant un endpoint de création
  financière — l'infrastructure reste générique, c'est l'API qui décide
  quels endpoints en tiennent compte.
- `processOne` (`mutation-queue.ts`) ajoute l'en-tête
  `Idempotency-Key: <valeur stockée>` à chaque tentative, y compris les
  rejeux — la clé ne change jamais pour une même ligne de la file.
- **Aucun changement dans les sites d'appel** (`use-sales.ts`,
  `use-purchases.ts`, `use-invoices.ts`, `use-journal-entries.ts`) :
  contrairement à l'estimation initiale de l'audit, la génération de la clé
  est centralisée dans `enqueueMutation`, pas répartie par site d'appel.
  Réduit le risque d'un futur site d'appel financier qui oublierait de la
  fournir.

### Côté API

- Nouvelle colonne `idempotency_key` (nullable) sur `Sale`, `Purchase`,
  `SalesInvoice`, `JournalEntry` — les quatre modèles de création pure
  identifiés par l'audit. Contrainte `@@unique([enterpriseId,
  idempotencyKey])` (index partiel `WHERE idempotency_key IS NOT NULL` :
  une création sans clé, ex. depuis apps/web qui n'a pas ce problème en
  ligne stable, n'est jamais bloquée par des `NULL` répétés).
- Chaque contrôleur de création (`SalesController.create`,
  `PurchasesController.create`, `InvoicingController.create`,
  `JournalController.create`) lit l'en-tête optionnel
  `Idempotency-Key` (`@Headers("idempotency-key")`) et le transmet au
  repository — jamais lu depuis le body, pour ne pas polluer le contrat
  DTO public existant (validé par Zod) avec un concept de transport, pas de
  domaine.
- Chaque `Repository.create()` concerné, dans la même transaction que
  l'insertion :
  1. Si une clé est fournie, `findFirst({ enterpriseId, idempotencyKey })`
     avant toute écriture. Trouvé → retourne l'enregistrement existant tel
     quel (même vue, même statut HTTP 201 côté contrôleur) : un rejeu
     idempotent est indiscernable d'un premier succès pour l'appelant.
  2. Sinon, insertion normale avec la clé posée.
  3. Filet de concurrence (deux rejeux quasi simultanés du même mutation
     hors-ligne, ex. deux onglets/appareils avec la même file — cas rare
     mais possible) : la contrainte unique fait échouer le second `INSERT`
     avec `P2002` ; le repository intercepte ce code, refait le `findFirst`
     et retourne l'enregistrement gagnant plutôt que de propager l'erreur —
     même patron défensif que `JournalRepository.create` avec `INSERT ...
     ON CONFLICT ... RETURNING` pour `journal_entry_counters`.
- Aucun changement pour les endpoints de transition d'état (`confirm`,
  `cancel`, `mark-paid`) : hors périmètre, déjà protégés par leur machine à
  états.

### Écarté

- **Table générique `IdempotencyKey` + interceptor rejouant la réponse
  HTTP en cache** (façon Stripe : capture du corps de réponse, statut
  `IN_PROGRESS`/`COMPLETED`, verrou anti-course générique). Rejeté pour ce
  cycle : sur-ingénierie par rapport aux quatre endpoints réellement
  concernés aujourd'hui (CLAUDE.md §9 « éviter les dépendances/abstractions
  inutiles ») ; exige de définir une politique de mise en cache des
  réponses d'erreur (4xx à mettre en cache pour rejouer la même erreur ?
  5xx à ne jamais mettre en cache ?) qui n'a pas d'équivalent existant dans
  ce dépôt ; le patron par contrainte unique est déjà éprouvé
  (`Payment.@@unique([provider, providerReference])`,
  `journal_entry_counters` via `ON CONFLICT`). Alternative à reconsidérer
  si un cinquième+ endpoint de création financière apparaît et que la
  duplication de logique de déduplication par repository devient réellement
  coûteuse — pas une certitude aujourd'hui avec quatre occurrences.
- **En-tête lu et revalidé par un guard générique
  (`IdempotencyGuard`/décorateur `@Idempotent()`) plutôt que par chaque
  repository** : envisagé, mais un guard n'a pas accès à la transaction
  Prisma du repository (le `findFirst`/`INSERT` doit être atomique avec le
  reste de l'écriture, dans le même `tx`) — aurait exigé soit de sortir la
  vérification de la transaction (réintroduit la fenêtre de course que la
  contrainte unique est censée fermer), soit un contrat de guard non
  standard dans ce dépôt. Le bloc de code (recherche + gestion `P2002`) est
  dupliqué quatre fois plutôt que factorisé pour cette raison ; une
  factorisation en fonction utilitaire pure (sans dépendance à un guard
  NestJS) reste possible côté implémentation si la duplication s'avère
  gênante en revue.
- **Champ `idempotencyKey` dans le DTO/body plutôt qu'en-tête** : rejeté,
  l'audit le demande explicitement en en-tête, et un champ de transport
  n'a pas sa place dans un contrat de domaine validé par Zod
  (`packages/validation`).

## Conséquences

- Changement de contrat d'API public (CLAUDE.md §3) : quatre endpoints
  `POST` acceptent désormais un en-tête optionnel supplémentaire, sans
  breaking change pour les clients existants qui ne l'envoient pas (apps/web
  aujourd'hui — pas de file de mutations hors-ligne côté web, donc pas de
  besoin fonctionnel immédiat, mais rien n'empêche de l'adopter plus tard).
- Quatre migrations Prisma (une colonne + un index unique partiel par
  modèle) — non destructives, colonne nullable, pas de backfill nécessaire.
- `packages/types` : les vues `SaleView`/`PurchaseView`/`SalesInvoiceView`/
  `JournalEntryView` n'exposent pas la clé d'idempotence (détail de
  déduplication, pas une donnée métier) — aucun changement de forme côté
  lecture.
- Tests à ajouter par module concerné (même patron que
  `journal.repository.spec.ts`) : « un deuxième `create()` avec la même
  clé retourne le même enregistrement sans en créer un second » et « deux
  clés différentes créent bien deux enregistrements distincts ».
  `mutation-queue.spec.ts` (mobile) : « la clé générée à l'enqueue est
  stable à travers plusieurs tentatives de rejeu ».
- Implémentation prévue module par module (Ventes, Achats, Facturation,
  Comptabilité) plutôt qu'en un seul commit massif (CLAUDE.md §9,
  incrémental) — chaque module vérifié indépendamment
  (typecheck/lint/test/test:tenant) avant le suivant, puis le câblage
  mobile (colonne SQLite + en-tête) en dernier, une fois les quatre
  endpoints prêts à le recevoir.
