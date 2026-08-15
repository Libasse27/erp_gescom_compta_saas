# Logs structurés et sonde de santé (Phase 10.5)

## Pourquoi un logger maison plutôt qu'une dépendance (pino, winston...)

`CLAUDE.md` §3 impose de justifier tout ajout de dépendance non triviale.
Le besoin ici — une ligne JSON par événement, corrélée à un `requestId` et,
quand pertinent, à un `tenantId`/`userId` — ne nécessite ni transport
réseau, ni rotation de fichiers, ni multi-destination : `console.log`/
`console.error` suffisent, Docker capture déjà stdout/stderr comme flux de
logs (`docker logs`, ou n'importe quel driver de logging Docker/agrégateur
branché dessus). Un logger applicatif complet (pino, winston) apporterait
des fonctionnalités (transports, sérialiseurs, benchmarks de perf extrême)
inutiles à ce stade, pour un coût de dépendance et de surface d'API non
nul. `StructuredLoggerService` (`src/common/logging/structured-logger.service.ts`)
fait ~110 lignes, sans dépendance, et implémente l'interface `LoggerService`
de Nest — ce qui lui permet de remplacer le logger par défaut sans toucher
au code qui fait déjà `new Logger(context)` ailleurs dans l'application
(bootstrap Nest inclus).

## Comment la corrélation fonctionne

Deux `AsyncLocalStorage` indépendants, tous deux lus par
`StructuredLoggerService` au moment d'écrire chaque ligne :

- **`RequestContext`** (`common/logging/request-context.ts`) — un
  `requestId` par requête HTTP, **toujours** présent (y compris routes
  publiques : login, register, `/health`). Peuplé en tout premier par
  `RequestContextMiddleware`, qui réutilise l'en-tête `X-Request-Id` entrant
  s'il existe (un reverse proxy en amont, Phase 10.6, en fournira un) ou en
  génère un sinon, et le renvoie dans la réponse pour permettre au client de
  corréler ses propres logs.
- **`TenantContext`** (`tenant/tenant-context.ts`, déjà existant depuis la
  Phase 3) — `tenantId`/`userId`, uniquement pour les requêtes authentifiées
  avec un JWT portant un `enterpriseId`. Non modifié par cette phase.

`app.module.ts` déclare l'ordre des middlewares — **significatif** :

```
RequestContextMiddleware   (englobe toute la requête)
  → TenantContextMiddleware  (peuple TenantContext si authentifié)
    → HttpLoggingMiddleware    (enregistre son listener 'finish' en dernier)
```

`HttpLoggingMiddleware` doit être le dernier maillon : il enregistre son
listener `res.on('finish', ...)` à l'intérieur de la chaîne de middlewares
déjà ouverte par les deux `AsyncLocalStorage.run()` précédents — c'est ce
qui permet au listener, bien qu'il se déclenche après coup (à la fin de la
requête), de lire encore `requestId`/`tenantId` au moment de sa création.
Un listener enregistré plus tôt dans la chaîne ne verrait pas le
`TenantContext` posé plus tard par `TenantContextMiddleware`.

## Format d'une ligne de log

Une ligne JSON par événement (format « JSON lines », consommable tel quel
par Loki/CloudWatch/ELK ou simplement `docker logs | jq`) :

```json
{
  "timestamp": "2026-08-15T21:32:15.815Z",
  "level": "log",
  "message": "GET /customers 200 12.3ms",
  "context": "HTTP",
  "method": "GET",
  "path": "/customers",
  "statusCode": 200,
  "durationMs": 12.3456,
  "requestId": "115ac8ab-3a86-4b3b-a024-0d2d115c9bbc",
  "tenantId": "…",
  "userId": "…"
}
```

`tenantId`/`userId` absents pour les routes publiques (pas d'erreur, juste
le champ omis). Niveau minimal contrôlé par `LOG_LEVEL` (`verbose` <
`debug` < `log` < `warn` < `error` < `fatal`, défaut `log` — masque
`debug`/`verbose` en production sans configuration). `error`/`fatal`
partent sur `stderr`, tout le reste sur `stdout` — séparation standard,
utile pour filtrer les erreurs dans `docker compose logs`.

## `GET /health`

`src/health/health.controller.ts` — hors du préfixe `/v1` (comme les
webhooks de paiement, `main.ts`) : une sonde d'infra ne doit pas dépendre du
versionnage de l'API. Vérifie une vraie connectivité Postgres
(`SELECT 1` via `PrismaService`, hors `TenantContext` par nature — même
catégorie qu'`AuthService`/`ProvisioningService`, `docs/adr/0008-...`) —
répond `200 { status: "ok", database: "ok", uptimeSeconds, timestamp }` ou
`503 { status: "error", database: "error", ... }`, jamais `200`
inconditionnel.

`docker-compose.prod.yml` (service `api`) déclare un `healthcheck` Docker
dessus. Pas de `curl`/`wget` dans l'image runner (Alpine minimal, Phase
10.1) : la sonde utilise `node -e "require('http').get(...)"`, déjà présent
dans l'image, pour éviter d'ajouter un paquet uniquement pour ça.

## Vérifié

- **Unitaire** (`structured-logger.service.spec.ts`, 9 tests) : format JSON,
  absence de champs de corrélation hors contexte, présence combinée
  `requestId`+`tenantId`/`userId` quand les deux contextes sont actifs,
  extraction `trace`/`context` selon la convention d'appel de Nest
  (`error(message, trace, context)`), filtrage `LOG_LEVEL`, routage
  `stdout`/`stderr` selon le niveau.
- **Intégration `/health`** (`health.integration.spec.ts`) : vraie requête
  HTTP sur une app Nest complète, connectée à Postgres réel — `200`, corps
  correct, **et** confirmation que `/v1/health` répond `404` (l'exclusion du
  préfixe fonctionne réellement, pas seulement dans la config).
- **Intégration corrélation** (`logging.integration.spec.ts`) : preuve de
  bout en bout que l'assemblage des trois middlewares fonctionne dans le
  bon ordre — une requête publique (`GET /plans`) obtient un `requestId`
  dans son log HTTP sans `tenantId` ; un `X-Request-Id` fourni par le client
  est réutilisé tel quel (pas régénéré) ; une requête authentifiée réelle
  (login via `/auth/login`, puis `GET /customers` avec le token) produit une
  ligne de log HTTP dont `tenantId`/`userId` correspondent exactement à
  l'entreprise et l'utilisateur du test — capturé en interceptant
  `console.log` pendant le test, pas en inspectant le code seulement.
- `pnpm typecheck`/`lint`/`test`/`test:tenant`/`build` verts sans
  régression sur le reste du monorepo (voir note de phase dans
  `docs/PROMPT-MAITRE-SAAS.md`).

## Écarts assumés

- Pas d'agrégateur de logs branché (Loki, CloudWatch...) — hors de portée
  sans VPS cible réel, même limite que la CD (Phase 10.2) et la copie
  hors-hôte des sauvegardes (Phase 10.4). Le format JSON lines choisi est
  compatible avec la plupart d'entre eux sans transformation.
- Pas de healthcheck Docker pour `apps/web` à ce commit (scope de cette
  phase limité à l'API, qui porte la logique métier et la connexion
  Postgres) — `apps/web` réutilise l'exposition HTTP déjà vérifiée en Phase
  10.1 (`GET /login` → 200).
