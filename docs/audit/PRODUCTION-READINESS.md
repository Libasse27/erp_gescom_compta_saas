# Audit — Préparation à la production (infrastructure, CI/CD, exploitation)

> Audit uniquement, aucune modification de code/infra. Périmètre : `docker/`,
> `apps/api/Dockerfile`, `apps/web/Dockerfile`, `.github/workflows/ci.yml`,
> `scripts/`, `apps/api/src/health`, `apps/api/src/common/logging`,
> `docs/deployment/`. Date : 2026-08-16.
>
> Méthode : chaque affirmation des commits `1efd7ed` (Docker 10.1), `412fc85`
> (CI 10.2), `574fdcd` (rollback migrations 10.3), `426daa2`+`753e2b2`
> (sauvegardes 10.4), `7fd0acf` (logs/health 10.5), `6b00b35` (Caddy 10.6) a
> été vérifiée en lisant directement le fichier concerné, pas sur la foi du
> message de commit. Constat général : **la documentation du projet est
> inhabituellement honnête sur ses propres limites** (chaque fichier
> `docs/deployment/*.md` contient une section « écarts assumés » ou
> équivalente) — plusieurs manques identifiés ci-dessous sont d'ailleurs déjà
> reconnus dans ces documents, mais restent des manques réels au sens de la
> checklist Definition of Done du rôle DevOps.

## Résumé par point demandé

| # | Sujet | Verdict |
|---|-------|---------|
| 4 | Docker | **Corrigé le 2026-08-17** — multi-stage OK, non-root OK, pas de secret en dur OK, healthcheck API OK, healthcheck `web` ajouté (P-05), limites CPU/mémoire sur les 4 services ajoutées (P-04) |
| 5 | CI/CD | Partiel — pipeline complet et **réellement vert sur GitHub Actions depuis le correctif du 2026-08-17** (run #6, P-10 : échouait à 100% des runs avant ça, jamais détecté) ; build Docker api/web ajouté en CI (P-02) ; SCA bloquant ajouté (P-01 partiel) ; **scan secrets/SAST/image toujours absent, pas de CD, pas de staging/E2E, protection de branche toujours non activée** (P-01 reste PARTIEL, P-03 reste OUVERT) |
| 6 | Backup/restore | Oui — chiffrement `age` réel (clé privée jamais sur le VPS), restauration réellement exercée avec preuve technique détaillée ; **RPO/RTO formalisés le 2026-08-17** (P-07), validation métier du chiffre encore à faire |
| 7 | Logs + /health | **Corrigé le 2026-08-17** — corrélation `requestId`/`tenantId`/`userId` réelle et testée, pas de fuite de secret constatée, `/health/live` + `/health/ready` séparés (P-06) |
| 8 | HTTPS/Caddy | Oui — HTTPS auto + redirection HTTP→HTTPS vérifiées (mode `tls internal`), CORS en liste blanche, helmet actif |
| 9 | Monitoring/alerting | **Non** — rien au-delà logs + health, aucun outil de métriques/erreurs/alerting |
| 10 | Secrets committés | Non trouvé — recherche large sans résultat concluant, `.env.prod` correctement ignoré |

---

## P-01 — Aucun scan de sécurité dans le pipeline CI

**Sévérité** : HIGH
**Composant** : `.github/workflows/ci.yml`
**Description** : le pipeline exécute `install → prisma generate →
typecheck → lint → build → test → test:tenant` (lignes 74-103) — rien
d'autre. Aucune étape SCA (audit de dépendances), aucun scan de secrets
(gitleaks/trufflehog), aucun SAST, aucun scan d'image conteneur
(Trivy/Grype), aucun scan IaC. Confirmé par lecture intégrale du fichier :
6 étapes, toutes listées ci-dessus, aucune autre.
**Impact** : une dépendance vulnérable, un secret accidentellement commité,
ou une faille de code introduite par un changement ne serait détectée par
aucun contrôle automatique avant merge sur `main`.
**Risque** : exposition de vulnérabilités connues en production sur un
système traitant des données financières/comptables réelles ; détection
tardive (audit manuel futur) plutôt qu'au moment du commit.
**Fichier(s)** : `.github/workflows/ci.yml:41-103`
**Solution** : ajouter au job existant (ou un job parallèle) : `pnpm audit`
ou équivalent (SCA), un scan de secrets (gitleaks en mode pre-commit et en
CI), un scan d'image après build Docker (Trivy, bloquant sur high/critical)
une fois les images buildées en CI (actuellement les Dockerfiles ne sont
même pas construits en CI — voir P-02).
**Priorité** : P1
**Statut** : PARTIEL (2026-08-17) — SCA ajouté (`scripts/ci-audit-gate.sh`,
bloquant sur les avis high/critical *avec correctif publié* ; 7 des 9 avis
HIGH pré-existants corrigés par overrides pnpm, voir commit
`fix(deps): corriger multer/sharp/postcss...`). **Toujours ouvert** : scan
de secrets (gitleaks) et scan d'image Docker (Trivy, maintenant possible
depuis l'ajout du build d'image en CI, P-02) — ajout volontairement différé,
ce sont des actions GitHub tierces à faire valider explicitement avant
ajout (CLAUDE.md §3, dépendance non triviale).

