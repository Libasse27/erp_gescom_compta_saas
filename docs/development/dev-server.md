# Serveur de développement API — pourquoi `--exec` est nécessaire

`apps/api`'s `pnpm dev` (`nest start --watch`) doit être lancé avec :

```json
"dev": "nest start --watch --exec \"node -r ts-node/register/transpile-only\""
```

**Ne jamais revenir à `nest start --watch` seul** — le serveur crashe au
démarrage avec `ERR_MODULE_NOT_FOUND` dès qu'il touche `@erp/validation` ou
`@erp/permissions`.

## Cause

`packages/validation` et `packages/permissions` (comme `@erp/types` et
`@erp/auth`) exposent `"main": "src/index.ts"` — la source TypeScript brute,
jamais un `dist/` compilé. C'est volontaire : `apps/web` (bundler Next.js) et
les commandes `typecheck`/`build`/`test` de chaque package consomment cette
source directement sans problème.

Mais `nest start --watch` compile uniquement le code d'`apps/api` lui-même
(via `tsc`), puis exécute le résultat avec `node` nu. Quand ce process Node
résout `require("@erp/validation")`, il tombe sur le fichier `.ts` brut.
Node (support natif du TypeScript, actif par défaut sur les versions
récentes) tente de le charger directement — mais sa résolution ESM interne
exige des extensions explicites sur les imports relatifs
(`export * from "./auth"` dans `packages/validation/src/index.ts`), alors
que ces packages sont écrits en résolution "Bundler" (extensions
optionnelles). Résultat : `ERR_MODULE_NOT_FOUND`.

## Pourquoi pas une autre solution

- **Ajouter les extensions `.ts` dans les exports/imports relatifs** : casse
  la compilation `tsc --watch` d'`apps/api` elle-même, qui tire ces fichiers
  dans son propre graphe de compilation (car `"types"` pointe aussi sur la
  source) et leur applique le tsconfig d'`apps/api` (`allowImportingTsExtensions`
  n'y est pas activé, et l'activer casserait l'émission JS réelle dont
  `apps/api` a besoin).
- **`--builder swc`** : ne résout rien — SWC ne transpile que le code source
  d'`apps/api`, jamais les packages workspace externes chargés via
  `require()` au runtime.

## Solution retenue

`--exec "node -r ts-node/register/transpile-only"` enregistre le hook
`require()` de `ts-node` **avant** que Node touche `@erp/validation`/
`@erp/permissions`. `ts-node` intercepte alors ces `.ts` en utilisant le
tsconfig propre à *chaque package* (résolution "Bundler", extensions
optionnelles) — pas celui d'`apps/api` — donc aucune modification des
packages partagés n'est nécessaire.
