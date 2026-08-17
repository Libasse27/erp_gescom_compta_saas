# CI/CD

## Incident résolu (2026-08-17) : `pnpm test` échouait à 100% sur GitHub Actions depuis la Phase 10.2

Le pipeline CI a été mis en place en Phase 10.2 mais n'avait jamais réellement
réussi une seule fois sur GitHub Actions — chaque run échouait à l'étape
`Tests` en ~5 secondes (jamais assez de temps pour exécuter réellement les
326+ tests), jamais remarqué plus tôt faute de `gh` authentifié pour lire les
logs, et jamais reproduit en local. Diagnostiqué le 2026-08-17 en repérant que
Turborepo 2.x est en `envMode: "strict"` par défaut : une tâche `turbo run`
ne voit que les variables d'environnement déclarées dans `turbo.json`, jamais
tout l'environnement du process parent. Le bloc `env:` de `ci.yml`
(`DATABASE_URL`, secrets JWT/webhooks…) n'atteignait donc jamais le process
Jest de `@erp/api`, qui échouait immédiatement avec `DATABASE_URL manquant`.
**Jamais reproduit en local** parce que `apps/api/.env` (fichier réel,
gitignored) sert de filet de secours à `dotenv.config()` dans
`global-setup.js`/`setup-env.js`, indépendamment de ce que `turbo` transmet —
en CI ce fichier n'existe pas, donc aucun filet.

**Corrigé** par `turbo.json` → `globalPassThroughEnv` (liste explicite des
variables requises, transmises sans participer au hash de cache). Vérifié
réellement : reproduction locale de l'échec exact (`apps/api/.env` déplacé
temporairement + `turbo run test --filter=@erp/api` avec seulement les
variables façon CI dans le shell → même erreur `DATABASE_URL manquant`),
puis confirmation que l'ajout de `globalPassThroughEnv` résout ce cas précis
(60/60 suites, 328/328 tests, `.env` toujours absent) avant de restaurer le
fichier et de relancer la suite complète normalement.

## État actuel (Phase 10.2) : intégration continue seule

Le pipeline `.github/workflows/ci.yml` s'exécute sur chaque `push`/`pull_request`
vers `main`. Un seul job (`ci`), étapes bloquantes dans l'ordre imposé par
`CLAUDE.md` §2 :

```
pnpm install --frozen-lockfile
pnpm --filter=@erp/api exec prisma generate   # voir note ci-dessous
pnpm typecheck
pnpm lint
pnpm build
pnpm test
pnpm test:tenant
```

Toute étape en échec arrête le job — aucune n'est facultative, y compris
`test:tenant` (règle non négociable, `CLAUDE.md` §5 / `docs/PROMPT-MAITRE-SAAS.md` §E).

Un service container `postgres:16-alpine` (identifiants de dev, identiques à
`docker/docker-compose.dev.yml` — pas des secrets) fournit une base
`erp_saas_test` dédiée. Les migrations Prisma sur cette base s'appliquent
automatiquement au lancement de Jest (`apps/api/test/global-setup.js`), pas
via une étape CI séparée.

**Génération explicite du client Prisma** : `pnpm install` seul ne suffit pas
— le postinstall de `@prisma/client`, exécuté à la racine du monorepo, ne
trouve pas toujours `apps/api/prisma/schema.prisma`. Sans génération
explicite, `typecheck`/`build` échouent (le code importe des types générés
depuis le schéma). Même contrainte rencontrée et documentée en Phase 10.1
pour `apps/api/Dockerfile`.

## Pas de déploiement continu (CD) pour l'instant

Décision prise avec l'utilisateur en Phase 10 (voir `docs/PROMPT-MAITRE-SAAS.md`
§Phase 10) : cible d'hébergement VPS + Docker Compose, mais **aucun VPS réel
n'existe aujourd'hui**. Configurer un déploiement automatique nécessiterait
des secrets GitHub Actions (accès SSH ou registre Docker) pointant vers une
infrastructure qui n'existe pas encore — reporté.

Déploiement pour l'instant **manuel/scripté**, décrit dans `docs/PROMPT-MAITRE-SAAS.md`
Phase 10.1 : `scripts/prod-post-deploy.sh` + `docker compose -f docker/docker-compose.prod.yml`
sur le VPS cible, une fois provisionné.

## Étendre vers un déploiement automatique (à faire quand un VPS existe)

1. Ajouter un job `deploy` dans `ci.yml` (ou un workflow séparé
   `deploy.yml`), déclenché uniquement sur `push` vers `main` **après**
   succès du job `ci`, via `needs: ci`.
2. Secrets GitHub Actions à créer (Settings → Secrets and variables →
   Actions) : accès SSH au VPS (clé privée dédiée, jamais la clé
   personnelle) ou identifiants d'un registre Docker si les images sont
   poussées plutôt que construites sur le VPS.
3. Le job `deploy` type : build des images (`docker compose build`),
   push vers le registre si utilisé, connexion SSH au VPS,
   `docker compose pull && scripts/prod-post-deploy.sh && docker compose up -d`.
4. Protéger l'environnement de déploiement (GitHub Environments) avec une
   validation manuelle avant le premier déploiement en production réelle.

## Protection de branche (à activer manuellement, hors périmètre code)

Pour que `main` refuse tout merge dont `test:tenant` échoue (critère
d'acceptation Phase 10), activer sur GitHub :
Settings → Branches → Branch protection rules → `main` →
« Require status checks to pass before merging » → sélectionner le check
`ci`. Changement de paramètres du dépôt, pas un fichier de code — à faire
par un mainteneur ayant les droits d'administration du dépôt.
