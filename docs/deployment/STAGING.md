# Infrastructure staging (P2)

> Référentiel opérationnel P2. Ce document ne duplique pas `PRODUCTION.md`,
> `BACKUPS.md`, `MONITORING.md`, `MIGRATIONS.md`, `CI-CD.md` : il s'y
> réfère et ajoute ce qui est spécifique à un environnement staging —
> notamment la checklist de validation avant tout trafic réel.
>
> **État au 2026-08-22 : aucun VPS staging réel n'est provisionné.** Toute
> case cochée 🟢 ci-dessous signifie « vérifié par une exécution réelle »,
> jamais « la configuration existe dans le dépôt ». Une configuration
> présente mais jamais exécutée sur un VPS reste 🟡, quelle que soit sa
> qualité apparente — voir `docs/audit/PRODUCTION-READINESS.md` pour le
> précédent (Caddy/HTTPS et sauvegardes hors-hôte vérifiés en simulation
> locale uniquement, jamais sur infrastructure réelle).

## Légende

| Symbole | Signification |
|---|---|
| 🟢 | Vérifié — preuve d'exécution réelle disponible (commande, log, capture) |
| 🟡 | À exécuter sur le VPS staging — non vérifiable depuis cet environnement |
| 🔵 | Validation métier — décision humaine, pas technique |
| 🔴 | Bloquant — empêche le passage staging → production tant que non résolu |

---

## 1. Objectif et périmètre

Staging = une réplique de l'architecture de production (`docker-compose.prod.yml`
+ Caddy + Postgres, Phase 10.6) sur une infrastructure réelle distincte,
utilisée pour :
- exercer le premier déploiement réel (DNS, TLS Let's Encrypt, secrets
  rotationnés) avant de le refaire à l'identique en production ;
- exécuter le smoke test de bout en bout (§10) avec de vrais fournisseurs
  de paiement en mode sandbox ;
- mesurer un RTO réel de restauration (§7), chose impossible sans VPS.

Hors périmètre : scaling horizontal, réplication Postgres, stack
Prometheus/Grafana complète — dette assumée identique à la production
(`docs/audit/PRODUCTION-READINESS.md` §« Dette assumée »).

**Règle de méthode (CLAUDE.md §9) : aucune modification de code applicatif
dans le cadre de P2.** Seuls les fichiers `docs/`, `docker/.env.*.example`
et, si nécessaire, un fichier Compose dédié au staging peuvent évoluer.

---

## 2. Prérequis du VPS staging

