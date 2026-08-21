# syntax=docker/dockerfile:1
# Build multi-stage via `turbo prune` (monorepo pnpm/Turborepo) — voir
# docs/PROMPT-MAITRE-SAAS.md §Phase 10.1. Contexte de build : la racine du
# monorepo (nécessaire à `turbo prune` pour résoudre les dépendances
# workspace @erp/*).

FROM node:24-alpine AS base
# libc6-compat : requis par certains modules natifs (ex. argon2) sur musl.
# openssl : node:24-alpine embarque déjà libssl.so.3 mais pas le binaire
# openssl (utilisé par le script de détection de Prisma au moment de
# `prisma generate`) — sans lui, la détection échoue et Prisma télécharge un
# moteur ciblant la mauvaise version d'OpenSSL, qui plante silencieusement
# au runtime (erreur non-JSON, vécu en vérifiant cette Phase 10.1).
RUN apk add --no-cache libc6-compat openssl
# npm embarque ses propres dépendances internes (tar, glob, minimatch,
# cross-spawn, brace-expansion, ip-address, sigstore, picomatch) — la
# version fournie par les images Node Alpine embarquait des CVE connues
# (dont une CRITICAL sur tar, CVE-2026-59873) détectées par le scan Trivy de
# l'image en CI (P-01). Jamais invoquées par notre code (seul
# `node dist/main.js` tourne au runtime), mais présentes dans l'image
# scannée — mise à jour explicite plutôt que d'ignorer le résultat du scan.
# Version épinglée (pas `npm@latest`), volontairement conservée à 10.9.9
# pour la stabilité/reproductibilité du build : tar/glob/minimatch y sont
# déjà corrigés en interne, compatible Node >=20.5.0. Note historique : ce
# pin évitait aussi, à l'origine, `npm@latest` (passé en npm 12, exigeant
# Node >=22) sur la base node:20-alpine alors utilisée (vécu en vérifiant ce
# correctif sur GitHub Actions) — CI-02 (passage à node:24-alpine) lève
# cette contrainte précise, mais ne change pas ce choix : aucune mise à
# niveau de package manager ici, périmètre strictement limité à la
# migration du runtime.
RUN npm install -g npm@10.9.9
RUN corepack enable
RUN npm install -g turbo@2.1.3

FROM base AS pruner
WORKDIR /app
COPY . .
RUN turbo prune @erp/api --docker

FROM base AS builder
WORKDIR /app
# Étape d'install séparée de la copie des sources : seuls les package.json
# (out/json) invalident ce cache, pas chaque modification de code.
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
# turbo prune ne copie que le graphe de workspaces (packages/apps) ; les
# fichiers racine référencés via "extends" (tsconfig) n'en font pas partie
# et doivent être copiés explicitement depuis le stage pruner (non élagué).
COPY --from=pruner /app/tsconfig.base.json ./tsconfig.base.json
# Le client Prisma doit être généré AVANT `nest build` : le code source
# importe des types spécifiques au schéma (Prisma.XxxWhereInput, modèles...)
# qui n'existent qu'une fois générés, pas dans le client par défaut.
RUN pnpm --filter=@erp/api exec prisma generate
RUN pnpm turbo run build --filter=@erp/api...

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
# npm n'est jamais invoqué au runtime (seul `node dist/main.js` tourne) —
# pnpm reste nécessaire (via corepack, resté actif) pour `docker compose run
# api pnpm ... prisma migrate deploy` (scripts/prod-post-deploy.sh), mais
# npm lui-même non. Supprimé plutôt que rustiné version par version : ses
# dépendances internes bundlées (sigstore, tuf-js...) ne sont pas toutes à
# jour même dans la dernière version 10.x (P-01, Trivy) — les supprimer
# élimine la surface d'attaque au lieu de la patcher au cas par cas.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001 -G nodejs
COPY --from=builder --chown=nestjs:nodejs /app .
USER nestjs
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
