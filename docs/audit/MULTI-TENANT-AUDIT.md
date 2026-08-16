# Audit d'isolation multi-tenant — ERP GESCOM COMPTA SaaS

- **Date** : 2026-08-16
- **Référentiel** : `CLAUDE.md` §5 (« règle la plus critique du projet »).
- **Périmètre** : `apps/api/src/tenant`, `apps/api/src/prisma`, `apps/api/src/common/guards`,
  l'ensemble des repositories et services accédant à Prisma, les 16 migrations SQL de
  `apps/api/prisma/migrations`, la suite `test:tenant`, et la configuration Postgres
  (`docker/`, `scripts/prod-post-deploy.sh`).
- **Méthode** : lecture directe des migrations SQL et du code. Les affirmations des ADR et des
  messages de commit n'ont pas été retenues comme preuve ; chaque mécanisme a été retrouvé dans
  la source.

---

## 1. Architecture d'isolation constatée

Le dispositif décrit dans `CLAUDE.md` §5 est **réellement en place**, et non simplement documenté :

1. **Origine du `tenantId`** — `TenantContextMiddleware` vérifie le JWT via
   `TokenService.verifyAccessToken()` et alimente l'`AsyncLocalStorage` avec
   `payload.enterpriseId` **uniquement**. Aucune lecture de corps, de query string ou d'en-tête
   applicatif. (`apps/api/src/tenant/tenant-context.middleware.ts:24-36`)
2. **Propagation** — `TenantContext` (`AsyncLocalStorage`), avec `getRequiredTenantId()` qui
   **lève** au lieu de retourner `undefined`. (`apps/api/src/tenant/tenant-context.ts:26-32`)
3. **Application base** — `TenantScopedPrismaService.run()` ouvre une transaction Prisma et y
   exécute `SELECT set_config('app.tenant_id', $1, true)` (équivalent paramétré de
   `SET LOCAL`), avant d'appeler le callback. Le `true` en troisième argument garantit la portée
   transactionnelle : un pool de connexions partagé ne peut pas fuiter le réglage vers une autre
   requête. (`apps/api/src/tenant/tenant-scoped-prisma.service.ts:43-56`)
4. **Garantie ultime** — `ENABLE` **et** `FORCE ROW LEVEL SECURITY` avec une policy
   `tenant_isolation` sur chaque table tenant, appuyée sur
   `current_setting('app.tenant_id', true)::uuid`.
5. **Rôle Postgres** — `erp_app_tenant` créé `NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS
   NOREPLICATION`, non propriétaire des tables, avec des `GRANT` table par table. Ce point est
   **vérifié par un test automatisé** interrogeant `pg_roles` et `pg_tables`
   (`tenant-isolation.tenant.spec.ts:200-213`).

C'est une implémentation sérieuse. Les constats ci-dessous portent sur ses angles morts.

## 2. Couverture RLS — vérification table par table

Vingt-sept tables portent `FORCE ROW LEVEL SECURITY` et une policy `tenant_isolation` :
`enterprises`, `roles`, `user_roles`, `role_permissions`, `users`, `settings`, `notifications`,
`subscriptions`, `subscription_events`, `payments`, `invoices`, `invoice_counters`, `accounts`,
`onboarding_states`, `customers`, `suppliers`, `products`, `stock_movements`, `sales`,
`sale_lines`, `purchases`, `purchase_lines`, `sales_invoices`, `sales_invoice_counters`,
`journal_entries`, `journal_entry_lines`, `journal_entry_counters`.

Les tables de catalogue plateforme (`permissions`, `plans`, `features`, `plan_features`,
`limits`, `plan_limits`) sont en `GRANT SELECT` seul, sans RLS : correct, elles ne portent pas de
donnée tenant.

**Table tenant sans RLS** : `audit_logs` (colonne `enterprise_id` présente) — voir MT-04.
**Tables sans colonne de rattachement tenant** : `refresh_tokens`, `auth_tokens` — voir MT-05.