---

## P-02 — Les images Docker ne sont jamais construites ni scannées en CI

**Sévérité** : MEDIUM
**Composant** : `.github/workflows/ci.yml`, `apps/api/Dockerfile`, `apps/web/Dockerfile`
**Description** : `pnpm build` (ligne 92-93) exécute le build Turborepo/TS
standard, pas `docker build`. Aucune étape du workflow ne référence
`docker build`, `docker/docker-compose.prod.yml`, ni les Dockerfiles.
**Impact** : un Dockerfile cassé (erreur de syntaxe, étape manquante,
dépendance système oubliée comme `openssl`/`libc6-compat` déjà rencontré et
documenté dans `apps/api/Dockerfile:8-14`) ne serait détecté qu'au moment
d'un déploiement manuel sur le VPS, pas avant.
**Risque** : déploiement bloqué ou échoué découvert en production plutôt
qu'en CI, alors même que les artefacts de production sont précisément ces
images.
**Fichier(s)** : `.github/workflows/ci.yml` (absence), `apps/api/Dockerfile`, `apps/web/Dockerfile`
**Solution** : ajouter une étape `docker build` (sans push) pour les deux
Dockerfiles dans le job CI, en complément du scan d'image de P-01.
**Priorité** : P2
**Statut** : CORRIGÉ (2026-08-17) — `docker build` direct (pas d'action
tierce) ajouté pour `apps/api/Dockerfile` et `apps/web/Dockerfile` dans
`.github/workflows/ci.yml`, après `test:tenant`. Scan de l'image obtenue
(Trivy) toujours ouvert, voir P-01.

---

## P-03 — Aucun déploiement continu, aucune étape staging/E2E, protection de branche non activée

