# 0015 — Module Clients mobile (Phase 9.4)

## Statut
Tranché — 2026-08-11

## Contexte

`docs/adr/0014-offline-sync-mobile.md` (Phase 9.3) avait livré
l'infrastructure offline-first (SQLite, cache TanStack Query persistant,
file de mutations rejouable) sans écran ERP réel pour l'exercer, et avait
explicitement reporté à cette phase plusieurs décisions « à trancher avant
que la Phase 9.4 ne câble la première requête/mutation ERP réelle » :
protection au repos du cache, liste blanche de ce qui est persisté, clé
d'idempotence sur les mutations rejouées.

Le module Clients (le CRUD le plus simple côté web — pas de ligne, pas de
cycle de statut) a été choisi pour ce cycle : il prouve le patron écran
mobile (liste/fiche/création/édition + permissions + lecture/écriture
hors-ligne) avant de le répliquer sur les modules suivants.

## Décision

**Protection au repos : plugin de config Expo, stockage persistant
conservé.** `apps/mobile/plugins/withExcludeOfflineDbFromBackup.js` exclut
`erp-offline.db` des sauvegardes iOS (iCloud/iTunes, via
`NSURLIsExcludedFromBackupKey` posé au runtime depuis `AppDelegate.swift`) et
Android (Auto Backup + Transfert d'appareil, via
`android:fullBackupContent`/`android:dataExtractionRules` sur
`<application>`, deux fichiers XML de règles d'exclusion).

Une alternative plus simple a été explicitement écartée : ouvrir la base
dans le répertoire cache de la plateforme (exclu des sauvegardes par défaut,
sans aucun code natif). Rejetée parce que les répertoires cache peuvent être
purgés par l'OS en cas de stockage faible — la file de mutations (données
utilisateur non encore synchronisées) y serait exposée à une perte
silencieuse, ce qui romprait la garantie de durabilité posée par la Phase
9.3 (survie à un kill de l'app). Le chiffrement applicatif/SQLCipher reste
hors périmètre, reporté à une ADR dédiée future une fois le volume réel de
données sensibles mieux connu — **correction apportée par la revue
sécurité** : contrairement à l'estimation initiale, `expo-sqlite@57` embarque
déjà SQLCipher et son plugin expose une option `useSQLCipher` pour iOS et
Android (`expo-sqlite/plugin/build/withSQLite.js`) — aucune nouvelle
dépendance à introduire le jour où ce chiffrement sera activé, seule reste la
question de l'emplacement de la clé (`expo-secure-store`, déjà utilisé pour
le refresh token) et de la migration du fichier existant. Voir « Revue
sécurité » ci-dessous.

L'exclusion cible le **répertoire** `SQLite` entier (pas le seul fichier
`erp-offline.db`) — correction également apportée par la revue sécurité :
une exclusion par fichier exact ne couvre pas ses annexes `-journal`/`-wal`/
`-shm`. expo-sqlite n'active aucun `PRAGMA journal_mode` particulier
aujourd'hui (mode `DELETE` par défaut, annexes éphémères), mais le jour où le
mode WAL serait activé pour la performance, une exclusion par fichier exact
serait silencieusement incomplète.

Vérification effectuée : `expo prebuild --platform android` exécuté dans cet
environnement — le plugin s'applique sans erreur, `AndroidManifest.xml` et
les deux fichiers XML générés contiennent exactement les règles attendues
(vérifié par lecture directe des fichiers générés). **`expo prebuild
--platform ios` n'a pas pu être exécuté dans cet environnement** (Windows —
la génération du projet iOS exige macOS/Linux) : le point d'ancrage Swift
(`class AppDelegate\b.*\{`, choisi pour sa stabilité à travers les versions
du SDK Expo plutôt que d'ancrer sur le corps d'une méthode existante) n'a
donc pas pu être vérifié contre un `AppDelegate.swift` réellement généré.
Si l'ancrage ne correspond pas, `mergeContents` (voir
`@expo/config-plugins/build/utils/generateCode.js`) lève une erreur explicite
(`ERR_NO_MATCH`) qui bloque le prebuild — échec visible et non silencieux,
mais qui reste à observer une fois sur macOS/Linux avant la première
distribution iOS. Voir annexe QA.

