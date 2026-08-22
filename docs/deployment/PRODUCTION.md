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

## Mise à jour d'un déploiement existant (P3)

La section « Premier déploiement » ci-dessus couvre un VPS neuf. Ce qui
suit s'applique à un VPS déjà en service, code déjà cloné.

**Point structurel à connaître avant de suivre cette procédure** :
`docker-compose.prod.yml` n'a pas de clé `image:` pour `api`/`web` — chaque
déploiement **reconstruit l'image localement** à partir du code source
(`git pull`), il n'existe ni registre ni tag d'image versionné. Le
`docker build` du CI (`.github/workflows/ci.yml`, P-02) est jetable, jamais
publié — « CI vert » signifie « ce commit se construit et passe les tests »,
pas « voici l'image qui tournera en production ». Un rollback applicatif
revient donc à revenir à un **commit Git** puis reconstruire, jamais à
« changer un tag d'image ».

```bash
git fetch
git log <sha-actuellement-deployé>..<nouveau-sha>   # revue humaine : y a-t-il une migration incluse ?
git tag pre-deploy-$(date +%Y%m%d-%H%M%S) HEAD       # marqueur de retour arrière, avant de bouger
git pull
scripts/prod-post-deploy.sh                          # migrate deploy — TOUJOURS avant de redémarrer api/web
docker compose --env-file docker/.env.prod -f docker/docker-compose.prod.yml up -d --build api web
scripts/smoke-test.sh --base-url https://<API_DOMAIN> --login-email <compte-de-test> --login-password <...>
```

L'ordre `migrate deploy` **avant** `up -d --build api/web` n'est pas
optionnel : c'est ce qui garantit que l'API ne démarre jamais face à un
schéma qu'elle ne connaît pas encore. `scripts/smoke-test.sh` (nouveau,
voir ci-dessous) est la dernière étape — un déploiement qui n'a pas encore
passé le smoke test n'est pas considéré terminé.

## Rollback applicatif — ce que c'est, et ce que ce n'est pas

