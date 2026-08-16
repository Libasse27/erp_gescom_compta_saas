# Audit du contrôle d'accès (RBAC / autorisation) — ERP GESCOM COMPTA SaaS

- **Date** : 2026-08-16
- **Périmètre** : `packages/permissions`, `apps/api/src/common/guards`,
  `apps/api/src/common/decorators`, `apps/api/src/auth/guards`,
  `apps/api/src/entitlements/guards`, l'ensemble des contrôleurs de `apps/api/src`,
  `apps/api/src/roles`, `apps/api/src/users`, `apps/api/src/super-admin`,
  et la piste d'audit associée (`apps/api/src/common/audit`).
- **Méthode** : recensement exhaustif des routes et de leurs gardes par lecture des décorateurs,
  puis lecture du code de chaque garde. Aucune affirmation de documentation n'a été retenue.

---

## 1. Modèle d'autorisation constaté

Trois niveaux coexistent :

1. **Authentification** — `JwtAuthGuard` : vérifie le JWT et pose
   `request.user = { id, enterpriseId, isSuperAdmin }`.
2. **Plateforme** — `SuperAdminGuard` : exige `user.isSuperAdmin`, re-lu depuis le JWT signé.
   Appliqué aux trois contrôleurs `admin/*`.
3. **Tenant** — `PermissionsGuard` + `@RequirePermission(<clé>)` : la permission est
   **re-résolue en base à chaque requête**, via la connexion RLS
   (`tenantPrisma.run(tx => tx.rolePermission.count(...))`), jamais depuis le JWT ni depuis un
   état client. C'est le bon patron.

S'y ajoutent deux gardes d'« entitlements » (plan et quotas) : `FeatureGuard`,
`SubscriptionAccessGuard`, `LimitGuard`.

Catalogue de permissions : 37 clés typées dans `packages/permissions/src/permission-keys.ts`,
7 rôles par défaut dans `default-roles.ts`.

### Recensement des routes et de leurs gardes

| Contrôleur | Gardes | Permission |
|---|---|---|
| `customers`, `suppliers`, `products`, `stock`, `sales`, `purchases`, `invoicing`, `accounting` (×3), `reports` | `JwtAuthGuard, PermissionsGuard, FeatureGuard, SubscriptionAccessGuard` | `@RequirePermission` sur **chaque** méthode |
| `roles` (GET), `settings` (GET) | `JwtAuthGuard, PermissionsGuard` | `users.manage` / `settings.manage` |
| `users` GET `/`, POST `/invite` | `JwtAuthGuard, PermissionsGuard` (+ `SubscriptionAccessGuard, LimitGuard` sur invite) | `users.manage` |
| `users` GET `/me/context` | `JwtAuthGuard` | aucune (volontaire) |
| `onboarding` GET + **PATCH** | `JwtAuthGuard` | **aucune** |
| `subscriptions/me` GET | `JwtAuthGuard` | **aucune** |
| `admin/overview`, `admin/enterprises`, `admin/enterprises/:id/subscription`, `admin/enterprises/:id/payments` | `JwtAuthGuard, SuperAdminGuard` | — |
| `auth/logout`, `auth/me` | `JwtAuthGuard` | — |
| `auth/*` (login, refresh, mfa/verify, forgot/reset password, verify-email), `auth/register`, `users/accept-invitation`, `plans`, `health`, `webhooks/payments/:provider` | **aucune** | — (routes publiques) |

## 2. Synthèse

| Sévérité | Nombre |
|---|---|
| CRITICAL | 0 |
| HIGH | 1 |
| MEDIUM | 6 |
| LOW | 3 |
| INFO | 1 |

---

## 3. Constats

### RBAC-01