**Liste blanche de persistance.** `query-client.ts` n'écrit sur disque que
les clés `["customers"]` (préfixe) et `["users","me","context"]`
(permissions) via `dehydrateOptions.shouldDehydrateQuery`, composé avec
`defaultShouldDehydrateQuery` de TanStack Query (préserve le comportement
par défaut — requêtes réussies uniquement — en plus du filtre par clé).
Permissions incluses dans la liste blanche : sans elles, un cold start
hors-ligne masquerait l'entrée « Clients » alors que la liste de clients,
elle, resterait consultable depuis le cache — incohérence gênante pour un
gain de sécurité nul (le contexte utilisateur ne contient aucun secret).

**Clé d'idempotence sur les mutations rejouées : reportée au premier module
financier.** Un doublon de client en cas de rejeu après perte de réponse
(timeout 15 s d'`apiFetch`) est un problème de qualité de données visible et
corrigeable (le doublon apparaît dans la liste, supprimable), pas une perte
financière. Construire le mécanisme maintenant exigerait un changement
d'API backend (en-tête d'idempotence + déduplication serveur) hors périmètre
d'un cycle mobile pour un bénéfice qui ne devient réellement nécessaire
qu'avec Ventes/Achats/Facturation/Comptabilité.

**Écrans : liste + fiche séparées, pas de formulaire intégré comme sur le
web.** Web affiche la liste et le formulaire de création/édition sur le même
écran (assez de largeur en desktop). Sur mobile, un écran de pile dédié
(`ClientForm`, poussé depuis `ClientsList`) est le patron idiomatique React
Navigation, déjà celui retenu en Phase 9.2 pour Login/MfaVerify. Un seul
écran gère création ET édition (route `{ customerId? }`), même schéma Zod
(`createCustomerSchema`) et même astuce de typage `z.input` +
`useForm({ values })` que le formulaire web (nécessaire pour les mêmes
raisons : champs avec `.default()`, resynchronisation une fois la fiche
chargée en mode édition).

**Écritures via la file de mutations hors-ligne, pas `useMutation`.**
Conforme à ADR-0014 : TanStack Query ne sert qu'au cache de lecture dans
cette architecture mobile. `useSaveCustomer`/`useDeactivateCustomer`
appellent `enqueueMutation` puis, si en ligne, `processQueue` +
`invalidateQueries` — suivre le patron web (`useMutation` appelant
directement l'API) aurait modélisé un comportement qui n'est plus vrai côté
mobile.

**Correctif d'infrastructure découvert pendant l'implémentation, générique
(pas spécifique à Clients) :** `useSyncEngine` (Phase 9.3) ne re-déclenche
`processQueue` que sur une *transition* de `[status, isOnline]` — pas quand
`enqueueMutation` insère une nouvelle ligne pendant qu'on est déjà
authentifié et en ligne. Sans correctif, un client créé en étant déjà
connecté serait resté `pending` jusqu'au prochain changement de
connectivité. Deux ajustements :
1. Le point d'appel de l'écriture déclenche lui-même `processQueue` +
   `invalidateQueries` juste après `enqueueMutation`, uniquement si en
   ligne (sinon, attendre le timeout de 15 s d'`apiFetch` pour rien —
   `apiFetch` ne consulte pas NetInfo lui-même).
2. `sync-engine.ts` appelle `queryClient.invalidateQueries()` (toutes
   requêtes montées) après un `processQueue` réussi déclenché par une
   reconnexion — seul point qui sait qu'un rejeu automatique vient
   d'aboutir, pour rafraîchir une liste laissée obsolète par une mutation
   créée hors-ligne.

**Aucune mise à jour optimiste locale (`setQueryData`).** Incohérente entre
création (pas d'ID avant réponse serveur, par choix ADR-0014 — aucun ID
généré côté client) et modification/suppression (ID déjà connu). Poser un
patron inconsistant dès le premier module écriture aurait été pire que de
l'omettre : un client créé hors-ligne n'apparaît dans la liste qu'après la
prochaine synchronisation réussie, assumé.

**Bannière de mutations en échec, pas d'UI de retry/dismiss.** Réalise la
promesse déjà inscrite en commentaire dans `mutation-queue.ts` (« exposé
pour une future UI ») a minima : `ClientsListScreen` interroge
`listMutations()` (poll léger, uniquement pendant que l'écran est actif via
`useIsFocused()`) et affiche un compte de mutations `status:"failed"`. Pas de
retry/dismiss par ligne — un seul module écriture ne donne pas assez de recul
pour figer ce patron ; reporté aux modules suivants.

## Revue sécurité (Phase 9.4)

Revue par l'agent `security` avant clôture du cycle (CLAUDE.md §3 : gating
par rôle dans `permissions.ts`, et première fois que de la PII réelle
transite par le cache hors-ligne). Deux findings MOYEN corrigés, un FAIBLE
corrigé (couvert ci-dessus), un FAIBLE corrigé :