## 3. Synthèse

| Sévérité | Nombre |
|---|---|
| CRITICAL | 0 |
| HIGH | 1 |
| MEDIUM | 5 |
| LOW | 3 |
| INFO | 2 |

---

## 4. Constats

### MT-01

- **Sévérité** : HIGH
- **Composant** : Connexion « identité » Postgres — contournement structurel de la RLS
- **Description** : `PrismaService` se connecte via `DATABASE_URL`, dont l'utilisateur est
  `POSTGRES_USER`, c'est-à-dire le compte créé par l'image `postgres:16-alpine` — **superuser du
  cluster et propriétaire de toutes les tables**. Or PostgreSQL n'applique aucune policy RLS à un
  superuser, ni au propriétaire d'une table même sous `FORCE` (`FORCE` ne neutralise que
  l'exemption du propriétaire vis-à-vis de ses propres tables lorsqu'il n'est pas superuser ; le
  superuser reste exempt en toutes circonstances). Ce client est injecté dans dix classes :
  `AuthService`, `AccountRecoveryService`, `AuditLogService`, `NotificationsService`,
  `PaymentWebhookService`, `PlansService`, `ProvisioningService`, `InvitationsService`,
  `HealthController` et `CrossTenantRepository`.
- **Impact** : la « garantie ultime côté base » revendiquée par `CLAUDE.md` §5 ne s'applique pas
  à ces dix composants. Parmi eux, `NotificationsService` écrit dans `notifications` (table
  tenant) avec un `enterpriseId` reçu en paramètre, sans aucune vérification ; `InvitationsService`
  lit `users` sur toute la plateforme ; `PaymentWebhookService` lit et écrit `payments`,
  `subscriptions` et `enterprises` de n'importe quel tenant. Toute erreur de filtre dans l'un
  d'eux produit une fuite inter-tenant sans qu'aucun garde-fou base ne l'arrête.
- **Risque** : `CLAUDE.md` §5 range explicitement « un rôle applicatif Postgres
  `superuser`/propriétaire de table utilisé par l'API » parmi les **interdits**. L'interdit est
  enfreint.
- **Fichier(s)** :
  - `apps/api/src/prisma/prisma.service.ts:5` (aucune `datasources` : hérite de `DATABASE_URL`)
  - `docker/docker-compose.dev.yml:6-8` (`POSTGRES_USER: erp`)
  - `docker/docker-compose.prod.yml` (`DATABASE_URL: ${DATABASE_URL}` bâti sur `POSTGRES_USER`)
  - `apps/api/src/notifications/notifications.service.ts:23,29-42`
  - `apps/api/src/users/invitations.service.ts:19,36-40`
  - `apps/api/src/payments/payments-webhook.service.ts:27,43-46`
- **Solution** : introduire un rôle `erp_app_identity` (`NOSUPERUSER NOBYPASSRLS`, non
  propriétaire) avec des `GRANT` limités aux seules tables nécessaires aux flux pré-tenant, et le
  substituer à `POSTGRES_USER` dans `DATABASE_URL`. Réserver le compte propriétaire à l'exécution
  des migrations, dans un conteneur éphémère distinct du runtime API. Étendre le test
  `tenant-isolation.tenant.spec.ts:200-213` au nouveau rôle. Le seul consommateur qui doit rester
  hors RLS est `CrossTenantRepository`, et il devrait alors disposer de sa propre connexion,
  distincte et auditée.
- **Priorité** : P1
- **Statut** : OUVERT

### MT-02

