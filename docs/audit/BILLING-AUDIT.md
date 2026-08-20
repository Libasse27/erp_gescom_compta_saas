# Audit de sécurité — Facturation, abonnements, paiements et provisioning

> Date : 2026-08-16 — Auditeur : agent `security` (audit en lecture seule, aucun
> code applicatif modifié).
> Périmètre : `apps/api/src/payments/`, `apps/api/src/subscriptions/`,
> `apps/api/src/plans/`, `apps/api/src/onboarding/`, `apps/api/src/provisioning/`,
> `apps/api/src/entitlements/`, `apps/api/prisma/schema.prisma` (modèles Plan,
> Feature, Limit, Subscription, Payment, Invoice, InvoiceCounter, OnboardingState),
> `packages/validation/src/payments.ts`, et les tests associés.
>
> Méthode : lecture du code réel et des tests. Les ADR (`0003`, `0005`, `0010`) et
> les messages de commit ont été traités comme des **déclarations d'intention à
> vérifier**, pas comme des preuves. Les écarts entre ADR et code sont signalés.

---

## 1. Synthèse

| Sévérité | Nombre |
|----------|--------|
| CRITICAL | 0 |
| HIGH     | 5 |
| MEDIUM   | 9 |
| LOW      | 5 |
| INFO     | 3 |
| **Total**| **22** |

Aucune faille d'isolation inter-tenant ni de contournement d'authentification n'a été
trouvée sur ce périmètre : la chaîne JWT → `TenantContext` → RLS est correctement
appliquée sur les lectures tenant (`MySubscriptionService`, `EntitlementsService`,
`OnboardingService`), les routes plateforme sont derrière `SuperAdminGuard`, la
signature HMAC du webhook est vérifiée avant tout traitement et en temps constant,
et tous les montants sont stockés en entiers.

Les faiblesses réelles sont **de nature financière et opérationnelle**, pas de nature
« fuite de données » :

1. l'idempotence du webhook est purement applicative et repose sur un
   *read-then-write* en `READ COMMITTED` — deux livraisons concurrentes du même
   événement produisent **deux factures** (BIL-01/BIL-02) ;
2. **aucun mécanisme n'existe pour faire respecter le non-paiement** : ni expiration
   d'essai, ni passage `PAST_DUE → SUSPENDED`, ni prise en compte de
   `Enterprise.status`, ni tâche planifiée (BIL-03/BIL-04). La machine à états est
   correcte et bien testée, mais elle n'est câblée qu'à un seul endroit ;
3. le montant d'un paiement est accepté depuis la requête au lieu d'être recalculé
   depuis le plan (BIL-05), en contradiction avec CLAUDE.md §6.

---

## 2. Réponses directes aux 7 questions posées

### 2.1 Webhooks (question 1)

- **Signature vérifiée avant traitement** : oui. `PaymentWebhookService.handle()`
  appelle `adapter.verifySignature()` en toute première instruction et lève 401 avant
  tout accès base (`payments-webhook.service.ts:34-40`). HMAC-SHA256 sur `req.rawBody`
  (octets bruts, `main.ts:16` `rawBody: true`), comparaison via
  `crypto.timingSafeEqual` avec contrôle de longueur préalable
  (`hmac-payment-provider.adapter.ts:13-27`). Secret distinct par fournisseur.
  Testé (`payments-webhook.integration.spec.ts:211-231`).
- **Authentifiée** : la route est publique (pas de JWT), ce qui est correct pour un
  webhook ; la signature est l'unique garde, et elle est effective.
- **Idempotence** : partielle. Il existe bien une contrainte DB
  `@@unique([provider, providerReference])` sur `Payment` (`schema.prisma:959-961`),
  mais elle garantit seulement l'unicité du *paiement*, **pas** l'unicité du
  *traitement de l'événement*. Le rejeu séquentiel est bien neutralisé par le test
  applicatif `payment.status !== "PENDING"` (`payments-webhook.service.ts:59-61`) et
  couvert par un test (rejeu ×3). Le rejeu **concurrent** ne l'est pas → BIL-01.
  Il n'existe ni table `processed_events`, ni identifiant d'événement fournisseur,
  ni clé d'idempotence en base.
- **Hors ordre / rejeu ancien** : aucun horodatage n'est signé ni vérifié, donc aucune
  fenêtre anti-rejeu (BIL-06). Un événement `SUCCEEDED` arrivant après un `FAILED`
  déjà traité est **silencieusement ignoré avec un HTTP 200** (BIL-07) : encaissement
  sans activation, sans alerte. Un `FAILED` arrivant sur un abonnement `TRIAL` provoque
  un 409 permanent et laisse le paiement bloqué en `PENDING` (BIL-08).

### 2.2 Provisioning (question 2)

Conforme à l'ADR 0003 **pour la partie base de données** : une seule
`prisma.$transaction` couvre Enterprise → Subscription(TRIAL) →
`currentSubscriptionId` → User → rôles système + rattachement ADMIN → plan comptable
SYSCOHADA → settings (`provisioning.service.ts:44-108`). Un échec en cours de
transaction annule tout ; testé pour `planId` inconnu et NINEA/email dupliqués.

**Écarts constatés** :
- l'ADR affirme « testé par injection de panne à chaque étape » — **aucun test
  d'injection de panne en milieu de transaction n'existe** dans
  `provisioning.integration.spec.ts` (4 tests, aucun mock de panne) ;
- les étapes **post-commit** (jeton de vérification, notification, audit, émission des
  tokens) sont hors transaction et **sans compensation ni reprise** : un échec d'email
  renvoie 500 au client alors que l'entreprise existe déjà, et la seule tentative de
  ré-inscription échoue en 409 (BIL-10) ;
