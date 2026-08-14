# syntax=docker/dockerfile:1
# Build multi-stage via `turbo prune` (monorepo pnpm/Turborepo) — voir
# docs/PROMPT-MAITRE-SAAS.md §Phase 10.1. Contexte de build : la racine du
# monorepo (nécessaire à `turbo prune` pour résoudre les dépendances
# workspace @erp/*).

FROM node:20-alpine AS base
# libc6-compat : requis par certains modules natifs (ex. argon2) sur musl.
# openssl : node:20-alpine embarque déjà libssl.so.3 mais pas le binaire
# openssl (utilisé par le script de détection de Prisma au moment de
# `prisma generate`) — sans lui, la détection échoue et Prisma télécharge un
# moteur ciblant la mauvaise version d'OpenSSL, qui plante silencieusement
# au runtime (erreur non-JSON, vécu en vérifiant cette Phase 10.1).
RUN apk add --no-cache libc6-compat openssl
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
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001 -G nodejs
COPY --from=builder --chown=nestjs:nodejs /app .
USER nestjs
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
