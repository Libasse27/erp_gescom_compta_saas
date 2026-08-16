# Audit — Packaging desktop (Electron)

> Audit uniquement, aucune modification de code. Périmètre : `apps/desktop`,
> `docs/adr/0013-stack-desktop.md`, `docs/desktop/PACKAGING.md`.
> Date : 2026-08-16. Vérifié par lecture directe des fichiers, scripts,
> tests et artefacts locaux — pas sur la seule foi des messages de commit.

## Résumé exécutif

Le packaging **fonctionne de bout en bout jusqu'au démarrage du serveur web
embarqué et l'affichage de la fenêtre Electron**, ce qui est mieux que ce que
laissait supposer le commit `dfe580e` (« serveur web embarqué non
fonctionnel »). Le bug de `node_modules` vide et le blocage
`next.config.ts` sont bien résolus, avec preuve technique cohérente (pas
seulement une affirmation). En revanche, **rien ne démontre que le chemin
login → API → écrans ERP fonctionne dans le paquet final** : l'URL de l'API
est figée au build sur `http://localhost:3000` et aucune vérification
fonctionnelle (login, appel API réel) n'a été menée sur le paquet packagé.
L'app n'a été vérifiée que sur le poste de développement, jamais sur une
machine propre.

---

## D-01 — URL d'API figée à `localhost:3000` dans l'app packagée

**Sévérité** : CRITICAL
**Composant** : `apps/desktop` (packaging) / `apps/web` (client)
**Description** : `apps/web/src/lib/api.ts` et `api-client.ts` lisent
`process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000"`. Les variables
`NEXT_PUBLIC_*` de Next.js sont **inlinées dans le bundle JavaScript côté
client au moment du build**, pas lues au runtime. `apps/desktop/scripts/package.js`
appelle `pnpm --filter web build` (ligne 33) sans jamais définir
`NEXT_PUBLIC_API_URL` — contrairement à `apps/web/Dockerfile` (lignes 3-5,
24-25) qui documente explicitement ce piège et le corrige via `--build-arg`.
Résultat : toute app desktop packagée pointe irrévocablement vers
`http://localhost:3000/v1`, quel que soit l'environnement de l'utilisateur
final.
**Impact** : un utilisateur installant l'app desktop en dehors du poste de
développement ne peut se connecter à aucune API réelle, sauf à faire tourner
lui-même une API NestJS locale sur le port 3000 — ce qui n'est ni prévu ni
documenté comme prérequis utilisateur. L'app est inutilisable en l'état hors
du poste où elle a été packagée.
**Risque** : livraison d'un installeur non fonctionnel pour l'utilisateur
final ; perte de confiance ; aucune détection avant un test manuel sur un
poste tiers (jamais fait à ce jour, voir D-04).
**Fichier(s)** :
- `apps/desktop/scripts/package.js:33` (build sans `NEXT_PUBLIC_API_URL`)
- `apps/web/src/lib/api.ts:8`, `apps/web/src/lib/api-client.ts:4`
- comparer avec `apps/web/Dockerfile:3-5,24-25` (traite déjà correctement ce
  piège pour Docker, mais pas pour le desktop)