- **Sévérité** : HIGH
- **Composant** : `PermissionsGuard` — comportement d'ouverture par défaut
- **Description** : le garde lit la métadonnée `REQUIRED_PERMISSION_KEY` **uniquement sur le
  handler** (`context.getHandler()`), et si elle est absente il retourne `true`. Deux
  conséquences. (1) Toute méthode placée sous un contrôleur portant
  `@UseGuards(..., PermissionsGuard)` mais oubliant `@RequirePermission` est **autorisée pour
  n'importe quel utilisateur authentifié rattaché à une entreprise**, sans aucun contrôle de
  permission. (2) Un `@RequirePermission` posé au niveau de la **classe** — geste naturel pour
  factoriser, et employé pour `@UseGuards` un peu partout dans ce dépôt — serait **silencieusement
  ignoré**, ouvrant l'intégralité du contrôleur. `FeatureGuard` et `LimitGuard` présentent
  exactement le même patron (`feature.guard.ts:18-21`, `limit.guard.ts:28-31`).
- **Impact** : à ce jour, les dix contrôleurs métier portent bien un `@RequirePermission` sur
  chaque méthode : aucune route n'est actuellement ouverte par ce biais. Le défaut est donc
  latent, mais il transforme un simple oubli de décorateur en faille d'autorisation muette, sans
  échec de test ni erreur de compilation. C'est l'inverse du principe « deny by default » et du
  « fail closed » exigés.
- **Risque** : élévation de privilège horizontale au sein d'un tenant (un `LECTEUR` accédant à
  une route de création) au premier ajout de route négligent.
- **Fichier(s)** :
  - `apps/api/src/common/guards/permissions.guard.ts:21-25` (`getHandler()` seul, puis `return true`)
  - `apps/api/src/common/decorators/require-permission.decorator.ts:8` (`SetMetadata` simple)
  - `apps/api/src/entitlements/guards/feature.guard.ts:18-21`
  - `apps/api/src/entitlements/guards/limit.guard.ts:28-31`
- **Solution** : inverser le défaut. Utiliser
  `reflector.getAllAndOverride(REQUIRED_PERMISSION_KEY, [context.getHandler(), context.getClass()])`
  et **lever `ForbiddenException` lorsque aucune permission n'est déclarée**, sauf marquage
  explicite `@NoPermissionRequired()` justifié par écrit. Test de non-régression : une route de
  test placée sous `PermissionsGuard` sans `@RequirePermission` doit renvoyer 403.
- **Priorité** : P1
- **Statut** : CORRIGÉ (2026-08-16) — `PermissionsGuard` utilise
  `getAllAndOverride` et lève `ForbiddenException` par défaut sauf
  `@RequirePermission` ou `@NoPermissionRequired()` explicite. Tests ajoutés
  (`permissions.guard.spec.ts`).

### RBAC-02

- **Sévérité** : MEDIUM
- **Composant** : Authentification non appliquée par défaut au niveau du routeur
- **Description** : le seul `APP_GUARD` déclaré est `ThrottlerGuard`
  (`app.module.ts:67`). `JwtAuthGuard` est appliqué **route par route ou contrôleur par
  contrôleur**, par `@UseGuards`. Il n'existe donc aucune liste blanche explicite de routes
  publiques : une route est publique par omission.
- **Impact** : le recensement effectué (tableau §1) montre que toutes les routes métier sont
  effectivement protégées — l'état actuel est sain. Mais la propriété n'est garantie par aucun
  mécanisme : ajouter un contrôleur sans `@UseGuards(JwtAuthGuard)` crée une route publique que
  ni le typage, ni le lint, ni les tests ne signalent.
- **Risque** : exposition non authentifiée d'un module futur.
- **Fichier(s)** :
  - `apps/api/src/app.module.ts:67` (`providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }]`)
  - `apps/api/src/onboarding/onboarding.controller.ts:11`, et tous les autres contrôleurs
- **Solution** : enregistrer `JwtAuthGuard` en `APP_GUARD` et introduire un décorateur `@Public()`
  explicite sur les seules routes de la liste blanche (`health`, `plans`, `auth/*`,
  `users/accept-invitation`, `webhooks/payments/:provider`). Ajouter un test parcourant la table
  de routage et vérifiant que toute route hors liste blanche renvoie 401 sans jeton.
- **Priorité** : P2
- **Statut** : OUVERT

