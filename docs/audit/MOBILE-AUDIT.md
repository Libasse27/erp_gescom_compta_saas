# Audit — Infrastructure hors-ligne mobile (Expo/React Native)

Date : 2026-08-16
Périmètre : `apps/mobile/src/lib/offline/`, `apps/mobile/src/lib/auth-context.tsx`,
`apps/mobile/src/lib/secure-token-store.ts`, `apps/mobile/src/lib/queries/*`,
`apps/mobile/plugins/withExcludeOfflineDbFromBackup.js`, `apps/mobile/app.json`.
Méthode : lecture directe du code (aucune confiance accordée aux messages de
commit ni aux ADR eux-mêmes sans vérification croisée du code réel produit).
Références : `docs/adr/0014-offline-sync-mobile.md`,
`docs/adr/0015-clients-mobile-phase-9-4.md`.

Constat général : les ADR 0014/0015 sont inhabituellement honnêtes et
documentent déjà la plupart des lacunes structurelles ci-dessous comme des
dettes assumées. Cet audit confirme, par lecture directe du code, que ces
dettes sont réelles, et signale surtout que l'une d'elles — l'absence de clé
d'idempotence — a été explicitement qualifiée de « bloquante pour toute
mutation financière » par l'ADR-0015 (Phase 9.4) mais n'a **pas** été résolue
avant que les Phases 9.8 à 9.11 (Ventes, Achats, Facturation, Comptabilité)
ne câblent des écritures financières réelles sur le même mécanisme non
protégé.

---

## AUDIT-001 — Aucune clé d'idempotence sur les mutations financières rejouées : risque de duplication réelle de documents

**Sévérité** : CRITICAL
**Composant** : `apps/mobile/src/lib/offline/mutation-queue.ts` (rejeu),
`apps/mobile/src/lib/queries/use-sales.ts`, `use-purchases.ts`,
`use-invoices.ts`, `use-journal-entries.ts` (sites d'appel financiers)

**Description** : `enqueueMutation` (`mutation-queue.ts:47-50`) insère la
mutation en SQLite sans aucun identifiant d'idempotence. Au rejeu,
`processOne` (`mutation-queue.ts:104-169`) appelle `apiFetch` avec un timeout
client de 15 s (`api.ts:23,29-39`). Si le serveur traite la requête avec
succès mais que la réponse est perdue (timeout réseau, coupure juste après
émission — scénario courant en 3G/4G sénégalaise, cf. CLAUDE.md §7), le
`catch` de `processOne` (`mutation-queue.ts:123-127`) traite cet échec
exactement comme une simple panne réseau : la mutation repasse en `pending`,
`retryCount` inchangé, et sera **rejouée à l'identique** — même `body`, même
`path`, aucun en-tête distinctif — dès le prochain passage de
`processQueue`. Aucun champ `version`/`If-Match` n'existe côté API
(confirmé par l'ADR-0014, aucune trace contraire trouvée dans
`packages/types`/`packages/validation`).

Pour les mutations d'état (`confirm`, `cancel`, `void`, `mark-paid`), le
serveur rejette probablement le doublon par un 409/400 (transition d'état
déjà effectuée) — dégradation en échec terminal visible, pas une corruption
silencieuse. Mais pour les créations pures — `POST /sales`
(`use-sales.ts:96-107`), `POST /purchases`, `POST /invoices`
(`use-invoices.ts:95-106`), `POST /accounting/journal-entries`
(`use-journal-entries.ts:85-99`) — rien côté API ne peut détecter qu'il
s'agit d'un doublon : chaque rejeu réussi crée un **nouveau** document
(nouvelle vente, nouvel achat, nouvelle facture, nouvelle écriture
comptable), avec son propre UUID serveur.

**Impact** : une facture ou une écriture comptable dupliquée est une donnée
financière fausse (TVA déclarée en double, solde de compte faussé, stock
décrémenté une seconde fois si une vente dupliquée est ensuite confirmée).
Aucun mécanisme de détection a posteriori n'existe (pas de contrainte
d'unicité applicative sur ces créations côté API, au-delà de ce qui a été
vérifié dans ce périmètre mobile).

