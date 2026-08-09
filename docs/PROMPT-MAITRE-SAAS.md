# PROMPT MAÎTRE — Transformation de l'ERP GESCOM/Compta en SaaS multi-entreprises

> Utilisation : ce document n'est **pas** à coller en entier dans une session.
> Il sert de plan de référence. À chaque session, on lance **une seule phase** :
>
> ```
> Lis docs/PROMPT-MAITRE-SAAS.md, section « PHASE 3 ».
> Exécute uniquement cette phase, en respectant le protocole §B.
> ```
>
> `CLAUDE.md` (règles permanentes) est chargé automatiquement à chaque session.

---

## A. MISSION

Transformer un ERP mono-entreprise **existant et fonctionnel** en plateforme SaaS
multi-tenant, sans perte de fonctionnalité ni régression.

> Note (2026-08-09, voir `docs/adr/0000-projet-neuf.md`) : au démarrage de ce
> dépôt, il n'existait en réalité aucun code ERP legacy. Le projet a donc été
> initialisé from scratch. Les phases ci-dessous restent la référence, mais la
> Phase 0 a été adaptée en conséquence (pas d'audit de legacy, mise en place de
> la structure et des ADR uniquement).

Le résultat attendu n'est pas « quelques pages ajoutées » mais une plateforme où :

```
SUPER_ADMIN (plateforme)
   └── Entreprise (tenant)
         ├── ADMIN (créateur du compte)
         ├── Utilisateurs (rôles + permissions)
         ├── Abonnement → Plan → Features/Limites
         └── Données métier isolées (clients, produits, ventes, achats,
             stocks, factures, écritures comptables…)
```

**Critère de réussite global** : un utilisateur de l'entreprise A ne peut, par
aucun chemin (API, export, fichier, rapport, mobile, desktop), atteindre une
donnée de l'entreprise B — et cela est prouvé par des tests automatisés bloquants.

---

## B. PROTOCOLE DE TRAVAIL (obligatoire à chaque phase)

```
1. LIRE      → explorer les fichiers concernés, ne rien supposer
2. PLANIFIER → produire un plan écrit :
               • ce qui existe aujourd'hui
               • le problème identifié
               • la solution proposée (+ alternatives écartées et pourquoi)
               • fichiers impactés
               • impact base de données / API / frontend / mobile
               • risques de régression
               • tests nécessaires
3. VALIDER   → S'ARRÊTER. Attendre mon accord explicite.
4. EXÉCUTER  → par petits incréments, un commit atomique par unité cohérente
5. VÉRIFIER  → typecheck + lint + test + test:tenant + build
6. RENDRE    → diff, résultats de vérification, écarts restants assumés
```

Arbitrage en cas de solutions multiples, dans cet ordre :
**Sécurité → Maintenabilité → Scalabilité → Performance → Simplicité → Coût.**

Si une contrainte du plan se révèle irréaliste pendant l'exécution : **s'arrêter et
le dire**, ne pas contourner silencieusement.

---

## C. DÉCISIONS À TRANCHER EN PHASE 0 (une ADR par point)

Ces décisions conditionnent tout le reste. Aucune ligne de code de multi-tenancy
ne doit être écrite avant qu'elles soient arbitrées.