### RBAC-03

- **Sévérité** : MEDIUM
- **Composant** : Permission `billing.manage` déclarée mais jamais appliquée
- **Description** : `billing.manage` figure au catalogue et est attribuée au rôle `ADMIN` par
  défaut, mais **aucune route ne l'exige**. `GET /v1/subscriptions/me`, qui expose le plan, le
  statut d'abonnement, les fonctionnalités et les quotas de l'entreprise, n'est protégé que par
  `JwtAuthGuard`.
- **Impact** : n'importe quel utilisateur du tenant — un `LECTEUR`, un `MAGASINIER` — lit les
  informations contractuelles et financières de l'entreprise. `GET /v1/users/me/context` expose
  également `planCode`, `subscriptionStatus` et `features`, sans permission (ce dernier est
  volontaire et documenté, car il pilote le menu, mais il propage la même information).
- **Risque** : divulgation d'informations commerciales à des utilisateurs non habilités ;
  permission déclarée au catalogue sans effet, ce qui fausse la lecture de la matrice RBAC.
- **Fichier(s)** :
  - `packages/permissions/src/permission-keys.ts:46` (`"billing.manage"`)
  - `apps/api/src/subscriptions/my-subscription.controller.ts:5-12`
  - `apps/api/src/users/users.service.ts:32-51`
- **Solution** : exiger `@RequirePermission("billing.manage")` sur `GET /subscriptions/me`, ou
  restreindre la réponse aux seuls éléments nécessaires au pilotage de l'interface pour les autres
  rôles.
- **Priorité** : P2
- **Statut** : OUVERT

### RBAC-04

- **Sévérité** : MEDIUM
- **Composant** : `PATCH /v1/onboarding` — écriture sans permission
- **Description** : `OnboardingController` est protégé par `JwtAuthGuard` seul. La méthode
  `PATCH` modifie l'`OnboardingState` de l'entreprise, ressource partagée par tout le tenant,
  sans aucune permission ni `SubscriptionAccessGuard`.
- **Impact** : tout utilisateur authentifié du tenant, quel que soit son rôle, peut faire avancer
  ou reculer l'assistant d'onboarding de son entreprise. Impact métier limité, mais c'est une
  écriture sur une ressource d'entreprise sans contrôle d'autorisation, non journalisée dans
  l'audit.
- **Risque** : modification non autorisée d'un état partagé ; incohérence de l'interface pour tous
  les utilisateurs du tenant.
- **Fichier(s)** :
  - `apps/api/src/onboarding/onboarding.controller.ts:11,20-22`
  - `apps/api/src/onboarding/onboarding.service.ts:40`
- **Solution** : exiger `@RequirePermission("settings.manage")` sur la méthode `PATCH`, ajouter
  `SubscriptionAccessGuard` et journaliser la modification.
- **Priorité** : P2
- **Statut** : OUVERT

### RBAC-05

- **Sévérité** : MEDIUM
- **Composant** : Absence totale d'administration RBAC
- **Description** : aucun endpoint ne permet de créer ou modifier un rôle, d'attribuer ou de
  retirer une permission à un rôle, de changer le rôle d'un utilisateur, de désactiver, suspendre
  ou supprimer un compte. Les seules routes RBAC sont `GET /v1/roles` (liste) et
  `POST /v1/users/invite`. `RolesService` et `SettingsService` sont explicitement en lecture seule.
  Les commentaires du dépôt affirment pourtant que « l'ADMIN peut ensuite librement modifier les
  permissions de chaque rôle dans son entreprise » (`packages/permissions/src/default-roles.ts`) :
  cette capacité **n'existe pas**.
- **Impact** : conséquence directe — les actions d'audit `CHANGE_ROLE`, `CREATE_USER`,
  `UPDATE_USER`, `DELETE_USER`, `SUSPEND_ACCOUNT`, `REACTIVATE_ACCOUNT` sont déclarées dans l'enum
  `AuditAction` mais **ne sont jamais émises** par aucun code. Un salarié qui quitte l'entreprise
  ne peut pas voir son accès révoqué par l'interface ; la revue trimestrielle des comptes actifs et
  des rôles, attendue par la politique de sécurité, est matériellement impossible.