- **Sévérité** : MEDIUM
- **Composant** : Défense en profondeur — absence de Prisma Client Extension
- **Description** : `CLAUDE.md` §5 prévoit « un repository de base scopé côté Prisma (middleware
  `$extends` ou Client Extension) [qui] refuse toute requête sur un modèle tenant exécutée hors
  `TenantContext` ». Cette extension **n'existe pas**. Le seul garde applicatif est le
  `TenantContext.getRequiredTenantId()` appelé au début de `TenantScopedPrismaService.run()` : il
  ne protège que le code qui a déjà choisi d'utiliser ce service. Rien, techniquement, n'empêche
  un nouveau service métier d'injecter `PrismaService` et d'interroger `tx.customer.findMany()`
  sans aucun scope — c'est exactement ce que font déjà dix classes (MT-01). Aucune règle ESLint
  n'interdit non plus l'injection de `PrismaService` hors d'un repository.
- **Impact** : l'isolation « structurelle, jamais fondée sur la discipline du développeur »
  revendiquée par `CLAUDE.md` repose en pratique, pour le choix de la connexion, sur la seule
  discipline du développeur. Le mécanisme lève bien (`rejects.toThrow(/TenantContext/)`, testé en
  `tenant-isolation.tenant.spec.ts:33-35`), mais uniquement pour qui l'emprunte.
- **Risque** : régression future silencieuse — un module ajouté avec la mauvaise connexion ne
  déclenche aucun échec de test.