- **Un rejet serveur en cours de rejeu ressortait comme un succès
  silencieux.** `processQueue` ne remonte jamais un échec HTTP à l'appelant
  — un 4xx était converti en `markMutationFailed` en interne mais la
  promesse de `useSaveCustomer`/`useDeactivateCustomer` résolvait quand même
  normalement, et l'écran appelait `navigation.goBack()` en croyant l'action
  réussie. Scénario concret : permission retirée à l'utilisateur entre la
  mise en file et le rejeu (cache `useMyContext` périmé, voir plus bas) →
  403 réel côté serveur → l'app affiche pourtant un succès. Corrigé :
  `mutation-queue.ts` exporte désormais `assertMutationSucceeded(mutationId)`
  (lève `MutationRejectedError` si la ligne est encore trouvée avec
  `status:"failed"` après le rejeu), appelé par les deux hooks avant
  `invalidateQueries` — les écrans n'ont nécessité aucun changement, leurs
  blocs `try/catch` existants gèrent déjà correctement une promesse qui
  rejette. Tests : `mutation-queue.spec.ts` (`assertMutationSucceeded`),
  `use-customers.spec.ts` (« propage le rejet serveur... »).
- **La liste blanche de persistance — le contrôle qui décide de ce qui va en
  clair sur `erp-offline.db` — n'avait aucun test.** Corrigé :
  `isAllowedToPersist` exporté depuis `query-client.ts`,
  `query-client.spec.ts` créé (accepte les préfixes `customers`/
  `users.me.context`, refuse un préfixe partiel type `["users","me"]` ou
  toute autre clé).
- **`useMyContext()` mis en cache hors-ligne : les permissions peuvent
  devenir périmées.** Confirmé conforme après vérification — le seul
  consommateur (`HomeScreen`) ne l'utilise que pour masquer un bouton, aucun
  code ne le traite comme une autorisation réelle ; le serveur revérifie
  indépendamment à chaque requête (`PermissionsGuard`, re-résolution en base,
  jamais depuis le JWT). Le risque réel n'était pas la permission périmée en
  elle-même mais ce qu'un 403 qui en découle provoquait côté UI — couvert par
  le point précédent.
- **Interpolation d'ID sans encodage.** `use-customers.ts` encode désormais
  systématiquement (`encodeURIComponent`) tout ID interpolé dans un chemin,
  en lecture comme en écriture — non exploitable aujourd'hui (aucun deep
  linking configuré, IDs toujours issus de réponses serveur), défense en
  profondeur avant que d'autres modules ne répliquent le patron.