- **Risque** : accumulation de comptes et de privilèges dormants, sans moyen de correction — c'est
  le contraire du moindre privilège.
- **Fichier(s)** :
  - `apps/api/src/roles/roles.controller.ts:9-16` (un seul `GET`)
  - `apps/api/src/users/users.controller.ts:20-68` (aucune route de modification)
  - `apps/api/prisma/schema.prisma:93-140` (`AuditAction` : `CHANGE_ROLE`, `SUSPEND_ACCOUNT`, … jamais utilisées)
  - `packages/permissions/src/default-roles.ts:70-73` (commentaire non tenu)
- **Solution** : implémenter les endpoints de gestion (`PATCH /users/:id/roles`,
  `PATCH /users/:id/status`, `POST|PATCH /roles`, `PUT /roles/:id/permissions`), tous sous
  `users.manage`, tous journalisés, avec un test « un `ADMIN` du tenant A ne peut pas modifier un
  utilisateur du tenant B » et interdiction pour un utilisateur de modifier son propre rôle.
  Corriger le commentaire de `default-roles.ts` en attendant.
- **Priorité** : P2
- **Statut** : OUVERT

### RBAC-06

- **Sévérité** : MEDIUM
- **Composant** : Journalisation des refus d'autorisation
- **Description** : `PermissionsGuard` et `SuperAdminGuard` lèvent une `ForbiddenException` sans
  écrire dans le journal d'audit. Symétriquement, une tentative d'accès à une ressource d'un autre
  tenant se solde par un `NotFoundException` (comportement voulu, « 404 pas 403 ») qui n'est lui
  non plus **jamais journalisé**. L'enum `AuditAction` ne contient d'ailleurs aucune valeur du type
  `PERMISSION_DENIED` ou `CROSS_TENANT_ATTEMPT`.
- **Impact** : les deux signaux de détection les plus importants d'un SaaS multi-tenant — rafale
  de 403 et tentative d'accès inter-tenant — sont invisibles. Une tentative d'accès inter-tenant
  doit être traitée comme un incident, jamais comme du bruit ; ici elle ne laisse aucune trace.
- **Risque** : impossibilité de détecter une reconnaissance ou une attaque en cours ; absence de
  matière pour une investigation post-incident.
- **Fichier(s)** :
  - `apps/api/src/common/guards/permissions.guard.ts:32-51`
  - `apps/api/src/auth/guards/super-admin.guard.ts:13-15`
  - `apps/api/src/customers/customers.repository.ts:52-60` (et les repositories homologues)
  - `apps/api/prisma/schema.prisma:93-140` (enum `AuditAction`)
- **Solution** : ajouter les actions `PERMISSION_DENIED` et `CROSS_TENANT_ATTEMPT` à `AuditAction`,
  les émettre depuis les gardes et depuis le point unique de résolution 404 des repositories, et
  configurer une alerte temps réel sur `CROSS_TENANT_ATTEMPT` et sur les rafales de
  `PERMISSION_DENIED`.
- **Priorité** : P2
- **Statut** : OUVERT

### RBAC-07

- **Sévérité** : MEDIUM
- **Composant** : Absence de séparation des tâches sur les flux financiers
- **Description** : les permissions sont découpées par module et par verbe CRUD
  (`accounting.create`, `invoicing.update`, `sales.update`…), jamais par acte métier. Aucune
  distinction entre saisir et valider : `accounting.create` autorise la création d'une écriture
  comptable sans qu'aucune validation par un tiers ne soit requise ; `invoicing.update` couvre
  `POST /invoices/:id/mark-paid` ; `purchases.update` couvre la confirmation d'un achat. Le rôle
  `ADMIN` cumule les 37 permissions. Aucun seuil de montant ne déclenche de double validation.