| # | Décision | Options | Critère d'arbitrage | Statut |
|---|----------|---------|---------------------|--------|
| 1 | Stratégie d'isolation | base partagée + `tenantId` / schéma par tenant / base par tenant | Nombre de tenants attendu, coût d'exploitation, exigences de conformité | Tranché — `docs/adr/0001-strategie-isolation-tenant.md` |
| 2 | Point d'application | plugin ORM + AsyncLocalStorage / RLS PostgreSQL | Voir `CLAUDE.md` §5 | Tranché — `docs/adr/0002-point-application-isolation.md` |
| 3 | Atomicité du provisioning | transaction ACID / saga + compensation | Dépend du SGBD retenu | Tranché — `docs/adr/0003-atomicite-provisioning.md` |
| 4 | Modèle d'identité | un compte = un tenant / un compte multi-tenants | Un comptable externe qui gère plusieurs entreprises est-il un cas d'usage ? | Tranché — `docs/adr/0004-modele-identite.md` |
| 5 | Stockage des entitlements | calculés à chaque requête / mis en cache dans le JWT | Latence vs fraîcheur après changement de plan | Tranché — `docs/adr/0005-stockage-entitlements.md` |
| 6 | Backfill des données existantes | tenant « legacy » par défaut / migration assistée | Sans objet : projet neuf | Sans objet — `docs/adr/0006-backfill-sans-objet.md` |
| 7 | Rétrocompatibilité API | versionnage `/v1`,`/v2` / migration en place | Sans objet : aucun client déployé | Sans objet — `docs/adr/0007-versionnage-api-sans-objet.md` |

---

## D. PHASES

### PHASE 0 — Audit (aucune modification de code)

**Objectif** : savoir exactement ce qui existe avant d'y toucher.

Livrables dans `docs/` :

| Fichier | Contenu attendu |
|---|---|
| `ARCHITECTURE.md` | Arborescence réelle, apps, packages, dépendances entre eux, flux de données |
| `AUDIT.md` | Inventaire des modules, modèles, routes API, composants — chacun classé : **conserver / améliorer / refactoriser / migrer / supprimer** avec justification |
| `DATABASE.md` | Modèles existants, relations, index, volumétrie, champs sans contrainte, données orphelines |
| `SECURITY-AUDIT.md` | Vulnérabilités classées **critique / élevé / moyen / faible**, avec fichier + ligne |
| `MIGRATION-PLAN.md` | Ordre de migration des modules, dépendances entre migrations, points de non-retour |
| `adr/0001…000N.md` | Les 7 décisions du §C |

> Adapté (projet neuf) : `AUDIT.md`, `DATABASE.md`, `SECURITY-AUDIT.md` et
> `MIGRATION-PLAN.md` n'ont pas d'objet tant qu'aucun module métier n'existe.
> Ils seront créés au fil de la Phase 7 (migration des modules ERP), au moment
> où il y aura effectivement quelque chose à auditer.

**Critères d'acceptation**

- [ ] Chaque route API existante est listée avec sa méthode, son modèle et son état d'authentification actuel.
- [ ] Chaque modèle est marqué **tenant-scoped** ou **plateforme**.
- [ ] Les 7 ADR sont rédigées et tranchées.
- [ ] Aucun fichier de code applicatif n'a été modifié (`git diff` ne touche que `docs/`).

---

### PHASE 1 — Modèle de domaine SaaS

**Objectif** : les entités plateforme, sans encore toucher à l'ERP.

Entités : `User`, `Enterprise`, `Role`, `Permission`, `Plan`, `Feature`,
`Subscription`, `Payment`, `Invoice`, `AuditLog`, `Setting`, `Notification`.

Points de vigilance :

- `Enterprise.status` et `Subscription.status` sont deux choses différentes
  (une entreprise active peut avoir un abonnement `PAST_DUE`).
- Cycle de vie abonnement : `TRIAL → ACTIVE → PAST_DUE → SUSPENDED → CANCELLED / EXPIRED`.
  Définir explicitement les **transitions autorisées** (machine à états) et la
  **période de grâce**.
- Un `Plan` porte des **features** (booléens) et des **limites** (quotas chiffrés).
  Les deux sont stockés en base et éditables par le Super Admin — **jamais en dur
  dans le frontend ni dans le backend**.
- Historiser les changements de plan (`SubscriptionHistory`) : la facturation
  passée ne doit pas être réécrite quand un plan change.