- le paiement n'est **pas** dans le flux d'inscription (essai gratuit d'abord), donc
  « le paiement échoue » ne casse pas le provisioning ; en revanche « le webhook
  n'arrive jamais » n'a aucune conséquence détectable ni relance (BIL-03/BIL-09).

### 2.3 Machine à états (question 3)

Le module `subscription-state-machine.ts` est correct et **réellement testé**
(`subscription-state-machine.spec.ts` : matrice exhaustive 6×6, états terminaux,
auto-transitions rejetées). Ce n'est donc pas de la documentation.

Mais il n'est appelé **qu'à un seul endroit de tout le dépôt** :
`payments-webhook.service.ts:90`. Aucun code ne produit jamais `SUSPENDED`,
`CANCELLED` ou `EXPIRED` (BIL-03), et `SubscriptionsService.changePlan` modifie un
abonnement sans consulter son statut (BIL-13). Aucun test d'intégration ne vérifie le
rejet d'une transition illégale à travers l'API — il n'existe d'ailleurs aucune route
capable d'en tenter une.

### 2.4 Entitlements (question 4)

Conforme. Features et limites sont en base (`plans`, `features`, `plan_features`,
`limits`, `plan_limits`), résolues à chaque requête côté serveur
(`EntitlementsService.resolve`), jamais dans le JWT (ADR 0005 respectée), jamais
codées en dur côté frontend (le front lit `features` depuis `/users/me`).

La chaîne est appliquée par composition de guards sur les 11 contrôleurs métier :
`JwtAuthGuard` (tenant) → `PermissionsGuard` (rôle/permission) → `FeatureGuard` (plan)
→ `SubscriptionAccessGuard` (statut d'abonnement), plus `LimitGuard` sur les quotas.

Réserves : `SubscriptionAccessGuard` est opt-in (pas global) et ne bloque **ni**
`PAST_DUE` **ni** l'absence totale d'abonnement (BIL-03) ; aucune API n'existe pour
que le Super Admin édite le catalogue de plans/features/limites, contrairement à ce
qu'affirme le commentaire de `schema.prisma:831-833` (BIL-12).

### 2.5 Montants (question 5)

Conforme, sans réserve. Aucun `Float` ni `Decimal` dans `schema.prisma`.
`Plan.priceMonthly/priceYearly`, `Payment.amount`, `Invoice.amount/amountExcludingTax/
vatAmount`, `PlanLimit.value` sont des `Int`. La TVA est exprimée en points de base
(`vatRateBasisPoints = 1800`) et la ventilation HT/TVA est faite en arithmétique
entière avec `vatAmount = amount - amountExcludingTax`, ce qui garantit
HT + TVA = TTC exactement (`invoice-generation.service.ts:46-47`). `formatFCFA()`
n'est utilisé que pour l'affichage. Aucun `parseFloat`/`toFixed` sur un montant.

### 2.6 Double comptabilisation (question 6)

**Oui, c'est possible**, en concurrence : voir BIL-01. La protection est applicative
(`if (payment.status !== "PENDING")`) et lue **hors transaction**, puis la mise à jour
est faite sans condition sur le statut. Aucune contrainte DB ne lie une facture à un
paiement ou à un cycle d'abonnement (BIL-02). La double *activation* d'abonnement est
en revanche évitée (le statut est relu dans la transaction), mais la double
*facturation* ne l'est pas.

### 2.7 Secrets (question 7)

Conforme sur les secrets de paiement : aucun secret réel versionné, seulement des
placeholders `change-me` dans `.env.example` et `docker/.env.prod.example`, et des
valeurs de CI factices dans `.github/workflows/ci.yml`. `env.paymentWebhookSecret()`
échoue au démarrage si la variable manque. Aucun `console.log` de payload de webhook,
aucun log de corps de requête (`HttpLoggingMiddleware` ne journalise que méthode,
chemin, statut, durée).

Une exception hors paiement mais dans le flux de provisioning : le jeton de
vérification d'email transite en clair dans le corps de notification, persisté en base
et écrit sur stdout (BIL-11).

---

## 3. Constats

### BIL-01

- **Sévérité** : HIGH
- **Composant** : Paiements — traitement du webhook (idempotence)
- **Description** : le contrôle d'idempotence lit l'état du paiement **avant** et
  **hors** de la transaction (`const payment = await this.prisma.payment.findUnique`
  puis `if (payment.status !== "PENDING")`), puis la transaction met à jour le paiement
  **sans condition sur son statut** (`tx.payment.update({ where: { id: payment.id } })`).
  Il s'agit d'un *read-then-write* classique exécuté au niveau d'isolation par défaut
  `READ COMMITTED`. Deux livraisons concurrentes du même événement (comportement normal
  d'un fournisseur qui rejoue en rafale sur timeout) passent toutes les deux le test,
  entrent toutes les deux dans la transaction, et exécutent toutes les deux
  `invoiceGeneration.generateForPayment()`. Le fichier
  `tenant-scoped-prisma.service.ts:38-45` documente précisément ce piège pour le stock
  et prescrit `Serializable` — la règle n'a pas été appliquée au chemin de paiement, qui
  n'utilise même pas `run()`.
- **Impact** : deux factures `PAID` pour un seul encaissement, compteur
  `invoice_counters` incrémenté deux fois, l'une des deux factures se retrouvant sans
  paiement rattaché (`payments: { connect }` réaffecte `Payment.invoiceId` à la
  dernière). Chiffre d'affaires et TVA déclarée faussés, réconciliation impossible.
- **Risque** : élevé en production (les fournisseurs Mobile Money rejouent
  systématiquement sur 5xx/timeout) ; contexte réseau 3G/4G intermittent identifié par
  CLAUDE.md §7 comme aggravant.
- **Fichier(s)** :
  - `apps/api/src/payments/payments-webhook.service.ts:44-46` (lecture hors transaction)
  - `apps/api/src/payments/payments-webhook.service.ts:59-61` (contrôle applicatif)
  - `apps/api/src/payments/payments-webhook.service.ts:73-80` (update inconditionnel)
  - `apps/api/src/payments/payments-webhook.service.ts:124-132` (génération de facture)
- **Solution** : remplacer le contrôle par un *compare-and-swap* atomique à
  l'intérieur de la transaction :
  `const { count } = await tx.payment.updateMany({ where: { id, status: "PENDING" },
  data: { ... } });` puis `if (count === 0) return { outcome:
  "ignored_already_processed" }`. Seule la transaction gagnante poursuit. Compléter par
  BIL-02 (garde base). Ajouter un test d'intégration lançant N livraisons en
  `Promise.all` et asseyant `invoices.length === 1`.
- **Priorité** : P1 — avant toute mise en service d'un fournisseur réel
- **Statut** : CORRIGÉ (2026-08-17) — la lecture hors transaction reste un
  raccourci pour le cas courant (rejeu déjà traité), mais n'est plus la garantie :
  `tx.payment.updateMany({ where: { id, status: "PENDING" }, data: {...} })`
  à l'intérieur de la transaction ne peut réussir (`count === 1`) que pour une
  seule livraison concurrente ; les autres obtiennent `count === 0` et
  sortent en `ignored_already_processed` sans dupliquer abonnement ni
  facture. Vérifié par un vrai test de concurrence (pas seulement séquentiel) :
  5 livraisons du même événement envoyées simultanément via `Promise.all`
  (`payments-webhook.integration.spec.ts`, "is idempotent under real
  concurrency") — exactement 1 `processed`, 4 `ignored_already_processed`,
  1 facture, 1 `SubscriptionEvent`.

### BIL-02

- **Sévérité** : HIGH
- **Composant** : Facturation — absence de garde d'unicité au niveau base
- **Description** : aucune contrainte de base n'empêche l'existence de deux `Invoice`
  pour le même paiement ou le même cycle d'abonnement. `Invoice` n'a d'unique que
  `number`, et le lien vers le paiement est porté par `Payment.invoiceId` (nullable,
  non unique). L'unique existant `@@unique([provider, providerReference])` sur
  `Payment` protège la création d'un paiement, pas le traitement de l'événement ; de
  plus `providerReference` étant nullable, PostgreSQL considère les NULL comme
  distincts et autorise autant de paiements sans référence qu'on veut. L'invariant
  « un paiement réussi ⇒ au plus une facture » n'est donc garanti que par du code
  applicatif, contrairement à l'esprit structurel de CLAUDE.md §5.
- **Impact** : toute régression applicative future (nouveau chemin d'appel,
  ré-émission manuelle, script d'administration) recrée silencieusement des doublons de
  facturation, sans filet.
- **Risque** : moyen isolément, élevé en combinaison avec BIL-01.
- **Fichier(s)** :
  - `apps/api/prisma/schema.prisma:941-965` (modèle `Payment`, unique nullable)
  - `apps/api/prisma/schema.prisma:967-997` (modèle `Invoice`, aucun unique métier)
  - `apps/api/src/payments/invoice-generation.service.ts:53-68`
- **Solution** : ajouter une colonne `paymentId String? @unique` sur `Invoice` (ou un
  index unique partiel `CREATE UNIQUE INDEX ... ON invoices (subscription_id,
  billing_period_start)`), renseignée dans la même transaction. Rendre
  `Payment.providerReference` non nullable si toute création passe désormais par un
  flux de checkout. Migration non destructive à écrire et à tester en rollback (CLAUDE.md §4).
- **Priorité** : P1
- **Statut** : CORRIGÉ (2026-08-17) — migration additive et non destructive
  `20260817020000_add_invoice_payment_unique_guard` : colonne `Invoice.paymentId`
  (`String? @unique`), renseignée dans la même transaction que la création de
  la facture (`invoice-generation.service.ts`). Une deuxième tentative de
  facturation pour le même paiement lève désormais une violation de
  contrainte unique Postgres au lieu de réaffecter silencieusement
  `Payment.invoiceId` à la dernière facture créée. Vérifié par un test dédié
  (`invoice-generation.service.spec.ts`, "rejects a second invoice for the
  same payment at the database level") : deuxième appel rejeté, une seule
  ligne `Invoice` en base pour ce `paymentId`. `Payment.providerReference`
  reste nullable (non traité ici — hors périmètre de ce correctif, qui vise
  la duplication de facture, pas la création de paiement).

### BIL-03

- **Sévérité** : HIGH
- **Composant** : Abonnements — cycle de vie non appliqué (essai, impayé, suspension)
- **Description** : la machine à états autorise `TRIAL → EXPIRED`,
  `ACTIVE/PAST_DUE → SUSPENDED`, `* → CANCELLED`, mais **aucun code du dépôt ne produit
  jamais ces états**. Recherche exhaustive : `assertSubscriptionTransition` n'est appelé
  que depuis le webhook, et la seule autre écriture sur `subscriptions` est
  `updateSubscriptionPlan` (plan uniquement). Il n'existe **aucune tâche planifiée**
  (aucun `@Cron`, aucun `ScheduleModule`, aucun worker). `trialEndDate` et la
  `renewalDate` positionnée comme échéance de grâce
  (`payments-webhook.service.ts:96-99`) sont écrites mais **jamais relues** par une
  décision d'accès. Enfin `SubscriptionAccessGuard` ne bloque ni `PAST_DUE` ni
  l'absence d'abonnement (`subscription-access.guard.ts:13-17, 35-37`), et laisse
  passer tous les `GET`.
- **Impact** : un essai gratuit ne se termine jamais ; un impayé ne restreint jamais
  rien ; la période de grâce est décorative. Un tenant peut utiliser la totalité de
  l'ERP indéfiniment sans payer. Économiquement, c'est le défaut le plus coûteux de ce
  périmètre.
- **Risque** : certain à l'ouverture commerciale.
- **Fichier(s)** :
  - `apps/api/src/subscriptions/subscription-state-machine.ts:7-14`
  - `apps/api/src/payments/payments-webhook.service.ts:90` (unique point d'appel)
  - `apps/api/src/entitlements/guards/subscription-access.guard.ts:13-17, 28-37`
  - absence : aucun `@Cron`/`ScheduleModule` dans `apps/api/src`
- **Solution** : introduire un service de cycle de vie (`SubscriptionLifecycleService`)
  exécuté par une tâche planifiée idempotente : `TRIAL` échu → `EXPIRED` ; `PAST_DUE`
  au-delà de la période de grâce → `SUSPENDED`. Passer **toutes** ces transitions par
  `assertSubscriptionTransition` + `SubscriptionEvent` + `AuditLog`. Décider
  explicitement (produit) du traitement de `PAST_DUE` dans `BLOCKING_STATUSES`.
  Tests d'intégration : essai échu ⇒ écriture refusée ; impayé après grâce ⇒ suspendu.
- **Priorité** : P1
- **Statut** : CORRIGÉ (2026-08-17) — `SubscriptionLifecycleService`
  (`apps/api/src/subscriptions/subscription-lifecycle.service.ts`), exécuté
  toutes les heures via `@Cron` (`@nestjs/schedule`) : `TRIAL` dont
  `trialEndDate` est dépassée → `EXPIRED` ; `PAST_DUE` dont `renewalDate`
  (échéance de grâce, déjà repoussée par `PaymentWebhookService` à chaque
  échec) est dépassée → `SUSPENDED`. Chaque transition passe par
  `assertSubscriptionTransition` + `SubscriptionEvent` + `AuditLog`
  (nouvelles actions `EXPIRE_TRIAL`/`SUSPEND_SUBSCRIPTION`, migration
  additive `20260817221428_add_subscription_lifecycle_audit_actions`).
  Idempotent par construction (chaque transition sort l'abonnement du
  filtre de la requête suivante), et une transition en échec sur un
  abonnement n'interrompt jamais le traitement des autres. Décision produit
  prise pour ce lot : `PAST_DUE` reste hors de `BLOCKING_STATUSES` (accès
  complet pendant la grâce, comportement Phase 4 inchangé) — seul le passage
  effectif à `SUSPENDED` après grâce déclenche le blocage déjà en place
  (`SubscriptionAccessGuard`). Tests
  (`subscription-lifecycle.integration.spec.ts`) : essai échu → `EXPIRED`
  (+ événement + audit log), essai non échu et essai sans `trialEndDate`
  jamais touchés, idempotence (deux exécutions consécutives ne créent
  jamais un second `SubscriptionEvent`), impayé après grâce → `SUSPENDED`
  (+ événement + audit log), grâce encore valide jamais touchée, un
  abonnement `ACTIVE` jamais affecté, et bout-en-bout : une requête mutante
  d'un tenant dont l'essai vient d'expirer est bien refusée en 403 par
  `SubscriptionAccessGuard`.

### BIL-04

- **Sévérité** : HIGH
- **Composant** : Authentification / suspension — `Enterprise.status` et `User.status`
  jamais appliqués
- **Description** : `JwtAuthGuard` se limite à vérifier la signature du JWT et à
  recopier `sub`/`enterpriseId`/`isSuperAdmin` dans `request.user`. Aucune requête base
  n'est faite, donc ni `User.status` ni `Enterprise.status` (`ACTIVE | SUSPENDED |
  ARCHIVED`) ne sont revalidés. Recherche exhaustive : `Enterprise.status` n'apparaît
  qu'en **lecture d'affichage** dans `SuperAdminService`, jamais dans une décision
  d'accès et **jamais en écriture** — il n'existe aucune route de suspension.
- **Impact** : suspendre une entreprise pour impayé ou fraude serait sans effet, même
  après implémentation de la table : les jetons en cours restent pleinement valides et
  rien ne les invalide. Combiné à BIL-03, il n'existe aujourd'hui **aucun levier
  technique** pour couper l'accès d'un client non payeur.
- **Risque** : élevé (perte de revenu, impossibilité de réagir à un abus).
- **Fichier(s)** :
  - `apps/api/src/auth/guards/jwt-auth.guard.ts:14-28`
  - `apps/api/src/super-admin/super-admin.service.ts:57` (seul usage, lecture)
  - `apps/api/prisma/schema.prisma:26-30` (`EnterpriseStatus`)
- **Solution** : revalider `User.status === ACTIVE` et `Enterprise.status === ACTIVE`
  côté serveur à chaque requête (avec cache court, comme les entitlements), et refuser
  en `401`/`403` sinon ; révoquer la famille de refresh tokens à la suspension. Exposer
  une route Super Admin de suspension/réactivation, journalisée en audit. Tests :
  « entreprise suspendue ⇒ 403 avec un access token encore valide ».
- **Priorité** : P1
- **Statut** : CORRIGÉ (2026-08-16) — `JwtAuthGuard` revalide désormais
  `User.status`/`Enterprise.status` à chaque requête authentifiée (via
  `PrismaService`, connexion d'identité — fonctionne aussi pour le Super
  Admin, hors `TenantContext`), avec un court cache mémoire par processus
  (`ACCOUNT_STATUS_CACHE_TTL_MS`, même patron qu'`EntitlementsService`).
  Écart assumé par rapport à la solution suggérée : rejet en **401**, pas
  403 — cohérent avec le message générique déjà utilisé par SEC-03
  (`auth.service.ts`) et avec le traitement existant d'un jeton
  invalide/expiré dans ce même guard ; c'est un échec d'authentification
  (le jeton n'est plus honoré), pas un refus d'autorisation. Nouvelles
  routes `POST /admin/enterprises/:id/suspend` et `.../reactivate`
  (`SuperAdminController`), qui révoquent immédiatement tous les refresh
  tokens de l'entreprise (`CrossTenantRepository.revokeAllRefreshTokensForEnterprise`)
  et journalisent `SUSPEND_ACCOUNT`/`REACTIVATE_ACCOUNT` (déjà présents
  dans `AuditAction` mais jamais câblés). Tests de non-régression : accès
  refusé sur un access token encore valide après suspension de
  l'entreprise et après suspension de l'utilisateur (`auth.integration.spec.ts`),
  cycle suspend/reactivate complet avec vérification de l'audit log et du
  403 pour un non-Super-Admin (`super-admin.integration.spec.ts`).

### BIL-05

- **Sévérité** : HIGH
- **Composant** : Paiements — montant non recalculé côté serveur
- **Description** : `amount` et `currency` sont acceptés depuis le corps de la requête
  d'amorçage (`createPendingPaymentSchema`) et écrits tels quels dans `Payment`. Ils ne
  sont **jamais** confrontés à `plan.priceMonthly`/`priceYearly` de l'abonnement visé.
  Le webhook, lui, ne fait que vérifier la cohérence entre l'événement et le paiement
  déjà enregistré (`payments-webhook.service.ts:63-65`) : il valide donc un montant
  potentiellement arbitraire. CLAUDE.md §6 exige que rien de ce qui vient du client ne
  soit accepté sans re-résolution serveur ; le montant d'une transaction financière est
  précisément ce qu'il ne faut jamais déléguer.
- **Impact** : un abonnement peut être activé pour 1 FCFA, et la facture émise porte ce
  montant erroné (base de la TVA déclarée). Aujourd'hui le risque est borné par le
  `SuperAdminGuard` sur la route d'amorçage, mais le futur flux de checkout
  (Phases 6/7, explicitement annoncé comme le remplaçant) héritera de ce contrat s'il
  n'est pas corrigé maintenant.
- **Risque** : moyen aujourd'hui (Super Admin seulement), élevé dès l'ouverture du
  checkout client.
- **Fichier(s)** :
  - `packages/validation/src/payments.ts:5-11`
  - `apps/api/src/payments/payments-bootstrap.service.ts:28-35`
  - `apps/api/src/payments/payments-webhook.service.ts:63-65`
- **Solution** : dériver le montant côté serveur depuis le plan et la périodicité
  (`amount = plan.priceMonthly` ou `priceYearly`), n'accepter du client que la
  périodicité ; forcer `currency = "XOF"` depuis `Enterprise.currency`. Rejeter en 409
  toute divergence. Test : « un amount forgé dans le body est ignoré au profit du prix
  du plan ».
- **Priorité** : P1
- **Statut** : CORRIGÉ (2026-08-18) — `createPendingPaymentSchema` n'accepte
  plus `amount`/`currency` : seule `billingPeriod` ("MONTHLY" | "YEARLY") est
  reçue du client. `PaymentsBootstrapService.createPendingPayment` dérive
  désormais `amount` de `plan.priceMonthly`/`priceYearly` de l'abonnement en
  cours (`CrossTenantRepository.findEnterpriseWithCurrentSubscription` inclut
  maintenant le `plan`), et force `currency = Enterprise.currency`. Une
  périodicité `YEARLY` sur un plan sans `priceYearly` est rejetée en 409.
  Vérifié par 4 tests dédiés
  (`payments-bootstrap.integration.spec.ts`) : un `amount`/`currency` forgé
  dans le corps est ignoré au profit du prix du plan, `YEARLY` dérive bien
  `priceYearly`, `YEARLY` sans `priceYearly` renvoie 409, une requête sans
  `billingPeriod` est rejetée en 400. Les tests existants du parcours
  bootstrap→webhook (`payments-webhook.integration.spec.ts`) mis à jour pour
  le nouveau contrat de requête et toujours verts.

### BIL-06

- **Sévérité** : MEDIUM
- **Composant** : Webhooks — absence de fenêtre anti-rejeu
- **Description** : la signature HMAC ne porte que sur le corps de la requête. Aucun
  horodatage n'est inclus dans la chaîne signée, aucun en-tête de date n'est exigé ni
  vérifié, aucune tolérance temporelle n'est appliquée — alors que l'ADR 0010 cite
  précisément ce mécanisme chez Stripe (`timestamp.payload` + tolérance bornée) comme
  état de l'art. Un corps signé capté reste indéfiniment rejouable tel quel.
- **Impact** : l'impact est aujourd'hui borné par l'unicité de `providerReference` et
  par le contrôle de statut (un rejeu retombe sur `ignored_already_processed`), mais la
  protection est un effet de bord métier, pas un contrôle de sécurité. Toute évolution
  du schéma d'événement (ex. références réutilisables, événements de remboursement)
  rouvre la fenêtre.
- **Risque** : faible aujourd'hui, moyen à l'intégration d'un fournisseur réel.
- **Fichier(s)** :
  - `apps/api/src/payments/providers/hmac-payment-provider.adapter.ts:13-27`
  - `apps/api/src/payments/payments-webhook.controller.ts:20` (seul en-tête lu)
  - `docs/adr/0010-verification-signature-webhook-hmac-generique.md`
- **Solution** : exiger un en-tête `x-webhook-timestamp`, l'inclure dans la chaîne
  signée (`${timestamp}.${rawBody}`) et rejeter au-delà d'une tolérance de 5 minutes ;
  conserver l'identifiant d'événement pour une table anti-rejeu (voir BIL-09).
  Documenter cette exigence dans l'ADR 0010 comme prérequis d'intégration réelle.
- **Priorité** : P2
- **Statut** : CORRIGÉ (2026-08-18) — `HmacPaymentProviderAdapter.verifySignature`
  exige désormais un en-tête `x-webhook-timestamp` (epoch secondes), inclus
  dans la chaîne signée (`${timestamp}.${rawBody}`, plus jamais le corps
  seul) et comparé à l'heure serveur avec une tolérance configurable
  (`PAYMENT_WEBHOOK_REPLAY_TOLERANCE_SECONDS`, 300 s par défaut). Un
  timestamp absent, non numérique, ou hors tolérance (passé ou futur) est
  rejeté au même titre qu'une signature invalide (401), sans distinguer la
  raison précise dans la réponse. `PaymentProviderAdapter.verifySignature`
  (contrat, `docs/adr/0010-...` mis à jour) prend un troisième paramètre —
  changement sans impact aujourd'hui, un seul adaptateur existant, aucun
  fournisseur réel branché. Vérifié par 8 nouveaux tests unitaires
  (`hmac-payment-provider.adapter.spec.ts` : absence de timestamp,
  timestamp non numérique, trop ancien, trop dans le futur, à la limite de
  la tolérance, ancien format de signature sans timestamp rejeté) et 2
  tests d'intégration bout-en-bout
  (`payments-webhook.integration.spec.ts` : webhook sans timestamp et
  webhook avec un timestamp d'il y a 1h, tous deux rejetés en 401 sans
  changement d'état). **Reste ouvert, non traité ici** : ceci borne la
  fenêtre de rejeu à quelques minutes mais ne l'élimine pas — un rejeu
  **dans** la fenêtre de tolérance reste accepté comme un événement légitime
  ; l'élimination complète nécessite la table d'événements déjà vus de
  BIL-09.

### BIL-07

- **Sévérité** : MEDIUM
- **Composant** : Paiements — événement de succès avalé sur état terminal
- **Description** : tout webhook portant sur un paiement dont le statut n'est plus
  `PENDING` retourne `200 { outcome: "ignored_already_processed" }`, y compris un
  `SUCCEEDED` arrivant après qu'un `FAILED` a été enregistré pour la même référence
  (retard réseau, inversion d'ordre de livraison, retentative du payeur sur la même
  référence). Le succès est alors définitivement perdu : ni activation, ni facture, ni
  notification, ni entrée d'audit, ni alerte.
- **Impact** : un client peut être débité sans que son abonnement soit activé, et
  l'exploitant n'a **aucun signal** pour le détecter — la réconciliation manuelle est
  la seule issue.
- **Risque** : moyen (dépend du comportement réel du fournisseur, inconnu à ce stade).
- **Fichier(s)** : `apps/api/src/payments/payments-webhook.service.ts:57-61`
- **Solution** : distinguer « même événement rejoué » (no-op légitime) de « événement
  différent sur un paiement déjà résolu » (anomalie) : si `event.status !==
  payment.status`, journaliser en audit avec `severity` élevée, créer une entrée de
  réconciliation et alerter, tout en répondant 200 au fournisseur. Ne jamais retourner
  un succès silencieux sur une divergence d'état financier.
- **Priorité** : P2
- **Statut** : CORRIGÉ (2026-08-18) — le bloc `payment.status !== "PENDING"`
  distingue désormais un rejeu légitime (`event.status === payment.status` :
  comportement inchangé, `ignored_already_processed`) d'une divergence
  (`event.status !== payment.status` sur un statut déjà terminal) :
  `Payment.metadata` (JSON, aucune migration) enrichi du détail de
  l'événement en conflit, entrée `AuditLog` (`action: "PAYMENT"`,
  `metadata: { anomaly: true, severity: "high", ... }`) et log `error`
  structuré (`new Logger(PaymentWebhookService.name)`, capté par
  `StructuredLoggerService`, même patron que
  `SubscriptionLifecycleService`). Réponse `200` conservée dans tous les
  cas (pas de retentatives en boucle côté fournisseur), nouvel `outcome:
  "status_conflict"` distinct de `"ignored_already_processed"`. Choix
  produit assumé : **aucune activation/facturation automatique** n'est
  déclenchée sur cette divergence tardive (date d'effet et période déjà
  écoulée ambiguës) — c'est un signal de détection pour réconciliation
  manuelle, pas une résolution automatique. Vérifié par 3 tests dédiés
  (`payments-webhook.integration.spec.ts`) : `SUCCEEDED` après `FAILED`
  déjà enregistré (abonnement reste `PAST_DUE`, aucune facture créée),
  cas symétrique `FAILED` après `SUCCEEDED` (abonnement reste `ACTIVE`,
  aucune facture dupliquée), et non-régression explicite sur le rejeu
  légitime (même statut) : aucune entrée d'anomalie créée. Les tests
  BIL-01 (idempotence séquentielle et concurrente) restent verts sans
  modification — la branche modifiée n'est jamais exercée par le
  scénario de concurrence (la course se joue dans la transaction, pas
  dans ce bloc).

### BIL-08

- **Sévérité** : MEDIUM
- **Composant** : Paiements — échec de paiement sur abonnement en essai
- **Description** : sur `status = failed`, le service vise systématiquement `PAST_DUE`.
  Or la machine à états n'autorise `TRIAL` que vers `ACTIVE`, `EXPIRED` ou `CANCELLED` :
  `TRIAL → PAST_DUE` lève `InvalidSubscriptionTransitionError`, converti en 409. La
  transaction est annulée, le paiement reste `PENDING` **indéfiniment**, et le
  fournisseur voit une erreur qu'il retentera en boucle jusqu'à abandon. Le cas est
  atteignable dès aujourd'hui (le test d'échec n'existe que pour un abonnement `ACTIVE`,
  `payments-webhook.integration.spec.ts:255`), et c'est même le cas nominal : un
  abonnement naît en `TRIAL` (`provisioning.service.ts:65`) et le premier paiement peut
  échouer.
- **Impact** : paiement bloqué en `PENDING` (donc éligible à une activation ultérieure
  par un rejeu, cf. BIL-19), retentatives infinies côté fournisseur, aucune notification
  d'échec envoyée au client.
- **Risque** : élevé en fréquence, faible en gravité unitaire.
- **Fichier(s)** :
  - `apps/api/src/payments/payments-webhook.service.ts:85-90, 136-141`
  - `apps/api/src/subscriptions/subscription-state-machine.ts:8`
- **Solution** : trancher explicitement le comportement produit — soit marquer le
  paiement `FAILED` et laisser l'abonnement en `TRIAL` (échec sans conséquence pendant
  l'essai), soit autoriser `TRIAL → PAST_DUE` dans la machine à états. Dans les deux
  cas, **le paiement doit être marqué `FAILED` et la notification envoyée** ; répondre
  200 au fournisseur. Ajouter le test « échec de paiement sur abonnement TRIAL ».
- **Priorité** : P2
- **Statut** : CORRIGÉ (2026-08-18) — décision produit tranchée : **option (a)**,
  un échec de paiement pendant l'essai n'a aucune conséquence sur le statut
  (l'entreprise n'a jamais été facturée, elle reste `TRIAL` jusqu'à
  `trialEndDate`). Dans `PaymentWebhookService.handle`, `targetStatus` devient
  `SubscriptionStatus | null` : `null` quand `event.status === "FAILED"` et
  `subscription.status === "TRIAL"` — aucune transition tentée, aucun
  `SubscriptionEvent` créé, `assertSubscriptionTransition` jamais appelée pour
  ce cas (donc plus de 409, plus de paiement bloqué en `PENDING`). Le
  compare-and-swap (`tx.payment.updateMany`, BIL-01) committe désormais
  normalement : `payment.status` passe à `FAILED` comme pour tout autre échec.
  `notifyEnterprise` distingue le message selon `subscription.status` (essai en
  cours vs abonnement payant en attente de paiement) — le texte ne prétend plus
  à tort que l'abonnement est « en attente de paiement » alors qu'il reste
  `TRIAL`. **Aucune migration** : `ALLOWED_TRANSITIONS.TRIAL` n'a pas été
  modifiée (l'option (b), qui l'aurait nécessité, n'a pas été retenue) ; aucun
  changement de schéma. Vérifié par 2 tests dédiés
  (`payments-webhook.integration.spec.ts`) : échec pendant l'essai → 200,
  paiement `FAILED`, abonnement `TRIAL` inchangé, aucun `SubscriptionEvent`,
  notification envoyée, aucune facture ; et l'interaction avec BIL-07 — un
  `SUCCEEDED` tardif arrivant après cet échec correctement enregistré est bien
  traité comme un conflit (`status_conflict`), pas un traitement normal. Le
  test existant sur `ACTIVE` reste vert sans modification.

### BIL-09

- **Sévérité** : MEDIUM
- **Composant** : Webhooks — aucune trace des événements rejetés
- **Description** : les rejets (401 signature invalide, 404 référence inconnue, 400
  montant divergent, 409 conflit) sont levés en exception sans **aucune** écriture
  d'audit ni journal dédié. Seule la ligne HTTP générique
  (`HttpLoggingMiddleware`, méthode/chemin/statut) subsiste. Il n'existe ni table
  d'événements reçus, ni file de rejeu (« dead-letter »), ni compteur.
  CLAUDE.md §6 impose l'audit des paiements ; seul le chemin nominal est audité
  (`payments-webhook.service.ts:143-149`).
- **Impact** : impossible de détecter une campagne de forge de signature, une erreur de
  configuration de secret (tous les webhooks légitimes rejetés en 401 passeraient
  inaperçus), ou une rafale de références inconnues. Impossible de rejouer un événement
  perdu : le corps reçu n'est nulle part.
- **Risque** : moyen — c'est un angle mort de détection sur le flux le plus sensible.
- **Fichier(s)** : `apps/api/src/payments/payments-webhook.service.ts:34-69, 143-149`
- **Solution** : persister chaque réception dans une table `webhook_events`
  (fournisseur, identifiant d'événement, empreinte du corps, statut de traitement,
  horodatage) **avant** traitement, avec un unique sur (provider, eventId) qui servira
  aussi d'anti-rejeu (BIL-06) et d'idempotence structurelle (BIL-01). Journaliser en
  audit tout rejet, et alerter sur seuil d'échecs de signature.
- **Priorité** : P2
- **Statut** : CORRIGÉ (2026-08-18) — **écart assumé par rapport à la solution
  proposée ci-dessus** : pas de table `webhook_events` dédiée. Au moment de ce
  correctif, les deux finalités que cette table devait servir sont déjà closes
  par des mécanismes différents et déjà testés : l'idempotence structurelle par
  BIL-01 (compare-and-swap transactionnel sur `Payment.status`) et l'anti-rejeu
  par BIL-06 (fenêtre de fraîcheur du timestamp signé). Construire la table
  aurait donc dupliqué, en plus lourd, des garanties déjà en place — ce n'est
  plus ce que BIL-09 doit apporter. Le seul objectif réellement restant —
  rendre chaque rejet détectable — est couvert par une nouvelle valeur
  d'`AuditAction` dédiée, `PAYMENT_WEBHOOK_REJECTED` (migration additive
  `20260818205014_add_payment_webhook_rejected_audit_action`, même patron que
  BIL-03/BIL-04), plutôt que de réutiliser `PAYMENT` (qui aurait mélangé
  paiements réellement traités et tentatives rejetées, rendant tout filtrage
  futur ambigu).

  `PaymentWebhookService` gagne une méthode privée `auditRejection(...)`,
  appelée juste avant chacun des rejets existants (aucun code HTTP modifié) :
  signature/timestamp invalide (401), corps JSON valide mais de forme
  invalide (400, nouveau `try/catch` autour de `adapter.parseEvent` — une
  **syntaxe** JSON cassée, elle, n'atteint jamais ce code : le body-parser
  Express, activé par `rawBody: true`, la rejette en amont avec sa propre
  erreur 400 avant même le routage Nest ; constaté en écrivant le test dédié,
  corrigé dans ce même correctif), référence de paiement inconnue (404),
  montant/devise divergents (400), paiement sans abonnement (409), transition
  de statut invalide résiduelle post-BIL-08 (409, ex. `SUSPENDED`/`CANCELLED`/
  `EXPIRED` + `FAILED`). Chaque entrée porte `provider`, `httpStatus`,
  `reason`, `providerReference` (quand déjà connu à ce stade — pas disponible
  pour un rejet de signature, la signature étant vérifiée avant tout parsing
  du corps), et une empreinte **SHA-256** du corps brut (`node:crypto`, aucune
  nouvelle dépendance) — **jamais le corps ni un secret en clair**, conforme à
  CLAUDE.md §6. Un log structuré `warn` (même `Logger` applicatif que BIL-07)
  accompagne chaque entrée pour une détection immédiate via les logs, sans
  nouvelle infrastructure d'alerting (pas de compteur à seuil glissant — la
  même limitation déjà documentée dans `docs/deployment/PRODUCTION.md` pour le
  scaling).

  **Exclu du périmètre, décision produit confirmée** : le rejet « fournisseur
  inconnu dans l'URL » (`payment-provider.registry.ts`) n'est pas audité — il
  vit dans un autre composant (le registre, pas le service), ne porte aucune
  donnée de paiement, et aucun critère de sécurité déjà défini (CLAUDE.md §6,
  ADR 0010) n'exige explicitement sa traçabilité ; aucun conflit constaté avec
  les critères existants.

  Vérifié par les 6 tests de rejet existants (401 sans signature, 401 mauvais
  secret, 401 sans timestamp, 401 timestamp expiré, 404 référence inconnue,
  400 montant divergent), chacun étendu d'une assertion sur l'entrée d'audit
  créée, plus 2 nouveaux tests (corps JSON malformé, paiement sans
  `subscriptionId` — deux chemins jusque-là non couverts par aucun test) et
  une non-régression explicite : ni un succès ni un `status_conflict` (BIL-07)
  ne crée jamais cette entrée. Migration testée `up` sur la base de dev.
  `pnpm typecheck`/`lint`/`test`/`test:tenant`/`build` tous verts ; BIL-01 à
  BIL-08 non régressés (aucune de leurs suites de tests modifiée en dehors des
  assertions ajoutées ci-dessus).

### BIL-10

- **Sévérité** : MEDIUM
- **Composant** : Provisioning — étapes post-commit sans compensation ni reprise
- **Description** : après le commit, quatre opérations s'enchaînent hors transaction :
  émission du jeton de vérification, notification, audit, émission de la paire de
  tokens. Aucune n'est protégée : si l'une échoue (base de notifications indisponible,
  futur envoi SMTP réel), l'appelant reçoit un 500 alors que l'entreprise, l'utilisateur
  et l'abonnement existent bel et bien. Le client rejoue et obtient un 409
  (« Un compte existe déjà avec cet email »). L'utilisateur n'a ni tokens, ni email de
  vérification, et l'audit `ENTERPRISE_PROVISIONED` peut manquer.
  L'ADR 0003 pose l'invariant « aucune entreprise à moitié créée » — il est tenu au sens
  base de données, pas au sens du parcours utilisateur.
- **Impact** : compte créé mais parcours d'inscription cassé, sans mécanisme de reprise.
  Trou possible dans la piste d'audit d'un événement pourtant listé comme obligatoire.
- **Risque** : moyen (croît avec l'ajout d'un vrai fournisseur d'email).
- **Fichier(s)** :
  - `apps/api/src/provisioning/provisioning.service.ts:109-137`
  - `apps/api/src/provisioning/provisioning.integration.spec.ts` (aucun test de panne injectée)
  - `docs/adr/0003-atomicite-provisioning.md`
- **Solution** : rendre notification et audit non bloquants pour la réponse (mise en
  file avec relance, échec journalisé mais n'annulant pas l'inscription), ou déplacer
  l'écriture d'audit dans la transaction. Ajouter les tests d'injection de panne
  revendiqués par l'ADR (panne à chaque étape de la transaction **et** en post-commit),
  et corriger l'ADR si le comportement retenu diffère de ce qu'elle décrit.
- **Priorité** : P2
- **Statut** : CORRIGÉ (2026-08-18) — deux mesures distinctes, décision produit
  confirmée. (1) L'écriture d'audit `ENTERPRISE_PROVISIONED` a rejoint la
  transaction Prisma existante : `AuditLogService.record()` accepte
  désormais un second paramètre optionnel `tx: Prisma.TransactionClient`
  (défaut `this.prisma`, tous les appels existants — BIL-01 à BIL-09 inclus
  — inchangés). Elle ne peut structurellement plus manquer si l'entreprise
  existe. (2) L'émission du jeton de vérification et l'envoi de l'email de
  bienvenue restent hors transaction (nature : effets de bord non centraux)
  mais sont désormais enveloppés dans un `try/catch` : une panne y est
  journalisée (log structuré `error`) sans jamais faire échouer
  l'inscription — l'endpoint répond toujours `201` avec des tokens valides.
  Assumé sans risque fonctionnel aujourd'hui : `User.emailVerifiedAt` n'est
  lu ni imposé nulle part dans le code (vérifié exhaustivement) — sa perte
  reste cosmétique. `AuthService.issueTokenPair` reste, lui, bloquant (fait
  partie du contrat de réponse `{ accessToken, refreshToken }`, pas
  d'assouplissement du contrat public) ; en cas de panne résiduelle à cette
  étape précise, le compte créé demeure utilisable via `/auth/login`,
  filet de secours implicite déjà testé indépendamment. Aucune file
  d'attente/relance construite : aucune infrastructure de queue (BullMQ/
  Redis) n'existe dans ce projet à ce stade — en ajouter une pour ce seul
  correctif aurait été disproportionné (CLAUDE.md §3, dépendance non
  triviale). Aucune migration Prisma : le paramètre `tx` est un changement
  de signature TypeScript uniquement.

  Vérifié par 4 tests d'injection de panne
  (`provisioning.integration.spec.ts`, technique `jest.spyOn` sur
  l'instance réelle du service via `app.get(...)`, précédent déjà établi
  par `subscription-lifecycle.integration.spec.ts`) : panne sur l'émission
  du jeton de vérification → 201 avec tokens valides, entreprise/audit
  bien créés ; panne sur l'envoi de la notification → même résultat ;
  confirmation explicite que l'audit `ENTERPRISE_PROVISIONED` est déjà
  présent immédiatement après le commit, sans fenêtre où il pourrait
  manquer. Les 4 tests nominal/idempotence/plan-inconnu/NINEA-dupliqué
  existants restent verts sans modification de leur logique. `docs/adr/
  0003-atomicite-provisioning.md` mis à jour pour préciser la portée réelle
  de l'invariant.

### BIL-11

- **Sévérité** : MEDIUM
- **Composant** : Provisioning / notifications — jeton de vérification en clair
- **Description** : le jeton de vérification d'email est interpolé en clair dans le
  corps du message, lequel est (a) persisté tel quel dans `Notification.body` et (b)
  écrit sur la sortie standard par `ConsoleMailSender`, donc capturé par la collecte de
  logs conteneur. Le jeton est pourtant stocké haché côté `AuthToken` — la précaution
  est annulée par la copie en clair.
- **Impact** : toute personne disposant d'un accès en lecture aux logs ou à la table
  `notifications` peut valider l'email d'un compte tiers. Le même canal servira aux
  jetons de réinitialisation de mot de passe, ce qui en ferait une prise de contrôle de
  compte. CLAUDE.md §6 interdit d'écrire un secret dans un log.
- **Risque** : moyen (dépend de l'accès aux logs), élevé si le motif est réutilisé pour
  la réinitialisation de mot de passe.
- **Fichier(s)** :
  - `apps/api/src/provisioning/provisioning.service.ts:116-124`
  - `apps/api/src/notifications/notifications.service.ts:28-40`
  - `apps/api/src/notifications/mail-sender.ts:17-21`
- **Solution** : ne jamais persister ni journaliser le corps contenant un secret :
  stocker un gabarit + des variables non sensibles, et n'injecter le jeton qu'au moment
  de l'envoi. Restreindre `ConsoleMailSender` au strict développement (échec au
  démarrage si sélectionné hors développement) et masquer le corps dans sa sortie.
  À rapprocher de l'audit d'authentification si un autre agent le couvre.
- **Priorité** : P2
- **Statut** : CORRIGÉ (2026-08-19) — **portée réelle plus étroite que ce que
  ce constat décrivait initialement**, vérifiée avant correctif :
  - le volet journalisation (`ConsoleMailSender` écrivant le corps sur
    stdout) est déjà couvert par **SEC-04**
    (`docs/audit/SECURITY-AUDIT.md`), corrigé le 2026-08-16 — `send()`
    n'écrit plus jamais `body`, seulement un `messageId` généré
    (`mail-sender.spec.ts`) ;
  - la réinitialisation de mot de passe (`account-recovery.service.ts`) et
    l'invitation utilisateur (`invitations.service.ts`) n'utilisent **pas**
    `NotificationsService.notify()` : les deux appellent `mailSender.send()`
    directement et ne persistent donc jamais leur jeton en base. Le risque
    d'aggravation anticipé par ce constat (« le même canal servira aux
    jetons de réinitialisation ») ne s'est pas matérialisé ;
  - seul restait le jeton de vérification d'email émis par
    `ProvisioningService.register` (`provisioning.service.ts:150-159`),
    seul appelant de `NotificationsService.notify()` à interpoler un secret
    dans `body` — celui-ci est bien persisté tel quel dans
    `Notification.body`.

  Correctif (Option A, périmètre minimal) : `NotifyParams` gagne un champ
  optionnel `mailBody?: string` (`notifications.service.ts`) — envoyé par
  `mailSender.send()` à la place de `body` quand présent, jamais persisté.
  `body` (persisté) reste toujours obligatoire et ne doit jamais porter de
  secret. `provisioning.service.ts` passe désormais un texte neutre dans
  `body` (« Un email de vérification vous a été envoyé. ») et le jeton
  uniquement dans `mailBody`. Les deux autres appelants
  (`payments-webhook.service.ts`, confirmation/échec de paiement) n'ont pas
  de secret et continuent à n'utiliser que `body` — comportement inchangé,
  `mailBody` retombe sur `body` par défaut. Aucune migration Prisma (aucun
  changement de schéma).

  Vérifié par un nouveau test dédié
  (`provisioning.integration.spec.ts`, « never persists the raw email
  verification token in Notification.body, while still sending it in the
  email (BIL-11) ») : le jeton réellement envoyé (capturé via un
  `MailSender` de test, même patron que
  `invitations.integration.spec.ts`/`account-recovery.integration.spec.ts`)
  est confronté au hash stocké dans `AuthToken` pour confirmer qu'il s'agit
  bien du jeton émis pour cet utilisateur, puis son absence est vérifiée
  dans le `body` persisté de la notification `WELCOME`. Les tests BIL-10
  existants sur ce même bloc (panne d'émission du jeton, panne d'envoi de
  la notification) restent verts sans modification de leur logique — seule
  la construction de l'argument passé à `notify()` change, pas le
  comportement de résilience post-commit.

### BIL-12

- **Sévérité** : MEDIUM
- **Composant** : Entitlements — catalogue non administrable
- **Description** : le commentaire de `schema.prisma:831-833` affirme que l'association
  feature↔plan est « éditable en base par le Super Admin ». Vérification faite, **aucun
  code applicatif n'écrit jamais** dans `plans`, `features`, `limits`, `plan_features`
  ou `plan_limits` : les seules écritures du dépôt sont dans `prisma/seed.ts`.
  `PlansService` est en lecture seule et public ; `SubscriptionsService` ne fait
  qu'affecter un plan existant à une entreprise.
- **Impact** : créer un plan, ajuster un prix ou activer une feature exige aujourd'hui
  une intervention manuelle en base de production — opération non tracée, non validée,
  à haut risque, et interdite par CLAUDE.md §3. La documentation surestime l'état réel.
- **Risque** : moyen (risque opérationnel, pas d'exploitation directe).
- **Fichier(s)** :
  - `apps/api/prisma/schema.prisma:811-880` (commentaires lignes 831-833, 857)
  - `apps/api/src/plans/plans.service.ts:24-41`
  - `apps/api/prisma/seed.ts:63-70`
- **Solution** : soit implémenter les routes Super Admin de gestion du catalogue
  (création/édition de plan, activation de feature, limites), avec validation Zod,
  audit `CHANGE_PLAN`/dédié et invalidation du cache d'entitlements ; soit corriger
  immédiatement les commentaires et l'ADR 0005 pour refléter l'état réel. Ne pas
  laisser la documentation décrire une capacité inexistante.
- **Priorité** : P2
- **Statut** : CORRIGÉ (2026-08-19) — `PlansAdminController` (nouveau module
  `plans-admin/`, `POST/PATCH/GET /admin/plans`, `PUT
  /admin/plans/:id/features/:featureKey`, `PUT /admin/plans/:id/limits/:limitKey`),
  réservé au Super Admin (`JwtAuthGuard` + `SuperAdminGuard`), validation Zod
  (`@erp/validation/plans-admin`), audit dédié (4 nouvelles valeurs `AuditAction` :
  `CREATE_PLAN`, `UPDATE_PLAN`, `UPDATE_PLAN_FEATURE`, `UPDATE_PLAN_LIMIT` —
  migration additive, distinctes de `CHANGE_PLAN` qui reste réservée au
  changement d'abonnement d'une entreprise). Cache d'entitlements non invalidé
  explicitement : même garantie de fraîcheur (TTL court) que
  `SubscriptionsService.changePlan` aujourd'hui, voir ADR-0005 §"Mise à jour —
  BIL-12". Périmètre volontairement restreint : une feature/limite ne peut être
  configurée que si sa clé existe déjà dans le catalogue (`Feature`/`Limit`) —
  aucune création dynamique de clé, ce catalogue reste défini par le code et
  `prisma/seed.ts` (même raisonnement que `PERMISSION_KEYS`). Commentaires
  `schema.prisma` corrigés pour décrire exactement ce périmètre.

### BIL-13

- **Sévérité** : MEDIUM
- **Composant** : Abonnements — changement de plan non transactionnel et non contrôlé
- **Description** : `changePlan` effectue deux écritures distinctes et non atomiques
  (`updateSubscriptionPlan` puis `createSubscriptionEvent`), suivies d'une troisième
  (audit). Un échec entre les deux laisse un abonnement dont le plan a changé **sans
  trace dans l'historique immuable**, ce qui contredit l'objectif affiché de
  `SubscriptionEvent`. Par ailleurs aucun contrôle n'est fait sur le statut de
  l'abonnement : un abonnement `CANCELLED` ou `EXPIRED` peut être basculé vers un plan
  supérieur. Aucune proration, aucun paiement, aucune facture ne sont déclenchés par un
  changement de plan.
- **Impact** : historique de facturation potentiellement incomplet ; montée en gamme
  possible sans contrepartie financière ni contrôle d'état.
- **Risque** : moyen (réservé au Super Admin, mais l'historique est un actif de
  conformité OHADA).
- **Fichier(s)** : `apps/api/src/subscriptions/subscriptions.service.ts:25-64`
- **Solution** : encapsuler mise à jour + `SubscriptionEvent` dans une seule
  transaction ; refuser le changement de plan sur un statut terminal
  (`CANCELLED`/`EXPIRED`) ; définir la règle de proration/facturation et l'implémenter
  ou la documenter comme non couverte. Tests : « changement refusé sur abonnement
  annulé », « aucun changement sans événement d'historique ».
- **Priorité** : P2
- **Statut** : CORRIGÉ (2026-08-20) — `SubscriptionsService.changePlan` refuse
  désormais (409) tout changement sur un abonnement `CANCELLED`/`EXPIRED` ;
  garde placée dans le service (pas dans `subscription-state-machine.ts`) car
  un changement de plan ne fait pas varier le statut
  (`fromStatus === toStatus`) — ce n'est pas une transition au sens de la
  state machine, qui rejetterait à tort tout changement de plan si on lui
  demandait `assertSubscriptionTransition(status, status)`.
  `CrossTenantRepository.changeSubscriptionPlan` encapsule désormais la mise
  à jour du plan et la création du `SubscriptionEvent` dans une seule
  transaction Prisma (`updateSubscriptionPlan` supprimée, devenue son seul
  appelant). **Écart assumé** : aucune proration/facturation n'est
  déclenchée par un changement de plan — décision produit/finance non
  tranchée (montant, date d'effet, remboursement au downgrade), restant
  explicitement hors périmètre de ce correctif. Tests : rejet 409 sur
  `CANCELLED` et `EXPIRED` (aucune écriture, aucun `SubscriptionEvent`),
  rollback des deux écritures si la transaction échoue (contrainte de clé
  étrangère sur `planId`), non-régression des 5 tests existants.

### BIL-14

- **Sévérité** : MEDIUM
- **Composant** : Provisioning — limitation de débit insuffisante sur `/auth/register`
- **Description** : `AUTH_RATE_LIMIT` (10 req/min) est appliqué par `@Throttle` au
  niveau de `AuthController` uniquement. `ProvisioningController` déclare pourtant le
  même préfixe `@Controller("auth")` et expose `POST /auth/register`, mais n'hérite
  d'aucun `@Throttle` : il retombe sur la limite globale de 100 req/min par IP.
  Or `register` est l'endpoint le plus coûteux de l'API (hachage Argon2, transaction de
  plusieurs dizaines d'insertions dont tout le plan comptable SYSCOHADA).
- **Impact** : déni de service applicatif à faible coût, et création de masse
  d'entreprises fantômes polluant la base et les compteurs de la plateforme.
  CLAUDE.md §6 demande une limite plus stricte sur `/auth/*` : elle n'est pas appliquée
  uniformément.
- **Risque** : moyen.
- **Fichier(s)** :
  - `apps/api/src/provisioning/provisioning.controller.ts:13-18`
  - `apps/api/src/auth/auth.controller.ts:29`
  - `apps/api/src/common/rate-limit.ts:9-15`
- **Solution** : appliquer `@Throttle(AUTH_RATE_LIMIT)` (voire une limite dédiée plus
  basse) sur `ProvisioningController`, et ajouter un test de non-régression qui vérifie
  que **toutes** les routes du préfixe `auth` portent bien la limite stricte.
- **Priorité** : P2
- **Statut** : CORRIGÉ (2026-08-20) — `ProvisioningController` porte
  désormais `@Throttle(AUTH_RATE_LIMIT)`, même limite que `AuthController`
  (10/min, pas de limite dédiée — décision produit à réévaluer plus tard si
  les métriques le justifient). `apps/api/src/common/auth-throttling.spec.ts`
  ajouté : découvre dynamiquement, à partir du système de fichiers, tous les
  `*.controller.ts` dont `@Controller()` porte le préfixe `auth`, et vérifie
  pour chacun la présence de `@Throttle(AUTH_RATE_LIMIT)` — un futur
  contrôleur `@Controller("auth/xxx")` sans throttling ferait donc échouer
  la CI automatiquement, sans liste manuelle à maintenir. Comparaison faite
  via une classe témoin décorée par le `Throttle` public du package (jamais
  de clé de métadonnée interne à `@nestjs/throttler` recopiée en dur, ce
  package ne les exporte pas). Test explicite dédié à
  `ProvisioningController` en complément. Vérifié : le test échoue bien si
  le décorateur est retiré (non vacueusement vert).

### BIL-15

- **Sévérité** : LOW
- **Composant** : Webhooks — limitation de débit contre-productive
- **Description** : la route de webhook est soumise au `ThrottlerGuard` global (100
  req/min par IP). Un fournisseur qui livre en rafale ou rejoue un lot depuis une plage
  d'IP réduite se verrait renvoyer des 429, sans en-tête `Retry-After` documenté côté
  intégration.
- **Impact** : perte silencieuse d'événements de paiement, ou retards de traitement.
- **Risque** : faible aujourd'hui (aucun trafic réel), à réévaluer à l'intégration.
- **Fichier(s)** :
  - `apps/api/src/app.module.ts:39, 67`
  - `apps/api/src/payments/payments-webhook.controller.ts:13-21`
- **Solution** : appliquer une limite dédiée (plus haute) aux webhooks, et prévoir une
  liste blanche d'IP fournisseur lorsqu'elle sera connue. Toujours répondre 200 sur un
  événement déjà traité, et documenter le comportement en cas de 429.
- **Priorité** : P3
- **Statut** : CORRIGÉ (2026-08-20) — `PaymentsWebhookController` porte
  désormais `@Throttle(WEBHOOK_RATE_LIMIT)`, 300 req/min/IP (nouvelle
  constante dans `common/rate-limit.ts`, calculée par `computeRateLimits`
  comme les autres limites, désactivée sous `NODE_ENV=test`) — même
  mécanisme d'override du throttler `default` que BIL-14, aucun throttler
  nommé supplémentaire, aucun changement dans `app.module.ts`. `Retry-After`
  vérifié directement dans les sources installées de `@nestjs/throttler`
  (6.5.0) : émis nativement sur tout 429, pas une fonctionnalité à activer
  séparément — documenté dans l'ADR 0010 (mise à jour 2026-08-20). Le point
  « toujours répondre 200 sur un événement déjà traité » de la solution
  d'origine était déjà satisfait par BIL-01/BIL-07/BIL-09, vérifié dans le
  code actuel de `PaymentWebhookService.handle`, rien à changer ici.
  **Écart assumé** : aucune liste blanche d'IP fournisseur — hors périmètre
  tant qu'aucun fournisseur réel n'est intégré, documenté dans l'ADR 0010.
  Tests : `common/webhook-throttling.spec.ts` (le contrôleur porte bien la
  limite dédiée, comparaison via classe témoin, vérifié qu'il échoue sans le
  décorateur) ; `common/rate-limit.spec.ts` complété (webhooks > global en
  valeurs de production).

### BIL-16

- **Sévérité** : LOW
- **Composant** : Validation — schémas de paiement non stricts
- **Description** : `createPendingPaymentSchema` et `paymentWebhookEventSchema` ne sont
  pas déclarés en `.strict()`. Les clés inconnues d'un payload sont silencieusement
  ignorées au lieu d'être rejetées. Le typage protège de l'injection d'opérateurs, mais
  une divergence de schéma côté fournisseur (renommage de champ, ajout d'un champ
  `amount_net` supplantant `amount`) passerait inaperçue.
- **Impact** : traitement d'un événement mal interprété sans erreur visible.
- **Risque** : faible.
- **Fichier(s)** : `packages/validation/src/payments.ts:5-11, 16-22`
- **Solution** : ajouter `.strict()` sur les deux schémas ; contraindre `currency` à
  un `z.enum(["XOF"])` tant que seule cette devise est supportée.
- **Priorité** : P3
- **Statut** : CORRIGÉ (2026-08-20) — `.strict()` appliqué aux deux schémas
  (`createPendingPaymentSchema`, `paymentWebhookEventSchema`) ; `currency` de
  `paymentWebhookEventSchema` resserré à `z.enum(["XOF"])`. Analyse faite
  avant implémentation : `ZodValidationPipe` ne transmettait déjà au service
  que les champs validés (BIL-05 neutralisait déjà tout `amount`/`currency`
  forgé côté client, indépendamment du mode strict) — `.strict()` sur
  `createPendingPaymentSchema` change donc le contrat HTTP (clé en trop → 400
  au lieu de 201 silencieux), sans renforcer une garantie de sécurité déjà
  acquise. Décision produit : appliquer `.strict()` aux deux schémas quand
  même, pour la cohérence des frontières API d'un ERP financier, plutôt que
  de le réserver au seul schéma webhook. Le test
  `payments-bootstrap.integration.spec.ts` qui démontrait explicitement le
  rejeu d'un `amount`/`currency` forgé comme *ignoré* (201) a été réécrit en
  deux temps : un cas payload propre → 201 (couverture BIL-05 préservée) et
  un nouveau cas payload avec clés en trop → 400 (couverture BIL-16).
  Tests ajoutés : clé inconnue dans le webhook → 400, devise ≠ XOF → 400, clé
  inconnue dans `createPendingPaymentSchema` → 400.

### BIL-17

- **Sévérité** : LOW
- **Composant** : Entitlements — cache mémoire sans invalidation ni borne
- **Description** : `EntitlementsService` maintient une `Map` par processus, clé =
  `tenantId`, TTL 5 s en production (`ENTITLEMENTS_CACHE_TTL_MS`, défaut 5000). Aucune
  invalidation explicite lors d'un changement de plan ou d'un changement de statut par
  le webhook, et aucune borne de taille ni éviction : la Map croît avec le nombre de
  tenants actifs. À noter que le test « prend effet immédiatement, sans redéploiement »
  (`subscriptions.controller.integration.spec.ts:186`) ne passe que parce que le TTL est
  forcé à 0 en environnement de test : il **ne démontre pas** le comportement de
  production.
- **Impact** : fenêtre de désynchronisation de quelques secondes après un changement de
  plan ou une suspension (acceptable si assumé) ; croissance mémoire non bornée sur un
  parc important.
- **Risque** : faible.
- **Fichier(s)** :
  - `apps/api/src/entitlements/entitlements.service.ts:30-48`
  - `apps/api/src/config/env.ts:23`
  - `apps/api/src/subscriptions/subscriptions.controller.integration.spec.ts:186`
- **Solution** : invalider explicitement l'entrée du tenant dans `changePlan` et dans le
  webhook ; borner le cache (LRU) ; requalifier le libellé du test ou le doubler d'un
  test exécuté avec le TTL de production.
- **Priorité** : P3
- **Statut** : OUVERT

### BIL-18

- **Sévérité** : LOW
- **Composant** : Multi-tenancy — flux facturation sur la connexion propriétaire
- **Description** : les tables `payments`, `invoices`, `subscriptions`,
  `subscription_events`, `invoice_counters` sont bien couvertes par
  `ENABLE/FORCE ROW LEVEL SECURITY`. Mais les chemins webhook et provisioning utilisent
  `PrismaService` (connexion `DATABASE_URL`, rôle propriétaire, RLS contournée), comme
  le prévoit l'ADR 0008 pour les flux pré-tenant. Il en résulte que l'isolation de ces
  écritures financières repose **uniquement** sur le code applicatif, sans le filet de
  sécurité base revendiqué comme « garantie ultime » par CLAUDE.md §5.
- **Impact** : une erreur de programmation dans le webhook (mauvais `enterpriseId`
  propagé) ne serait arrêtée par rien. Ce point est atténué par le fait que
  `enterpriseId` et `subscriptionId` sont relus depuis le `Payment` en base et jamais
  acceptés depuis le payload — bonne pratique effectivement appliquée
  (`payments-webhook.service.ts:82-83`).
- **Risque** : faible.
- **Fichier(s)** :
  - `apps/api/src/prisma/prisma.service.ts:1-15`
  - `apps/api/src/tenant/tenant-scoped-prisma.service.ts:14-20`
  - `apps/api/prisma/migrations/20260809113836_add_tenant_role_and_rls/migration.sql`
- **Solution** : une fois le tenant résolu (après lecture du `Payment`), exécuter la
  suite du traitement via `TenantScopedPrismaService.run()` afin de bénéficier de la RLS
  pour les écritures `subscription`/`invoice` ; à défaut, documenter explicitement
  l'exception dans l'ADR 0008 et ajouter un test asseyant que le webhook ne peut pas
  écrire hors de l'entreprise du paiement.
- **Priorité** : P3
- **Statut** : OUVERT

### BIL-19

- **Sévérité** : LOW
- **Composant** : Paiements — paiement en attente sans expiration
- **Description** : un `Payment` créé en `PENDING` le reste indéfiniment ; aucune date
  d'expiration, aucune purge, aucun statut `EXPIRED`. Combiné à BIL-08 (paiements
  bloqués en `PENDING`) et à l'absence de fenêtre anti-rejeu (BIL-06), une référence
  amorcée il y a plusieurs mois peut encore être activée par un webhook signé.
- **Impact** : activation d'un abonnement sur une intention de paiement obsolète.
- **Risque** : faible.
- **Fichier(s)** :
  - `apps/api/src/payments/payments-bootstrap.service.ts:28-35`
  - `apps/api/prisma/schema.prisma:941-965`
- **Solution** : ajouter `expiresAt` sur `Payment`, refuser un webhook portant sur un
  paiement expiré (avec audit), et purger/expirer les intentions anciennes via la tâche
  planifiée de BIL-03.
- **Priorité** : P3
- **Statut** : OUVERT

### BIL-20

- **Sévérité** : INFO
- **Composant** : Abonnements — machine à états : constat positif et réserve de test
- **Description** : contrairement à ce qu'un audit rapide pourrait conclure, la machine
  à états n'est **pas** que documentaire : `ALLOWED_TRANSITIONS` est une table explicite,
  `assertSubscriptionTransition` lève une erreur typée, et
  `subscription-state-machine.spec.ts` couvre la matrice complète 6×6, les états
  terminaux et le rejet des auto-transitions. C'est un point solide.
  La réserve porte sur le **câblage** : un seul appelant (BIL-03) et aucun test
  d'intégration de bout en bout démontrant qu'une transition illégale est refusée à
  travers une route HTTP.
- **Impact** : aucun défaut immédiat ; risque de régression silencieuse si de nouveaux
  chemins d'écriture de statut sont ajoutés sans passer par la fonction d'assertion.
- **Risque** : néant à court terme.
- **Fichier(s)** :
  - `apps/api/src/subscriptions/subscription-state-machine.ts:7-34`
  - `apps/api/src/subscriptions/subscription-state-machine.spec.ts:24-69`
- **Solution** : centraliser toute écriture de `Subscription.status` dans un unique
  service de cycle de vie (voir BIL-03) et ajouter un test/lint interdisant
  `subscription.update({ data: { status } })` ailleurs.
- **Priorité** : P4
- **Statut** : OUVERT

### BIL-21

- **Sévérité** : INFO
- **Composant** : Montants — conformité XOF confirmée
- **Description** : vérification exhaustive du schéma : aucun champ `Float` ni
  `Decimal`. Tous les montants de facturation sont `Int`. La ventilation TVA est faite
  en entiers avec un taux en points de base, et `vatAmount` est calculé par différence,
  ce qui garantit l'égalité exacte HT + TVA = TTC sans dérive d'arrondi. `formatFCFA()`
  est cantonné à l'affichage. Aucun `parseFloat`/`toFixed` appliqué à un montant.
  Conforme à CLAUDE.md §7.
- **Impact** : aucun.
- **Risque** : néant.
- **Fichier(s)** :
  - `apps/api/prisma/schema.prisma:811-997`
  - `apps/api/src/payments/invoice-generation.service.ts:5, 46-47`
  - `packages/utils/src/format-fcfa.ts:5-7`
- **Solution** : ajouter une règle de garde en CI (interdiction de `Float`/`Decimal`
  dans `schema.prisma`) pour verrouiller cet acquis.
- **Priorité** : P4
- **Statut** : OUVERT

### BIL-22

- **Sévérité** : INFO
- **Composant** : Secrets — conformité confirmée sur le périmètre paiement
- **Description** : aucun secret de paiement n'est versionné. Les fichiers suivis ne
  contiennent que des placeholders (`change-me`) et des valeurs de CI factices.
  `env.paymentWebhookSecret()` échoue au démarrage si la variable manque, ce qui évite
  un démarrage avec un secret vide. Aucun `console.log` de payload de webhook, aucune
  journalisation de corps de requête ni d'en-tête `x-webhook-signature`.
- **Impact** : aucun.
- **Risque** : néant.
- **Fichier(s)** :
  - `.env.example:13-17`, `docker/.env.prod.example:28-32`
  - `apps/api/src/config/env.ts:3-9, 27`
  - `apps/api/src/common/logging/http-logging.middleware.ts:17-25`
- **Solution** : maintenir ; ajouter un scan de secrets (Gitleaks) bloquant en CI si ce
  n'est pas déjà couvert, et prévoir la procédure de rotation des secrets de webhook
  avant l'intégration d'un fournisseur réel.
- **Priorité** : P4
- **Statut** : OUVERT

---

## 4. Écarts entre documentation et code

| Source | Affirmation | Constat |
|--------|-------------|---------|
| ADR 0003 | « Un échec à n'importe quelle étape […] testé par injection de panne à chaque étape » | Aucun test d'injection de panne n'existe (BIL-10) |
| ADR 0003 | « aucune entreprise à moitié créée ne doit exister » | Vrai en base, faux au niveau du parcours (post-commit non compensé) |
| ADR 0010 | Cite la tolérance de rejeu bornée dans le temps comme état de l'art | Non implémentée (BIL-06) |
| ADR 0005 | « changement de plan […] se répercute sans attendre » | Vrai à ~5 s près en production ; le test qui l'atteste tourne avec TTL=0 (BIL-17) |
| `schema.prisma:831-833` | Association feature↔plan « éditable en base par le Super Admin » | Corrigé (BIL-12) : `PlansAdminController` implémente désormais cette édition |
| `payments-webhook.service.ts:22-23` | « Idempotence par (provider, providerReference) — champ unique en base » | L'unique porte sur le paiement, pas sur le traitement de l'événement (BIL-01/BIL-02) |

---

## 5. Recommandation de séquencement

1. **P1 — avant tout branchement d'un fournisseur de paiement réel** : BIL-01, BIL-02,
   BIL-05 (intégrité financière), puis BIL-03 et BIL-04 (capacité à faire respecter le
   non-paiement).
2. **P2 — sous 30 jours** : BIL-06 à BIL-14.
3. **P3/P4** : durcissement et alignement documentaire.

## 6. Points nécessitant une validation non technique

- Décision **produit** : `PAST_DUE` doit-il bloquer les écritures ? Quelle durée de
  grâce ? Quel comportement en cas d'échec de paiement pendant l'essai (BIL-08) ?
- Décision **produit/finance** : proration lors d'un changement de plan (BIL-13).
- Validation **juridique/comptable** : la double émission de facture (BIL-01) touche la
  base de TVA déclarée ; la procédure de correction d'une facture émise en double doit
  être définie avec un comptable (une facture n'est pas supprimable en SYSCOHADA — il
  faut un avoir). La durée de conservation des factures SaaS et des journaux d'audit
  associés doit être confirmée (≥ 10 ans OHADA à vérifier).