**Une image Docker précédente n'est pas une sauvegarde de la base de
données.** Revenir au code d'hier ne fait rien aux données d'aujourd'hui —
si le problème vient des données (migration destructive, corruption), le
rollback applicatif seul ne répare rien et peut aggraver la situation (code
ancien écrivant dans un schéma qu'il ne comprend pas correctement).

Trois notions distinctes, à ne jamais confondre :

| | Rollback **applicatif** (code) | Rollback de **migration** | Restauration de **backup** |
|---|---|---|---|
| Portée | Revenir à un commit antérieur, reconstruire, redémarrer `api`/`web` | Débloquer/corriger `_prisma_migrations` (`scripts/db-migrate-resolve-failed.sh`) — jamais de DDL inverse automatique | Écraser les données depuis un dump (`scripts/db-restore.sh`) |
| Documenté | Ci-dessous | `docs/deployment/MIGRATIONS.md` | `docs/deployment/BACKUPS.md` |
| Répare une perte de données ? | **Non** | Non (Prisma ne génère pas de "down") | Oui, jusqu'au RPO (24h, voir BACKUPS.md) |

### Quand un rollback applicatif seul est sûr — et quand il est interdit

| Situation | Action |
|---|---|
| Nouveau code, aucune migration appliquée depuis le déploiement précédent | 🟢 rollback vers le commit précédent : `git checkout pre-deploy-<horodatage>`, rebuild, restart |
| Migration additive appliquée (nouvelle colonne/table optionnelle) et le code précédent l'ignore sans erreur | 🟢 rollback possible **après vérification manuelle** que l'ancien code ne dépend d'aucun objet ajouté |
| Migration destructive ou incompatible (colonne supprimée/renommée, contrainte `NOT NULL` ajoutée, type changé) | 🔴 rollback applicatif seul **interdit** — le code précédent ne comprend pas le schéma actuel. Écrire une migration corrective (roll-forward) avant tout retour en arrière du code |
| Migration en échec au déploiement (`P3018`) | 🔴 arrêter, diagnostiquer via `docs/deployment/MIGRATIONS.md` (niveau 1) — jamais redémarrer `api` avant résolution |
| Données corrompues ou perdues | 🔴 restauration de backup selon `docs/deployment/BACKUPS.md`, jamais un rollback de code seul |

### Procédure de rollback applicatif (cas sûr uniquement)

```bash
git checkout pre-deploy-<horodatage>          # tag posé avant le déploiement problématique
docker compose --env-file docker/.env.prod -f docker/docker-compose.prod.yml up -d --build api web
scripts/smoke-test.sh --base-url https://<API_DOMAIN> --login-email <compte-de-test> --login-password <...>
git checkout main                              # revenir sur la branche après vérification
```

### Conteneur qui ne démarre pas, ou démarre mais reste `unhealthy`

`restart: unless-stopped` (tous les services, `docker-compose.prod.yml`)
redémarre un conteneur qui **crashe** (boucle si l'erreur persiste), mais
ne fait **rien** pour un conteneur qui démarre et reste `unhealthy` — Docker
Compose hors mode Swarm n'agit pas sur l'état de healthcheck. Un
déploiement dont les conteneurs affichent `Up` n'est donc pas
nécessairement sain :

```bash
docker compose --env-file docker/.env.prod -f docker/docker-compose.prod.yml ps   # colonne STATUS : Up ≠ healthy
docker compose --env-file docker/.env.prod -f docker/docker-compose.prod.yml logs api
```

## Smoke test (`scripts/smoke-test.sh`)

Deux contrôles obligatoires, aucun ne se fie au seul code de sortie de
`curl` (qui reste 0 même sur une réponse 404/500 sans l'option `-f`) — le
code HTTP est toujours extrait explicitement (`-w '%{http_code}'`) et
comparé :

1. `GET /health/ready` doit répondre **exactement** `200` (pas
   `/health/live`, qui ne vérifie aucune dépendance et ne détecterait pas
   une panne Postgres — P-06).
2. Un endpoint métier authentifié (`/v1/auth/me` par défaut, override via
   `--business-path`) doit répondre `2xx` — preuve que JWT, `TenantContext`
   et RLS fonctionnent de bout en bout, pas seulement que Postgres répond à
   `SELECT 1`.

Échec de l'un ou l'autre → code de sortie `1`. Voir
`scripts/smoke-test.sh --help` pour les options (authentification par
`--token` déjà obtenu, ou `--login-email`/`--login-password`).

**Vérifié en local** (stack `pnpm dev` réelle, pas simulée) : succès
nominal (200 + 2xx, exit 0), puis trois scénarios d'échec confirmés propres
(exit 1 avec message explicite, jamais un plantage brut) — mauvais mot de
passe (401 au login), endpoint métier inexistant (404), et hôte injoignable
(`curl` échoue, code rapporté `000` plutôt que de faire avorter le script
sous `set -e`). **Non vérifié** : exécution contre un VPS staging réel
(aucun VPS provisionné à ce jour, voir `docs/deployment/STAGING.md`).

## Sauvegardes

`docs/deployment/BACKUPS.md` — `scripts/db-backup.sh`/`scripts/db-restore.sh`,
vérifiés par une restauration réelle, et copie hors-hôte chiffrée
(`scripts/backup-offsite-sync.sh`/`backup-offsite-fetch.sh`, `age` + `rclone`
vers un stockage S3-compatible). Cron quotidien recommandé, à installer une
fois le VPS provisionné (ligne crontab documentée dans ce fichier).

## Logs et santé

`docs/deployment/LOGGING.md` — logs JSON structurés corrélés par
`requestId`/`tenantId`. Trois routes de sonde (P-06, hors préfixe `/v1`) :
`GET /health/live` (aucune dépendance externe, sert à décider un
redémarrage), `GET /health/ready` (vérifie Postgres, sert à décider une
sortie de rotation), `GET /health` (alias de `/health/ready`, conservé pour
compatibilité — c'est lui que le healthcheck Docker de `api` utilise
aujourd'hui).

## Rotation des secrets de paiement (BIL-22)

Corrige `docs/audit/BILLING-AUDIT.md` BIL-22 : aucune procédure n'était
écrite pour faire tourner `PAYMENT_WEBHOOK_SECRET_WAVE` /
`_ORANGE_MONEY` / `_FREE_MONEY` / `_STRIPE` / `_CARD` (`docker/.env.prod`,
lus par `env.paymentWebhookSecret()`) une fois un vrai fournisseur branché
— à prévoir avant cette intégration, pas après.

**Limite structurelle à connaître avant de dérouler cette procédure** :
chaque fournisseur n'a aujourd'hui qu'**un seul** secret actif côté
plateforme (une valeur par variable d'environnement, pas de fenêtre où deux
secrets seraient simultanément valides côté `api`). Deux cas :

- **Le fournisseur supporte une période de transition** (plusieurs secrets
  de signature actifs simultanément sur son tableau de bord, ex. Stripe) :
  la séquence ci-dessous est alors réellement sans coupure.
- **Le fournisseur remplace le secret de façon atomique** (pas de
  transition) : un très bref écart est possible entre le moment où le
  fournisseur signe avec le nouveau secret et celui où `api` a redémarré
  avec ce même secret. Ce n'est pas silencieux : un webhook livré pendant
  cet écart reçoit un `401` (signature invalide) et **la quasi-totalité des
  fournisseurs de paiement retentent automatiquement un webhook en échec**
  ; l'idempotence déjà en place (`@@unique([provider, providerReference])`,
  BIL-01) garantit qu'un rejeu après coup est traité exactement une fois,
  sans perte ni doublon. Minimiser cet écart en préparant chaque étape à
  l'avance (secret déjà généré, commande de redéploiement déjà prête) plutôt
  qu'en l'improvisant.

Séquence :

1. **Identifier le secret concerné et son fournisseur** (une variable = un
   fournisseur, jamais de valeur partagée entre deux fournisseurs).
2. **Générer le nouveau secret côté fournisseur** (tableau de bord du
   fournisseur — jamais généré côté plateforme : c'est lui qui signera avec
   cette valeur).
3. **Mettre à jour `docker/.env.prod` sur le VPS** avec la nouvelle valeur
   (édition directe sur l'hôte — ce fichier n'est jamais commité, voir
   `docker/.env.prod.example`).
4. **Redéployer `api` pour charger le nouveau secret** :
   ```bash
   docker compose --env-file docker/.env.prod -f docker/docker-compose.prod.yml up -d api
   ```
5. **Déclencher un événement de test contrôlé** depuis le tableau de bord du
   fournisseur (fonction « envoyer un webhook de test », quand elle existe)
   et vérifier une réponse `200`.
6. **Vérifier les logs immédiatement après** (`docs/deployment/LOGGING.md`)
   — rechercher une fenêtre de temps sans aucun `PAYMENT_WEBHOOK_REJECTED`
   dont `reason: "invalid_signature_or_timestamp"` pour ce fournisseur ;
   la présence d'un seul rejet de ce type juste après le redéploiement est
   le signal que le nouveau secret n'est pas encore correctement pris en
   compte des deux côtés.
7. **Révoquer l'ancien secret côté fournisseur seulement après cette
   validation** — jamais avant, jamais en même temps que l'étape 4.
8. **Ne jamais écrire la valeur du secret elle-même** dans Git, un log, ce
   fichier ou `docs/audit/BILLING-AUDIT.md` — seule la procédure est
   documentée ici, jamais une valeur réelle (voir Gitleaks ci-dessous).

Gitleaks (`.github/workflows/ci.yml`, step « Scan de secrets (bloquant) »)
est déjà une garde CI bloquante sur tout le dépôt, y compris ces secrets de
paiement — BIL-22 ne la modifie pas, elle n'a pas besoin d'être dupliquée
ici.

## Monitoring et alerting (P-08)

`docs/deployment/MONITORING.md` — tracking d'erreurs Sentry (désactivé par
défaut, `SENTRY_DSN` optionnel) sur `api` et `web`, marche à suivre pour un
moniteur d'uptime externe sur `/health/ready`. Métriques de
latence/débit historisées (Prometheus/Grafana) toujours hors périmètre, à
mettre en place avant un trafic de production réel significatif.

## Limites de ressources (P-04)

`docker-compose.prod.yml` définit `mem_limit`/`cpus` sur les 4 services
(`postgres`, `api`, `web`, `caddy`) — pas `deploy.resources.limits`, ignoré
par `docker compose up` hors mode Swarm. Valeurs par défaut conservatrices
pour un VPS mutualisé (`postgres` 1024M/1 vCPU, `api` 512M/1 vCPU, `web`
256M/0.5 vCPU, `caddy` 128M/0.25 vCPU), overridables sans toucher au fichier
via `docker/.env.prod` (`POSTGRES_MEM_LIMIT`, `API_MEM_LIMIT`, ...) une fois
le VPS cible connu et son RAM/CPU réels disponibles pour dimensionner
correctement, en particulier `postgres`.

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
