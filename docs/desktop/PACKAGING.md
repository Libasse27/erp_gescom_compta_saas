# Packaging desktop — état et blocages (Phase 9.5)

> Contexte : `docs/adr/0013-stack-desktop.md` décide qu'Electron encapsule
> `apps/web` (Next.js) tel quel plutôt que de reconstruire un renderer natif,
> et reporte explicitement le détail du packaging à cette phase. Ce document
> trace ce qui a été essayé, ce qui marche, et ce qui reste à faire —
> constaté sur le poste de développement Windows utilisé pour cette session.

## Objectif

Produire un installeur/archive desktop **autonome** : le process principal
Electron doit pouvoir démarrer le serveur `apps/web` sans dépendre de pnpm,
du monorepo, ni d'une connexion réseau vers le store pnpm — uniquement ce
qui est embarqué dans l'installeur.

## Ce qui fonctionne

1. **`electron/main.ts`** distingue développement (`pnpm --filter web
   start` depuis le monorepo) et packagé (`app.isPackaged`), 14 tests
   unitaires couvrant les deux chemins, `waitForWebServer` (retry/timeout),
   la sécurité de la fenêtre (`contextIsolation`/`nodeIntegration`) et le
   cycle de vie (`window-all-closed`/`before-quit`).
2. **`pnpm --filter web deploy web-dist --prod`** (commande native pnpm)
   matérialise `apps/web` + son `node_modules` de production **sans
   symlinks** (jonctions Windows uniquement) — contrairement à la sortie
   Next.js `output: "standalone"`, écartée (voir « Tentatives écartées »
   ci-dessous).
3. **electron-builder copie cette ressource sans erreur EPERM** : la
   jonction Windows n'est pas le problème que `output: "standalone"`
   posait (celui-ci utilisait `fs.symlink`, qui nécessite des privilèges
   élevés sur Windows sans Mode développeur — les jonctions pnpm n'en ont
   pas besoin).
4. **Un `.zip` Windows non signé se construit de bout en bout**
   (`pnpm --filter @erp/desktop package`, cible `win: zip`) : le process
   Electron lui-même (fenêtre, sécurité, icône par défaut) est packagé
   correctement.

## Ce qui ne fonctionne pas encore

**Le `node_modules` déployé par `pnpm deploy` n'arrive pas dans le paquet
final.** electron-builder applique sa propre logique de détection/pruning
de dépendances aux entrées `extraResources`, qui ne reconnaît pas un
`node_modules` déjà construit à la main comme une ressource à copier telle
quelle — il est silencieusement absent du résultat (`win-unpacked` ne
contient que le code source de `apps/web`, sans `node_modules`). Un `.zip`
produit dans l'état actuel ne permettrait donc pas à `next start` de
démarrer une fois installé.

Piste non explorée faute de temps dans cette session : configurer `files`
(pas `extraResources`) avec un pattern explicite incluant `web-dist/**/*`
et `!web-dist/**/node_modules/**` inversé, ou désactiver le filtrage
node_modules d'electron-builder pour cette ressource spécifique
(`electron-builder` expose `files`/`extraResources` avec des matchers glob
par entrée — à vérifier si un objet `{ from, to, filter }` explicite avec
`filter: ["**/*"]` contourne le comportement par défaut).

Un artefact parasite (`web-dist/apps/desktop/web-dist`, une auto-inclusion
du dossier de déploiement dans lui-même) a aussi été observé lors du test
manuel — signe que `pnpm deploy` trace potentiellement plus que le
strict nécessaire dans une exécution répétée sans nettoyage préalable ;
`scripts/package.js` supprime déjà `web-dist` avant chaque déploiement pour
éviter ça en usage normal.

## Tentatives écartées

- **Next.js `output: "standalone"`** : produit un serveur autonome
  (`server.js` + dépendances tracées), l'approche standard hors monorepo
  pnpm sur Windows. Écartée : le traçage de fichiers de Next.js recrée les
  symlinks pnpm via `fs.symlink`, qui échoue avec `EPERM` sur Windows sans
  Mode développeur actif **dans l'environnement où `next build` tourne** —
  activer le Mode développeur Windows côté utilisateur n'a pas résolu le
  problème dans cette session (probablement une limite du bac à sable dans
  lequel les commandes s'exécutent, indépendante du réglage Windows
  lui-même). À reconsidérer sur un poste/CI où `next build` peut tourner
  avec les privilèges nécessaires.
- **NSIS (`win: { target: "nsis" }`)** : `makensis.exe` (outil Win32 hérité)
  échoue avec `!include: could not open file` sur les chemins internes à
  `node_modules/.pnpm/...` — dépassement probable de la limite Windows
  `MAX_PATH` (260 caractères) une fois combinés le chemin profond du
  monorepo et les noms de dossiers `.pnpm` (qui encodent nom+version de
  chaque dépendance). Remplacé par la cible `zip`, qui ne passe pas par
  `makensis.exe`.

## Prochaines étapes possibles

1. Résoudre l'inclusion de `node_modules` dans le paquet (piste `files`
   ci-dessus), puis vérifier que l'app installée démarre réellement (lancer
   le `.exe` depuis `win-unpacked`, pas seulement vérifier la présence des
   fichiers).
2. Revenir sur `output: "standalone"` si un environnement de build sans
   cette limitation de symlinks est disponible (CI Linux/macOS, ou poste
   Windows hors bac à sable) — produirait un artefact nettement plus léger
   qu'un `node_modules` complet copié tel quel.
3. Reprendre NSIS une fois (1) réglé, si un vrai installeur (pas juste un
   zip) est souhaité — possible correctif : builder depuis un chemin plus
   court, ou chercher une option electron-builder pour raccourcir les
   chemins intermédiaires.
4. Auto-update (`electron-updater`) et signature de code restent non
   commencés (nécessitent des décisions produit : hébergement du flux de
   mise à jour, certificats) — voir `apps/desktop/README.md`.
