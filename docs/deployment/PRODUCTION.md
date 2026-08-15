# Déploiement production (Phase 10 — vue d'ensemble)

Ce document est le point d'entrée : il assemble ce que documentent déjà
`CI-CD.md`, `MIGRATIONS.md`, `BACKUPS.md` et `LOGGING.md`, et couvre ce qui
n'était pas encore écrit — reverse proxy/HTTPS (10.6) et procédure complète
de premier déploiement sur un VPS neuf.

Cible retenue (Phase 10.1, confirmée avec l'utilisateur) : **VPS +
Docker Compose**, pas de plateforme managée.

## Prérequis sur le VPS

- Docker + Docker Compose v2 installés.
- Deux enregistrements DNS **A** pointant vers l'IP du VPS : un pour
  l'API, un pour le web (ex. `api.exemple.sn`, `app.exemple.sn`) — Caddy
  (10.6) en a besoin pour obtenir un certificat Let's Encrypt.
- Ports 80 et 443 ouverts (pare-feu du VPS/hébergeur) — Caddy en a besoin
  à la fois pour le challenge ACME (80) et le trafic HTTPS (443). Port 22
  (SSH) pour l'administration, aucun autre port n'a besoin d'être exposé
  (voir « Reverse proxy » ci-dessous : `api`/`web` ne publient plus de port
  depuis la Phase 10.6).

## Premier déploiement (VPS neuf)

```bash
git clone https://github.com/libasse27/erp_gescom_compta_saas.git
cd erp_gescom_compta_saas
cp docker/.env.prod.example docker/.env.prod
# Éditer docker/.env.prod : remplacer chaque "change-me" par une vraie
# valeur secrète (openssl rand -hex 32 pour les secrets, vrais domaines
# pour API_DOMAIN/WEB_DOMAIN/CORS_ALLOWED_ORIGINS/NEXT_PUBLIC_API_URL —
# doivent rester cohérents entre eux, voir docker/.env.prod.example).

docker compose --env-file docker/.env.prod -f docker/docker-compose.prod.yml up -d postgres
scripts/prod-post-deploy.sh          # migrations + rotation mot de passe erp_app_tenant (10.1/10.3)
docker compose --env-file docker/.env.prod -f docker/docker-compose.prod.yml up -d --build api web caddy
```

Caddy obtient automatiquement les certificats Let's Encrypt pour
`API_DOMAIN`/`WEB_DOMAIN` au premier démarrage (peut prendre quelques
dizaines de secondes) — surveiller `docker compose logs -f caddy` lors du
tout premier lancement.

## Reverse proxy et HTTPS (Phase 10.6)

Décision et alternatives écartées : `docs/adr/0017-caddy-reverse-proxy-https.md`.

`docker/Caddyfile` route par domaine vers les deux services internes :

```
API_DOMAIN  → api:3000
WEB_DOMAIN  → web:3001
```

Depuis cette phase, **`api` et `web` ne publient plus aucun port sur
l'hôte** (`docker-compose.prod.yml`) — Caddy, sur le réseau Docker interne
`erp_saas_prod`, est le seul point d'entrée externe. HTTPS automatique
(obtention et renouvellement) sans tâche cron séparée ; les certificats
sont persistés dans le volume nommé `erp_saas_caddy_data` (sans lui, Caddy
redemanderait un certificat neuf à chaque recréation du conteneur, au
risque de heurter le rate limit de Let's Encrypt).

### Vérifié — mécanisme de reverse proxy (sans domaine public réel)

Aucun VPS/domaine réel disponible dans cet environnement de développement
pour obtenir un vrai certificat Let's Encrypt (limite déjà rencontrée pour
la CD en 10.2 et la copie hors-hôte des sauvegardes en 10.4). Le mécanisme
de routage lui-même — ce que Caddy fait une fois un certificat en main,
identique que ce certificat vienne d'ACME ou du mode `tls internal` — a été
vérifié de bout en bout sur la stack Docker prod réelle :

1. `docker/Caddyfile.local-test` (variante `tls internal` — certificat
   auto-signé local, jamais utilisée en production, jamais montée par
   `docker-compose.prod.yml`) montée à la place de `docker/Caddyfile` via
   `docker/docker-compose.local-test-override.yml`, un fichier de
   surcharge Compose dédié à cette vérification :
   `docker compose --env-file docker/.env.prod -f docker/docker-compose.prod.yml -f docker/docker-compose.local-test-override.yml up -d --build api web caddy`.
2. Domaines de test (`api.local-test.internal`, `app.local-test.internal`)
   résolus vers `127.0.0.1` côté client via `curl --resolve` (pas de vraie
   entrée DNS nécessaire pour vérifier le routage).
3. Stack complète démarrée (`postgres` → migrations → `api`/`web`/`caddy`) :
   - `https://api.local-test.internal/health` (à travers Caddy, port 443)
     → `200 {"status":"ok",...}`, réponse identique à un appel direct au
     service `api`.
   - `https://app.local-test.internal/login` (à travers Caddy) → `200`,
     HTML SSR Next.js réel (même page que vérifiée en Phase 10.1).
   - `http://localhost:3000` et `http://localhost:3001` (les anciens ports
     publiés avant cette phase) → connexion refusée : confirme que `api`/
     `web` ne sont plus joignables autrement qu'à travers Caddy.
   - Requête `http://` (port 80, pas 443) sur `API_DOMAIN` → redirigée en
     `308` vers `https://` (comportement HTTPS automatique de Caddy, actif
     même en mode `tls internal`).
4. Stack éteinte proprement (`down -v`), `docker/.env.prod` supprimé.

## Migrations

`docs/deployment/MIGRATIONS.md` — déploiement automatisé
(`prisma migrate deploy`, déjà intégré à `scripts/prod-post-deploy.sh`) et
stratégie de rollback (résolution d'échec via
`scripts/db-migrate-resolve-failed.sh`, ou roll-forward).

## Sauvegardes

`docs/deployment/BACKUPS.md` — `scripts/db-backup.sh`/`scripts/db-restore.sh`,
vérifiés par une restauration réelle. Cron quotidien recommandé, à installer
une fois le VPS provisionné (ligne crontab documentée dans ce fichier).

## Logs et santé

`docs/deployment/LOGGING.md` — logs JSON structurés corrélés par
`requestId`/`tenantId`, `GET /health` (healthcheck Docker déjà branché sur
`api`).

## CI/CD

`docs/deployment/CI-CD.md` — intégration continue bloquante
(`typecheck`/`lint`/`build`/`test`/`test:tenant`) sur chaque push/PR.
Déploiement continu non couvert (pas de VPS cible réel à ce jour) — la
section « Étendre vers un déploiement automatique » de ce fichier documente
comment l'ajouter le jour où un VPS existe.

## Montée en charge — état actuel et limites connues

Pas de mise à l'échelle horizontale mise en place à ce commit (hors
périmètre sans charge réelle à absorber). Points à garder en tête pour une
évolution future, documentés plutôt qu'implémentés prématurément
(CLAUDE.md §9, incrémental) :

- **`api` est sans état entre requêtes** (le `TenantContext`/`RequestContext`
  sont de l'`AsyncLocalStorage` par requête, pas un état partagé) — répliquer
  le service `api` derrière Caddy (`reverse_proxy api:3000 api2:3000 ...`,
  round-robin natif) ne poserait pas de problème de cohérence applicative.
- **Postgres est une instance unique**, sans réplication ni bascule
  automatique — un point de défaillance unique. Une réplication (streaming
  replication Postgres, ou un service managé) serait la prochaine étape
  avant toute charge de production réelle, hors périmètre tant qu'aucun
  VPS/trafic réel n'existe.
- **Rate limiting** déjà en place au niveau applicatif (`ThrottlerGuard`,
  `CLAUDE.md` §6) — suffisant pour une seule instance `api` ; une réplication
  horizontale nécessiterait un stockage partagé pour les compteurs (Redis)
  plutôt que la mémoire du process actuelle.
