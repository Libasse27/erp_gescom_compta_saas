# 0014 — Stockage local et résolution de conflits hors-ligne (Phase 9.3)

## Statut
Tranché — 2026-08-11

## Contexte
`docs/adr/0012-stack-mobile.md` (Phase 9.0) avait déjà tranché le principe de
l'offline-first mobile — `@react-native-community/netinfo` pour l'état
réseau, TanStack Query comme couche d'état serveur, une file de mutations en
attente rejouée au retour réseau, purge complète au logout/changement de
tenant — mais avait explicitement reporté à cette phase deux décisions : le
moteur de stockage local exact, et la politique de résolution de conflits,
« vu l'impact sur des données financières ».

À ce stade (Phase 9.3), aucun écran ERP n'existe encore côté mobile
(clients/produits/ventes = Phase 9.4). Cette phase construit donc
l'infrastructure réutilisable — détection réseau, cache de lecture
persistant, file de mutations rejouable — sur laquelle la Phase 9.4 câblera
les vrais écrans.

Constats qui contraignent la conception (audit du modèle de domaine ERP,
`packages/types`, `apps/api/prisma/schema.prisma`) :
- Aucune entité ERP n'a de champ `version`/`revision` — pas de mécanisme de
  concurrence optimiste existant côté serveur.
- Aucun contrôleur API n'accepte d'`id` fourni par le client à la création —
  Prisma génère toujours l'UUID côté serveur.
- Le seul mécanisme d'idempotence existant dans tout le dépôt est celui des
  webhooks de paiement (Phase 5), keyé sur une contrainte unique
  `(provider, providerReference)` — un mécanisme serveur-serveur, pas un
  motif d'idempotence côté client réutilisable ici.

## Décision

**Stockage : `expo-sqlite`.** Relationnel, adapté à la forme naturelle
d'une file de mutations (lignes avec statut/compteur de tentatives/erreur,
interrogeables), et capable de porter à la fois le cache de lecture et la
file de mutations dans un seul store — pas de deuxième dépendance de
stockage. Préféré à MMKV (clé-valeur, aurait exigé un client de
développement personnalisé sous Expo managed) et à AsyncStorage (le plus
simple, mais le moins adapté à des requêtes sur la file — un pur magasin
clé-valeur async, JSON.parse à chaque lecture).

**Conflits : dernier-écrit-gagne, aucun changement backend dans cette
phase.** Les mutations en file rejouent comme des appels API normaux au
retour réseau ; le serveur reste seul juge de l'état final ; aucun ID n'est
généré côté client pour un enregistrement créé hors-ligne. La concurrence
optimiste réelle (champ `version`, en-tête `If-Match`) est explicitement
reportée à la Phase 9.4, une fois de vraies mutations ERP existantes pour
informer quelles ressources en ont réellement besoin — l'ajouter maintenant
serait un changement de contrat d'API public cross-cutting (CLAUDE.md §3),
bien au-delà du périmètre d'une phase d'infrastructure mobile.

**Purge : une seule base SQLite, vidée au logout/expiration de session — pas
un fichier par tenant.** L'identité du tenant n'est connue qu'*après* succès
du login (`GET /auth/me`) ; un schéma par fichier ne pourrait même pas
choisir le bon fichier au démarrage avant le flux de restauration de session
qui décide justement s'il y a une session active.
`LoginScreen`/`MfaVerifyScreen` (`apps/mobile/src/navigation/types.ts`) sont
atteignables, dans `src/lib/auth-context.tsx`, via un logout explicite, un
échec de refresh silencieux, **ou un cold start sans jeton stocké** — les
trois branches purgent désormais (la troisième ne purgeait pas dans la
première version de cette phase ; corrigé par la revue sécurité, voir
ci-dessous). La purge est donc la frontière tenant ; un second fichier
n'ajouterait que de la gestion de fichiers orphelins sans gain de sécurité
supplémentaire une fois cette frontière effectivement complète.

**Pas de mécanisme de mutations différées intégré à TanStack Query.**
TanStack Query propose son propre système de pause/reprise des mutations
(`networkMode`, `resumePausedMutations`), mais il exige de pré-enregistrer
`setMutationDefaults` pour chaque forme de mutation (aucune n'existe encore
côté mobile), et son format persisté interne n'est pas directement
inspectable en SQL — un problème concret vu la sensibilité des données
financières à venir. TanStack Query sert donc uniquement au **cache de
lecture** (`onlineManager` + persister maison) ; les **mutations** passent
par une file SQLite écrite à la main, adossée à `apiFetch`
(`apps/mobile/src/lib/api.ts`) déjà existant — deux mécanismes simples et
indépendants plutôt qu'un seul mécanisme complexe et peu observable.