- **Fichier(s)** :
  - `apps/api/src/tenant/tenant-scoped-prisma.service.ts:43-48` (garde limité à `run()`)
  - `apps/api/src/prisma/prisma.service.ts:5` (client nu, exporté globalement par `PrismaModule`)
  - `eslint.config.js` (aucune restriction d'import/injection)
- **Solution** : (1) implémenter un `$extends` sur `PrismaService` qui lève dès qu'une opération
  vise un modèle porteur d'`enterpriseId` alors qu'aucune liste blanche explicite ne l'autorise ;
  (2) restreindre `PrismaModule` pour qu'il n'exporte `PrismaService` qu'aux modules recensés ;
  (3) ajouter une règle ESLint `no-restricted-imports` sur `PrismaService` hors des fichiers
  `*.repository.ts` et de la liste blanche pré-tenant.
- **Priorité** : P2
- **Statut** : OUVERT

### MT-03

- **Sévérité** : MEDIUM
- **Composant** : Suite `test:tenant` — couverture incomplète au regard de `CLAUDE.md` §5
- **Description** : dix fichiers `*.tenant.spec.ts` existent (`tenant`, `customers`, `suppliers`,
  `products`, `stock`, `sales`, `purchases`, `invoicing`, `accounting`, `reports`) et la suite est
  bloquante en CI. Confrontée aux cinq critères de `CLAUDE.md` §5 :
  - **Critère 1** (404 et non 403 sur une ressource d'un autre tenant) : couvert au niveau
    repository (`customers.repository.ts:52-60` renvoie `NotFoundException`) et par les specs
    HTTP de module.
  - **Critère 2** (requête forgée avec le `tenantId` de B dans le corps) : **non couvert**. Aucun
    test n'envoie `enterpriseId`/`tenantId` dans un corps de requête pour vérifier qu'il est
    ignoré. La protection existe (Zod `strip` + `enterpriseId` pris sur `req.user`), mais elle
    n'est pas verrouillée par un test.
  - **Critère 3** (« test générique appliqué à **tous** les endpoints de liste ») : le test n'est
    pas générique — c'est une liste de cas écrits à la main, table par table. Les endpoints de
    liste de `users`, `roles`, `settings`, `onboarding` et `subscriptions/me` n'ont **aucun**
    test d'isolation.
  - **Critère 4** (requête hors `TenantContext`) : couvert (`tenant-isolation.tenant.spec.ts:33-35`).
  - **Critère 5** (un `ADMIN` ne peut s'attribuer `SUPER_ADMIN`) : couvert
    (`super-admin-privilege-escalation.integration.spec.ts`).
  Par ailleurs, le script est `jest --passWithNoTests --testPathPattern="\.tenant\.spec\.ts$"` :
  si le motif cessait de correspondre (renommage, déplacement), la CI passerait au vert avec
  **zéro** test d'isolation exécuté.
- **Impact** : trois des cinq critères contractuels ne sont pas pleinement satisfaits, et le
  garde-fou CI peut devenir silencieusement inopérant.
- **Risque** : fausse assurance ; régression d'isolation non détectée sur les modules
  d'administration (users, roles, settings).
- **Fichier(s)** :
  - `apps/api/package.json:11` (`"test:tenant"` avec `--passWithNoTests`)
  - `apps/api/src/tenant/tenant-isolation.tenant.spec.ts:1-214`
  - absence de `users/*.tenant.spec.ts`, `roles/*.tenant.spec.ts`, `settings/*.tenant.spec.ts`,
    `onboarding/*.tenant.spec.ts`, `subscriptions/*.tenant.spec.ts`
- **Solution** : retirer `--passWithNoTests` de `test:tenant` et ajouter un test de garde
  vérifiant qu'au moins N fichiers sont exécutés. Écrire un test **générique** parcourant la table
  de routage NestJS et vérifiant, pour chaque endpoint de liste, que le tenant A ne voit aucune
  ressource du tenant B. Ajouter le test « `enterpriseId` du tenant B injecté dans le corps →
  ressource créée/lue dans A ».
- **Priorité** : P2
- **Statut** : OUVERT

### MT-04

- **Sévérité** : MEDIUM
- **Composant** : Table `audit_logs` — table tenant hors RLS
- **Description** : `AuditLog` porte une colonne `enterprise_id` (nullable pour les actions
  plateforme) mais aucune migration ne pose `ENABLE`/`FORCE ROW LEVEL SECURITY` ni de policy
  `tenant_isolation` sur `audit_logs`. La table n'apparaît dans aucun `GRANT` vers
  `erp_app_tenant` — les écritures passent donc exclusivement par la connexion superuser
  (MT-01), ce qui limite l'exposition actuelle mais ne constitue pas un contrôle.
- **Impact** : aucun endpoint tenant ne lit aujourd'hui l'audit, l'exposition immédiate est donc
  nulle. Mais le jour où une page « Journal d'activité » sera exposée à un `ADMIN` d'entreprise —
  besoin fonctionnel évident pour un ERP — l'isolation reposerait entièrement sur une clause
  `where` applicative, sans filet base, contrairement à toutes les autres tables tenant.
- **Risque** : fuite inter-tenant de la piste d'audit (qui a fait quoi, quand, depuis quelle IP)
  au premier endpoint de consultation ajouté.
- **Fichier(s)** :
  - `apps/api/prisma/schema.prisma:1033-1051` (modèle `AuditLog`, `@@index([enterpriseId])`)
  - `apps/api/prisma/migrations/20260809113836_add_tenant_role_and_rls/migration.sql:37-96`
    (`audit_logs` absente de la liste)
- **Solution** : poser dès maintenant `ENABLE`/`FORCE ROW LEVEL SECURITY` sur `audit_logs` avec
  une policy `SELECT` sur `enterprise_id = current_setting('app.tenant_id', true)::uuid`, un
  `GRANT SELECT` (jamais `UPDATE`/`DELETE`, cf. SEC-13) vers `erp_app_tenant`, et un test
  d'isolation dédié.
- **Priorité** : P2
- **Statut** : OUVERT

### MT-05

- **Sévérité** : MEDIUM
- **Composant** : Table `auth_tokens` — accessible en écriture depuis un contexte tenant, sans RLS
- **Description** : la migration RLS accorde explicitement
  `GRANT SELECT, INSERT, UPDATE, DELETE ON auth_tokens TO erp_app_tenant`, en assumant l'absence de
  policy : « Pas de colonne `enterpriseId` sur `auth_tokens` […] mais pas de policy RLS
  applicable » (`migration.sql:30-33`). Ce droit est nécessaire à `InvitationsService.invite()`,
  qui crée le jeton d'invitation à l'intérieur d'un `tenantPrisma.run()`. Conséquence : depuis
  n'importe quel `TenantContext`, la connexion tenant peut lire, modifier ou supprimer **tous**
  les `auth_tokens` de la plateforme — jetons de réinitialisation de mot de passe et
  d'invitation de tous les tenants confondus, y compris ceux d'un futur Super Admin.
- **Impact** : les jetons sont stockés hachés (`tokenHash`), une lecture ne permet donc pas de les
  rejouer directement. En revanche, un `DELETE`/`UPDATE` permettrait un déni de service ciblé
  (invalidation des réinitialisations d'un concurrent) et un `INSERT` permettrait de fabriquer un
  jeton d'invitation valide pour un `userId` arbitraire, dont on connaîtrait le clair — soit une
  prise de contrôle de compte inter-tenant, dès lors qu'un chemin de code exploitable existerait.
  À ce jour aucun endpoint ne l'expose ; c'est le privilège lui-même qui est excessif.
- **Risque** : violation du moindre privilège sur la table la plus sensible après `users` ;
  escalade inter-tenant en cas de faille applicative dans un module tenant.
- **Fichier(s)** :
  - `apps/api/prisma/migrations/20260809113836_add_tenant_role_and_rls/migration.sql:30-33`
  - `apps/api/src/users/invitations.service.ts:68-76` (création du `authToken` dans `tenantPrisma.run`)
  - `apps/api/prisma/schema.prisma:222-234` (modèle `AuthToken`, sans `enterpriseId`)
- **Solution** : ajouter une colonne `enterprise_id` (nullable pour les jetons plateforme) sur
  `auth_tokens`, poser une policy RLS, et réduire le `GRANT` à `INSERT` seul pour le rôle tenant.
  Alternative : sortir la création du jeton d'invitation de la transaction tenant et la confier à
  la connexion d'identité, puis révoquer entièrement les droits du rôle tenant sur `auth_tokens`.
- **Priorité** : P2
- **Statut** : OUVERT

### MT-06

- **Sévérité** : MEDIUM
- **Composant** : Fraîcheur du contexte tenant — durée de vie du JWT
- **Description** : `TenantContextMiddleware` établit le contexte à partir du seul contenu du JWT,
  sans consulter la base. Aucun mécanisme de révocation d'access token n'existe (les refresh
  tokens sont révocables, les access tokens non). Combiné à l'absence de contrôle de
  `User.status`/`Enterprise.status` (constat SEC-03), cela signifie qu'un utilisateur retiré d'une
  entreprise, suspendu, ou dont l'entreprise a été suspendue, conserve un contexte tenant pleinement
  opérationnel jusqu'à expiration naturelle de son access token.
- **Impact** : fenêtre de 15 minutes (`JWT_ACCESS_TTL` par défaut) pendant laquelle une révocation
  d'accès décidée par un administrateur reste sans effet sur les données du tenant.
- **Risque** : impossibilité de couper immédiatement un accès en cas d'incident — point de
  contrôle attendu en réponse à incident (§12 de la politique de sécurité).
- **Fichier(s)** :
  - `apps/api/src/tenant/tenant-context.middleware.ts:24-36`
  - `apps/api/src/auth/guards/jwt-auth.guard.ts:22-25`
  - `apps/api/src/config/env.ts:16` (`JWT_ACCESS_TTL` par défaut `15m`)
- **Solution** : documenter et assumer explicitement la fenêtre de 15 minutes, ou introduire une
  liste de révocation (`jti` en cache court) consultée par `JwtAuthGuard` lors d'une suspension.
  Dans tous les cas, révoquer toutes les familles de refresh tokens à la suspension d'un
  utilisateur ou d'une entreprise.
- **Priorité** : P2
- **Statut** : OUVERT

### MT-07

- **Sévérité** : LOW
- **Composant** : Policies RLS — `WITH CHECK` implicite et absence de test d'écriture
- **Description** : les 27 policies sont écrites `CREATE POLICY tenant_isolation ON <table> USING
  (<expr>)`, sans `FOR` ni `WITH CHECK`. Le comportement PostgreSQL est correct : `FOR ALL` par
  défaut, et en l'absence de `WITH CHECK` c'est l'expression `USING` qui s'applique aux lignes
  insérées ou modifiées. L'insertion inter-tenant est donc bien bloquée. Mais cela n'est ni
  explicite ni testé : la suite `test:tenant` ne contient **aucun** test d'`INSERT` avec un
  `enterpriseId` appartenant à un autre tenant. Seul un `UPDATE` inter-tenant est testé
  (`tenant-isolation.tenant.spec.ts:54-69`).
- **Impact** : une modification future d'une policy (ajout d'un `WITH CHECK` divergent, passage en
  `FOR SELECT`) ouvrirait l'écriture inter-tenant sans qu'aucun test n'échoue.
- **Risque** : régression silencieuse sur le chemin d'écriture.
- **Fichier(s)** :
  - `apps/api/prisma/migrations/20260809113836_add_tenant_role_and_rls/migration.sql:45-96`
  - `apps/api/src/tenant/tenant-isolation.tenant.spec.ts:54-69`
- **Solution** : rendre le `WITH CHECK` explicite sur chaque policy et ajouter un test
  « depuis le contexte de A, l'insertion d'une ligne portant `enterpriseId = B` est rejetée » sur
  au moins une table de chaque famille (données métier, compteur, ligne de document).
- **Priorité** : P3
- **Statut** : OUVERT

### MT-08

- **Sévérité** : LOW
- **Composant** : Tables à `enterprise_id` nullable — `settings` et `notifications`
- **Description** : `Setting` et `Notification` ont un `enterpriseId` nullable
  (`scope = PLATFORM` pour l'un, notifications plateforme pour l'autre), mais leur policy est
  `enterprise_id = current_setting('app.tenant_id', true)::uuid`. Une comparaison avec `NULL`
  produisant `NULL`, ces lignes sont invisibles et non modifiables depuis la connexion tenant.
- **Impact** : comportement sûr (« fail closed »), mais non intentionnel et non testé.
  `SettingsService.listEnterpriseSettings()` filtre déjà sur `scope: "ENTERPRISE"`, ce qui masque
  le sujet. Une future fonctionnalité de paramètre plateforme visible par les tenants échouerait
  de façon opaque.
- **Risque** : comportement fonctionnel surprenant, aucun risque de sécurité.
- **Fichier(s)** :
  - `apps/api/prisma/migrations/20260809113836_add_tenant_role_and_rls/migration.sql:68-76`
  - `apps/api/prisma/schema.prisma:1055-1067`, `apps/api/prisma/schema.prisma:1070-1087`
- **Solution** : documenter le choix en commentaire de migration et ajouter un test constatant
  l'invisibilité des lignes `PLATFORM` depuis un contexte tenant.
- **Priorité** : P3
- **Statut** : OUVERT

### MT-09

- **Sévérité** : LOW
- **Composant** : Routes tenant appelées par un Super Admin — échec en 500
- **Description** : `GET /v1/subscriptions/me` et `GET|PATCH /v1/onboarding` ne sont protégés que
  par `JwtAuthGuard` et s'appuient sur `TenantScopedPrismaService`. Un Super Admin, qui n'a pas
  d'`enterpriseId` et pour lequel `TenantContextMiddleware` ne peuple donc aucun contexte,
  déclenche l'`Error` nu de `getRequiredTenantId()`, converti en 500 par NestJS faute de filtre
  d'exception global (SEC-10).
- **Impact** : comportement fail-closed correct sur le fond, mais rendu par un 500 au lieu d'un
  403. Bruit d'alerte et diagnostic dégradé.
- **Risque** : faible ; masque de vraies erreurs serveur dans la supervision.
- **Fichier(s)** :
  - `apps/api/src/subscriptions/my-subscription.controller.ts:5-12`
  - `apps/api/src/onboarding/onboarding.controller.ts:11-22`
  - `apps/api/src/tenant/tenant-context.ts:28-30`
- **Solution** : convertir l'absence de `TenantContext` en `ForbiddenException` typée, ou ajouter
  un `TenantRequiredGuard` explicite sur ces contrôleurs.
- **Priorité** : P3
- **Statut** : OUVERT

### MT-10

- **Sévérité** : INFO
- **Composant** : `CrossTenantRepository` — constat conforme
- **Description** : les accès cross-tenant du Super Admin passent bien par un
  `CrossTenantRepository` unique et explicite, sans logique métier, et chaque appel de
  `SuperAdminService` journalise un `CROSS_TENANT_ACCESS` dans l'audit
  (`super-admin.service.ts:28-50`). `SubscriptionsService` journalise `CHANGE_PLAN`. Aucune route
  Super Admin n'accède directement à `PrismaService`.
- **Impact** : aucun. Conforme à `CLAUDE.md` §5.
- **Risque** : le seul point de vigilance est que la journalisation dépend de la discipline de
  chaque appelant, comme le note d'ailleurs le commentaire du fichier — un futur consommateur du
  repository pourrait l'omettre.
- **Fichier(s)** : `apps/api/src/tenant/cross-tenant.repository.ts:16-123`,
  `apps/api/src/super-admin/super-admin.service.ts:28-50`
- **Solution** : déplacer la journalisation `CROSS_TENANT_ACCESS` dans le repository lui-même
  pour la rendre non contournable.
- **Priorité** : —
- **Statut** : OUVERT (suivi documentaire)

### MT-11

- **Sévérité** : INFO
- **Composant** : Origine du `tenantId` — constat conforme
- **Description** : vérification exhaustive menée sur `apps/api/src` — aucun `@Body()`, `@Query()`
  ni accès `req.body` non validé par un `ZodValidationPipe` ; aucun `@Param("enterpriseId")` sur
  une route tenant (le paramètre n'apparaît que sur les routes `admin/enterprises/:enterpriseId/*`,
  protégées par `SuperAdminGuard`) ; aucun schéma Zod n'accepte de champ `tenantId`,
  `enterpriseId` ou `isSuperAdmin`. Tous les contrôleurs tenant transmettent
  `user.enterpriseId`, issu de `request.user` alimenté par `JwtAuthGuard`. La contrainte SQL
  `users_super_admin_has_no_enterprise_chk` verrouille en base l'invariant
  `isSuperAdmin ⇔ enterpriseId IS NULL`.
- **Impact** : aucun. Le critère « le `tenantId` provient exclusivement du token vérifié » est
  respecté.
- **Risque** : néant.
- **Fichier(s)** : `apps/api/src/auth/guards/jwt-auth.guard.ts:24`,
  `apps/api/prisma/migrations/20260809023348_init_saas_domain/migration.sql:430-439`,
  `packages/validation/src/*.ts`
- **Solution** : maintenir ; verrouiller par le test manquant décrit en MT-03 (critère 2).
- **Priorité** : —
- **Statut** : OUVERT (suivi documentaire)

---

## 5. Conclusion

L'isolation multi-tenant est **réelle et structurelle** : RLS forcée sur 27 tables, rôle Postgres
dédié non-superuser vérifié par test, `SET LOCAL` par transaction, `tenantId` exclusivement issu
du JWT. C'est nettement au-dessus de la moyenne pour un SaaS de ce stade.

Le point qui doit être traité en priorité n'est pas une faille d'exploitation immédiate mais un
défaut structurel : **la seconde connexion Prisma est superuser** (MT-01), ce qui neutralise la
garantie base pour dix composants applicatifs et enfreint un interdit explicite de `CLAUDE.md`.
Viennent ensuite l'absence de Client Extension (MT-02) et les trous de la suite `test:tenant`
(MT-03), qui font reposer sur la discipline ce que l'architecture prétend garantir.