| Élément | Cible | Statut |
|---|---|---|
| OS | Debian/Ubuntu LTS récent (aligné sur les commandes `apt` déjà documentées dans `BACKUPS.md`) | 🟡 |
| CPU/RAM/disque | Dimensionné pour héberger `postgres`+`api`+`web`+`caddy` simultanément — les limites par défaut de `docker-compose.prod.yml` (§4) donnent un plancher (~1,9 Go RAM, ~2,75 vCPU cumulés) ; à ajuster une fois le fournisseur choisi | 🟡 |
| Docker + Docker Compose v2 | Requis (`docs/deployment/PRODUCTION.md` §Prérequis) | 🟡 |
| Accès SSH | Clé publique uniquement, mot de passe désactivé, utilisateur non-root pour l'exploitation courante | 🟡 |
| Pare-feu | Ports 22 (SSH), 80/443 (Caddy) ouverts ; tout le reste fermé — `api`/`web`/`postgres` ne publient déjà aucun port sur l'hôte depuis Phase 10.6 (vérifié par lecture de `docker-compose.prod.yml`, §4 ci-dessous) | 🟢 (config) / 🟡 (pare-feu système du VPS) |
| Fournisseur | Aucun tranché — cohérent avec `docs/adr/` (aucune ADR n'a encore fixé de fournisseur VPS) | 🔵 |

---

## 3. DNS et domaine staging

Convention recommandée (à valider) : sous-domaines dédiés, jamais les mêmes
noms que la production, pour ne pas mélanger les certificats Let's Encrypt
ni risquer un test qui touche un domaine public réel déjà indexé.

- `api.staging.<domaine>` → `API_DOMAIN`
- `app.staging.<domaine>` → `WEB_DOMAIN`

| Contrôle | Statut |
|---|---|
| Domaine racine disponible/possédé | 🔵 (à confirmer côté métier — quel domaine réel utiliser) |
| Enregistrements DNS A créés vers l'IP du VPS staging | 🟡 |
| Obtention certificat Let's Encrypt (HTTPS auto, Caddy) | 🟡 — mécanisme de routage déjà vérifié en mode `tls internal` local (`docker/Caddyfile.local-test`, `docs/deployment/PRODUCTION.md` §Reverse proxy), **jamais avec un vrai certificat ACME** |
| Renouvellement automatique du certificat | 🟡 — dépend du volume `erp_saas_caddy_data` déjà en place (config vérifiée), pas testé en conditions réelles sur plusieurs mois |
| Redirection HTTP→HTTPS | 🟢 (config) — comportement `308` déjà observé en local-test, comportement standard de Caddy indépendant du mode TLS |

---

## 4. Architecture staging

Réutilise telle quelle la stack de `docker/docker-compose.prod.yml`
(vérifiée par lecture le 2026-08-22) — **pas de MongoDB, pas de Redis, pas
de worker/queue** dans ce projet à ce jour (recherche `redis`/`mongo` sur
`apps/`, `packages/`, `docker/` : aucune occurrence hors `node_modules` et
artefacts de build). Le stack cible réel est :

```
Internet → Caddy (80/443, seul point d'entrée) → web:3001 (Next.js)
                                                 → api:3000 (NestJS)
                                                    → postgres:5432 (réseau interne uniquement)
```

| Service | Statut config | Statut vérifié réellement |
|---|---|---|
| Caddy (reverse proxy + TLS) | 🟢 (`docker/Caddyfile`) | 🟡 — jamais testé avec domaine public réel |
| `web` (Next.js) | 🟢 (Dockerfile multi-stage, non-root, healthcheck `GET /login`) | 🟡 |
| `api` (NestJS) | 🟢 (Dockerfile multi-stage, non-root, healthcheck `GET /health`) | 🟡 |
| `postgres` | 🟢 (image officielle, volume nommé, healthcheck `pg_isready`) | 🟡 |
| Limites CPU/mémoire (P-04) | 🟢 — définies par défaut, overridables via `docker/.env.prod` | 🔵 — dimensionnement définitif à valider une fois le VPS réel connu |

Recommandation : créer `docker/.env.staging` (copie de
`docker/.env.prod.example`, jamais commité — même règle que `.env.prod`)
plutôt que de réutiliser `docker/.env.prod` pour éviter toute confusion
entre les deux environnements.

---

## 5. Secrets et variables d'environnement

| Contrôle | Statut |
|---|---|
| Aucun secret commité dans Git | 🟢 — vérifié par l'audit du 2026-08-16 (`docs/audit/PRODUCTION-READINESS.md` §10, recherche large sans résultat concluant) et par le gitleaks bloquant en CI depuis P-01 |
| `docker/.env.prod.example` sert de gabarit exhaustif des variables requises | 🟢 (99 lignes, toutes les clés listées) |
| Secrets staging générés indépendamment des secrets de production | 🟡 — à générer au provisionnement (`openssl rand -base64 32` pour JWT/MFA, valeurs distinctes de dev **et** de prod) |
| `JWT_ACCESS_SECRET` / `MFA_ENCRYPTION_KEY` ≥ 32 caractères aléatoires | 🟡 |
| Mots de passe des rôles Postgres (`erp_app_tenant`, `erp_app_identity`) rotationnés via `scripts/prod-post-deploy.sh` avant premier démarrage de l'API | 🟡 — script déjà vérifié en Phase 10.1/10.4, jamais rejoué sur un VPS staging réel |
| Secrets de webhook paiement (Wave/Orange Money/Free Money/Stripe/Card) en mode sandbox, distincts des secrets de production | 🔵 — dépend des comptes sandbox à créer avec chaque fournisseur |
| `SENTRY_DSN` staging distinct du DSN de production | 🟡 — voir `docs/deployment/MONITORING.md`, projet Sentry dédié recommandé |
| `CORS_ALLOWED_ORIGINS` / `NEXT_PUBLIC_API_URL` cohérents avec les domaines staging (§3) | 🟡 |
| SMTP réel configuré | 🔴 — non couvert (`ConsoleMailSender` toujours actif en l'absence d'intégration SMTP, `apps/api/src/main.ts` avertit explicitement en production). **Bloquant pour tester réinitialisation de mot de passe / invitations en conditions réelles**, mais pas pour le reste du smoke test |

---

## 6. Base de données

| Contrôle | Statut |
|---|---|
| Migrations Prisma appliquées via `prisma migrate deploy` (jamais `migrate dev` hors poste local) | 🟢 (mécanisme vérifié en CI à chaque run + procédure documentée, `docs/deployment/MIGRATIONS.md`) / 🟡 (jamais exécuté sur un cluster Postgres staging réel) |
| Rollback de migration testé (échec + résolution) | 🟢 — vérifié de bout en bout sur conteneur Postgres jetable (`docs/deployment/MIGRATIONS.md` §Vérifié), reproductible à l'identique sur staging |
| Seed (`apps/api/prisma/seed.ts`) : plans, permissions, features ERP | 🟢 (idempotent, `upsert` uniquement) / 🟡 (jamais exécuté hors dev/CI) |
| Premier Super Admin créé via `pnpm --filter=@erp/api create-super-admin` (jamais via route HTTP, CLAUDE.md §6) | 🟢 (mécanisme vérifié, MFA forcée à la création) / 🟡 (jamais exécuté sur staging) |
| Isolation tenant (RLS) active après migration | 🟢 — vérifié par `test:tenant` (CI bloquant) et par la restauration réelle du 2026-08-17 (`docs/deployment/BACKUPS.md` §Vérifié) |
| `erp_app_tenant`/`erp_app_identity` non-superuser, non-propriétaire des tables | 🟢 — `docs/adr/0008-...`, `docs/adr/0018-...` |

---

## 7. Sauvegarde / restauration

Procédure et outillage déjà écrits et vérifiés en local
(`docs/deployment/BACKUPS.md`) — **jamais exécutés sur un VPS réel avec un
vrai fournisseur S3**.

| Contrôle | Statut |
|---|---|
| `scripts/db-backup.sh` (dump `pg_dump -Fc`, rétention, `chmod 600`) | 🟢 (mécanisme) / 🟡 (jamais exécuté hors dev) |
| Chiffrement `age` + copie hors-hôte S3-compatible (`backup-offsite-sync.sh`) | 🟢 (vérifié bout en bout avec MinIO jetable, bug `rclone` réel trouvé et corrigé) / 🟡 (jamais avec un vrai fournisseur S3) |
| Restauration réelle avec vérification RLS post-restauration | 🟢 (exercée et documentée en détail, `docs/deployment/BACKUPS.md` §Vérifié) / 🟡 (à rejouer sur staging pour confirmer sur infrastructure non jetable) |
| Cron quotidien installé (3h, `Africa/Dakar`) | 🟡 — ligne crontab documentée, jamais installée faute de VPS |
| RPO cible formalisé (24h) | 🟢 — `docs/deployment/BACKUPS.md` §RPO/RTO |
| RPO validé par le métier | 🔵 — toujours ouvert (P-07), à faire avant go production, pas nécessairement avant staging |
| RTO mesuré (chronométré, pas estimé) | 🟡 — à chronométrer lors du premier exercice de restauration réel sur staging (`date` avant/après `db-restore.sh`) |

---

## 8. Sécurité

| Contrôle | Statut |
|---|---|
| HTTPS automatique + redirection HTTP→HTTPS | 🟡 — voir §3, jamais avec certificat ACME réel |
| Pare-feu VPS (22/80/443 uniquement) | 🟡 |
| Conteneurs non-root (`nestjs`/`nextjs`, uid/gid 1001) | 🟢 — vérifié par lecture des Dockerfiles (`docs/audit/PRODUCTION-READINESS.md` §Ce qui est solide) |
| `api`/`web`/`postgres` sans port publié sur l'hôte (seul Caddy expose 80/443) | 🟢 — vérifié par lecture de `docker-compose.prod.yml` et par test réel en local-test (connexion refusée sur les anciens ports) |
| `helmet()` actif | 🟢 — `apps/api/src/main.ts:27` |
| CORS liste blanche stricte (jamais `*`) | 🟢 — `apps/api/src/main.ts:31`, `env.corsAllowedOrigins()` |
| Rate limiting global + `/auth/*` + webhooks paiement | 🟢 — `apps/api/src/common/rate-limit.ts`, testé (`auth-throttling.spec.ts`, `webhook-throttling.spec.ts`) |
| Whitelist IP fournisseur webhook paiement | 🔴 — délibérément absente (`payments-webhook.controller.ts:14` : signature HMAC générique préférée à une liste d'IP, `docs/adr/0010-...`). **Pas un bug** mais à revalider une fois le(s) fournisseur(s) réel(s) intégré(s) — voir mémoire projet |
| CSP/HSTS | 🟡 — fournis par les valeurs par défaut de `helmet()`, jamais auditées explicitement ni testées avec de vrais navigateurs sur un domaine HTTPS réel |
| Scan de secrets, SCA, scan d'image Trivy bloquants en CI | 🟢 — vérifié sur GitHub Actions (P-01, run vert confirmé) |
| SAST | 🔴 — absent, hors périmètre de tout lot livré à ce jour (P-01) |
| Protection de branche `main` (status check requis, force-push/suppression interdits) | 🟢 — activée et vérifiée le 2026-08-22 |

---

## 9. Observabilité

| Contrôle | Statut |
|---|---|
| Logs JSON structurés, corrélation `requestId`/`tenantId`/`userId` | 🟢 — testé par interception réelle de `console.log` (`logging.integration.spec.ts`) |
| `/health/live` et `/health/ready` séparés | 🟢 — `apps/api/src/health/health.controller.ts`, P-06 corrigé |
| Healthcheck Docker `api`/`web`/`postgres` | 🟢 (config vérifiée) / 🟡 (comportement réel jamais observé sous charge) |
| Sentry (tracking erreurs serveur) | 🟢 (scaffolding installé, désactivé par défaut) / 🟡 (compte Sentry jamais créé, `SENTRY_DSN` jamais renseigné en conditions réelles) |
| Moniteur d'uptime externe (`/health/ready`) | 🔴 — compte jamais créé (P-08), aucun domaine public à surveiller pour l'instant |
| Métriques latence/débit (Prometheus/Grafana) | 🔴 — hors périmètre assumé, à traiter avant trafic de production réel significatif, pas nécessairement avant staging |
| Agrégateur de logs (Loki/CloudWatch) | 🔴 — non branché, format prêt |

---

## 10. Smoke test staging (à exécuter une fois le VPS provisionné)

Aucune étape ci-dessous n'a été exécutée sur staging réel — toutes 🟡 par
construction. Ordre recommandé, chaque étape dépendant de la précédente :

1. 🟡 `pnpm --filter=@erp/api create-super-admin` → compte créé, MFA activée
2. 🟡 Connexion Super Admin (MFA obligatoire, CLAUDE.md §6)
3. 🟡 Création d'une entreprise (provisioning tenant) → vérifier `TenantContext` peuplé
4. 🟡 Création d'un utilisateur standard dans ce tenant, login
5. 🟡 Isolation tenant : créer une deuxième entreprise, vérifier qu'aucune ressource de la première n'est visible (404, pas 403 — règle CLAUDE.md §5)
6. 🟡 Souscription à un abonnement/plan
7. 🟡 Paiement de test (sandbox Wave/Orange Money/Free Money selon disponibilité) + réception et vérification de signature du webhook
8. 🟡 Émission d'une facture, vérification du montant en FCFA entier (jamais de float)
9. 🟡 Déconnexion, vérification de la révocation du refresh token
10. 🟡 Vérification des logs applicatifs pour chaque étape ci-dessus (corrélation `requestId`/`tenantId`)

---

## 11. Critères de validation P2

P2 est considéré complet quand :

- toutes les lignes 🟡 des §2 à §9 sont repassées 🟢 par une exécution réelle sur le VPS staging (preuve : commande + sortie, comme documenté dans `BACKUPS.md`/`MIGRATIONS.md`) ;
- le smoke test (§10) est intégralement exécuté sans échec inattendu ;
- les 🔵 (RPO métier, fournisseur VPS, whitelist webhook) sont tranchés ou explicitement acceptés comme dette assumée par le métier ;
- les 🔴 restants sont soit corrigés, soit réévalués et documentés comme dette assumée (pas silencieusement ignorés).

## 12. Go/No-Go P2 → P3

**No-Go tant qu'aucun VPS n'est provisionné** — c'est l'état actuel. Une
fois un VPS choisi (🔵 §2), la séquence devient :

1. Provisionner le VPS, DNS (§2-§3).
2. Dérouler §4-§9 dans l'ordre, transformer chaque 🟡 en 🟢 avec preuve.
3. Exécuter le smoke test (§10).
4. Revue conjointe (toi + moi) de ce document une fois rempli : si tout est 🟢/🔵-tranché, P3 peut démarrer.
5. Ne jamais promouvoir staging → production tant qu'un 🔴 reste ouvert sans arbitrage explicite.