**Pas d'écran de démonstration committé.** Un écran de démo prouverait un
comportement natif réel (persistance SQLite après kill de l'app, événements
NetInfo réels) qu'aucun test unitaire ne peut garantir, mais : (1) le câbler
sur un vrai endpoint mutable exigerait de toucher `apps/api` (nouvel
endpoint, sa propre couverture `test:tenant`), hors périmètre d'une phase
d'infrastructure mobile ; (2) un écran accessible depuis `HomeScreen` dans
une phase dont le périmètre exclut explicitement les écrans ERP est une
tension directe, et du code « temporaire » committé a un piètre historique de
suppression effective. À la place, une procédure de QA manuelle (annexe
ci-dessous), exécutée une fois pendant l'implémentation et non committée.

## Écarté
- **Fichiers SQLite par tenant** — cf. justification ci-dessus.
- **Mécanisme de mutations différées intégré à TanStack Query** — format
  persisté peu inspectable, exige un enregistrement préalable par forme de
  mutation inexistante à ce stade.
- **MMKV** — clé-valeur, pas de requêtes relationnelles pour la file de
  mutations, nécessite un client de développement personnalisé sous Expo
  managed workflow.
- **AsyncStorage** — le plus simple mais le moins adapté : magasin clé-valeur
  purement async, aucune requête sur la file de mutations.
- **Concurrence optimiste (champ `version`) dès cette phase** — changement de
  contrat d'API public cross-cutting, à trancher une fois de vraies
  mutations ERP existantes (Phase 9.4).
- **Écran de démonstration committé** — cf. justification ci-dessus.

## Revue sécurité (Phase 9.3)

Revue par l'agent `security` avant clôture du cycle (CLAUDE.md §3, fichiers
touchant l'authentification). Un finding ÉLEVÉ, corrigé avant de considérer
la phase terminée :

- **Chemin de démarrage sans purge** : la branche « aucun refresh token
  stocké » de `restoreSession()` menait à `LoginScreen` sans appeler
  `purgeOfflineStore()` — le seul chemin de code qui contredisait
  l'affirmation initiale de cet ADR. Combiné à l'ordre `clearStoredRefreshToken()`
  puis `purgeOfflineStore()` dans `logout()`, un kill de l'app entre les deux
  pouvait laisser une file de mutations d'un tenant A rejouée avec le jeton
  d'un tenant B connecté ensuite sur le même appareil. Corrigé : purge
  inconditionnelle sur cette branche (qui devient le filet de rattrapage
  pour toutes les autres), et purge déplacée avant l'effacement du jeton
  dans les trois autres branches. Test de régression :
  `auth-context.spec.ts` — « purge le cache hors-ligne au démarrage quand
  aucun jeton n'est stocké ».
- **Course entre la purge et la persistance automatique** (MOYEN) :
  `persistQueryClient` réagit à chaque changement du cache sans throttle et
  pouvait ré-écrire des données sur disque juste après le `DELETE` de la
  purge, si un écran encore monté observait une requête au même instant.
  Corrigé : `query-client.ts` conserve désormais la fonction d'arrêt
  retournée par `persistQueryClient` ; `purgeOfflineStore()` suspend la
  persistance le temps de la purge puis la relance.
- **Jeton expiré traité comme un rejet métier** (MOYEN) : un `401` en cours
  de rejeu tombait dans le même panier que les 4xx métier (400/403/404/409/422)
  et marquait la mutation en échec terminal définitif, alors qu'il s'agit
  d'un access token expiré (15 min), pas d'un rejet de la mutation
  elle-même. Corrigé : branche dédiée, remise en `pending` sans incrémenter
  `retryCount`, arrêt de la file.
- **Aucun garde-fou structurel sur le chemin d'une mutation** (FAIBLE) :
  `enqueueMutation` accepte désormais uniquement un chemin relatif, sans
  schéma/hôte, sans `..` ni double slash — posé maintenant, avant que la
  Phase 9.4 n'ouvre des sites d'appel réels, plutôt qu'après coup.