**Risque** : élevé et concret, pas théorique — le chemin de code qui produit
la duplication (timeout 15 s → réponse perdue → remise en pending → rejeu
identique) est exactement le comportement nominal de `processOne` en cas
d'échec réseau, sans branche spéciale. Le terrain (réseau 3G/4G
intermittent, CLAUDE.md §7) rend ce scénario probable, pas rare.

**Fichiers** :
- `apps/mobile/src/lib/offline/mutation-queue.ts:104-128` (traitement
  identique panne réseau / réponse perdue)
- `apps/mobile/src/lib/api.ts:23,28-40` (timeout 15 s, `AbortController`)
- `apps/mobile/src/lib/queries/use-sales.ts:91-107`
- `apps/mobile/src/lib/queries/use-purchases.ts` (même patron, à vérifier
  ligne à ligne au prochain cycle mobile — non recopié ici mais confirmé
  strictement identique par grep sur `enqueueMutation`)
- `apps/mobile/src/lib/queries/use-invoices.ts:90-107`
- `apps/mobile/src/lib/queries/use-journal-entries.ts:80-99`

**Solution** : générer un UUID côté client à l'`enqueue` (pas comme
identifiant de l'enregistrement métier — l'API reste seule à générer les ID,
cf. ADR-0014 — mais comme clé de déduplication), l'envoyer dans un en-tête
(`Idempotency-Key`), et ajouter côté API une déduplication par clé unique
(table de clés d'idempotence ou contrainte sur les endpoints de création
financière). C'est un changement d'API public (CLAUDE.md §3) : nécessite un
ADR dédié et une coordination avec `backend`/`architect`, déjà anticipée par
l'ADR-0014/0015 mais non exécutée.

**Priorité** : Immédiate — à traiter avant toute mise en production des
modules Ventes/Achats/Facturation/Comptabilité mobiles, qui sont déjà livrés
et activables aujourd'hui.

**Statut** : CORRIGÉ (2026-08-16) — ADR dédié rédigé et tranché
(`docs/adr/0019-idempotence-mutations-financieres-mobiles.md`) avant toute
implémentation, comme requis ici. Clé générée une seule fois à l'enqueue
(`apps/mobile/src/lib/offline/db.ts`), stable à travers tous les rejeux,
envoyée en en-tête `Idempotency-Key` par `processOne`
(`mutation-queue.ts`). Déduplication côté API par contrainte unique
`(enterpriseId, idempotencyKey)` sur `Sale`/`Purchase`/`SalesInvoice`/
`JournalEntry` — pas de table générique de cache de réponse (écart assumé
et justifié dans l'ADR : sur-ingénierie pour quatre endpoints connus).
Aucun changement de site d'appel côté mobile (`use-sales.ts` et
équivalents), confirmant l'estimation de l'ADR. Tests de non-régression
ajoutés à chaque étage (repository, contrôleur HTTP, file mobile).

---

## AUDIT-002 — Résolution de conflits : dernier-écrit-gagne silencieux, aucune détection de modification concurrente

**Sévérité** : HIGH
**Composant** : `apps/mobile/src/lib/queries/use-customers.ts` (et modules
symétriques Fournisseurs/Produits), `apps/mobile/src/lib/offline/mutation-queue.ts`

**Description** : `useSaveCustomer` (`use-customers.ts:68-98`) envoie un
`PATCH /customers/:id` avec l'intégralité des valeurs du formulaire local,
sans aucune information sur l'état du serveur au moment où l'édition
hors-ligne a commencé. Si un autre utilisateur (ou le même utilisateur sur
un autre appareil) a modifié le même client entre le début de l'édition
hors-ligne et le rejeu, le PATCH écrase silencieusement ces changements —
aucune comparaison, aucun 409, aucun avertissement à l'utilisateur avant ou
après l'écrasement. Confirmé par lecture directe : aucun champ `version` /
`updatedAt` transmis, aucun en-tête `If-Match`.