- **Impact** : un seul compte `COMPTABLE` peut créer et « valider » une écriture au journal ; un
  seul compte peut marquer une facture comme payée. Sur un progiciel SYSCOHADA destiné à produire
  des états financiers opposables, c'est un défaut de conception du contrôle interne.
- **Risque** : fraude interne non détectable par le seul journal d'audit ; contestation de la
  fiabilité des états produits.
- **Fichier(s)** :
  - `packages/permissions/src/permission-keys.ts:33-46`
  - `packages/permissions/src/default-roles.ts` (`ADMIN: ALL_PERMISSIONS`, `COMPTABLE`)
  - `apps/api/src/accounting/journal.controller.ts:49-50`
  - `apps/api/src/invoicing/invoicing.controller.ts:62-63`
- **Solution** : introduire des permissions d'acte distinctes (`accounting.validate`,
  `payment.validate`, `invoice.issue`) et un seuil de montant en FCFA au-delà duquel une seconde
  validation par un utilisateur différent est requise. Décision à cadrer avec `architect`.
- **Priorité** : P2
- **Statut** : OUVERT

### RBAC-08

- **Sévérité** : LOW
- **Composant** : Exports et rapports non journalisés
- **Description** : `ReportsController` expose `GET /v1/reports/sales`, `/purchases` et
  `/income-statement` sous `reports.read`. Aucun de ces appels n'écrit dans le journal d'audit —
  la recherche `auditLog` dans `apps/api/src/reports` ne renvoie aucune occurrence. L'action
  `EXPORT_DATA` existe dans l'enum mais n'est jamais émise.
- **Impact** : l'extraction du chiffre d'affaires, du détail des achats et du compte de résultat
  d'une entreprise ne laisse aucune trace. `CLAUDE.md` §6 range pourtant explicitement « export de
  données » parmi les événements à journaliser.
- **Risque** : exfiltration de données financières indétectable ; impossibilité d'alerter sur un
  volume d'export anormal.
- **Fichier(s)** :
  - `apps/api/src/reports/reports.controller.ts:17-46`
  - `apps/api/prisma/schema.prisma:93-140` (`EXPORT_DATA` inutilisée)
- **Solution** : journaliser un `EXPORT_DATA` sur chaque appel de rapport, avec la période
  demandée et le volume de lignes retourné, et poser une alerte sur les volumes anormaux.
- **Priorité** : P3
- **Statut** : OUVERT

### RBAC-09

- **Sévérité** : LOW
- **Composant** : Matrice rôles × permissions non versionnée hors du code
- **Description** : la matrice n'existe que sous forme de code
  (`packages/permissions/src/default-roles.ts`). Aucun `docs/security/rbac.md` n'est présent dans
  le dépôt. Aucune procédure de revue n'est définie.
- **Impact** : toute évolution des droits passe inaperçue dans une revue de code centrée sur le
  fonctionnel ; aucune vue lisible par un responsable métier ou un auditeur.
- **Risque** : dérive progressive des privilèges sans traçabilité de décision.
- **Fichier(s)** : `packages/permissions/src/default-roles.ts`, absence de `docs/security/rbac.md`
- **Solution** : générer `docs/security/rbac.md` depuis `default-roles.ts` (table rôles ×
  permissions), le versionner, et exiger sa mise à jour dans toute PR touchant les permissions.
- **Priorité** : P3
- **Statut** : OUVERT

### RBAC-10

- **Sévérité** : LOW
- **Composant** : MFA absente pour les rôles tenant sensibles
- **Description** : la MFA n'est exigée que pour `SUPER_ADMIN`
  (`auth.service.ts:111-128`), et aucune route d'enrôlement TOTP n'existe : `mfaSecret` n'est posé
  que par `scripts/create-super-admin.ts`. Un `ADMIN`, un `COMPTABLE` ou un porteur de
  `billing.manage` ne peut pas activer de second facteur, même volontairement. L'action d'audit
  `MFA_ENABLED` n'est jamais émise.
- **Impact** : les rôles habilités à inviter des utilisateurs, à paramétrer l'entreprise et à
  saisir des écritures comptables sont protégés par un seul facteur.
