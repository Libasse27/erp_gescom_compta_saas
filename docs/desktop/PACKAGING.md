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

## État actuel : fonctionne de bout en bout

Vérifié manuellement (build → deploy → package → lancement du `.exe` packagé,
requête HTTP sur le serveur embarqué) sur ce poste de développement :

1. **`electron/main.ts`** distingue développement (`pnpm --filter web
   start` depuis le monorepo) et packagé (`app.isPackaged`), 14 tests
   unitaires couvrant les deux chemins, `waitForWebServer` (retry/timeout),
   la sécurité de la fenêtre (`contextIsolation`/`nodeIntegration`) et le
   cycle de vie (`window-all-closed`/`before-quit`).
2. **`pnpm --filter web deploy web-dist --prod --config.node-linker=hoisted`**
   matérialise `apps/web` + son `node_modules` de production en arbre plat,
   sans symlinks ni jonctions Windows (voir « `node_modules` vide » ci-dessous
   pour pourquoi `--config.node-linker=hoisted` est indispensable).
3. **electron-builder copie cette ressource sans erreur** et le
   `node_modules` déployé arrive intact dans le paquet final (`extraResources`
   avec `{ "from": ".", "to": ".", "filter": ["web-dist/**/*"] }` — voir
   « `node_modules` vide » ci-dessous pour pourquoi ce filtre explicite est
   nécessaire plutôt que `{ "from": "web-dist", "to": "web-dist" }`).
4. **Un `.zip` Windows non signé se construit de bout en bout**
   (`pnpm --filter @erp/desktop package`, cible `win: zip`).
5. **L'app packagée démarre réellement** : le serveur Next.js embarqué
   répond `✓ Ready` en ~3s et sert `HTTP 200` sur `http://localhost:3001`,
   la fenêtre Electron se charge dessus. Testé en lançant directement
   `win-unpacked/ERP Gescom Compta.exe`.

## Bugs résolus

### `node_modules` vide dans le paquet final

**Symptôme :** `win-unpacked` ne contenait que le code source de `apps/web`,
sans `node_modules` — `next start` ne pouvait pas démarrer une fois installé.

**Cause :** par défaut, `pnpm deploy` matérialise le `node_modules` déployé
avec des jonctions Windows vers un store virtuel `.pnpm/`. electron-builder
copie ces jonctions sans erreur, mais son parcours de fichiers (utilisé par
`extraResources`) ne les traverse pas — le contenu réel des paquets n'est
jamais copié.

**Correctif :**
- `scripts/package.js` déploie avec
  `pnpm --filter web deploy "<dir>" --prod --config.node-linker=hoisted`,
  ce qui produit un `node_modules` classique à plat, sans jonction ni store
  virtuel.
- `apps/desktop/package.json` : `extraResources` est passé de
  `{ "from": "web-dist", "to": "web-dist" }` à
  `{ "from": ".", "to": ".", "filter": ["web-dist/**/*"] }` — le filtre
  explicite garantit que le parcours de fichiers d'electron-builder (pas une
  simple copie de jonction) traite chaque entrée individuellement.

### `next.config.ts` fait échouer le démarrage packagé (`Cannot find module 'typescript'`)

**Symptôme :** une fois le `node_modules` correctement présent, le serveur
packagé échouait quand même à démarrer : `next start` tentait de charger
`next.config.ts`, ce qui nécessite le paquet `typescript` au runtime (Next.js
transpile la config à la volée). `pnpm deploy --prod` exclut les
devDependencies — dont `typescript` — donc le module était introuvable.
Next.js tentait un auto-install de secours (`pnpm add typescript`), qui
échouait aussi dans ce contexte (résolution du workspace vers la racine du
monorepo au lieu du dossier déployé, contamination du `node_modules`
packagé avec des jonctions pnpm par-dessus l'arbre plat).

**Cause racine :** `apps/web/next.config.ts` ne contenait qu'un objet vide
(`{}`) — la config n'avait aucun besoin réel d'être en TypeScript.

**Correctif :** `apps/web/next.config.ts` → `apps/web/next.config.mjs`
(JavaScript ESM standard, pas de transpilation ni de dépendance `typescript`
requise au runtime). Aucune référence à l'ancien chemin ailleurs dans le
repo (vérifié par recherche globale).

**Point de vigilance pour la suite :** si `next.config.ts` doit un jour
réapparaître (typage plus riche de la config), il faudra soit déployer
`typescript` en production (sortir cette dépendance de `devDependencies`
dans `apps/web/package.json`, avec le coût en poids de paquet que ça
implique), soit conserver `.mjs`/`.js` pour le déploiement desktop
spécifiquement.

## Reste à faire

1. **Un vrai installeur (pas juste un zip).** NSIS (`makensis.exe`) échoue
   sur ce poste avec `!include: could not open file` sur les chemins internes
   à `node_modules/.pnpm/...` — dépassement probable de la limite Windows
   `MAX_PATH` (260 caractères) une fois combinés le chemin profond du
   monorepo et les noms de dossiers `.pnpm`. Contourné en ciblant `zip`.
   Pistes : builder depuis un chemin plus court, ou chercher une option
   electron-builder pour raccourcir les chemins intermédiaires — à
   reconsidérer maintenant que `node_modules` est déployé à plat (moins de
   chemins `.pnpm` profonds qu'avant, donc peut-être déjà résolu, non
   retesté).
2. **Poids du paquet.** Un `node_modules` de production complet copié tel
   quel est nettement plus lourd qu'un artefact `output: "standalone"`
   tracé par Next.js. `output: "standalone"` reste écarté sur ce poste
   (voir « Tentatives écartées » ci-dessous) mais vaut la peine d'être
   retenté sur un environnement de build sans restriction de symlinks
   (CI Linux/macOS).
3. **Auto-update (`electron-updater`) et signature de code** restent non
   commencés — nécessitent des décisions produit (hébergement du flux de
   mise à jour, certificats) non prises à ce stade. Voir
   `apps/desktop/README.md`.

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
- **NSIS (`win: { target: "nsis" }`)** : voir point 1 de « Reste à faire ».
  Remplacé par la cible `zip`, qui ne passe pas par `makensis.exe`.

## Méthode de vérification utilisée

Pour confirmer qu'un paquet démarre réellement (pas seulement qu'il se
construit sans erreur) :

```bash
pnpm --filter @erp/desktop package
# puis, depuis apps/desktop/release/win-unpacked :
./"ERP Gescom Compta.exe"
# vérifier dans les logs : "✓ Ready in Xs" (pas d'erreur next.config)
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3001/
# attendu : HTTP 200
```

Un `.zip` qui se construit sans erreur ne garantit **rien** sur le
démarrage réel — les deux bugs ci-dessus sont passés inaperçus lors de la
construction et ne se sont révélés qu'au lancement effectif de l'exécutable.
