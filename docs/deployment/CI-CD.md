# CI/CD

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