**Sévérité** : MEDIUM
**Composant** : `.github/workflows/ci.yml`, paramètres GitHub du dépôt
**Description** : `docs/deployment/CI-CD.md` le documente lui-même sans
détour (lignes 35-45, 62-69) : pas de VPS cible existant, donc pas de job
`deploy`, pas d'environnement staging, pas de tests e2e/smoke automatisés
après build. La protection de branche (« Require status checks to pass »)
n'a pas non plus été activée — c'est un réglage GitHub hors du code, non
vérifiable par lecture de fichier, mais explicitement signalé comme
« à activer manuellement » dans la documentation elle-même, donc à traiter
comme non fait tant que non confirmé.
**Impact** : rien n'empêche aujourd'hui un merge sur `main` dont la CI a
échoué (si la protection de branche n'a jamais été activée côté GitHub) ;
et même une fois activée, aucune promotion automatisée vers un
environnement de test avant la production n'existe.
**Risque** : cohérent avec le stade du projet (pas de VPS réel encore
provisionné) — risque faible tant que le déploiement reste manuel et
délibéré, mais à ne pas oublier au moment du premier déploiement réel.
**Fichier(s)** : `.github/workflows/ci.yml`, `docs/deployment/CI-CD.md:35-69`
**Solution** : suivre le plan déjà écrit dans `CI-CD.md` §« Étendre vers un
déploiement automatique » lors du provisionnement du premier VPS ; activer
la protection de branche dès maintenant (ne dépend d'aucune infrastructure)
et vérifier son état actuel via `gh api repos/.../branches/main/protection`.
**Priorité** : P1 (protection de branche — ne coûte rien, à faire
immédiatement) / P3 (CD complet — dépend du provisioning VPS, hors
périmètre code)
**Statut** : OUVERT — vérifié le 2026-08-17 : `gh` n'est pas authentifié
dans cet environnement (`gh auth status` → non connecté), impossible
d'activer la protection de branche par API depuis ici. Reste à faire
manuellement (GitHub → Settings → Branches) ou via `gh auth login` +
`gh api repos/.../branches/main/protection` par un mainteneur habilité.

---

## P-04 — Aucune limite de ressources CPU/mémoire sur les conteneurs de production

**Sévérité** : MEDIUM
**Composant** : `docker/docker-compose.prod.yml`
**Description** : aucun service (`postgres`, `api`, `web`, `caddy`) ne
déclare de limite `deploy.resources.limits` ni `mem_limit`/`cpus` — vérifié
par lecture intégrale du fichier (126 lignes), aucune occurrence de ces
clés.
**Impact** : un service en fuite mémoire ou en boucle CPU (ex. une requête
mal formée déclenchant une requête Prisma coûteuse) peut affamer les autres
conteneurs sur le même VPS, y compris Postgres — risque direct de panne en
cascade sur un VPS mutualisé (topologie retenue, `docs/deployment/PRODUCTION.md`).
**Risque** : indisponibilité totale de la stack causée par un seul service
défaillant, sur une infrastructure à ressources limitées (contexte
budgétaire UEMOA, un seul VPS).
**Fichier(s)** : `docker/docker-compose.prod.yml` (absence sur les 4 services)
**Solution** : définir des limites explicites par service (ex. `api` :
512M/1 vCPU, `web` : 256M/0.5 vCPU, `postgres` : dimensionné selon la
RAM du VPS retenu, `caddy` : 128M/0.25 vCPU) via `deploy.resources.limits`
(Compose v2) ou `mem_limit`/`cpus` selon la version de Docker Compose
utilisée sur le VPS cible.
**Priorité** : P1 — à faire avant le premier déploiement réel, pas après.
**Statut** : CORRIGÉ (2026-08-17) — `mem_limit`/`cpus` (pas
`deploy.resources.limits`, ignoré hors Swarm par `docker compose up`)
définis sur les 4 services dans `docker-compose.prod.yml`, valeurs par
défaut conservatrices, overridables via `docker/.env.prod`. Dimensionnement
définitif (notamment `postgres`) toujours à ajuster une fois le VPS cible
réel connu.

---

## P-05 — Pas de `HEALTHCHECK`/healthcheck pour le service `web`

**Sévérité** : LOW
**Composant** : `docker/docker-compose.prod.yml`, `apps/web/Dockerfile`
**Description** : `docker-compose.prod.yml` définit un `healthcheck` pour
`postgres` (lignes 21-25) et `api` (lignes 59-70), mais aucun pour `web`
(lignes 74-89) — confirmé par lecture directe, absence de toute clé
`healthcheck` dans le bloc `web:`. `docs/deployment/LOGGING.md` (lignes
127-130) reconnaît explicitement cet écart (« Pas de healthcheck Docker
pour apps/web à ce commit »).
**Impact** : Docker/Caddy ne peuvent pas détecter automatiquement un `web`
qui répond mais sert des pages cassées (ex. erreur 500 SSR systématique) ;
`restart: unless-stopped` ne se déclenche que sur un crash process, pas sur
une dégradation applicative silencieuse.
**Risque** : dégradation utilisateur non détectée automatiquement par
l'orchestrateur (faible sévérité ici, un seul service `web` sans
réplication ni failover de toute façon à ce stade).
**Fichier(s)** : `docker/docker-compose.prod.yml:74-89`
**Solution** : ajouter un healthcheck `web` similaire à celui de `api`
(`node -e "require('http').get('http://localhost:3001/login', ...)"` ou une
route dédiée), cohérent avec l'absence de `curl`/`wget` dans l'image Alpine.
**Priorité** : P3
**Statut** : CORRIGÉ (2026-08-17) — healthcheck `web` ajouté dans
`docker-compose.prod.yml`, sonde Node sur `GET /login`, même approche que
`api`.

---

## P-06 — `/health` unique, pas de séparation `/health/live` / `/health/ready`

**Sévérité** : MEDIUM
**Composant** : `apps/api/src/health/health.controller.ts`
**Description** : un seul endpoint `GET /health` (lignes 17-39) vérifie la
connectivité Postgres (`SELECT 1`) et renvoie `200`/`503` en conséquence.
Le prompt maître DevOps (référentiel de ce rôle, §5) comme les conventions
Kubernetes/orchestrateurs standard distinguent : *liveness* (le process
tourne-t-il, sans dépendance externe — sert à décider un redémarrage) et
*readiness* (le service peut-il accepter du trafic, avec dépendances comme
la base — sert à décider une sortie de rotation load balancer). Ici les
deux notions sont fusionnées dans un seul endpoint.
**Impact** : en cas de perte de connectivité Postgres, l'unique `/health`
renvoie `503` — ce qui est correct pour la *readiness* (ne pas envoyer de
trafic), mais si ce même endpoint était un jour branché à une politique de
redémarrage automatique de conteneur (*liveness*), cela redémarrerait
inutilement un process API parfaitement sain alors que c'est Postgres qui
est en cause. Actuellement sans conséquence concrète (le `healthcheck`
Docker de `docker-compose.prod.yml:59-70` ne fait que sortir le conteneur
d'un `restart: unless-stopped`, pas de rotation de charge multi-instance),
mais devient un vrai problème dès qu'une réplication de `api` sera mise en
place (déjà anticipée dans `docs/deployment/PRODUCTION.md:131-134`).
**Risque** : redémarrages inutiles/en cascade lors d'un futur passage à
plusieurs instances `api`, au pire moment (pendant un incident Postgres).
**Fichier(s)** : `apps/api/src/health/health.controller.ts:17-39`
**Solution** : séparer `GET /health/live` (aucune dépendance externe,
répond `200` tant que le process Node tourne) et `GET /health/ready`
(vérifie Postgres, comportement actuel de `/health`) — conserver `/health`
en alias de `/health/ready` pour compatibilité si nécessaire.
**Priorité** : P2
**Statut** : CORRIGÉ (2026-08-17) — `GET /health/live` (aucune dépendance
externe) et `GET /health/ready` (vérifie Postgres) ajoutés dans
`health.controller.ts` ; `GET /health` conservé en alias de `/health/ready`,
toujours branché sur le healthcheck Docker `api` existant.

---

## P-07 — RPO/RTO non formalisés en chiffres malgré une restauration réellement exercée

**Sévérité** : LOW
**Composant** : `docs/deployment/BACKUPS.md`
**Description** : contrairement à la demande initiale d'audit qui
soupçonnait que « testé par restauration réelle » ne serait qu'un message
de commit sans preuve — **ce n'est pas le cas ici** : `docs/deployment/BACKUPS.md`
(lignes 153-184) décrit une procédure de vérification concrète et détaillée
(migration réelle, insertion de données de test multi-tenant, dump réel de
116 Ko, `TRUNCATE CASCADE` simulant un sinistre, restauration, vérification
explicite que la RLS fonctionne toujours après restauration y compris
l'absence totale de lignes visibles hors `TenantContext`). C'est une preuve
d'ingénierie sérieuse, pas une allégation vide. En revanche, aucun chiffre
de RPO (perte de données maximale tolérée) ni de RTO (durée maximale
d'indisponibilité tolérée) n'est formellement énoncé nulle part dans le
projet — seule la fréquence de sauvegarde (quotidienne, 3h du matin,
`BACKUPS.md:19-28`) permet de déduire un RPO implicite de ~24h, jamais
formalisé comme objectif métier validé.
**Impact** : sans RPO/RTO explicites et validés avec le métier, impossible
de savoir si une fréquence quotidienne est suffisante pour un ERP
comptable/facturation (une perte de 24h de facturation peut être
inacceptable pour certains tenants), ni de mesurer objectivement si la
procédure de restauration documentée (durée non chronométrée dans le test
décrit) respecte un objectif de temps de reprise.
**Risque** : décision de fréquence de sauvegarde prise par défaut technique
plutôt que par arbitrage métier explicite.
**Fichier(s)** : `docs/deployment/BACKUPS.md` (absence de section RPO/RTO)
**Solution** : formaliser avec `architect`/le métier un RPO et un RTO cible
par criticité de donnée (ex. RPO 24h acceptable pour les données de
paramétrage, RPO plus strict à envisager pour les écritures comptables
validées — éventuellement via une réplication en continu ou des sauvegardes
plus fréquentes si le RPO cible est inférieur à 24h) ; chronométrer la
prochaine restauration exercée pour obtenir un RTO mesuré, pas estimé.
**Priorité** : P2
**Statut** : CORRIGÉ partiellement (2026-08-17) — RPO cible (24h, déduit de
la cadence actuelle) et RTO (non chronométré, à mesurer au prochain exercice
réel) formalisés dans `docs/deployment/BACKUPS.md` §RPO/RTO. Validation
métier explicite (le RPO 24h est-il acceptable pour les écritures
comptables ?) toujours à faire, cf. `docs/audit/ACCOUNTING-AUDIT.md`.

---

## P-08 — Aucun outil de monitoring/alerting au-delà des logs et du health check

**Sévérité** : HIGH
**Composant** : ensemble du projet (absence transversale)
**Description** : recherche large (`prometheus`, `grafana`, `sentry`,
`datadog`, `alertmanager`, `opentelemetry`, `otel`, insensible à la casse)
sur l'ensemble du dépôt : **aucune occurrence dans le code ou la
configuration** (une seule occurrence trouvée, dans `pnpm-lock.yaml`, sans
rapport — probablement une dépendance transitive mentionnant le mot dans
sa description). Il n'existe strictement rien pour : suivre le taux
d'erreurs 5xx dans le temps, la latence p95/p99, les échecs de paiement
Mobile Money/webhook, ou déclencher une alerte (page/email/SMS) en cas de
dégradation. Le seul signal disponible est la sonde `/health` (poll manuel
ou via `docker healthcheck`, sans historique ni agrégation) et les logs
JSON bruts (sans agrégateur branché, reconnu explicitement dans
`docs/deployment/LOGGING.md:123-126`).
**Impact** : aucune détection proactive d'incident — une panne, une
dégradation de latence, ou une série d'échecs de paiement Wave/Orange
Money/Free Money ne serait remarquée que si un utilisateur se plaint ou si
quelqu'un consulte manuellement les logs/health. Contraire à la règle d'or
DevOps §5 (chaque service a des métriques exploitables) et §6.2 (alertes
sur symptômes utilisateur).
**Risque** : temps de détection d'incident potentiellement très long
(heures, voire jours) sur un système traitant paiements et comptabilité
d'entreprises réelles — impact direct sur la confiance et, pour les
échecs de paiement en particulier, sur le chiffre d'affaires suivi.
**Fichier(s)** : absence transversale (aucun fichier de configuration
monitoring dans le dépôt)
**Solution** : cohérent avec l'état du projet (pas de VPS/trafic réel
encore) de reporter un stack Prometheus/Grafana complet, mais **avant tout
trafic réel de production**, mettre en place au minimum : un outil de
suivi d'erreurs applicatives (Sentry ou équivalent, léger à intégrer côté
NestJS/Next.js), et une alerte simple sur le healthcheck externe (ex. un
service de monitoring externe gratuit/pas cher — UptimeRobot ou équivalent
— sur `/health` avec notification email/SMS) en attendant un stack
Prometheus+Grafana+Alertmanager complet. Instrumenter en priorité les
webhooks de paiement (déjà un point sensible identifié, `docs/adr/0010-...`)
avec des métriques de taux d'échec.
**Priorité** : P1 — à traiter avant tout trafic de production réel, pas
après un premier incident.
**Statut** : OUVERT

---

## P-09 — Secrets de développement en dur dans le pipeline CI

**Sévérité** : INFO
**Composant** : `.github/workflows/ci.yml`
**Description** : le bloc `env:` (lignes 18-39) contient des valeurs comme
`JWT_ACCESS_SECRET: ci-jwt-access-secret-at-least-32-characters-long` et des
mots de passe Postgres en clair. Le fichier commente explicitement (lignes
19-27) que ce sont des identifiants de dev, jamais utilisés hors CI/local,
cohérents avec `docker/docker-compose.dev.yml`. Vérifié : ce sont
effectivement des valeurs de test triviales, sans rapport avec un secret de
production, et `docker/.env.prod` (le seul fichier contenant potentiellement
de vrais secrets) est correctement absent du dépôt et listé dans
`.gitignore` et `.dockerignore`.
**Impact** : aucun en soi — ce n'est pas une fuite de secret de production.
Mentionné à titre de traçabilité de la vérification demandée (règle d'or
DevOps #2 : aucun secret en clair dans un pipeline), pas comme un
problème réel.
**Risque** : nul dans l'état actuel ; à surveiller uniquement si ces mêmes
valeurs de dev venaient un jour à être copiées-collées dans un `.env.prod`
réel par erreur humaine.
**Fichier(s)** : `.github/workflows/ci.yml:18-39`
**Solution** : aucune action requise. Best-practice déjà en place :
commentaire explicite sur la nature de ces valeurs.
**Priorité** : P4 (aucune action)
**Statut** : OUVERT (informatif)

---

## P-10 — Le pipeline CI échouait à 100% sur GitHub Actions depuis sa création, jamais détecté

**Sévérité** : CRITICAL (reclassé depuis « non détecté » — un pipeline qui
échoue toujours équivaut à l'absence totale de CI)
**Composant** : `turbo.json`, `.github/workflows/ci.yml`
**Description** : Turborepo 2.x (`^2.1.3`, résolu en `2.10.9`) est en
`envMode: "strict"` par défaut — une tâche lancée via `turbo run` ne reçoit
que les variables d'environnement explicitement déclarées dans `turbo.json`
(`env`/`globalEnv`/`passThroughEnv`), jamais l'environnement complet du
process parent. `turbo.json` ne déclarait aucune de ces clés. En CI,
`.github/workflows/ci.yml` fournit `DATABASE_URL` et les autres secrets via
le bloc `env:` du *workflow* (donc présents dans le process du job), mais
`pnpm test` → `turbo run test` les filtrait avant qu'ils n'atteignent le
process Jest de `@erp/api`, qui échouait immédiatement
(`DATABASE_URL manquant`). **Jamais détecté ni corrigé sur les 4 exécutions
précédentes** (Phase 10.2 à ce jour) faute d'accès à `gh` authentifié pour
lire les logs bruts des runs — chaque échec avait été implicitement supposé
« pas encore vérifié » plutôt que « vérifié et cassé ». **Jamais reproduit en
local** : `apps/api/.env` (fichier réel, gitignored, absent en CI) sert de
filet de secours à `dotenv.config()` dans `global-setup.js`/`setup-env.js`,
qui recharge `DATABASE_URL` depuis ce fichier indépendamment de ce que
`turbo` a transmis — masquant totalement le problème sur toute machine de
développement où ce fichier existe.
**Impact** : aucune régression n'a jamais été détectée par CI depuis sa mise
en place — chaque `git push`/PR affichait un badge rouge sur l'étape `Tests`,
ce qui, en pratique, revient à n'avoir aucune CI fonctionnelle malgré un
pipeline qui « existe » dans le dépôt.
**Risque** : élevé — invalide la prémisse de `docs/deployment/CI-CD.md`
(« `test:tenant`, règle CLAUDE.md la plus critique, est bien exécuté et
bloquant ») : `test:tenant` était en réalité `skipped` sur chaque run, car
l'étape `Tests` précédente échouait toujours en premier.
**Fichier(s)** : `turbo.json` (absence totale de `env`/`globalEnv`/`passThroughEnv`)
**Solution** : `globalPassThroughEnv` ajouté à `turbo.json`, listant les
variables runtime nécessaires (`DATABASE_URL`, `IDENTITY_DATABASE_URL`,
`TENANT_DATABASE_URL`, secrets JWT/MFA/webhooks, etc.) —
`passThroughEnv` plutôt que `env`/`globalEnv` pour ne pas faire participer
des valeurs secrètes au hash de cache Turborepo. **Vérifié réellement, pas
supposé** : reproduction locale de l'échec exact (déplacement temporaire de
`apps/api/.env` + `turbo run test --filter=@erp/api` avec uniquement les
variables façon CI dans le shell → même erreur `DATABASE_URL manquant`),
puis confirmation que le correctif résout ce cas précis (60/60 suites,
328/328 tests, `.env` toujours absent) avant restauration du fichier et
re-vérification complète de la chaîne standard (`typecheck`/`lint`/`build`/
`test`/`test:tenant`, tous verts). **Confirmé sur GitHub Actions** : run
#6 (commit `c0cbd54`, https://github.com/Libasse27/erp_gescom_compta_saas/actions/runs/32021000646),
premier run vert de l'histoire du dépôt — les 15 étapes réussies, y compris
« Tests d'isolation multi-tenant (bloquant) » qui n'avait, jusque-là, jamais
pu s'exécuter une seule fois (toujours `skipped` après l'échec de l'étape
`Tests` précédente).
**Priorité** : P0 — était le blocage le plus critique de toute la Phase 10/9.5
**Statut** : CORRIGÉ (2026-08-17), vérifié en local et sur GitHub Actions

---

## Ce qui est solide (vérifié positivement)

- **Docker** (`apps/api/Dockerfile`, `apps/web/Dockerfile`) : build
  multi-stage réel via `turbo prune`, utilisateur non-root créé et utilisé
  (`nestjs`/`nextjs`, uid/gid 1001), aucun secret en dur dans les Dockerfiles
  (`NEXT_PUBLIC_API_URL` correctement passé en `--build-arg`, tout le reste
  en variables d'environnement runtime via `docker-compose.prod.yml`).
- **CI** (`.github/workflows/ci.yml`) : le fichier définit bien
  `install → prisma generate → typecheck → lint → build → test → test:tenant`
  dans cet ordre — mais cette lecture de fichier avait été prise, à tort,
  comme preuve que le pipeline fonctionnait réellement. **Corrigé et
  reclassé** : voir P-10, le pipeline avait en réalité échoué à 100% des
  exécutions réelles sur GitHub Actions depuis sa création (Phase 10.2)
  jusqu'au correctif du 2026-08-17.
- **Sauvegardes/restauration** : chiffrement `age` réellement implémenté
  (pas de mention de clé privée dans aucun script ni fichier d'env commité),
  séparation clé publique (VPS) / clé privée (opérateur, jamais sur le
  VPS) correctement conçue. Preuve de restauration détaillée et technique,
  incluant une vérification de la RLS post-restauration — dépasse le
  niveau de preuve habituel d'un simple test manuel.
- **Logs structurés** : corrélation `requestId`/`tenantId`/`userId`
  vérifiée par un test d'intégration qui intercepte réellement
  `console.log` (`logging.integration.spec.ts`), pas seulement une lecture
  de code. Aucun corps de requête/réponse loggé par
  `HttpLoggingMiddleware` (seulement méthode/chemin/statut/durée) — pas de
  risque de fuite de mot de passe/token par ce canal, vérifié directement
  dans `structured-logger.service.ts`.
- **HTTPS/Caddy** : `docker-compose.prod.yml` ne publie plus aucun port sur
  `api`/`web` (seul Caddy expose 80/443) — vérifié par lecture du fichier.
  Redirection HTTP→HTTPS automatique de Caddy vérifiée concrètement en mode
  `tls internal` (`docs/deployment/PRODUCTION.md:87-92`, `308` constaté).
  `helmet()` actif et CORS en liste blanche stricte (jamais `*`) dans
  `apps/api/src/main.ts:18,23`.
- **Secrets** : recherche large de motifs de clés/secrets réels
  (`sk_live`, `AKIA`, clés privées PEM, tokens GitHub/Slack) sur l'ensemble
  du dépôt suivi par git — aucune correspondance concluante. Les seules
  occurrences de `password = "..."` sont dans des fichiers de test
  (`*.spec.ts`), attendu et sans risque.

## Points à valider par l'architecte ou la sécurité

- P-08 (absence totale de monitoring/alerting) : décision à prendre avec
  `architect` sur le niveau minimal acceptable avant un premier trafic de
  production réel — ce n'est pas qu'une dette technique mineure vu la
  nature du produit (paiements, comptabilité).
- P-07 (RPO/RTO non formalisés) : arbitrage métier requis, pas une décision
  technique isolée.
- P-04 (limites de ressources absentes) : dimensionnement à faire avec
  connaissance du VPS cible réel (RAM/CPU disponibles), actuellement inconnu
  puisqu'aucun VPS n'est encore provisionné.

## Dette assumée (déjà documentée par le projet lui-même, confirmée par cet audit)

- Pas de déploiement continu ni de VPS réel — délibéré, documenté, cohérent
  avec l'absence d'infrastructure cible à ce jour (`docs/deployment/CI-CD.md`).
- Pas de scaling horizontal, pas de réplication Postgres — délibéré et
  documenté (`docs/deployment/PRODUCTION.md:124-143`), acceptable tant
  qu'aucun trafic réel n'existe, mais à traiter avant mise en production
  effective.
- Pas d'agrégateur de logs branché (Loki/CloudWatch) — le format JSON
  lines choisi est prêt pour ça, juste non connecté (`docs/deployment/LOGGING.md:123-126`).