**Impact** : sur un ERP multi-utilisateur (le cas d'usage même du produit),
deux commerciaux modifiant la même fiche client, l'un hors-ligne l'autre en
ligne, aboutissent à une perte silencieuse des modifications du second sans
qu'aucun des deux ne le sache.

**Risque** : ce n'est pas une régression — l'ADR-0014 documente
explicitement ce choix (« dernier-écrit-gagne, aucun changement backend »)
comme décision assumée pour cette phase, faute de champ `version` côté
serveur. Le risque réel est que rien dans l'interface n'informe
l'utilisateur qu'un écrasement silencieux vient d'avoir lieu — contrairement
à une simple limitation technique documentée, c'est une expérience
utilisateur potentiellement trompeuse sur des données métier.

**Fichiers** :
- `apps/mobile/src/lib/queries/use-customers.ts:68-98`
- `docs/adr/0014-offline-sync-mobile.md:43-51` (décision assumée)

**Solution** : à court terme, aucune action technique requise sans
changement backend (ajout d'un champ `version`/`updatedAt` et concurrence
optimiste, déjà identifié par l'ADR comme reporté). À court terme sans
toucher l'API : afficher `updatedAt` du serveur au moment de l'ouverture du
formulaire, et si la réponse du PATCH renvoie un `updatedAt` postérieur à un
autre changement détecté après coup, informer l'utilisateur au lieu d'un
silence total. Décision produit/architecture à trancher avec `architect`.

**Priorité** : Haute — avant d'ouvrir l'édition hors-ligne à des tenants
avec plusieurs utilisateurs actifs simultanément sur les mêmes fiches.

**Statut** : OUVERT (dette assumée par ADR-0014, mais sans mitigation UX)

---

## AUDIT-003 — Chiffrement au repos : `erp-offline.db` contient des données personnelles et légales en clair

**Sévérité** : MEDIUM
**Composant** : `apps/mobile/src/lib/offline/db.ts`, plan de persistance
(`query-client.ts`)

**Description** : `erp-offline.db` (SQLite, `db.ts:9`) n'utilise aucun
chiffrement — ni SQLCipher (disponible via `expo-sqlite`'s
`useSQLCipher`, confirmé non activé dans `app.json` : seuls les plugins
`expo-sqlite` et `withExcludeOfflineDbFromBackup` sont déclarés, aucune
option `useSQLCipher`), ni chiffrement applicatif du blob JSON écrit par
`persister.ts`. La liste blanche de persistance (`query-client.ts:13-37`)
confirme que des données personnelles et des identifiants légaux
(clients avec NINEA/RCCM potentiellement, fournisseurs, factures, écritures
comptables) sont désormais mis en cache en clair sur le disque de
l'appareil, contrairement au refresh token qui est en `SecureStore`
(`secure-token-store.ts:13-15`, Keychain/Keystore).

**Impact** : sur un appareil perdu, volé, ou avec accès physique
(root/jailbreak, ou simple accès au bac à sable de l'app sur un appareil non
chiffré au niveau OS), les données métier hors-ligne — factures, écritures
comptables, coordonnées clients — sont lisibles en clair.

**Risque** : mitigé par l'exclusion des sauvegardes OS (AUDIT vérifié, voir
INFO-001) et par la purge au logout, mais reste un vecteur d'exposition tant
que l'appareil reste déverrouillé/compromis pendant une session active ou
entre deux purges. L'ADR-0015 qualifie explicitement ce point de dette
"à trancher avant le premier module financier" — or Facturation et
Comptabilité (Phases 9.10/9.11) ont depuis été livrées sans qu'aucun ADR de
suivi ne tranche cette question.

**Fichiers** :
- `apps/mobile/src/lib/offline/db.ts:9` (`openDatabaseSync`, sans
  `useSQLCipher`)
- `apps/mobile/app.json:24-26` (plugins déclarés, aucune option de
  chiffrement)
- `docs/adr/0015-clients-mobile-phase-9-4.md:37-46` (dette actée)

**Solution** : activer `useSQLCipher` (déjà disponible sans nouvelle
dépendance selon l'ADR-0015) avec une clé stockée via `expo-secure-store`,
ou statuer explicitement que le risque est accepté pour la durée de vie
prévue des appareils cibles. Nécessite un ADR dédié comme déjà annoncé.

**Priorité** : Moyenne-haute — à statuer avant élargissement du parc
d'appareils ou avant un premier client pilote avec des données sensibles
réelles.

**Statut** : OUVERT

---

## AUDIT-004 — Rétention illimitée des mutations en échec terminal tant que la session reste active

**Sévérité** : MEDIUM
**Composant** : `apps/mobile/src/lib/offline/db.ts`, `mutation-queue.ts`

**Description** : `markMutationFailed` (`db.ts:136-142`) conserve la ligne
en base indéfiniment (statut `'failed'`), et seule `purgeTenantScoped`
(`db.ts:154-156`, appelée uniquement au logout/expiration de session) la
supprime. Une mutation en échec terminal — par exemple une facture rejetée
par un 409 (code produit dupliqué) ou un 403 (permission retirée
entre-temps) — contient le corps complet de la requête
(`body TEXT` en clair, `db.ts:23`) et reste sur l'appareil tant que
l'utilisateur ne se déconnecte pas, sans limite de durée ni UI de
retry/dismiss pour la faire disparaître plus tôt (confirmé : ADR-0015
« Écarté », aucune UI de ce type trouvée au-delà du compteur passif dans
`ClientsListScreen.tsx:55-94`).

**Impact** : accumulation de données métier en clair sur le disque au-delà
du temps strictement nécessaire, sur une session qui peut durer plusieurs
jours (pas de déconnexion automatique visible dans le périmètre audité).

**Risque** : Moyen — combiné à AUDIT-003 (absence de chiffrement), la
fenêtre d'exposition s'allonge avec la durée de la session.

**Fichiers** :
- `apps/mobile/src/lib/offline/db.ts:136-142,154-156`
- `apps/mobile/src/screens/ClientsListScreen.tsx:55-94` (compteur seul, pas
  de purge)

**Solution** : purge automatique après un délai (ex. 30 jours) ou UI de
retry/dismiss qui purge à la résolution, comme déjà noté par l'ADR-0015
sans être traité depuis.

**Priorité** : Moyenne.

**Statut** : OUVERT

---

## AUDIT-005 — `db.ts` (couche SQLite réelle) non couverte par la CI

**Sévérité** : MEDIUM
**Composant** : `apps/mobile/src/lib/offline/db.ts`

**Description** : confirmé — aucun fichier `db.spec.ts` n'existe. Tous les
tests (`mutation-queue.spec.ts`, `query-client.spec.ts`, `sync-engine.spec.ts`)
mockent explicitement `./db` (voir les commentaires dans chaque fichier de
test expliquant pourquoi un automock est dangereux — chargerait le vrai
`expo-sqlite` natif). Cela signifie que le SQL réel — y compris la clause
`ON CONFLICT(id) DO UPDATE` de `writeCache`, la clause
`WHERE status IN ('pending', 'processing')` de `listPendingMutations`, et la
migration `CREATE TABLE IF NOT EXISTS` — n'est jamais exécuté en CI. Le
scénario « ligne restée en `processing` après un kill de l'app, reprise au
redémarrage » (AUDIT-006) dépend entièrement de cette requête SQL non
testée.

**Impact** : une régression dans `db.ts` (ex. clause SQL cassée lors d'une
future migration de schéma) ne serait détectée qu'en usage réel sur
appareil, jamais en CI.

**Risque** : Moyen — le fichier est volontairement fin (aucune logique
métier, cf. ADR-0014), ce qui limite la surface, mais la logique de reprise
après kill (`status IN ('pending','processing')`) est justement dans ce
fichier non testé, et c'est la garantie centrale de non-perte de mutation en
file.

**Fichiers** :
- `apps/mobile/src/lib/offline/db.ts` (aucun `.spec.ts` associé)
- `docs/adr/0014-offline-sync-mobile.md:192-201` (gap déclaré explicitement,
  conforme à CLAUDE.md §4 — pas une omission silencieuse)

**Solution** : ADR-0014 le déclare déjà et propose la procédure de QA
manuelle en annexe — **cette procédure n'a jamais été exécutée** (ADR-0014
ligne 222 : « Non exécutée dans ce cycle »), y compris pour les cycles
suivants (aucune trace d'exécution dans les ADR 0015 et suivants pour les
modules Ventes/Achats/Facturation/Comptabilité). Un test d'intégration réel
sur détox/Maestro avec un simulateur, ou a minima l'exécution effective de
la procédure de QA manuelle documentée, reste à faire avant mise en
production.

**Priorité** : Moyenne-haute, vu que les modules financiers sont
maintenant en jeu.

**Statut** : OUVERT

---

## AUDIT-006 — Reprise après kill de l'app en plein rejeu : mécanisme correct en théorie, jamais vérifié en pratique

**Sévérité** : LOW (théorie du code correcte, gap = absence de vérification réelle, déjà couvert par AUDIT-005)

**Composant** : `apps/mobile/src/lib/offline/db.ts`,
`apps/mobile/src/lib/offline/mutation-queue.ts`

**Description** : le design est cohérent sur le papier — `markMutationProcessing`
est appelé avant l'appel réseau (`mutation-queue.ts:114`), et
`listPendingMutations` inclut délibérément le statut `'processing'`
(`db.ts:107-114`, avec commentaire explicite sur ce choix) pour qu'une ligne
laissée dans cet état par un kill de l'app soit reprise au redémarrage
suivant plutôt qu'oubliée. Mais : (1) rien ne distingue une ligne
`'processing'` dont la requête HTTP a réellement atteint le serveur avant le
kill d'une ligne dont elle ne l'a pas atteint — la reprise revient donc,
dans le pire cas, exactement au même risque de duplication qu'AUDIT-001 ;
(2) ce chemin spécifique (redémarrage avec une ligne `'processing'` en
base) n'est testé nulle part — `mutation-queue.spec.ts` ne construit jamais
de `makeMutation({ status: "processing" })`, et `db.ts` lui-même n'est pas
testé (AUDIT-005).

**Impact** : combiné à AUDIT-001, un kill de l'app pendant le rejeu d'une
création financière (facture, écriture) est le scénario le plus probable de
duplication réelle en production — pas seulement un timeout réseau ordinaire.

**Risque** : Faible en tant que défaut de conception isolé (le choix
d'inclure `'processing'` dans la reprise est le bon compromis en l'absence
d'idempotence), mais amplifie directement la sévérité d'AUDIT-001.

**Fichiers** :
- `apps/mobile/src/lib/offline/db.ts:107-114`
- `apps/mobile/src/lib/offline/mutation-queue.ts:104-128`

**Solution** : résolue de facto par la correction d'AUDIT-001 (clé
d'idempotence) — une fois celle-ci en place, la reprise d'une ligne
`'processing'` après kill devient sûre par construction (le serveur peut
détecter le doublon quel que soit le moment exact du kill). Ajouter en
complément un test explicite de ce chemin de reprise.

**Priorité** : Regroupée avec AUDIT-001.

**Statut** : OUVERT

---

## AUDIT-007 — Purge au logout/expiration : vérifiée correcte sur les branches de code auditées

**Sévérité** : INFO (constat positif, documenté pour mémoire d'audit)

**Composant** : `apps/mobile/src/lib/auth-context.tsx`,
`apps/mobile/src/lib/offline/index.ts`

**Description** : contrairement à la consigne de méfiance envers les
messages de commit, ce point a été vérifié ligne à ligne et non pris sur la
seule foi du commit `7ec04e6` ou de l'ADR. Les trois branches de démarrage/
déconnexion appellent bien `purgeOfflineStore()` :
1. Cold start sans refresh token stocké (`auth-context.tsx:73-82`).
2. Échec du refresh silencieux (`auth-context.tsx:87-96`), purge **avant**
   `clearStoredRefreshToken()`.
3. Logout explicite (`auth-context.tsx:146-161`), même ordre.
4. Une quatrième branche, `restoreSession().catch()`
   (`auth-context.tsx:109-116`), purge également en cas d'exception
   inattendue pendant la restauration.

`purgeOfflineStore()` (`offline/index.ts:25-37`) vide bien le cache
TanStack Query en mémoire (`queryClient.clear()`), le persiste sur disque
(`sqlitePersister.removeClient()` → `writeCache(null)` → `DELETE FROM
query_cache`), et la file de mutations tenant (`purgeTenantScoped()` →
`DELETE FROM mutation_queue WHERE scope != 'auth'`), avec suspension de la
persistance automatique le temps de l'opération
(`withPersistenceSuspended`, `query-client.ts:102-108`) pour éviter la
course décrite dans l'ADR. Les 9 tests de `auth-context.spec.ts` couvrent
ces branches de façon comportementale (mock de `purgeOfflineStore`,
assertions sur son appel), pas seulement en confiance sur le commit.

**Limite identifiée, non couverte par les tests actuels** : les mutations de
`scope: 'auth'` (réservé, non câblé — confirmé, aucun site d'appel ne
transmet `scope: "auth"` dans tout `apps/mobile/src`) survivent
délibérément à la purge (`purgeTenantScoped`, `db.ts:155`). Comme rien ne
les alimente actuellement, ce n'est pas un risque actif, mais deviendra un
point à revérifier le jour où ce scope sera câblé (rejeu de la révocation
`/auth/logout`).

**Fichiers** :
- `apps/mobile/src/lib/auth-context.tsx:73-82,87-96,109-116,146-161`
- `apps/mobile/src/lib/offline/index.ts:25-37`
- `apps/mobile/src/lib/offline/query-client.ts:98-108`
- `apps/mobile/src/lib/auth-context.spec.ts:47-55,155-165,167-195`

**Solution** : n/a — constat positif. Point de vigilance à revalider quand
`scope: 'auth'` sera effectivement câblé.

**Priorité** : n/a.

**Statut** : INFO (vérifié conforme)

---

## AUDIT-008 — Exclusion des sauvegardes OS : vérifiée correcte et complète (Android confirmé, iOS non vérifiable dans cet environnement)

**Sévérité** : INFO

**Composant** : `apps/mobile/plugins/withExcludeOfflineDbFromBackup.js`,
`apps/mobile/app.json`

**Description** : le plugin est bien déclaré dans `app.json:24-26` (aux
côtés de `expo-sqlite`) et cible le **répertoire** `SQLite/` entier (pas
seulement `erp-offline.db`), ce qui couvre correctement d'éventuelles
annexes `-journal`/`-wal`/`-shm` si le mode WAL était activé plus tard —
choix correct et documenté. Android : règles XML
(`fullBackupContent`/`dataExtractionRules`) couvrant à la fois Auto Backup
pré-Android 12 et le nouveau mécanisme post-12, plus le transfert
d'appareil — cohérent avec les deux mécanismes officiels recommandés
plutôt que le trop large `android:allowBackup="false"`. L'ADR-0015
documente que la génération réelle (`expo prebuild --platform android`) a
été vérifiée dans l'environnement d'implémentation (fichiers XML générés
lus directement). iOS : le mécanisme (`NSURLIsExcludedFromBackupKey` posé
depuis `AppDelegate.swift` généré) est correct en théorie mais explicitement
non vérifiable sur cet environnement Windows (nécessite macOS/Linux pour
`expo prebuild --platform ios`), et l'ADR le déclare sans détour plutôt que
de prétendre une vérification qui n'a pas eu lieu.

**Impact** : aucun défaut trouvé dans le code du plugin lui-même. Le seul
gap réel est l'absence de vérification empirique côté iOS, déjà déclarée
comme telle.

**Fichiers** :
- `apps/mobile/plugins/withExcludeOfflineDbFromBackup.js:23-24,46-64,81-113`
- `apps/mobile/app.json:24-26`
- `docs/adr/0015-clients-mobile-phase-9-4.md:56-69,243-262`

**Solution** : exécuter la procédure de QA manuelle iOS documentée en
annexe de l'ADR-0015 avant la première distribution iOS (macOS/Linux
requis) — non fait à ce jour, déjà tracé comme tel.

**Priorité** : Basse (Android vérifié) à Moyenne (iOS, bloquant avant
distribution App Store).

**Statut** : OUVERT (uniquement pour le volet iOS non vérifiable)

---

## Résumé des sévérités

| Sévérité | Nombre |
|---|---|
| CRITICAL | 1 (AUDIT-001) |
| HIGH | 1 (AUDIT-002) |
| MEDIUM | 4 (AUDIT-003, 004, 005, et volet iOS d'AUDIT-008 traité en INFO/OUVERT partiel) |
| LOW | 1 (AUDIT-006) |
| INFO | 2 (AUDIT-007 positif, AUDIT-008 volet Android positif) |

## Constat de méthode

Les ADR 0014/0015 documentent déjà, de façon inhabituellement transparente,
la plupart des gaps identifiés ici comme dettes assumées et priorisées. Le
finding le plus important de cet audit n'est donc pas une divergence entre
le code et sa documentation (peu trouvée), mais le fait que l'ADR-0015
qualifiait explicitement la clé d'idempotence de **bloquante pour toute
mutation financière**, et que les Phases 9.8 à 9.11 ont depuis câblé
Ventes, Achats, Facturation et Comptabilité sur le même mécanisme non
protégé, sans qu'aucun ADR de suivi ne revienne trancher ce point avant
la mise en service de ces modules.