- **Risque** : prise de contrôle d'un compte à privilèges au sein d'un tenant par vol de mot de
  passe.
- **Fichier(s)** :
  - `apps/api/src/auth/auth.service.ts:111-128`
  - `apps/api/src/auth/mfa.service.ts` (aucun point d'entrée HTTP)
  - `apps/api/src/auth/auth.controller.ts:30-98` (aucune route `mfa/setup` ni `mfa/enable`)
- **Solution** : exposer un parcours d'enrôlement TOTP authentifié, journaliser `MFA_ENABLED`, et
  rendre la MFA obligatoire pour les rôles portant `users.manage`, `settings.manage`,
  `billing.manage` ou une permission `accounting.*`.
- **Priorité** : P3
- **Statut** : OUVERT

### RBAC-11

- **Sévérité** : INFO
- **Composant** : Points conformes — à préserver
- **Description** : plusieurs choix méritent d'être relevés comme références.
  (1) `PermissionsGuard` **re-résout la permission en base à chaque requête**, à travers la
  connexion RLS, et ne fait jamais confiance à un rôle ou à une permission portée par le JWT —
  conforme à `CLAUDE.md` §6 (`permissions.guard.ts:36-46`).
  (2) `SuperAdminGuard` relit `isSuperAdmin` depuis le JWT signé côté serveur, et le garde refuse
  tout utilisateur porteur d'un `enterpriseId` sur les routes RBAC tenant.
  (3) L'escalade vers `SUPER_ADMIN` est bloquée par **trois** couches indépendantes : aucun schéma
  Zod n'accepte `isSuperAdmin` (mode `strip`), aucune route HTTP ne crée de Super Admin (seul
  `scripts/create-super-admin.ts`, avec MFA activée d'office), et la contrainte SQL
  `users_super_admin_has_no_enterprise_chk` interdit l'état incohérent en base. Un test
  d'intégration dédié le vérifie.
  (4) Le catalogue de permissions est typé (`PermissionKey`), ce qui empêche de référencer une
  clé inexistante à la compilation.
  (5) `InvitationsService.invite()` vérifie explicitement que le `roleId` fourni appartient bien
  au tenant de l'invitant, en défense en profondeur de la RLS.
- **Impact** : aucun. Constats positifs.
- **Risque** : néant.
- **Fichier(s)** :
  - `apps/api/src/common/guards/permissions.guard.ts:36-52`
  - `apps/api/src/auth/guards/super-admin.guard.ts:10-18`
  - `apps/api/src/scripts/create-super-admin.ts:35-64`
  - `apps/api/prisma/migrations/20260809023348_init_saas_domain/migration.sql:430-439`
  - `apps/api/src/auth/super-admin-privilege-escalation.integration.spec.ts`
  - `apps/api/src/users/invitations.service.ts:48-55`
- **Solution** : maintenir ; verrouiller par les tests d'ouverture par défaut décrits en RBAC-01
  et RBAC-02.
- **Priorité** : —
- **Statut** : OUVERT (suivi documentaire)

---

## 4. Conclusion

Le mécanisme d'autorisation est bien conçu sur le fond : point de décision unique, permission
re-résolue en base à chaque requête via la connexion RLS, catalogue typé, escalade vers
`SUPER_ADMIN` bloquée par trois couches indépendantes et testée.

Deux faiblesses structurelles subsistent, de même nature : **le défaut est l'ouverture, pas la
fermeture**. `PermissionsGuard` autorise quand aucune permission n'est déclarée (RBAC-01), et
l'authentification n'est appliquée que par opt-in route par route (RBAC-02). Aucune route n'est
aujourd'hui exposée par ces deux mécanismes, mais rien ne le garantit demain.

S'y ajoute un manque fonctionnel qui a des conséquences de sécurité : **l'administration RBAC
n'existe pas** (RBAC-05). Il est impossible de retirer un rôle, de suspendre un compte ou de faire
évoluer les droits par l'API, ce qui rend inapplicables la revue périodique des accès et la
révocation en réponse à incident.