- **Purge non résiliente à un échec partiel** (MOYEN) : `purgeOfflineStore()`
  tente désormais `removeClient()` et `purgeTenantScoped()` via
  `Promise.allSettled` (un échec sur l'un n'empêche plus la tentative de
  l'autre) et remonte un échec agrégé à l'appelant plutôt que de le masquer.

Décisions explicitement **reportées, à trancher avant que la Phase 9.4 ne
câble la première requête/mutation ERP réelle** (aucune n'est un défaut de
ce cycle, faute de données ERP réelles à protéger aujourd'hui) :

- **Chiffrement au repos** : `erp-offline.db` est en clair, alors que le
  refresh token (`expo-secure-store`, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`) est
  exclu des sauvegardes iCloud/iTunes. Le cache métier, une fois peuplé de
  données ERP réelles, vivrait par défaut dans un répertoire **inclus** dans
  ces sauvegardes, et `app.json` ne définit aucune règle d'exclusion. À
  trancher : exclusion des sauvegardes (coût quasi nul, à faire dans tous
  les cas), chiffrement applicatif du blob, ou SQLCipher (hors managed
  workflow). Décision à documenter dans un ADR dédié, avec la classification
  des données réellement mises en cache.
- **Liste blanche de ce qui est persisté** : `persistQueryClient` n'utilise
  pas `dehydrateOptions.shouldDehydrateQuery` — sans allow-list, toute query
  réussie ira sur disque, y compris une query qui contiendrait par accident
  un jeton. Plus sûr de poser la liste maintenant, tant qu'elle est vide,
  qu'après coup.
- **Clé d'idempotence sur les mutations rejouées** : une requête traitée par
  le serveur dont la réponse est perdue (timeout 15 s d'`apiFetch`) est
  remise en pending puis rejouée à l'identique — double soumission possible.
  Distinct de la politique dernier-écrit-gagne (qui concerne les conflits de
  lecture, pas les doublons d'écriture). Bloquant pour toute mutation
  financière (paiement, écriture comptable) : clé d'idempotence générée à
  l'enqueue, envoyée en en-tête, déduplication côté API à ajouter.
- **Perte silencieuse des mutations `'tenant'` au logout** : `purgeOfflineStore()`
  supprime les mutations en attente non encore envoyées. Défendable ce cycle
  (purger est le comportement sûr, aucune mutation réelle n'existe) ; pour
  9.4, à trancher entre avertir l'utilisateur si des mutations sont en
  attente au logout, ou stamper les mutations par utilisateur et ne les
  rejouer qu'au retour du même compte.
- **Cache restauré sans lien avec l'identité de session** : la restauration
  du cache disque (au chargement du module, avant tout flux d'auth) ne porte
  aucune identité utilisateur/tenant au-delà du `buster` de version de
  schéma. Défense en profondeur à ajouter en 9.4 par-dessus la purge
  (ceinture et bretelles), pas un remplacement de la purge.

## Conséquences
- La Phase 9.4 (écrans ERP mobiles) appelle `enqueueMutation` de
  `apps/mobile/src/lib/offline` sur échec d'écriture et `useQuery` contre le
  `queryClient` partagé — aucune nouvelle infrastructure de cache/file à
  construire.
- La colonne `scope` de `mutation_queue` (`'tenant' | 'auth'`) est réservée
  mais le rejeu de la révocation `/auth/logout` en cas d'échec réseau au
  logout (`scope='auth'`) n'est **pas câblé** dans ce cycle — cas mineur,
  rien de vérifiable sans écran ERP réel pour l'exercer. Reporté sans
  migration de schéma nécessaire le jour où il sera câblé.
- `db.ts` (le SQL réel, `expo-sqlite`) n'est **pas couvert par la CI** —
  jest-expo n'a pas de mock intégré pour son API JSI, et un faux moteur SQL
  maison risquerait de diverger du comportement réel. `db.ts` reste
  volontairement fin (câblage seul, aucune logique métier) ; tout le reste du
  module passe par sa frontière typée et est testé en isolant `./db` par un
  mock explicite (pas d'automock — voir note dans les fichiers `*.spec.ts`,
  un automock introspecte le module réel et déclencherait quand même l'appel
  natif). Le comportement réel de `db.ts` est couvert par la procédure de QA
  manuelle ci-dessous plutôt que par la CI (CLAUDE.md §4 : déclaré
  explicitement plutôt que passé sous silence).

## Annexe — Procédure de QA manuelle (exécutée une fois, non committée)

Objectif : vérifier que le comportement natif réel (non testable en CI, voir
ci-dessus) correspond au design.

1. Ajouter temporairement un bouton scratch dans `HomeScreen` appelant
   `enqueueMutation({ method: "POST", path: "/__scratch-404", body: {} })`.
2. Lancer l'app (`pnpm --filter @erp/mobile start`), se connecter.
3. Activer le mode avion. Appuyer sur le bouton scratch. Observer dans les
   logs réseau (Metro/Flipper) qu'aucune requête ne part.
4. Vérifier que la ligne apparaît dans `mutation_queue` (via un `console.log`
   temporaire de `listMutations()`, ou un inspecteur SQLite).
5. Désactiver le mode avion. Observer que la requête part automatiquement
   (déclenchée par `useSyncEngine`) sans action utilisateur.
6. Se déconnecter puis se reconnecter (ou tuer l'app et la relancer) :
   vérifier que la ligne restante (le cas échéant) est toujours rejouée ou a
   bien été purgée selon le scénario.
7. Retirer le bouton scratch avant de committer.

**Non exécutée dans ce cycle** : l'implémentation a été réalisée et vérifiée
par tests unitaires (`pnpm --filter @erp/mobile test`) et par les
vérifications standard (typecheck/lint/build), mais sans accès à un
simulateur/appareil physique dans cet environnement. Cette procédure doit
être exécutée manuellement avant la mise en production de cette
fonctionnalité, et son résultat consigné dans la description de la PR
correspondante (CLAUDE.md §4 : ne pas prétendre qu'un critère est vérifié
s'il ne l'a pas été).
