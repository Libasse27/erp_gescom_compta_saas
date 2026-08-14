# 0016 — Compilation CommonJS des packages partagés (résolution du bug `pnpm dev`/`pnpm start`)

## Statut
Tranché — 2026-08-14

## Contexte
Bug connu depuis la Phase 7.1 (2026-08-09), documenté dans
`docs/PROMPT-MAITRE-SAAS.md` §Phase 10 : `pnpm dev` et `pnpm start`
(`apps/api`) plantent au démarrage, alors que `pnpm build`/`pnpm test`
passent. La Phase 10 (production) impose de trancher ce point avant toute
conteneurisation, puisqu'une image Docker de l'API doit exécuter
`node dist/main.js` en production — exactement le chemin qui plante.

### Cause racine (vérifiée, pas supposée)
- Les 7 packages partagés (`packages/{types,validation,permissions,utils,auth,config,ui}`)
  déclarent `"main": "src/index.ts"` / `"types": "src/index.ts"` dans leur
  `package.json` : ils exposent leur **source TypeScript brute**, bien que
  chacun ait un script `build` (`tsc -p tsconfig.json`) produisant `dist/`.
- Leur `tsconfig.json` compile en `"module": "ESNext"`, `"moduleResolution": "Bundler"`.
- `apps/api/tsconfig.json` compile en `"module": "CommonJS"`, `"moduleResolution": "Node10"`
  (`nest build`). Au runtime, `node dist/main.js` (CommonJS) exécute
  `require('@erp/validation')`, résolu par le symlink pnpm vers
  `packages/validation/package.json` → `main: "src/index.ts"` → Node tente
  de charger un fichier `.ts` brut sans loader enregistré (aucun `ts-node`
  en production) → échec.
- `pnpm test` (ts-jest) et `pnpm build` (tsc, ne s'exécute pas) ne passent
  jamais par cette résolution runtime, d'où la découverte tardive du bug.
- Pointer `main` vers `dist/index.js` sans autre changement n'aurait pas
  suffi : ce `dist` est aujourd'hui émis en **ESM** (`module: ESNext`), donc
  toujours pas `require`-able tel quel par une app CommonJS comme `apps/api`.

## Décision
Faire compiler les 7 packages partagés en **CommonJS**, aligné sur
`apps/api`, et faire pointer `main`/`types` vers le `dist/` compilé plutôt
que vers la source :

- `packages/*/tsconfig.json` : `"module": "CommonJS"`, `"moduleResolution": "Node10"`
  (remplace `ESNext`/`Bundler`).
- `packages/*/package.json` : `"main": "dist/index.js"`, `"types": "dist/index.d.ts"`
  (remplace `src/index.ts`).
- `turbo.json` : tâche `dev` complétée avec `"dependsOn": ["^build"]` (déjà
  présent pour `build`/`lint`/`typecheck`/`test`/`test:tenant`), pour que les
  packages soient compilés avant que `apps/api`/`apps/web` ne démarrent en
  dev.

Du CommonJS est consommable sans changement par tous les consommateurs
actuels : `apps/api` (CommonJS natif), `apps/web` (Next.js/webpack, gère le
CommonJS de façon standard), `apps/mobile` (Metro/Babel), `apps/desktop`
(Electron, process principal CommonJS).

### Alternatives écartées
- **Ajouter les extensions `.js` aux imports relatifs internes des
  packages** (garder `main: src/index.ts`) : casse `ts-node`/`prisma db seed`
  et `create-super-admin` (déjà constaté en Phase 8, voir note du module
  Fournisseurs dans `docs/PROMPT-MAITRE-SAAS.md`), qui ne font pas ce
  remapping d'extensions.
- **`tsx watch` pour le dev de `apps/api`** : réglerait le dev mais pas
  `pnpm start` (production), qui est le vrai besoin pour l'image Docker.
- **Bundler `webpack` de Nest** (`nest build --webpack`) : nécessite une
  nouvelle dépendance (`ts-loader` ou équivalent) et change la chaîne de
  build pour un problème résolu plus simplement par une config de sortie
  différente — écarté au nom de la simplicité (CLAUDE.md §B, arbitrage).

### Limitation assumée
En dev, une modification d'un package partagé nécessite un rebuild
(`pnpm build --filter=<package>` ou `pnpm build` complet) avant d'être visible
dans `apps/api`/`apps/web` — pas de hot-rebuild des packages. Acceptable :
évite d'introduire un mode watch supplémentaire par package pour un gain
marginal en phase de production.

## Conséquences
- `pnpm start` (donc `node dist/main.js`, donc l'image Docker de la Phase
  10.1) fonctionne enfin — prérequis direct de la conteneurisation.
- Aucune nouvelle dépendance ajoutée.
- Tout nouveau package partagé doit suivre le même patron (`module:
  CommonJS`, `main`/`types` vers `dist/`) pour rester cohérent.
