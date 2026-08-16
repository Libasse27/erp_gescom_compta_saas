# Audit de sécurité applicative — ERP GESCOM COMPTA SaaS

- **Date** : 2026-08-16
- **Périmètre** : `apps/api/src` (auth, tenant, common, prisma, payments, users, provisioning),
  `apps/api/prisma` (schema + 16 migrations), `packages/validation`, `packages/permissions`,
  `docker/`, `scripts/`, `.github/workflows/ci.yml`, stockage des jetons côté `apps/web` et `apps/mobile`.
- **Méthode** : lecture directe du code source, des migrations SQL et des tests. Aucun commit,
  ADR ou document de progression n'a été retenu comme preuve.
- **Nature** : audit défensif. Aucun code offensif ni charge utile n'a été produit.
- **Statut du code** : aucune modification apportée à l'application.

---

## 1. Modèle de menaces (résumé)

| Actif | Frontière de confiance | Menace principale (STRIDE) |
|---|---|---|
| Données comptables et commerciales par tenant | JWT → `TenantContext` → RLS Postgres | Information Disclosure (fuite inter-tenant) |
| Comptes et sessions | `/auth/*` public | Spoofing, Elevation of Privilege |
| Compte `SUPER_ADMIN` | CLI hors HTTP + MFA | Elevation of Privilege |
| Paiements Mobile Money | Webhook public signé HMAC | Tampering, Repudiation |
| Journal d'audit | Écriture applicative uniquement | Repudiation (altération) |
| Secrets (JWT, MFA, DB, webhooks) | Variables d'environnement | Information Disclosure |

Points d'entrée non authentifiés recensés : `GET /health`, `GET /v1/plans`,
`POST /v1/auth/login|refresh|mfa/verify|forgot-password|reset-password|verify-email`,
`POST /v1/auth/register`, `POST /v1/users/accept-invitation`, `POST /webhooks/payments/:provider`.

---

## 2. Synthèse

| Sévérité | Nombre |
|---|---|
| CRITICAL | 0 |
| HIGH | 5 |
| MEDIUM | 8 |
| LOW | 8 |
| INFO | 3 |

Aucun défaut classé CRITICAL n'a été confirmé : l'isolation multi-tenant repose bien sur une
RLS Postgres réelle, forcée, avec un rôle applicatif non-superuser vérifié par un test
automatisé. Les défauts HIGH portent sur l'authentification (confusion de jeton, statut de
compte ignoré), sur la seconde connexion base de données (superuser) et sur des fuites de
secrets par les journaux.

---

## 3. Constats

### SEC-01

- **Sévérité** : HIGH
- **Composant** : Authentification — service de jetons / garde JWT
- **Description** : `TokenService.verifyAccessToken()` ne vérifie aucun claim de type. Le jeton
  de défi MFA, émis par `signMfaChallengeToken()` et signé avec **le même secret** que l'access
  token, est donc accepté tel quel par `JwtAuthGuard` comme un jeton de session. La vérification
  inverse existe pourtant (`verifyMfaChallengeToken` refuse un jeton dont `type !== "mfa_challenge"`),
  mais elle n'a pas d'équivalent côté access token. Aucun claim `iss`, `aud` ni `jti` n'est émis
  ni contrôlé, et l'algorithme accepté n'est pas épinglé explicitement au niveau du `JwtModule`.
- **Impact** : un porteur du seul mot de passe d'un `SUPER_ADMIN` obtient un jeton de 5 minutes
  qui franchit `JwtAuthGuard` et donne accès à `GET /v1/auth/me` (profil, email, statut MFA) et à
  `POST /v1/auth/logout`, sans jamais présenter le second facteur. `SuperAdminGuard` et les routes
  tenant restent fermés (le payload du défi ne porte ni `isSuperAdmin` ni `enterpriseId`), ce qui
  borne l'exploitation — mais le principe du second facteur est contourné.
- **Risque** : contournement partiel de la MFA ; toute route future protégée par le seul
  `JwtAuthGuard` deviendrait accessible avec un jeton pré-MFA.
- **Fichier(s)** :
  - `apps/api/src/auth/token.service.ts:28-31` (`verifyAccessToken`, aucun contrôle de type)
  - `apps/api/src/auth/token.service.ts:35-37` (`signMfaChallengeToken`, même secret)
  - `apps/api/src/auth/guards/jwt-auth.guard.ts:23-25`
  - `apps/api/src/auth/auth.module.ts:15-17` (`JwtModule` sans `issuer`/`audience`/`algorithms`)
- **Solution** : ajouter un claim `typ: "access"` à l'émission et le rejeter explicitement dans
  `verifyAccessToken` s'il diffère ; ou dériver un secret distinct pour le défi MFA. Épingler
  `algorithms: ["HS256"]`, `issuer` et `audience` dans la configuration du `JwtModule` et dans
  chaque `verify`. Test de non-régression : « un jeton de défi MFA présenté en `Bearer` sur
  `GET /v1/auth/me` renvoie 401 ».
- **Priorité** : P1
- **Statut** : CORRIGÉ (2026-08-16) — `typ: "access"` émis et vérifié dans
  `TokenService.verifyAccessToken`, `algorithms: ["HS256"]`/`issuer`/`audience`
  épinglés dans `AuthModule` (`JwtModule.registerAsync`) et sur chaque
  `sign`/`verify` de `token.service.ts`. Test de non-régression ajouté :
  `auth-mfa.integration.spec.ts` → « rejects an MFA challenge token presented
  as a Bearer access token ».