Point vérifié et jugé sûr sans changement : le cast `values as
CreateCustomerInput` dans `ClientFormScreen.tsx` n'est pas un contournement
— `zodResolver` retourne les valeurs déjà parsées (défauts appliqués) avant
que `handleSubmit` ne les transmette, et le serveur revalide indépendamment
via `ZodValidationPipe` sur POST et PATCH (schémas non `.passthrough()`,
toute clé inconnue est retirée avant d'atteindre le service).

Dettes déjà actées ci-dessus (chiffrement SQLCipher, idempotence, QA iOS) et
deux points supplémentaires à trancher, notés mais non traités ce cycle :

- **Rétention illimitée des mutations en échec terminal.** `mutation_queue`
  n'est purgée qu'au logout/expiration de session (`purgeTenantScoped`) — une
  mutation `status:"failed"` (donc toute la fiche client soumise, en clair)
  reste sur l'appareil indéfiniment tant que l'utilisateur reste connecté.
  À trancher avant le premier module financier : purge automatique après un
  délai, ou UI de retry/dismiss qui purge à la résolution (cf. « Écarté »
  ci-dessous).
- **Registre des traitements.** Le cache local contient désormais des
  données personnelles et des identifiants légaux (NINEA/RCCM) au sens de la
  loi n° 2008-12 — à qualifier avec un juriste (déclaration/inscription CDP),
  pas une décision technique.

## Écarté
- Répertoire cache pour le fichier SQLite — cf. justification ci-dessus
  (risque de perte de la file de mutations sous pression de stockage).
- `android:allowBackup="false"` — coupe Auto Backup pour toute l'application,
  granularité trop large pour un seul fichier ; préféré :
  `fullBackupContent`/`dataExtractionRules` sélectifs.
- Mise à jour optimiste locale du cache pour créer/modifier/supprimer.
- UI de retry/dismiss par mutation en échec.
- Clé d'idempotence sur les mutations rejouées dès ce cycle.
- Formulaire intégré à la liste (patron web) plutôt qu'un écran de pile
  dédié.
- Barre d'onglets / tiroir de navigation — un bouton unique sur `HomeScreen`
  (gated par `clients.read`) suffit pour un cycle à un seul module.
- Vérifications de permission fines par bouton/champ dans les écrans — le
  web ne le fait pas non plus (gating au niveau navigation + 403 backend
  comme seule autorité réelle).
- Chiffrement applicatif/SQLCipher du fichier SQLite.
- Purge automatique des mutations en échec terminal après un délai — reportée
  avec la décision UI retry/dismiss ci-dessus (revue sécurité Phase 9.4).

## Conséquences
- Les modules suivants (Fournisseurs, Produits, ...) répliquent le même
  patron : hooks `use-<module>.ts` dans `apps/mobile/src/lib/queries/`,
  écrans liste/fiche séparés, écritures via `enqueueMutation`. Ajouter leurs
  clés de requête à `DEHYDRATE_ALLOW_LIST` (`query-client.ts`) est requis
  pour qu'ils restent consultables hors-ligne — l'oublier ne casse rien
  (la donnée n'est simplement pas mise en cache), mais dégrade l'expérience
  hors-ligne silencieusement.
- Le premier module financier (Ventes/Achats/Facturation/Comptabilité) devra
  trancher la clé d'idempotence reportée ici — probablement le moment
  d'ouvrir un nouvel ADR dédié, le changement touchant `apps/api`.
- La QA manuelle iOS du plugin de sauvegarde (annexe ci-dessous) doit être
  exécutée sur macOS/Linux avant la première distribution iOS — non faite
  dans ce cycle, environnement Windows uniquement.
- `useSyncEngine`'s post-rejeu `invalidateQueries()` est générique : tout
  futur module bénéficie automatiquement du rafraîchissement post-rejeu
  sans code supplémentaire.

## Annexe — Procédure de QA manuelle (non exécutée dans cet environnement)

**Android (partiellement vérifié — génération de fichiers confirmée,
comportement runtime non testé sur appareil réel) :**
1. `expo prebuild --platform android`, ouvrir le projet, confirmer que le
   répertoire `SQLite/` (et donc `erp-offline.db`) n'apparaît pas dans une
   sauvegarde Google One/Auto Backup après connexion + création d'un client.

**iOS (entièrement à faire, nécessite macOS/Linux) :**
1. `expo prebuild --platform ios` — confirmer l'absence d'erreur
   `ERR_NO_MATCH` (validerait l'ancrage `class AppDelegate\b.*\{`).
2. Lire `ios/<name>/AppDelegate.swift` généré, confirmer visuellement que le
   bloc `erpExcludeOfflineDbFromBackupOnce` a bien été injecté dans le corps
   de la classe.
3. Lancer l'app sur simulateur/appareil, se connecter (création du
   répertoire SQLite), relancer l'app une seconde fois (l'exclusion ne prend
   effet qu'au second lancement, le répertoire n'existant pas encore au
   premier — voir Décision ci-dessus), puis vérifier via Xcode
   (Devices and Simulators → sauvegarde) ou une sauvegarde iCloud réelle que
   le répertoire `SQLite/` est absent de la sauvegarde.

**Les deux plateformes :**
4. Se connecter, créer un client hors-ligne (mode avion), vérifier qu'il
   apparaît dans `mutation_queue` (inspecteur SQLite ou `listMutations()`
   temporairement loggé) mais pas encore dans la liste.
5. Revenir en ligne, vérifier que la création part automatiquement
   (`useSyncEngine`) et que la liste se rafraîchit sans action utilisateur.
6. Se déconnecter, se reconnecter avec un compte d'un autre rôle sans
   `clients.read` : vérifier que le bouton « Clients » n'apparaît pas.
