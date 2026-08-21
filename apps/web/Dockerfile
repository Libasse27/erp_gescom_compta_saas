# syntax=docker/dockerfile:1
# Contexte de build : la racine du monorepo (comme apps/api/Dockerfile).
# NEXT_PUBLIC_API_URL est inlinée au build (variable NEXT_PUBLIC_*), donc
# fournie en --build-arg, pas seulement en variable d'environnement runtime.

FROM node:24-alpine AS base
# Paquets Alpine (libssl3/libcrypto3...) : la version figée dans une image
# Node Alpine publiée peut être en retard sur les correctifs de sécurité
# du dépôt Alpine — CVE-2026-45447 (OpenSSL, use-after-free dans
# PKCS7_verify) détectée par Trivy en CI sur erp-web:ci, qui ne touchait
# jamais apk contrairement à apps/api/Dockerfile (dont le `apk add`
# installait déjà une version à jour, sans upgrade explicite). `apk
# upgrade` tire les derniers paquets disponibles dans l'index au moment du
# build, sans ajouter de nouveau paquet.
RUN apk upgrade --no-cache
# npm embarque ses propres dépendances internes (tar, glob, minimatch,
# cross-spawn, brace-expansion, ip-address, sigstore, picomatch) — la
# version fournie par les images Node Alpine embarquait des CVE connues
# (dont une CRITICAL sur tar, CVE-2026-59873) détectées par le scan Trivy de
# l'image en CI (P-01, voir apps/api/Dockerfile pour le contexte complet).
# Jamais invoquées par notre code, mais présentes dans l'image scannée.
# Version épinglée (pas `npm@latest`), volontairement conservée à 10.9.9
# pour la stabilité/reproductibilité du build : tar/glob/minimatch y sont
# déjà corrigés en interne, compatible Node >=20.5.0. Note historique : ce
# pin évitait aussi, à l'origine, `npm@latest` (passé en npm 12, exigeant
# Node >=22) sur la base node:20-alpine alors utilisée (vécu en vérifiant ce
# correctif) — CI-02 (passage à node:24-alpine) lève cette contrainte
# précise, mais ne change pas ce choix : aucune mise à niveau de package
# manager ici, périmètre strictement limité à la migration du runtime.
RUN npm install -g npm@10.9.9
RUN corepack enable
RUN npm install -g turbo@2.1.3

FROM base AS pruner
WORKDIR /app
COPY . .
RUN turbo prune @erp/web --docker

FROM base AS builder
WORKDIR /app
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
# Même remarque que apps/api/Dockerfile : tsconfig.base.json n'est pas dans
# le graphe de workspaces élagué par turbo prune.
COPY --from=pruner /app/tsconfig.base.json ./tsconfig.base.json
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
# Active output:"standalone" (apps/web/next.config.mjs) uniquement ici — sur
# Windows, ce mode échoue en dehors de Docker (liens symboliques EPERM).
ENV DOCKER_BUILD=true
RUN pnpm turbo run build --filter=@erp/web...

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
# npm/npx ne sont jamais invoqués au runtime (sortie standalone Next.js,
# self-suffisante — voir COPY ci-dessous) — supprimés plutôt que rustinés
# version par version : leurs dépendances internes bundlées (sigstore,
# tuf-js...) ne sont pas toutes à jour même dans la dernière version 10.x
# (P-01, Trivy). Voir apps/api/Dockerfile pour le contexte complet.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001 -G nodejs
# Pas de apps/web/public/ pour l'instant (aucun asset statique) — à
# réintroduire ici (COPY --from=builder /app/apps/web/public ./apps/web/public)
# le jour où ce dossier apparaît.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
USER nextjs
ENV PORT=3001
EXPOSE 3001
CMD ["node", "apps/web/server.js"]