**Solution** : injecter `NEXT_PUBLIC_API_URL` dans l'environnement avant
`pnpm --filter web build` dans `scripts/package.js` (variable d'environnement
lue par le script de packaging, ex. `DESKTOP_API_URL`, avec valeur par
défaut explicite pointant vers une API de production réelle, jamais
`localhost`). Documenter dans `apps/desktop/README.md` comment reconfigurer
cette URL pour produire un paquet visant un environnement différent
(staging/prod), et envisager, si plusieurs environnements sont nécessaires,
un mécanisme de configuration post-build (fichier de config lu au runtime par
le process principal Electron plutôt qu'une valeur inlinée).
**Priorité** : P0 — bloquant avant toute distribution, même interne.
**Statut** : OUVERT

---

## D-02 — Port du serveur web embarqué non paramétrable

**Sévérité** : MEDIUM
**Composant** : `apps/desktop/electron/main.ts`
**Description** : `WEB_PORT = 3001` est une constante en dur (ligne 13),
justifiée dans un commentaire par le fait que `apps/web/package.json` fixe
déjà `next start -p 3001`. Aucun sondage de port libre, aucun fallback si le
port 3001 est déjà occupé sur le poste de l'utilisateur (autre instance de
l'app, autre service local).
**Impact** : sur un poste où le port 3001 est déjà utilisé, `next start`
échouera silencieusement côté process enfant (l'erreur `EADDRINUSE` du child
process n'est pas interceptée par `waitForWebServer`, qui continuera de
sonder jusqu'au timeout de 30 s puis lèvera une erreur générique peu
actionnable pour un utilisateur final).
**Risque** : échec de démarrage non diagnostiqué facilement par un
utilisateur non technique ; pas de message d'erreur clair affiché dans
l'UI (juste un rejet de promesse côté process principal).
**Fichier(s)** : `apps/desktop/electron/main.ts:13,36-47`
**Solution** : sonder un port libre dynamiquement (ex. `get-port`) ou, a
minima, capturer l'événement `exit`/`error` du child process avec un message
utilisateur explicite (boîte de dialogue Electron) plutôt qu'un timeout
muet de 30 s.
**Priorité** : P2
**Statut** : OUVERT

---

## D-03 — Pas d'installeur réel, uniquement une archive `.zip` non signée

**Sévérité** : HIGH
**Composant** : `apps/desktop/package.json` (config `build.win`)
**Description** : la cible Windows est `zip` (`package.json:35`), pas
`nsis`. `docs/desktop/PACKAGING.md` (lignes 95-104) documente que NSIS
échoue sur le poste de dev avec une erreur probablement liée à la limite
`MAX_PATH` de Windows, non retestée depuis le passage à `node-linker
hoisted`. Aucune signature de code (ADR 0013 §Conséquences, README §État)
— confirmé par absence totale de configuration `certificateFile`/
`certificateSubjectName` dans `package.json`.
**Impact** : pas de véritable expérience « installeur cliquer-suivant-
terminer » pour l'utilisateur final (il doit dézipper et lancer l'exe
manuellement, pas de raccourci menu Démarrer, pas de désinstalleur, pas
d'entrée dans « Programmes et fonctionnalités »). Sans signature de code,
Windows SmartScreen affichera un avertissement bloquant par défaut pour tout
utilisateur non averti.
**Risque** : mauvaise expérience de déploiement pour des utilisateurs
métier non techniques (comptables, gestionnaires commerciaux — le public
cible réel du produit) ; adoption compromise en dehors d'un contexte de
test interne.
**Fichier(s)** : `apps/desktop/package.json:27-38`, `docs/desktop/PACKAGING.md:93-114`
**Solution** : retester NSIS depuis un chemin de build court
(`C:\build\erp` plutôt qu'un chemin profond) maintenant que le
`node_modules` est à plat (hoisted) — la cause potentielle (chemins
`.pnpm` profonds) documentée dans PACKAGING.md pourrait déjà être résolue
et n'a simplement pas été revérifiée. Prévoir un certificat de signature de
code avant toute distribution au-delà d'un cercle de test interne.
**Priorité** : P1
**Statut** : OUVERT

---

## D-04 — Aucune vérification sur environnement propre, ni du flux login/API

**Sévérité** : HIGH
**Composant** : processus de vérification desktop (absence de)
**Description** : `docs/desktop/PACKAGING.md` §« Méthode de vérification
utilisée » (lignes 131-143) décrit une vérification limitée à : lancer
l'exe et vérifier que `curl http://localhost:3001/` répond `HTTP 200`. Cela
prouve seulement que le serveur Next.js démarre et répond sur sa route
racine — pas que la page de login s'affiche correctement, pas qu'un
utilisateur peut s'authentifier, pas que l'app appelle réellement l'API
NestJS (qui, de toute façon, ne peut pas être jointe vu D-01), pas que les
écrans ERP sont utilisables. Aucune trace d'un test sur une machine Windows
différente de celle utilisée pour le développement (pas de VM propre, pas
de second poste) : `apps/desktop/release-verify/` est un artefact local
généré le 13/08 (`win-unpacked/ERP Gescom Compta.exe`), jamais transporté
ni exécuté ailleurs que sur ce poste.
**Impact** : la seule preuve disponible ne couvre qu'une fraction du
parcours utilisateur demandé (source → build web → build electron →
package → installeur → installation propre → démarrage → login → appel
API → usage ERP). Les étapes « login », « talle à l'API », « ERP
utilisable » et « installation propre sur machine tierce » ne sont
couvertes par aucune preuve.
**Risque** : régressions ou blocages fonctionnels (D-01 en est un exemple
concret) non détectés avant qu'un utilisateur réel ne les rencontre.
**Fichier(s)** : `docs/desktop/PACKAGING.md:131-147`, `apps/desktop/README.md:19-31`
**Solution** : avant toute annonce de « packaging desktop fonctionnel »,
exécuter et documenter un scénario de bout en bout sur une VM Windows
propre (sans Node/pnpm/le monorepo installés) : installation, lancement,
écran de login affiché, connexion réussie contre une API réelle (staging),
navigation dans au moins un module ERP. Conserver la preuve (capture
d'écran ou log commenté) dans `docs/desktop/PACKAGING.md`.
**Priorité** : P1
**Statut** : OUVERT

---

## D-05 — Poids du paquet et empreinte disque non maîtrisés

**Sévérité** : LOW
**Composant** : packaging (stratégie `pnpm deploy --prod` + copie intégrale)
**Description** : `docs/desktop/PACKAGING.md` (lignes 105-110) reconnaît
explicitement que la copie intégrale d'un `node_modules` de production est
« nettement plus lourde » que l'approche `output: standalone` de Next.js,
écartée pour des raisons d'incompatibilité Windows (symlinks EPERM). Le
`.zip` généré fait ~127 Mo (`apps/desktop/release-verify/ERP Gescom Compta-0.0.1-win.zip`).
**Impact** : temps de téléchargement/installation plus long pour
l'utilisateur final, coût de distribution plus élevé (bande passante),
pertinent dans un contexte de connectivité intermittente (Sénégal/UEMOA,
CLAUDE.md contexte régional).
**Risque** : faible à ce stade (usage interne/test), à surveiller avant
diffusion à grande échelle.
**Fichier(s)** : `docs/desktop/PACKAGING.md:105-110`
**Solution** : retenter `output: "standalone"` sur un environnement CI
Linux/macOS (comme suggéré dans PACKAGING.md) où le traçage de fichiers
Next.js ne rencontre pas la limitation Windows EPERM ; ou packager le build
Windows depuis un runner CI Windows avec le mode développeur Windows actif
au niveau système (pas seulement utilisateur), pour retenter `standalone`.
**Priorité** : P3
**Statut** : OUVERT

---

## D-06 — Auto-update et intégrité de mise à jour non implémentés

**Sévérité** : INFO
**Composant** : `apps/desktop` (electron-updater)
**Description** : `electron-updater` est une dépendance déclarée
(`package.json:16`) mais non câblée dans `electron/main.ts` — confirmé par
absence de tout import/usage dans le fichier. Assumé et documenté comme tel
dans le README (§État, lignes 32-34).
**Impact** : aucune app desktop packagée ne pourra recevoir de mise à jour
automatique ; chaque évolution nécessite une redistribution manuelle
complète du paquet.
**Risque** : dérive de version entre postes desktop dans la durée si
l'usage se généralise ; pas un risque immédiat vu l'absence de
distribution actuelle.
**Fichier(s)** : `apps/desktop/package.json:16`, `apps/desktop/electron/main.ts` (absence)
**Solution** : décision produit à prendre (hébergement du flux de mise à
jour : GitHub Releases, S3, serveur générique) avant implémentation —
correctement identifié comme prérequis non tranché dans le README.
**Priorité** : P3 (aucune urgence tant que la distribution reste interne)
**Statut** : OUVERT

---

## Ce qui fonctionne réellement (vérifié, pas seulement documenté)

- `electron/main.ts` distingue correctement dev (`pnpm --filter web start`)
  et packagé (`app.isPackaged`, `ELECTRON_RUN_AS_NODE=1`), avec 14 tests
  unitaires (`main.spec.ts`) qui couvrent les deux chemins, le polling
  `waitForWebServer` (succès, échec réseau puis succès, timeout), la
  sécurité de fenêtre (`contextIsolation: true`, `nodeIntegration: false`)
  et le cycle de vie (`window-all-closed`, `before-quit`) — lu et vérifié
  ligne à ligne, cohérent avec le code testé.
- Le correctif `node_modules` vide (`--config.node-linker=hoisted` +
  `extraResources` avec filtre explicite plutôt que copie de dossier) est
  techniquement cohérent avec la cause documentée (jonctions Windows non
  traversées par le parcours de fichiers d'electron-builder) — logique
  vérifiable dans `scripts/package.js:19,36` et `package.json:31`.
- Le correctif `next.config.ts → next.config.mjs` élimine bien la
  dépendance runtime à `typescript` (fichier confirmé en `.mjs` dans
  `apps/desktop/web-dist/next.config.mjs`, cohérent avec l'absence de
  `typescript` dans les dépendances de production déployées).
- Un artefact local daté du 13/08 (`apps/desktop/release-verify/win-unpacked/ERP Gescom Compta.exe`,
  correctement exclu de git via `.gitignore:11`) atteste qu'un paquet a
  effectivement été produit et lancé sur ce poste.

## Ce qui n'est PAS vérifié (contrairement à l'impression donnée par la doc)

- Le flux applicatif complet (installation propre → login → appel API →
  usage ERP) — voir D-04.
- Le fonctionnement sur une machine autre que le poste de développement —
  voir D-04.
- Un vrai installeur Windows (NSIS) — voir D-03.
- L'URL d'API en environnement de production — voir D-01 (celui-ci est en
  réalité **non fonctionnel par construction**, pas seulement « non
  vérifié »).

## Points à valider par l'architecte ou la sécurité

- D-01 doit être corrigé avant toute mise à disposition du paquet desktop à
  un utilisateur, même en interne pour recette — sinon l'app est
  non fonctionnelle dès la première utilisation hors du poste de build.
- Décision produit à prendre avec `architect`/l'utilisateur : le paquet
  desktop doit-il être reconfigurable après build (plusieurs environnements
  cibles) ou est-il acceptable qu'un paquet soit lié à une seule API à vie
  (ce que fait actuellement Docker pour `apps/web`) ?