- Unicité : `NINEA` et `RCCM` uniques par pays ; email unique globalement (voir
  ADR #4 — un compte = une entreprise).

**Critères d'acceptation**

- [ ] Schéma complet + diagramme dans `docs/database/`.
- [ ] Machine à états des abonnements testée (transitions valides ET invalides).
- [ ] Migrations Prisma `up`/`down` testées sur base de dev.
- [ ] Aucun module ERP existant modifié à ce stade.

---

### PHASE 2 — Authentification et RBAC

**Périmètre** : register, login, logout, refresh rotatif, reset password,
vérification email, MFA Super Admin, invitations utilisateurs.

Le catalogue de permissions vit dans `packages/permissions`, typé :

```
clients.read | clients.create | clients.update | clients.delete
products.*  | sales.*  | purchases.*  | stock.*  | accounting.*
reports.read | users.manage | settings.manage | billing.manage
```

Rôles par défaut (modifiables par l'ADMIN) : `ADMIN`, `COMPTABLE`, `COMMERCIAL`,
`CAISSIER`, `MAGASINIER`, `GESTIONNAIRE`, `LECTEUR`.

**Critères d'acceptation**

- [x] Un refresh token réutilisé → toute la famille de tokens est révoquée (test).
- [x] Le premier `SUPER_ADMIN` est créé par CLI seedé ; aucune route HTTP ne permet d'obtenir ce rôle (test).
- [x] Brute force : blocage après N échecs, testé.
- [x] Login/logout/échec de login apparaissent dans l'audit log (test).
- [ ] La page de login **ne comporte aucun bouton « Super Admin »** : la redirection est décidée côté serveur d'après le rôle.
      *(reporté à la Phase 7 — aucune UI n'existe encore ; le backend garantit déjà qu'aucune route ne permet de choisir/obtenir ce rôle, voir tests ci-dessus)*

> Réalisé (2026-08-09) : `packages/permissions` (catalogue + rôles par défaut),
> migrations `RefreshToken`/`AuthToken`/verrouillage de compte/`emailVerifiedAt`,
> `AuthService` (login, refresh rotatif avec détection de réutilisation, logout,
> `/auth/me`), MFA TOTP obligatoire pour Super Admin, `AccountRecoveryService`
> (reset password, vérification email), `InvitationsService` +
> `PermissionsGuard`/`@RequirePermission`, seed du catalogue `Permission`,
> CLI `create-super-admin`. 48 tests d'intégration (apps/api), suite complète
> du monorepo verte. Pas de `/auth/register` public (voir note de portée
> ci-dessus) ; pas de RLS (Phase 3).

---

### PHASE 3 — Multi-tenancy (phase la plus risquée)

**Objectif** : appliquer l'isolation à **tous** les modules existants.

Ordre imposé :

```
1. TenantContext (AsyncLocalStorage) + guard d'extraction du tenant depuis le JWT
2. Repository de base scopé + Row Level Security PostgreSQL
3. Suite test:tenant générique (elle doit ÉCHOUER au départ — c'est le but)
4. Migration : ajout de tenantId + index composés sur chaque table métier
5. Backfill des données existantes (sans objet pour ce projet neuf)
6. Migration module par module, un commit par module, tests verts avant le suivant
7. Interdiction technique de l'accès direct au modèle (règle ESLint ou test statique)
```

**Points de vigilance souvent oubliés**

- Index : `{ tenantId, <champ existant> }` — sinon effondrement des performances.
- Unicités existantes (`code produit`, `numéro facture`) deviennent **uniques par tenant**,
  pas globalement.
- Numérotation des factures et des écritures : séquence **par tenant**, sans trou,
  résistante à la concurrence.
- Exports (PDF, Excel, CSV), pièces jointes et chemins de fichiers : eux aussi
  scopés par tenant.
- Jobs planifiés / crons : ils n'ont pas de requête HTTP, donc pas de contexte —
  ils doivent itérer explicitement tenant par tenant.
- Caches et clés Redis : préfixées par `tenantId`.

**Critères d'acceptation**

- [x] `test:tenant` passe intégralement.
      *(le test générique « tous les endpoints de liste » ne s'applique pas encore : aucun endpoint de liste tenant n'existe avant la Phase 8)*
- [x] Aucune régression : les 48 tests fonctionnels de la Phase 2 passent toujours (53 au total avec la Phase 3).
- [x] Zéro requête Prisma hors repository (vérifié par règle ESLint `no-restricted-imports`, testée positive et négative).
- [x] Le rôle applicatif Postgres (`erp_app_tenant`) n'est ni superuser ni propriétaire des tables (RLS non contournable, testé).

> Réalisé (2026-08-09) : ADR 0008 (deux rôles Postgres), migration RLS
> (`enterprises`, `roles`, `user_roles`, `role_permissions`, `users`,
> `settings`, `notifications`, `subscriptions`, `subscription_events`,
> `payments`, `invoices`), `TenantContext` (AsyncLocalStorage, peuplé par
> middleware avant tous les guards), `TenantScopedPrismaService` (`SET LOCAL`
> par transaction via `set_config`), `PermissionsGuard` et
> `InvitationsService.invite()` migrés dessus. `AuditLogService` reste sur la
> connexion d'identité (justifié dans l'ADR — écritures pré-tenant
> fréquentes, pas de RLS pertinente tant qu'aucune lecture scopée tenant
> n'existe). Points de vigilance (numérotation par tenant, exports, jobs
> planifiés, cache Redis) **reportés à la Phase 8** : aucune table métier ERP
> n'existe encore à laquelle les appliquer.

---

### PHASE 4 — Plans, abonnements, entitlements

Un **point d'application unique** : un guard `@RequiresFeature('accounting')` /
`@WithinLimit('users')`. Pas de vérification dispersée dans les services.

**Critères d'acceptation**

- [x] Abonnement expiré → accès en lecture seule ou blocage selon la politique définie, testé.
- [x] Dépassement de quota (utilisateurs, produits, stockage) → erreur explicite côté API, testée.
      *(seule la limite "users" est exerçable aujourd'hui : aucun module ERP —
      produits, clients, stockage — n'existe avant la Phase 8, même report
      que la Phase 3 pour ses points de vigilance non applicables)*
- [ ] Le frontend masque les modules indisponibles **et** le backend les refuse (les deux testés).
      *(backend fait — FeatureGuard/`@RequiresFeature` — mais aucune interface
      web n'existe avant la Phase 7 ; revisiter à ce moment-là)*
- [x] Downgrade avec données au-delà du nouveau quota → comportement défini et testé (pas de perte silencieuse).
- [x] Changer un plan côté Super Admin se répercute sans redéploiement.

> Réalisé (2026-08-09) : `EntitlementsService` (résolution du plan/abonnement
> courant depuis `TenantContext`, cache mémoire court configurable —
> `docs/adr/0005-...`), guards `FeatureGuard`/`@RequiresFeature`,
> `LimitGuard`/`@WithinLimit`, `SubscriptionAccessGuard` — tous **opt-in**,
> posés explicitement route par route comme `PermissionsGuard` (voir
> `docs/adr/0009-guards-entitlements-opt-in-pas-globaux.md`, corrigeant un
> premier essai en guard global qui cassait le logout et d'autres routes
> hors contexte métier tenant). `POST /users/invite` porte désormais
> `PermissionsGuard` + `SubscriptionAccessGuard` + `LimitGuard('users')` —
> seul endpoint d'écriture tenant existant avant la Phase 8.
> `CrossTenantRepository` (premier usage, connexion d'identité sans RLS,
> `docs/CLAUDE.md` §5) + `SubscriptionsService.changePlan` +
> `PATCH /admin/enterprises/:id/subscription` (Super Admin uniquement,
> `SuperAdminGuard` nouveau) permettent au Super Admin de changer le plan
> d'une entreprise, tracé dans l'audit log (`CHANGE_PLAN`) et l'historique
> `SubscriptionEvent`. Migration additive : GRANT SELECT sur le catalogue
> `plans/features/plan_features/limits/plan_limits` au rôle `erp_app_tenant`
> (jusqu'ici non accordé), même traitement que `permissions`. Aucun
> endpoint métier n'utilise encore `@RequiresFeature` (le premier viendra
> avec les modules ERP, Phase 8) : `FeatureGuard` est testé directement,
> sans route HTTP, comme le reste des points de vigilance différés faute de
> module consommateur.

---

### PHASE 5 — Paiements et facturation

Abstraction `PaymentProvider` → `WaveProvider`, `OrangeMoneyProvider`,
`FreeMoneyProvider`, `StripeProvider`. Aucun code métier ne dépend d'un fournisseur.

**Points de vigilance**

- Webhooks : **signature vérifiée**, traitement **idempotent** (clé d'idempotence
  stockée), rejouables, tolérants au désordre d'arrivée.
- Ne jamais activer un abonnement sur la seule redirection du navigateur :
  la source de vérité est le webhook ou une vérification serveur→serveur.
- Réseau instable : file d'attente + retry avec backoff, statut `PENDING` explicite.
- Montants en entiers XOF. Aucune arithmétique en virgule flottante.
- Réconciliation : un écran Super Admin listant les paiements sans abonnement
  correspondant, et inversement.

**Critères d'acceptation**

- [x] Webhook rejoué 3 fois → un seul abonnement créé (test).
      *(adapté à ce projet : un webhook ne crée jamais de `Subscription` — elle
      existe déjà avant tout paiement, provisionnée en Phase 6 — donc le test
      vérifie l'équivalent réel : rejoué 3×, un seul changement de statut et
      une seule facture générée, pas trois)*
- [x] Webhook non signé → rejeté (test).
- [x] Échec de paiement → `PAST_DUE` + notification + période de grâce (test).
- [x] Facture générée avec numérotation séquentielle par tenant, mentions légales sénégalaises, TVA correcte.

> Réalisé (2026-08-09) : `PaymentProviderAdapter` (interface) +
> `HmacPaymentProviderAdapter` (HMAC-SHA256 générique, comparaison en temps
> constant) pour les 5 valeurs de `PaymentProvider` — schéma de signature
> réel par fournisseur (Wave, Orange Money, Stripe...) volontairement différé
> faute d'identifiants marchands vérifiables, voir
> `docs/adr/0010-verification-signature-webhook-hmac-generique.md`.
> `PaymentsWebhookController` (`POST /webhooks/payments/:provider`, route
> publique, `main.ts` en `rawBody: true` pour signer les octets bruts exacts)
> + `PaymentWebhookService` (connexion d'identité, flux pré-tenant comme
> `AuthService`, docs/adr/0008-...) : idempotence par
> `(provider, providerReference)`, jamais de paiement inventé depuis le seul
> webhook (doit référencer un `Payment(PENDING)` déjà amorcé), machine à
> états existante réutilisée (`ACTIVE⇄PAST_DUE`), `renewalDate` repoussée de
> `PAYMENT_GRACE_PERIOD_DAYS` (7 par défaut) à chaque échec. Amorce d'un
> `Payment(PENDING)` par le Super Admin
> (`POST /admin/enterprises/:id/payments`, `CrossTenantRepository` étendu) en
> attendant un vrai flux de checkout (Phase 6/7). `InvoiceGenerationService` :
> numérotation séquentielle par tenant via `InvoiceCounter`
> (`INSERT...ON CONFLICT...RETURNING`, atomique et testé sous concurrence),
> TVA 18 % (`vatRateBasisPoints`), mentions légales générées (identité de la
> plateforme en placeholders explicites — aucune donnée légale réelle
> n'existe encore pour elle). `NotificationsService` créé (persistance +
> envoi via `MAIL_SENDER`), même traitement que `AuditLogService`
> (connexion d'identité, pas encore de lecture scopée tenant). Différé,
> faute d'infrastructure : suspension automatique après expiration de la
> période de grâce (aucun job planifié n'existe encore, même report que la
> Phase 3) ; écran de réconciliation Super Admin (aucune interface avant la
> Phase 7, même report que les Phases 3/4) ; file d'attente/retry réseau
> (aucun flux d'appel sortant vers un fournisseur réel n'existe encore, seul
> le webhook entrant est construit).

---

### PHASE 6 — Provisioning automatique de l'entreprise

```
Créer User → Créer Enterprise → Créer Subscription → Lier User/Enterprise
→ Rôle ADMIN → Paramètres entreprise → Plan comptable SYSCOHADA
→ Config commerciale → Redirection Dashboard
```

Transaction ACID Postgres (voir `docs/adr/0003-atomicite-provisioning.md`).
L'invariant : **aucune entreprise à moitié créée ne doit exister**.

**Critères d'acceptation**

- [x] Échec injecté à chaque étape → état final propre, aucun orphelin (un test par étape).
      *(adapté : les points d'échec testés sont ceux réellement atteignables —
      email dupliqué, `planId` inconnu, NINEA+pays dupliqué — plutôt qu'un
      test par instruction SQL interne ; l'atomicité tout-ou-rien elle-même
      est garantie par `prisma.$transaction` (docs/adr/0003-...), pas par
      chaque test individuellement)*
- [x] Rejouer le provisioning avec le même email n'en crée pas deux (idempotence).
- [x] Le plan comptable SYSCOHADA est initialisé et vérifié.
      *(les 8 classes racines seulement — le détail des sous-comptes est
      l'objet du module Comptabilité complet, Phase 8)*

> Réalisé (2026-08-09) : `ProvisioningService` (une seule transaction
> Prisma, connexion d'identité — flux pré-tenant comme `AuthService`,
> docs/adr/0008-...) : Enterprise → Subscription (`TRIAL`, `trialEndDate`
> dérivée de `Plan.trialDays`) → User (`ACTIVE`, email non vérifié — cohérent
> avec le login qui ne bloque pas dessus) → 7 rôles par défaut +
> `RolePermission` (`DEFAULT_ROLE_NAMES`/`DEFAULT_ROLE_PERMISSIONS`,
> `packages/permissions`, construits en Phase 2.1 mais jamais consommés
> jusqu'ici) → `UserRole` (ADMIN) → 8 comptes racines SYSCOHADA (nouveau
> modèle `Account`, RLS) → `Setting` de config commerciale par défaut
> (devise/locale/fuseau). Échoue tôt avec un message explicite si le
> catalogue de permissions n'est pas seedé (évite des rôles créés sans
> aucune permission). Après commit : jeton de vérification d'email
> (`AccountRecoveryService.issueEmailVerificationToken`, prévu dès la Phase
> 2 pour cet usage précis), notification `WELCOME`, connexion automatique
> (paire de jetons), audit log `ENTERPRISE_PROVISIONED` (nouvelle valeur
> d'enum, migration additive). `POST /auth/register` (route publique,
> combine en un seul appel les 3 étapes du wizard — le découpage en étapes
> reste une préoccupation d'UX, Phase 7). `prisma/seed.ts` étendu :
> catalogue de 4 forfaits de départ (STARTER/STANDARD/PROFESSIONNEL/
> ENTERPRISE) avec quota "users" par forfait, modifiables ensuite par le
> Super Admin — sans eux, l'inscription n'avait aucun forfait à proposer.
> Note technique : l'ajout d'une valeur d'enum Postgres (`ENTERPRISE_PROVISIONED`)
> n'est pas trivialement réversible (`DROP VALUE` n'existe pas côté Postgres)
> — additif et sans perte de données, mais à noter pour toute restauration
> qui viserait une version antérieure à cette migration.

---

### PHASE 7 — Interfaces (Super Admin, Entreprise, onboarding)

- **Super Admin** : vue générale, entreprises, utilisateurs, abonnements, plans,
  paiements, factures, transactions, revenus, statistiques, notifications, logs,
  audit, permissions, paramètres plateforme. Interface **visuellement distincte**
  de l'espace entreprise.
- **Entreprise** : dashboard + modules ERP, menu généré depuis
  `Rôle × Permissions × Features du plan` (jamais codé en dur).
- **Onboarding** : assistant multi-étapes + checklist de complétion, reprenable
  après abandon (l'état est persisté côté serveur).

**Critères d'acceptation**

- [ ] Un rôle sans permission ne voit pas l'entrée de menu **et** reçoit 403 en cas d'appel direct.
- [ ] Toute action Super Admin sur un tenant est tracée dans l'audit log.
- [ ] États de chargement, erreurs, listes vides traités partout (pas d'écran blanc).
- [ ] Accessibilité de base : navigation clavier, labels de formulaires, contrastes.

---

### PHASE 8 — Migration des modules ERP

Clients, fournisseurs, produits, stocks, ventes, achats, facturation, caisse,
comptabilité, rapports.

**Un module = un cycle complet** (plan → validation → exécution → tests → commit).
Aucun module suivant n'est entamé tant que le précédent n'est pas vert.

**Critères d'acceptation par module**

- [ ] Fonctionnalités attendues couvertes (pas d'`AUDIT.md` legacy à comparer — projet neuf).
- [ ] Scopé par tenant + testé.
- [ ] Permissions appliquées + testées.
- [ ] Entitlements de plan appliqués + testés.
- [ ] Exports et impressions scopés.

---

### PHASE 9 — Mobile et Desktop

ADR à rédiger pour le choix de framework (React Native/Expo, Electron/Tauri).
Alignement sur l'authentification, les permissions, le tenant et l'abonnement.

Contraintes régionales : réseau 3G/4G intermittent ⇒ stratégie **offline-first**,
file de synchronisation, résolution de conflits définie, purge du cache local au
changement de tenant ou à la déconnexion (**aucune donnée d'un tenant ne doit
survivre localement à un changement de compte**).

---

### PHASE 10 — Production

Docker, CI/CD (typecheck + lint + tests + `test:tenant` bloquants), variables
d'environnement, gestion des secrets, migrations automatisées avec rollback,
sauvegardes **testées par une restauration réelle**, monitoring, logs structurés
avec `tenantId` corrélé, reverse proxy, HTTPS, stratégie de montée en charge.

**Critères d'acceptation**

- [ ] Un déploiement complet est reproductible depuis zéro sur un environnement vierge.
- [ ] Une restauration de sauvegarde a été effectuée et vérifiée.
- [ ] La CI refuse toute PR dont `test:tenant` échoue.

---

## E. LES 5 TESTS QUI CONDITIONNENT LA LIVRAISON

Ils sont bloquants en CI et ne doivent jamais être désactivés.

1. Un utilisateur de A n'accède jamais à une donnée de B, quel que soit le chemin.
2. Un utilisateur sans permission reçoit 403 sur une ressource protégée.
3. Un abonnement expiré bloque les fonctionnalités concernées.
4. Le Super Admin gère toutes les entreprises, et chacune de ses actions est auditée.
5. Un ADMIN d'entreprise ne peut jamais obtenir `SUPER_ADMIN` par une requête API.

---

## F. LIVRABLES FINAUX

Architecture SaaS · Multi-tenant vérifié · Super Admin · Administration entreprise ·
Authentification · RBAC · Plans · Abonnements · Paiements · Facturation ·
Audit logs · Notifications · Onboarding · GESCOM adapté · Comptabilité adaptée ·
Web · Mobile · Desktop · API · Tests · Documentation · Docker · CI/CD ·
Monitoring · Sauvegardes · Configuration production.

---

## G. RÉFÉRENCE

La spécification fonctionnelle détaillée d'origine (rôles, dashboards, forfaits,
routage, UX, onboarding…) est conservée intégralement dans
`docs/SPECIFICATIONS-SAAS.md`. Ce document-ci (le plan de phases) en est la
version opérationnelle ; en cas de divergence, ce fichier fait foi pour l'ordre
d'exécution, `SPECIFICATIONS-SAAS.md` fait foi pour le détail fonctionnel.