### SEC-02

- **Sévérité** : HIGH
- **Composant** : Persistance — connexion « identité » Postgres
- **Description** : deux connexions coexistent. `TenantScopedPrismaService` utilise
  `TENANT_DATABASE_URL` (rôle `erp_app_tenant`, `NOSUPERUSER NOBYPASSRLS`, non propriétaire —
  correct et vérifié par test). Mais `PrismaService` utilise `DATABASE_URL`, dont l'utilisateur
  est `POSTGRES_USER` : dans les deux fichiers Compose, c'est le compte créé par l'image
  `postgres:16-alpine`, donc **superuser du cluster et propriétaire de toutes les tables**. Ce
  client est injecté dans neuf classes applicatives : `AuthService`, `AccountRecoveryService`,
  `AuditLogService`, `NotificationsService`, `PaymentWebhookService`, `PlansService`,
  `ProvisioningService`, `InvitationsService`, `HealthController`, ainsi que
  `CrossTenantRepository`.
- **Impact** : sur cette connexion, la Row Level Security est intégralement contournée (un
  superuser et le propriétaire d'une table ignorent les policies, y compris `FORCE`). Toute faille
  logique, injection ou erreur de filtre dans l'un de ces neuf composants expose les données de
  **tous** les tenants. Le processus API détient en permanence une connexion superuser vers la base
  de production.
- **Risque** : violation directe de `CLAUDE.md` §5 (« un rôle applicatif Postgres
  `superuser`/propriétaire de table utilisé par l'API » figure dans les interdits). Escalade de
  privilèges base de données en cas de compromission du conteneur API.
- **Fichier(s)** :
  - `apps/api/src/prisma/prisma.service.ts:5` (aucune `datasources` explicite → `DATABASE_URL`)
  - `docker/docker-compose.dev.yml:6` (`POSTGRES_USER: erp`)
  - `docker/docker-compose.prod.yml` (`POSTGRES_USER: ${POSTGRES_USER}`, réutilisé dans `DATABASE_URL`)
  - `apps/api/src/auth/auth.service.ts:31`, `apps/api/src/common/audit/audit-log.service.ts:19`,
    `apps/api/src/notifications/notifications.service.ts:23`,
    `apps/api/src/payments/payments-webhook.service.ts:27`,
    `apps/api/src/provisioning/provisioning.service.ts:23`,
    `apps/api/src/users/invitations.service.ts:19`, `apps/api/src/plans/plans.service.ts:22`,
    `apps/api/src/health/health.controller.ts:19`, `apps/api/src/tenant/cross-tenant.repository.ts:18`
- **Solution** : créer un troisième rôle Postgres `erp_app_identity`, `NOSUPERUSER NOBYPASSRLS`,
  non propriétaire, avec des `GRANT` limités aux seules tables réellement nécessaires
  (`users`, `refresh_tokens`, `auth_tokens`, `audit_logs`, `notifications`, `plans`, `features`,
  `payments`, `subscriptions`, `enterprises`). Réserver le compte propriétaire à
  `prisma migrate deploy`, exécuté par un conteneur éphémère distinct, jamais au runtime de l'API.
  Étendre le test existant sur `erp_app_tenant` (`tenant-isolation.tenant.spec.ts:200-213`) au
  rôle d'identité.
- **Priorité** : P1
- **Statut** : CORRIGÉ (2026-08-16) — doublon de MT-01 (`docs/audit/MULTI-TENANT-AUDIT.md`).
  Rôle `erp_app_identity` créé (`NOSUPERUSER`, non propriétaire) — `BYPASSRLS`
  plutôt que `NOBYPASSRLS` par rapport à la solution suggérée ici, choix
  documenté et justifié dans `docs/adr/0018-role-identite-bypassrls-non-superuser.md`
  (nécessaire pour les flux pré-tenant, reste soumis aux `GRANT` table par
  table). `PrismaService` se connecte désormais via `IDENTITY_DATABASE_URL`.

### SEC-03

- **Sévérité** : HIGH
- **Composant** : Authentification — cycle de vie des comptes
- **Description** : `AuthService.login()` vérifie l'existence de l'utilisateur, le verrouillage
  temporaire, le mot de passe et — pour un Super Admin — l'activation de la MFA. Il ne vérifie
  **jamais** `User.status` ni `Enterprise.status`. `AuthService.refresh()` ne les vérifie pas
  davantage. Une recherche exhaustive sur `EnterpriseStatus` dans `apps/api/src` ne remonte
  **aucune occurrence** : la valeur `SUSPENDED`/`ARCHIVED` n'est lue nulle part dans l'API.
  `SubscriptionAccessGuard` ne filtre que sur `SubscriptionStatus`, et uniquement pour les
  méthodes non-`GET`.
- **Impact** : un utilisateur `SUSPENDED` conserve la possibilité de se connecter et d'obtenir
  une paire de jetons. Un utilisateur `PENDING_INVITE` de même, si son hash de mot de passe est
  devinable. Une entreprise `SUSPENDED` (impayé, résiliation, incident) conserve un accès complet
  en lecture à ses données, et un accès en écriture tant que l'abonnement n'est pas
  `EXPIRED`/`SUSPENDED`/`CANCELLED`.
- **Risque** : impossibilité de couper effectivement l'accès d'un salarié parti ou d'un client
  suspendu — c'est aussi un point de contrôle attendu par un bailleur soumis à des exigences de
  type RGPD.
- **Fichier(s)** :
  - `apps/api/src/auth/auth.service.ts:38-143` (`login`, aucun contrôle de `status`)
  - `apps/api/src/auth/auth.service.ts:213-272` (`refresh`, idem)
  - `apps/api/src/entitlements/guards/subscription-access.guard.ts:28-38`
  - `apps/api/prisma/schema.prisma:20-32` (`UserStatus`, `EnterpriseStatus` définis mais inutilisés)
- **Solution** : refuser la connexion et le rafraîchissement si `user.status !== "ACTIVE"` ou si
  `enterprise.status !== "ACTIVE"`, avec le message générique `GENERIC_LOGIN_ERROR` pour ne pas
  distinguer les cas. Révoquer les familles de refresh tokens à la suspension. Tests :
  « un utilisateur SUSPENDED reçoit 401 sur `/auth/login` » et « le refresh d'un utilisateur d'une
  entreprise SUSPENDED reçoit 401 ».
- **Priorité** : P1
- **Statut** : CORRIGÉ (2026-08-16) — `login`/`refresh` rejettent désormais un
  `User.status`/`Enterprise.status` non `ACTIVE` avec le message générique,
  révocation de toute la famille de refresh tokens au refresh. Action d'audit
  dédiée `REFRESH_REJECTED_INACTIVE_ACCOUNT`. Tests ajoutés dans
  `auth.integration.spec.ts`.

### SEC-04

- **Sévérité** : HIGH
- **Composant** : Notifications — expédition des courriels
- **Description** : `NotificationsModule` lie `MAIL_SENDER` à `ConsoleMailSender` de manière
  **inconditionnelle**, sans aucune bascule d'environnement. `ConsoleMailSender.send()` écrit le
  corps complet du message sur la sortie standard. Or les corps de message contiennent les jetons
  bruts : jeton de réinitialisation de mot de passe (`account-recovery.service.ts`) et jeton
  d'invitation (`invitations.service.ts`).
- **Impact** : en production, tous les jetons de réinitialisation (validité 1 h) et d'invitation
  (validité 7 j) sont écrits en clair dans les journaux du conteneur, journaux par ailleurs
  destinés à être agrégés (Phase 10.5). Toute personne ayant accès aux logs peut prendre le
  contrôle de n'importe quel compte, y compris administrateur d'entreprise. Corollaire : aucun
  courriel n'est réellement envoyé en production, la fonction de réinitialisation est donc à la
  fois inopérante et dangereuse.
- **Risque** : prise de contrôle de compte à partir d'un accès en lecture aux journaux ;
  violation de l'interdit « aucun secret dans un log applicatif ».
- **Fichier(s)** :
  - `apps/api/src/notifications/notifications.module.ts:7` (`useClass: ConsoleMailSender`)
  - `apps/api/src/notifications/mail-sender.ts:17-20` (`console.log` du corps complet)
  - `apps/api/src/auth/account-recovery.service.ts:57-63` (jeton brut dans `body`)
  - `apps/api/src/users/invitations.service.ts:83-87` (jeton brut dans `body`)
- **Solution** : faire échouer le démarrage si `NODE_ENV === "production"` et qu'aucun expéditeur
  réel n'est configuré (principe « fail closed » et validation de configuration au démarrage). En
  attendant l'intégration SMTP, ne jamais journaliser le corps : n'émettre que
  `to`/`subject`/identifiant de message. Test : « `ConsoleMailSender` n'écrit jamais `body` ».
- **Priorité** : P1
- **Statut** : PARTIELLEMENT CORRIGÉ (2026-08-16) — `ConsoleMailSender` n'écrit
  plus jamais `body` (identifiant de message généré à la place), test ajouté
  (`mail-sender.spec.ts`). Écart restant assumé : pas de fail-closed au
  démarrage — `main.ts` émet un avertissement fort en production tant que
  l'intégration SMTP réelle (Phase 24) n'existe pas, un fail-closed strict
  casserait le seul chemin de déploiement documenté sans offrir
  d'alternative. À revisiter quand un expéditeur réel existera.

### SEC-05

- **Sévérité** : HIGH
- **Composant** : Configuration Express — confiance au reverse proxy
- **Description** : en production, Caddy termine TLS et relaie vers `api:3000`
  (`docker/Caddyfile`). L'application n'active jamais `app.set("trust proxy", ...)` :
  la recherche `trust proxy|trustProxy` dans `apps/api/src` ne renvoie aucune occurrence. Express
  considère donc l'adresse de la connexion TCP — celle du conteneur Caddy — comme `req.ip`, et
  ignore `X-Forwarded-For`.
- **Impact** : deux conséquences directes. (1) `ThrottlerGuard` regroupe **toutes** les requêtes,
  quelle que soit leur origine, dans un unique compteur : le quota global de 100 requêtes/minute
  et le quota `/auth/*` de 10/minute sont partagés par l'ensemble d'Internet. Un attaquant seul
  épuise le quota et provoque un déni de service pour tous les clients légitimes, tandis que le
  rate limiting par IP ne le ralentit plus de façon différenciée. (2) Le champ `ipAddress` de
  chaque entrée d'audit (`LOGIN`, `LOGIN_FAILED`, `CROSS_TENANT_ACCESS`, …) enregistre l'IP du
  proxy : la piste d'audit est inexploitable pour une investigation.
- **Risque** : déni de service par épuisement de quota ; perte de valeur probante du journal
  d'audit, dont la conservation est pourtant exigée sur 5 ans (OHADA).
- **Fichier(s)** :
  - `apps/api/src/main.ts:8-39` (aucun `trust proxy`)
  - `docker/Caddyfile:16-22` (`reverse_proxy api:3000`)
  - `apps/api/src/auth/auth.controller.ts:20-22` (`req.ip` propagé vers l'audit)
- **Solution** : `app.set("trust proxy", 1)` (un seul saut de proxy connu, jamais `true`), puis
  vérifier que `req.ip` reflète l'IP client réelle. Test d'intégration avec un en-tête
  `X-Forwarded-For` contrôlé.
- **Priorité** : P1
- **Statut** : OUVERT

### SEC-06

- **Sévérité** : MEDIUM
- **Composant** : Rate limiting
- **Description** : `ThrottlerModule.forRoot` est utilisé sans stockage externe, donc avec le
  stockage mémoire par défaut, et sans `getTracker` personnalisé : la clé de limitation est l'IP
  seule. `CLAUDE.md` §6 exige « global, par IP, **par compte**, plus strict sur `/auth/*` ». La
  limitation par compte n'existe pas. Le verrouillage après 5 échecs
  (`MAX_FAILED_LOGIN_ATTEMPTS`) la compense partiellement, mais uniquement pour `/auth/login`.
- **Impact** : compteurs remis à zéro à chaque redémarrage et non partagés entre réplicas — le
  passage à deux instances double mécaniquement le quota réel. Aucune protection par compte sur
  `/auth/refresh`, `/auth/reset-password`, `/auth/verify-email`, `/users/accept-invitation`.
  Aucun en-tête `Retry-After` explicite.
- **Risque** : bourrage d'identifiants distribué peu freiné ; scalabilité horizontale annulant la
  protection.
- **Fichier(s)** : `apps/api/src/common/rate-limit.ts:10-16`, `apps/api/src/app.module.ts:39,67`
- **Solution** : stockage partagé (Redis) et second `Throttle` indexé sur l'identifiant de compte
  (ou sur l'email normalisé pour les routes anonymes).
- **Priorité** : P2
- **Statut** : OUVERT

### SEC-07

- **Sévérité** : MEDIUM
- **Composant** : Provisioning — inscription en libre service
- **Description** : `@Throttle(AUTH_RATE_LIMIT)` est posé **au niveau de la classe**
  `AuthController` uniquement. `ProvisioningController` déclare pourtant `@Controller("auth")`
  et expose `POST /v1/auth/register`, mais n'hérite d'aucune limite renforcée : seule la limite
  globale de 100 requêtes/minute s'applique.
- **Impact** : la route la plus coûteuse de la plateforme (création d'entreprise, seed du plan
  comptable SYSCOHADA, des rôles et des permissions, hachage argon2id) tolère dix fois plus
  d'appels que `/auth/login`. Création massive de tenants factices, saturation base et déni de
  service par épuisement de ressources.
- **Risque** : abus d'inscription, pollution des données, coût d'infrastructure.
- **Fichier(s)** :
  - `apps/api/src/provisioning/provisioning.controller.ts:13-17`
  - `apps/api/src/auth/auth.controller.ts:29` (portée du `@Throttle` limitée à cette classe)
- **Solution** : appliquer `@Throttle(AUTH_RATE_LIMIT)` — voire un quota plus strict — à
  `ProvisioningController`, et ajouter une vérification d'email avant provisioning complet.
- **Priorité** : P2
- **Statut** : OUVERT

### SEC-08

- **Sévérité** : MEDIUM
- **Composant** : Authentification — énumération de comptes par canal temporel
- **Description** : le message d'erreur est correctement uniforme (`GENERIC_LOGIN_ERROR`), et
  `requestPasswordReset` renvoie toujours le même message. En revanche, quand l'email est inconnu,
  `login()` sort **immédiatement** après le `findUnique`, sans exécuter `argon2.verify`. Quand
  l'email existe, la vérification argon2id (plusieurs dizaines de millisecondes) est effectuée.
- **Impact** : l'écart de temps de réponse est mesurable et stable, ce qui permet d'énumérer les
  comptes de la plateforme malgré l'uniformité des messages. Même mécanisme sur
  `/auth/forgot-password`, qui sort en `return` immédiat si l'utilisateur n'existe pas.
- **Risque** : constitution d'une liste de comptes valides préalable à une attaque par bourrage
  d'identifiants ou à du hameçonnage ciblé.
- **Fichier(s)** :
  - `apps/api/src/auth/auth.service.ts:39-50`
  - `apps/api/src/auth/account-recovery.service.ts:32-36`
- **Solution** : vérifier systématiquement un hash factice de référence (« dummy hash » argon2id
  constant) lorsque l'utilisateur est absent, afin d'égaliser les temps de réponse. Test :
  l'écart médian de latence entre email connu et inconnu reste sous un seuil défini.
- **Priorité** : P2
- **Statut** : OUVERT

### SEC-09

- **Sévérité** : MEDIUM
- **Composant** : Migrations — secret en dur
- **Description** : la migration de mise en place de la RLS crée le rôle applicatif avec un mot de
  passe littéral : `CREATE ROLE erp_app_tenant WITH LOGIN PASSWORD 'erp_tenant_dev_password'`.
  Ce mot de passe est également présent en clair dans `.github/workflows/ci.yml`. Le script
  `scripts/prod-post-deploy.sh` corrige le tir en production par un `ALTER ROLE ... WITH PASSWORD`
  après `prisma migrate deploy` — mais il s'agit d'une étape **manuelle**, hors CI, dont l'oubli
  n'est détecté par aucun contrôle.
- **Impact** : entre `migrate deploy` et l'exécution du script, la base de production accepte une
  authentification avec un mot de passe publié dans un dépôt Git. Si le port 5432 est un jour
  exposé, ou depuis tout autre conteneur du réseau Docker, l'accès est immédiat au rôle qui porte
  les `GRANT` sur l'ensemble des tables tenant.
- **Risque** : accès direct à la base avec des identifiants connus publiquement.
- **Fichier(s)** :
  - `apps/api/prisma/migrations/20260809113836_add_tenant_role_and_rls/migration.sql:15-22`
  - `.github/workflows/ci.yml` (variable `TENANT_DATABASE_URL`)
  - `scripts/prod-post-deploy.sh:33-40`
- **Solution** : ne pas créer le rôle depuis une migration. Le provisionner par un script
  d'initialisation prenant le mot de passe depuis l'environnement, exécuté **avant** la première
  migration. À défaut, ajouter au démarrage de l'API une vérification refusant de démarrer si
  `TENANT_DATABASE_URL` contient encore le mot de passe de développement.
- **Priorité** : P2
- **Statut** : OUVERT

### SEC-10

- **Sévérité** : MEDIUM
- **Composant** : Gestion des erreurs
- **Description** : aucun filtre d'exception global n'existe — la recherche
  `ExceptionFilter|APP_FILTER|useGlobalFilters` dans `apps/api/src` ne renvoie aucune occurrence,
  alors que `CLAUDE.md` §8 impose « classes d'erreur typées + filtre d'exception global NestJS ».
  Plusieurs chemins lèvent un `Error` nu : `TenantContext.getRequiredTenantId()`,
  `TokenService.verifyMfaChallengeToken()`, `MfaService.decryptSecret()`.
- **Impact** : ces erreurs remontent en 500 génériques. Le corps de réponse par défaut de NestJS
  ne fuit pas la trace d'appel, le risque de divulgation reste donc faible ; en revanche il n'y a
  ni format d'erreur stable (Problem Details), ni code métier, ni corrélation systématique avec
  le `correlationId`. Concrètement, un Super Admin appelant `GET /v1/subscriptions/me` ou
  `GET /v1/onboarding` (routes qui exigent un `TenantContext` qu'il n'a pas) déclenche un 500 au
  lieu d'un 403.
- **Risque** : bruit d'alerte masquant de vraies erreurs serveur ; diagnostic d'incident dégradé.
- **Fichier(s)** :
  - `apps/api/src/main.ts:8-39` (aucun `useGlobalFilters`)
  - `apps/api/src/tenant/tenant-context.ts:28-30`
  - `apps/api/src/auth/token.service.ts:42`
- **Solution** : ajouter un `AllExceptionsFilter` global produisant un corps Problem Details
  (`type`, `title`, `status`, `code`, `correlationId`), sans détail technique en production, et
  convertir l'absence de `TenantContext` en 403 typé.
- **Priorité** : P2
- **Statut** : OUVERT

### SEC-11

- **Sévérité** : MEDIUM
- **Composant** : Chaîne d'intégration continue
- **Description** : le workflow CI exécute `typecheck`, `lint`, `build`, `test` et `test:tenant`
  contre un Postgres réel — ce qui est solide sur le plan fonctionnel. Il ne comporte en revanche
  **aucun** contrôle de sécurité : pas d'analyse de composition logicielle (`npm/pnpm audit`,
  Dependabot, OSV), pas de détection de secrets (Gitleaks), pas de SAST (Semgrep,
  `eslint-plugin-security`), pas de scan d'image conteneur (Trivy), pas de SBOM.
- **Impact** : une dépendance vulnérable `high`/`critical` ou un secret committé passe en
  production sans blocage. Le constat SEC-09 (mot de passe en dur dans une migration) serait
  précisément détecté par un scanner de secrets.
- **Risque** : introduction silencieuse de vulnérabilités de la chaîne d'approvisionnement.
- **Fichier(s)** : `.github/workflows/ci.yml` (job `ci`, étapes 6 à 9)
- **Solution** : ajouter des étapes bloquantes SCA / Gitleaks / Semgrep / Trivy avec seuil de
  blocage `high`, et générer un SBOM archivé à chaque build.
- **Priorité** : P2
- **Statut** : OUVERT

### SEC-12

- **Sévérité** : MEDIUM
- **Composant** : Journalisation applicative
- **Description** : `StructuredLoggerService` sérialise les paramètres qui lui sont passés sans
  aucune liste de champs à masquer — la recherche `redact` dans `apps/api/src/common/logging`
  ne renvoie rien. `HttpLoggingMiddleware` journalise `path`, qui inclut la chaîne de requête.
- **Impact** : la redaction repose entièrement sur la discipline de chaque appelant. Un futur
  `logger.error("échec", { body })` écrirait mots de passe ou jetons. Combiné à SEC-04, la
  surface de fuite par les journaux est déjà réelle.
- **Risque** : divulgation de données personnelles ou de secrets par les journaux agrégés.
- **Fichier(s)** :
  - `apps/api/src/common/logging/structured-logger.service.ts:70-80`
  - `apps/api/src/common/logging/http-logging.middleware.ts`
- **Solution** : implémenter une redaction centralisée sur une liste de clés
  (`password`, `token`, `authorization`, `refreshToken`, `mfaSecret`, `passwordHash`, `secret`),
  appliquée récursivement avant sérialisation, et tronquer la chaîne de requête. Test sur un
  échantillon réel.
- **Priorité** : P2
- **Statut** : OUVERT

### SEC-13

- **Sévérité** : MEDIUM
- **Composant** : Journal d'audit — immuabilité
- **Description** : `AuditLogService` n'expose que `record()`, ce qui est conforme au niveau
  applicatif. Mais l'immuabilité n'est garantie **que par cette convention** : aucun `REVOKE
  UPDATE, DELETE ON audit_logs`, aucun déclencheur `BEFORE UPDATE OR DELETE`, aucune RLS sur
  `audit_logs`. Le service écrit via `PrismaService`, c'est-à-dire la connexion superuser (SEC-02),
  qui dispose de tous les droits sur la table.
- **Impact** : n'importe quel code injectant `PrismaService` peut appeler
  `prisma.auditLog.deleteMany()` ou `updateMany()`. La conservation exigée sur 5 ans (OHADA) n'est
  garantie par aucun mécanisme technique.
- **Risque** : répudiation ; effacement de traces par un attaquant ayant obtenu l'exécution de
  code dans l'API.
- **Fichier(s)** :
  - `apps/api/src/common/audit/audit-log.service.ts:19-38`
  - `apps/api/prisma/schema.prisma:1033-1051` (modèle `AuditLog`)
  - `apps/api/prisma/migrations/` (aucune migration ne restreint `audit_logs`)
- **Solution** : migration ajoutant `REVOKE UPDATE, DELETE ON audit_logs FROM <rôles applicatifs>`
  et un déclencheur `RAISE EXCEPTION` sur `UPDATE`/`DELETE`. Copie en écriture seule vers un
  stockage externe pour la conservation longue durée.
- **Priorité** : P2
- **Statut** : OUVERT

### SEC-14

- **Sévérité** : LOW
- **Composant** : Validation d'entrée
- **Description** : `packages/validation/src` contient 33 `z.object(...)` et **zéro** `.strict()`.
  En Zod 3, le comportement par défaut est `strip` : les clés inconnues sont silencieusement
  supprimées.
- **Impact** : le risque d'affectation en masse est effectivement neutralisé — le test
  `super-admin-privilege-escalation.integration.spec.ts` le démontre pour `isSuperAdmin`. Mais un
  `enterpriseId` ou un `role` injecté dans le corps est ignoré **en silence** plutôt que rejeté :
  aucune trace, aucune alerte, alors qu'il s'agit d'un signal d'attaque. Toute future utilisation
  de `.passthrough()` ou d'un `...body` inverserait la protection sans qu'aucun test ne le voie.
- **Risque** : perte de signal de détection ; régression silencieuse possible.
- **Fichier(s)** : `packages/validation/src/*.ts` (33 schémas), `apps/api/src/common/validation/zod-validation.pipe.ts:9-15`
- **Solution** : appliquer `.strict()` à tous les schémas de corps de requête et renvoyer 400 avec
  journalisation d'un événement de sécurité lorsqu'une clé inconnue sensible
  (`tenantId`, `enterpriseId`, `isSuperAdmin`, `role`) est présente.
- **Priorité** : P3
- **Statut** : OUVERT

### SEC-15

- **Sévérité** : LOW
- **Composant** : Chiffrement en transit — API vers base de données
- **Description** : ni `DATABASE_URL` ni `TENANT_DATABASE_URL` ne portent `sslmode=require`, et
  le service Postgres n'est configuré avec aucun certificat.
- **Impact** : le trafic SQL circule en clair sur le réseau Docker. La surface est réduite (réseau
  interne, port non publié en production), mais elle inclut identifiants de connexion et données
  de tous les tenants pour tout conteneur compromis du même réseau.
- **Risque** : interception latérale ; non-conformité au principe « aucun trafic en clair, y
  compris entre services internes ».
- **Fichier(s)** : `docker/docker-compose.prod.yml` (service `postgres`, variables `DATABASE_URL`/`TENANT_DATABASE_URL`)
- **Solution** : activer TLS côté Postgres et ajouter `sslmode=verify-full` aux deux URL.
- **Priorité** : P3
- **Statut** : OUVERT

### SEC-16

- **Sévérité** : LOW
- **Composant** : Politique de mots de passe et MFA
- **Description** : `passwordSchema` impose 10 caractères avec minuscule, majuscule et chiffre.
  Aucun contrôle contre les listes de mots de passe compromis. La MFA n'est obligatoire que pour
  `SUPER_ADMIN` ; aucune route d'enrôlement TOTP n'existe pour les utilisateurs tenant — le
  secret MFA n'est posé que par `scripts/create-super-admin.ts`.
- **Impact** : un `ADMIN` d'entreprise, un `COMPTABLE` ou tout rôle habilité à valider un paiement
  ne dispose que d'un facteur, alors qu'il manipule des données financières.
- **Risque** : prise de contrôle de compte à privilèges par mot de passe faible ou rejoué.
- **Fichier(s)** :
  - `packages/validation/src/auth.ts:24-30` (`passwordSchema`)
  - `apps/api/src/auth/auth.service.ts:111-128` (MFA exigée pour le seul Super Admin)
  - `apps/api/src/auth/mfa.service.ts` (aucun point d'entrée HTTP d'enrôlement)
- **Solution** : porter le minimum à 12 caractères, contrôler contre une liste de mots de passe
  compromis, exposer un parcours d'enrôlement TOTP et rendre la MFA obligatoire pour les rôles
  portant `users.manage`, `settings.manage`, `billing.manage` et `accounting.*`.
- **Priorité** : P3
- **Statut** : OUVERT

### SEC-17

- **Sévérité** : LOW
- **Composant** : Rotation des refresh tokens
- **Description** : la rotation est correctement implémentée (jeton opaque de 48 octets, stocké
  haché en SHA-256, révocation de toute la famille sur réutilisation) et couverte par un test.
  Elle n'est cependant **pas atomique** : `refreshToken.create()` puis `refreshToken.update()`
  sont deux appels séparés, hors transaction.
- **Impact** : deux requêtes `/auth/refresh` concurrentes portant le même jeton peuvent toutes
  deux constater `status === ACTIVE` avant l'une des mises à jour, et créer deux jetons valides
  dans la même famille sans déclencher la détection de réutilisation. Fenêtre étroite, mais
  atteignable sur un réseau instable — cas explicitement cité pour le contexte 3G/4G.
- **Risque** : détection de vol de session ponctuellement contournée.
- **Fichier(s)** : `apps/api/src/auth/auth.service.ts:250-263`
- **Solution** : envelopper la lecture, la création et la mise à jour dans un
  `prisma.$transaction` en isolation `Serializable`, ou passer par un `updateMany` conditionnel
  sur `status: ACTIVE` et traiter `count === 0` comme une réutilisation.
- **Priorité** : P3
- **Statut** : OUVERT

### SEC-18

- **Sévérité** : LOW
- **Composant** : MFA — rejeu de code TOTP
- **Description** : `MfaService.verifyCode()` s'appuie sur `authenticator.check()` sans mémoriser
  les codes déjà consommés. Le chiffrement du secret est correct (AES-256-GCM, IV aléatoire de
  12 octets par chiffrement, tag d'authentification vérifié).
- **Impact** : un code TOTP intercepté reste utilisable pendant toute la fenêtre en cours.
- **Risque** : rejeu de second facteur sur une fenêtre de 30 secondes.
- **Fichier(s)** : `apps/api/src/auth/mfa.service.ts:27-29`
- **Solution** : mémoriser le dernier pas de temps validé par utilisateur et refuser sa
  réutilisation.
- **Priorité** : P3
- **Statut** : OUVERT

### SEC-19

- **Sévérité** : LOW
- **Composant** : Script de création du Super Admin
- **Description** : `pnpm create-super-admin --password <password>` reçoit le mot de passe en
  argument de ligne de commande.
- **Impact** : le mot de passe apparaît dans l'historique du shell, dans `ps` et dans les
  journaux d'audit système de l'hôte. L'URI de provisioning TOTP est en outre affichée sur la
  sortie standard, donc potentiellement capturée par le journal de déploiement.
- **Risque** : divulgation des identifiants du compte le plus privilégié de la plateforme.
- **Fichier(s)** : `apps/api/src/scripts/create-super-admin.ts:66-90,96-103`
- **Solution** : lire le mot de passe sur `stdin` en mode masqué, ou depuis une variable
  d'environnement ; rappeler dans la procédure de déploiement que la sortie ne doit pas être
  journalisée.
- **Priorité** : P3
- **Statut** : OUVERT

### SEC-20

- **Sévérité** : LOW
- **Composant** : En-têtes de sécurité HTTP
- **Description** : `helmet()` est activé avec sa configuration par défaut. La CSP par défaut de
  helmet est appliquée à l'API mais n'est pas explicitement définie ; HSTS est laissé à Caddy.
  Aucune limite de taille de corps n'est fixée explicitement (`express.json({ limit })`), la
  valeur par défaut d'Express (100 kB) s'applique donc implicitement.
- **Impact** : posture correcte mais non maîtrisée : un changement de version de helmet ou de
  Caddy modifierait silencieusement les en-têtes servis.
- **Risque** : dérive de configuration.
- **Fichier(s)** : `apps/api/src/main.ts:18`, `docker/Caddyfile`
- **Solution** : déclarer explicitement CSP, HSTS (`max-age=31536000; includeSubDomains; preload`),
  `Referrer-Policy` et la limite de corps ; ajouter un test d'intégration sur les en-têtes de
  réponse.
- **Priorité** : P3
- **Statut** : OUVERT

### SEC-21

- **Sévérité** : LOW
- **Composant** : Session côté web — cookie de refresh
- **Description** : le cookie portant le refresh token est posé avec `httpOnly: true`,
  `secure: process.env.NODE_ENV === "production"` et `sameSite: "lax"`.
- **Impact** : `lax` autorise l'envoi du cookie sur une navigation de premier niveau initiée par
  un site tiers. Les routes concernées (`/api/session/*` de Next.js) sont en `POST`, non couvertes
  par `lax`, le risque effectif est donc faible ; `strict` reste néanmoins l'attendu pour un jeton
  de rafraîchissement.
- **Risque** : surface CSRF résiduelle en cas d'ajout futur d'une route `GET` de session.
- **Fichier(s)** : `apps/web/src/lib/session/cookies.ts:12-14`
- **Solution** : passer à `sameSite: "strict"`.
- **Priorité** : P3
- **Statut** : OUVERT

### SEC-22

- **Sévérité** : INFO
- **Composant** : Gestion des secrets — constat conforme
- **Description** : `.gitignore` couvre `.env`, `.env.local`, `.env.*.local`, `docker/.env.prod`,
  `backups/` et `*.dump`. `git ls-files` ne remonte que `.env.example` et
  `docker/.env.prod.example`. La recherche de motifs de clés (`BEGIN PRIVATE`, `sk_live`, `AKIA…`)
  sur l'ensemble des fichiers suivis ne renvoie aucun résultat. `config/env.ts` centralise l'accès
  et échoue au démarrage sur variable manquante (`requireEnv`).
- **Impact** : aucun. Constat positif conservé comme référence.
- **Risque** : néant. Seule exception : SEC-09 (mot de passe de rôle en dur dans une migration).
- **Fichier(s)** : `.gitignore`, `apps/api/src/config/env.ts:3-9`
- **Solution** : maintenir ; compléter par un scanner de secrets en CI (SEC-11).
- **Priorité** : —
- **Statut** : OUVERT (suivi documentaire)

### SEC-23

- **Sévérité** : INFO
- **Composant** : Webhooks de paiement — constat conforme
- **Description** : `HmacPaymentProviderAdapter.verifySignature()` calcule un HMAC-SHA256 sur le
  corps brut (`rawBody: true` dans `main.ts`), compare les longueurs puis utilise
  `crypto.timingSafeEqual`. `PaymentWebhookService` refuse tout webhook dont le paiement n'a pas
  été préalablement amorcé, traite le rejeu comme idempotent via la contrainte d'unicité
  `(provider, providerReference)`, et **recalcule** montant et devise côté serveur avant
  d'activer un abonnement.
- **Impact** : aucun. Le seul manque est une fenêtre temporelle de signature (anti-rejeu par
  horodatage), largement compensée par l'idempotence.
- **Risque** : résiduel faible.
- **Fichier(s)** :
  - `apps/api/src/payments/providers/hmac-payment-provider.adapter.ts:14-29`
  - `apps/api/src/payments/payments-webhook.service.ts:34-66`
- **Solution** : ajouter un horodatage signé et une fenêtre d'acceptation courte lorsque les
  schémas réels des fournisseurs (Wave, Orange Money, Free Money) seront disponibles.
- **Priorité** : —
- **Statut** : OUVERT (suivi documentaire)

### SEC-24

- **Sévérité** : INFO
- **Composant** : Stockage des jetons côté clients — constat conforme
- **Description** : `apps/web` conserve l'access token en mémoire (`auth-provider.tsx`) et le
  refresh token dans un cookie `httpOnly` posé par un route handler Next.js. `apps/mobile` utilise
  `expo-secure-store` avec `WHEN_UNLOCKED_THIS_DEVICE_ONLY` et un test vérifiant que l'access token
  n'est jamais persisté. Aucun usage de `localStorage`/`sessionStorage` pour un jeton.
- **Impact** : aucun.
- **Risque** : néant.
- **Fichier(s)** : `apps/web/src/lib/session/cookies.ts`, `apps/web/src/lib/session/auth-provider.tsx`,
  `apps/mobile/src/lib/secure-token-store.ts`
- **Solution** : maintenir.
- **Priorité** : —
- **Statut** : OUVERT (suivi documentaire)

---

## 4. Points nécessitant une validation juridique

- Durée de conservation du journal d'audit : 5 ans retenus au titre d'OHADA. À confirmer par un
  juriste, de même que la durée applicable aux `audit_logs` contenant des données à caractère
  personnel (email, IP, user-agent).
- Recensement des traitements de données personnelles et besoin éventuel de déclaration auprès de
  la **CDP** (loi sénégalaise n° 2008-12) : non traité dans le dépôt, aucun registre présent.
- Journalisation de l'email en clair dans le champ `metadata` d'un `LOGIN_FAILED` pour un compte
  inexistant (`auth.service.ts:47`) : proportionnalité à valider.
- Hébergement et transferts hors frontières des sauvegardes chiffrées (`scripts/backup-offsite-*.sh`).

## 5. Risques résiduels acceptés

Aucun risque résiduel n'a été formellement accepté à ce stade : les constats HIGH ci-dessus n'ont
fait l'objet d'aucune décision documentée. En l'état, SEC-01 à SEC-05 doivent être traités avant
toute mise en production réelle avec des données clients.
