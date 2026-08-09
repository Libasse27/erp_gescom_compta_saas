# PROMPT MAÎTRE — TRANSFORMATION D'UN ERP GESCOM & COMPTABILITÉ EN SAAS MULTI-ENTREPRISES

> Spécification fonctionnelle détaillée d'origine, conservée intégralement pour
> référence. Le plan d'exécution opérationnel (phases, protocole, ADR) vit dans
> `docs/PROMPT-MAITRE-SAAS.md` — en cas de divergence entre les deux documents,
> c'est ce dernier qui fait foi pour l'ordre d'exécution.

## 1. CONTEXTE DU PROJET

Je dispose actuellement d'une application ERP existante de **gestion commerciale (GESCOM) et de comptabilité**.

L'application fonctionne déjà et contient des fonctionnalités métier que je souhaite **conserver, améliorer et faire évoluer**, sans repartir de zéro.

Je veux maintenant transformer cette application en une **plateforme SaaS professionnelle, sécurisée, multi-entreprises et évolutive**, permettant à plusieurs entreprises de créer leur compte, souscrire à un forfait payant et utiliser leur propre espace de gestion.

L'objectif est de conserver le cœur fonctionnel actuel de l'ERP tout en ajoutant une véritable architecture SaaS.

Le projet est organisé sous forme de **monorepo** :

```text
monorepo/
│
├── apps/
│   ├── web/
│   ├── mobile/
│   ├── desktop/
│   └── api/
│
├── packages/
│
├── docker/
│
├── docs/
│
├── scripts/
│
└── infra/
```

---

# 2. OBJECTIF PRINCIPAL

Transformer l'ERP actuel en une plateforme SaaS permettant :

1. À un utilisateur de créer un compte.
2. À cet utilisateur de créer une entreprise.
3. De devenir automatiquement l'**Administrateur principal** de cette entreprise.
4. De choisir un forfait payant.
5. D'accéder à son espace entreprise.
6. De gérer les utilisateurs de son entreprise.
7. De gérer les modules ERP autorisés par son forfait.
8. De gérer les données commerciales et comptables de son entreprise.
9. Au Super Administrateur de gérer l'ensemble de la plateforme.
10. D'isoler totalement les données entre les différentes entreprises.

L'application doit donc fonctionner selon le modèle :

```text
PLATEFORME SaaS
│
├── SUPER ADMIN
│   │
│   ├── Entreprise A
│   │   ├── Administrateur
│   │   ├── Utilisateurs
│   │   ├── Clients
│   │   ├── Fournisseurs
│   │   ├── Produits
│   │   ├── Ventes
│   │   ├── Achats
│   │   └── Comptabilité
│   │
│   ├── Entreprise B
│   │   ├── Administrateur
│   │   ├── Utilisateurs
│   │   ├── Clients
│   │   ├── Fournisseurs
│   │   ├── Produits
│   │   ├── Ventes
│   │   └── Comptabilité
│   │
│   └── Entreprise C
│       └── ...
```

---

# 3. PRINCIPLE FONDAMENTAL : MULTI-TENANT

L'application doit devenir une architecture **multi-tenant**.

Chaque entreprise représente un tenant.

Toutes les données métier doivent être rattachées à une entreprise.

Exemple :

```text
Entreprise
   ↓
tenantId / entrepriseId
   ↓
Clients
Produits
Fournisseurs
Ventes
Achats
Stocks
Factures
Paiements
Écritures comptables
Utilisateurs
Paramètres
```

Une entreprise ne doit **jamais** pouvoir accéder aux données d'une autre entreprise.

Cette isolation doit être appliquée :

* au niveau API ;
* au niveau des services ;
* au niveau des repositories ;
* au niveau des requêtes base de données ;
* au niveau des permissions ;
* au niveau du frontend ;
* au niveau du mobile ;
* au niveau du desktop ;
* au niveau des exports ;
* au niveau des fichiers/documents.

Ne jamais faire confiance uniquement au frontend pour assurer l'isolation des tenants.

---

# 4. TYPES D'UTILISATEURS

Créer une architecture RBAC professionnelle.

## 4.1 SUPER_ADMIN

Le Super Administrateur appartient à la plateforme et non à une entreprise.

Il peut :

* accéder au Dashboard global ;
* créer/modifier/suspendre des entreprises ;
* consulter les entreprises ;
* gérer les abonnements ;
* gérer les forfaits ;
* gérer les paiements ;
* gérer les utilisateurs ;
* suspendre un compte ;
* réactiver un compte ;
* gérer les paramètres globaux ;
* consulter les statistiques globales ;
* consulter les logs ;
* consulter les audits ;
* gérer les permissions globales ;
* gérer les fonctionnalités disponibles ;
* gérer les plans tarifaires ;
* gérer les notifications ;
* gérer les paramètres de la plateforme.

Le Super Admin doit avoir une interface différente de celle des entreprises.

---

# 5. ADMINISTRATEUR D'ENTREPRISE

Lorsqu'un utilisateur crée une entreprise, les informations suivantes doivent être utilisées :

```text
Prénom
Nom
Email
Mot de passe
Téléphone
```

Puis :

```text
Nom de l'entreprise
Raison sociale
NINEA
RCCM
Adresse
Téléphone
Email
Pays
Ville
Devise
Secteur d'activité
```

L'utilisateur qui crée l'entreprise devient automatiquement :

```text
Entreprise
    ↓
Administrateur principal
```

Son compte doit être associé à l'entreprise via :

```text
user.entrepriseId
```

ou une relation équivalente adaptée à l'architecture retenue.

---

# 6. PAGE LOGIN

La page `LoginPage` doit permettre de se connecter à la plateforme.

Prévoir une architecture permettant de distinguer :

### Connexion entreprise

```text
Email
Mot de passe

[ Se connecter ]
```

Après authentification :

```text
Utilisateur
   ↓
Entreprise
   ↓
Dashboard entreprise
```

### Connexion Super Admin

Le système doit reconnaître que le compte appartient à la plateforme et permettre l'accès au :

```text
Super Admin Dashboard
```

Pour des raisons de sécurité, ne pas simplement afficher un bouton "Super Admin" permettant de contourner les contrôles.

L'accès doit être déterminé par les rôles et permissions côté serveur.

Prévoir également :

* validation ;
* messages d'erreur ;
* protection brute-force ;
* rate limiting ;
* JWT/session sécurisé ;
* refresh token ;
* expiration ;
* déconnexion ;
* gestion des sessions ;
* MFA/2FA pour Super Admin ;
* journalisation des connexions.

---

# 7. PAGE REGISTRE / INSCRIPTION

Créer une `RegisterPage` professionnelle.

Le processus doit être un onboarding SaaS.

## Étape 1 — Création du compte administrateur

Demander :

```text
Prénom *
Nom *
Email *
Téléphone
Mot de passe *
Confirmation mot de passe *
```

## Étape 2 — Création de l'entreprise

Demander :

```text
Nom entreprise *
Raison sociale
NINEA
RCCM
Secteur d'activité
Adresse
Ville
Pays
Téléphone
Email professionnel
```

## Étape 3 — Choix du forfait

Afficher les différents plans disponibles.

Exemple :

```text
STARTER
STANDARD
PROFESSIONNEL
COMPLET / ENTERPRISE
```

Le nom définitif des forfaits doit être configurable depuis le Super Admin.

---

# 8. FORFAITS PAYANTS

Le système doit être conçu pour gérer plusieurs abonnements.

Exemple :

## FORFAIT STARTER

Pour petites entreprises.

Possibilité de limiter :

* nombre d'utilisateurs ;
* nombre de produits ;
* nombre de clients ;
* nombre de documents ;
* stockage ;
* modules accessibles.

## FORFAIT STANDARD

Fonctionnalités supplémentaires :

* gestion commerciale ;
* ventes ;
* achats ;
* stocks ;
* clients ;
* fournisseurs ;
* facturation ;
* rapports.

## FORFAIT PROFESSIONNEL

Ajouter :

* comptabilité avancée ;
* statistiques ;
* tableaux de bord ;
* gestion avancée des utilisateurs ;
* exports ;
* automatisations ;
* API ;
* fonctionnalités avancées.

## FORFAIT COMPLET / ENTERPRISE

Inclure toutes les fonctionnalités disponibles.

Prévoir :

* utilisateurs avancés ;
* permissions avancées ;
* reporting avancé ;
* API ;
* intégrations ;
* stockage important ;
* fonctionnalités premium ;
* support prioritaire.

IMPORTANT :

Les limites et fonctionnalités de chaque forfait doivent être **configurables depuis le Super Admin**.

Ne pas coder en dur les plans dans le frontend.

---

# 9. ABONNEMENT

Créer un véritable système d'abonnement SaaS.

Modèle logique :

```text
User
   ↓
Entreprise
   ↓
Subscription
   ↓
Plan
   ↓
Payment
```

Une entreprise doit avoir :

```text
planId
subscriptionId
status
startDate
endDate
trialEndDate
renewalDate
```

Statuts possibles :

```text
TRIAL
ACTIVE
PAST_DUE
SUSPENDED
CANCELLED
EXPIRED
```

Prévoir également :

* période d'essai configurable ;
* renouvellement ;
* expiration ;
* suspension ;
* changement de forfait ;
* upgrade ;
* downgrade ;
* historique des abonnements ;
* historique des paiements ;
* factures ;
* notifications d'expiration.

---

# 10. PAIEMENT

Le système doit être conçu avec une abstraction de paiement.

Créer par exemple :

```text
PaymentProvider
```

afin de pouvoir intégrer plusieurs fournisseurs.

Prévoir notamment la possibilité d'intégrer :

```text
Wave
Orange Money
Carte bancaire
Stripe
```

L'architecture ne doit pas dépendre directement d'un seul fournisseur.

Exemple conceptuel :

```text
PaymentProvider
│
├── StripeProvider
├── WaveProvider
└── OrangeMoneyProvider
```

Le Super Admin doit pouvoir consulter :

* paiements ;
* transactions ;
* abonnements ;
* factures ;
* paiements échoués ;
* remboursements ;
* revenus ;
* statistiques.

---

# 11. CRÉATION AUTOMATIQUE DE L'ENTREPRISE

Après validation de l'inscription et du paiement :

```text
Créer User
      ↓
Créer Entreprise
      ↓
Créer Subscription
      ↓
Associer User → Entreprise
      ↓
Attribuer rôle ADMIN
      ↓
Initialiser paramètres entreprise
      ↓
Créer configuration comptable
      ↓
Créer configuration commerciale
      ↓
Créer Dashboard
      ↓
Rediriger vers Dashboard entreprise
```

Cette opération doit être **transactionnelle** lorsque la technologie de base de données le permet.

Éviter les entreprises partiellement créées.

---

# 12. UTILISATEURS D'UNE ENTREPRISE

L'administrateur doit pouvoir inviter des utilisateurs.

Exemple :

```text
ADMIN
COMPTABLE
COMMERCIAL
CAISSIER
MAGASINIER
GESTIONNAIRE
LECTEUR
```

Les rôles doivent être configurables.

Créer un véritable système :

```text
Role
Permission
UserRole
```

Exemples de permissions :

```text
clients.read
clients.create
clients.update
clients.delete

products.read
products.create
products.update
products.delete

sales.read
sales.create
sales.update
sales.delete

accounting.read
accounting.create
accounting.update

reports.read
```

---

# 13. DASHBOARD SUPER ADMIN

Créer une interface professionnelle :

```text
Super Admin Dashboard
│
├── Vue générale
├── Entreprises
├── Utilisateurs
├── Abonnements
├── Plans
├── Paiements
├── Factures
├── Transactions
├── Revenus
├── Statistiques
├── Notifications
├── Logs
├── Audit
├── Permissions
├── Paramètres
└── Configuration plateforme
```

Le dashboard doit afficher par exemple :

```text
Nombre total entreprises
Entreprises actives
Entreprises suspendues
Nouveaux comptes
Abonnements actifs
Abonnements expirés
Revenus
Paiements en attente
Paiements échoués
Nombre total utilisateurs
```

---

# 14. DASHBOARD ENTREPRISE

Chaque administrateur doit avoir son propre dashboard.

Exemple :

```text
Dashboard
│
├── Vue générale
├── Clients
├── Fournisseurs
├── Produits
├── Stocks
├── Ventes
├── Achats
├── Facturation
├── Caisse
├── Comptabilité
├── Rapports
├── Utilisateurs
├── Abonnement
└── Paramètres
```

Le menu doit être généré en fonction :

```text
Role
+
Permissions
+
Plan
```

---

# 15. CONSERVATION DE L'ERP EXISTANT

IMPORTANT :

Ne pas réécrire inutilement l'application existante.

Avant toute modification :

1. analyser le code existant ;
2. analyser l'architecture ;
3. identifier les modules ;
4. identifier les modèles ;
5. identifier les API ;
6. identifier les routes ;
7. identifier les composants ;
8. identifier les dépendances ;
9. identifier les problèmes de sécurité ;
10. identifier les fonctionnalités existantes.

Créer ensuite un rapport d'audit.

Classer les éléments :

```text
À conserver
À améliorer
À refactoriser
À migrer
À supprimer
À créer
```

Ne jamais supprimer une fonctionnalité existante sans justification.

> Note : ce projet ayant démarré sans code legacy (voir `docs/adr/`), cette
> section 15 s'appliquera si/quand du code externe est un jour importé dans le
> monorepo.

---

# 16. ARCHITECTURE MONOREPO

Respecter et améliorer l'architecture :

```text
monorepo/
│
├── apps/
│   ├── web/
│   ├── mobile/
│   ├── desktop/
│   └── api/
│
├── packages/
│   ├── ui/
│   ├── types/
│   ├── config/
│   ├── auth/
│   ├── permissions/
│   ├── validation/
│   └── utils/
│
├── docker/
│
├── docs/
│
├── scripts/
│
└── infra/
```

L'objectif est d'éviter la duplication de code entre :

```text
Web
Mobile
Desktop
API
```

Partager autant que possible :

* types ;
* validations ;
* permissions ;
* constantes ;
* modèles DTO ;
* utilitaires ;
* logique commune.

---

# 17. SÉCURITÉ

La sécurité doit être considérée comme une priorité absolue.

Implémenter :

* RBAC ;
* tenant isolation ;
* JWT sécurisé ;
* refresh token rotation ;
* expiration des sessions ;
* MFA pour Super Admin ;
* rate limiting ;
* protection brute-force ;
* validation des données ;
* sanitation ;
* protection CSRF selon architecture ;
* protection XSS ;
* protection injection ;
* audit logs ;
* logs de connexion ;
* gestion sécurisée des secrets ;
* chiffrement des données sensibles ;
* HTTPS ;
* headers de sécurité ;
* CORS strict ;
* contrôle des permissions côté API.

Ne jamais faire confiance aux informations envoyées par le frontend :

```text
entrepriseId
userId
role
permissions
plan
```

Ces informations doivent être vérifiées côté backend.

---

# 18. AUDIT LOG

Créer un système d'audit.

Exemple :

```text
AuditLog

id
userId
entrepriseId
action
resource
resourceId
ipAddress
userAgent
timestamp
metadata
```

Exemples :

```text
LOGIN
LOGOUT
CREATE_USER
DELETE_USER
CREATE_INVOICE
UPDATE_PRODUCT
DELETE_CLIENT
CHANGE_PLAN
PAYMENT
SUSPEND_ACCOUNT
```

Le Super Admin peut consulter les logs globaux.

L'administrateur d'entreprise peut consulter les logs de son entreprise selon ses permissions.

---

# 19. BASE DE DONNÉES

Analyser la base existante avant toute migration.

Mettre en place une architecture cohérente.

Exemple conceptuel :

```text
Platform
│
├── User
├── Enterprise
├── Plan
├── Subscription
├── Payment
├── Invoice
├── Transaction
├── AuditLog
└── Setting

Tenant
│
├── Customer
├── Supplier
├── Product
├── Category
├── Sale
├── Purchase
├── Stock
├── Invoice
├── Payment
├── AccountingEntry
└── ...
```

Chaque donnée métier doit être correctement liée à :

```text
enterpriseId / tenantId
```

---

# 20. ROUTAGE

Le système doit distinguer clairement les routes.

Exemple :

```text
/login
/register

/super-admin
/super-admin/enterprises
/super-admin/users
/super-admin/plans
/super-admin/subscriptions
/super-admin/payments

/app
/app/dashboard
/app/customers
/app/products
/app/sales
/app/purchases
/app/accounting
/app/settings
```

Les routes doivent être protégées par :

```text
Authentication
+
Role
+
Permission
+
Subscription
+
Tenant
```

---

# 21. GESTION DU PLAN ET DES FEATURES

Créer un système de feature flags / entitlements.

Exemple :

```text
Plan
   ↓
Features
   ↓
Permissions
   ↓
Modules disponibles
```

Exemple :

```text
STANDARD

clients = true
products = true
sales = true
purchases = true
accounting = false
advancedReports = false
api = false
```

Le frontend ne doit pas être la seule protection.

Le backend doit également vérifier que l'entreprise possède le droit d'utiliser une fonctionnalité.

---

# 22. EXPÉRIENCE UTILISATEUR

L'application doit avoir une UX SaaS moderne.

Prévoir :

* design professionnel ;
* responsive ;
* sidebar dynamique ;
* dashboard moderne ;
* notifications ;
* loaders ;
* skeletons ;
* confirmations ;
* gestion des erreurs ;
* formulaires avec validation ;
* recherche ;
* pagination ;
* filtres ;
* exports ;
* import de données ;
* dark mode si compatible avec l'application existante.

---

# 23. ONBOARDING

Après la création du compte, afficher un assistant :

```text
Bienvenue !

Étape 1
Informations entreprise

Étape 2
Configuration

Étape 3
Plan

Étape 4
Paiement

Étape 5
Configuration ERP

Étape 6
Inviter vos collaborateurs

Étape 7
Commencer à utiliser l'ERP
```

Prévoir une checklist :

```text
✓ Entreprise créée
✓ Profil complété
✓ Plan activé
✓ Premier utilisateur ajouté
□ Premier client
□ Premier produit
□ Première vente
□ Configuration comptable
```

---

# 24. NOTIFICATIONS

Créer un système de notifications.

Exemples :

```text
Bienvenue
Paiement confirmé
Paiement échoué
Abonnement bientôt expiré
Abonnement expiré
Nouvel utilisateur
Invitation utilisateur
Entreprise suspendue
Changement de plan
```

Prévoir une architecture permettant :

```text
Email
Notification interne
SMS / WhatsApp éventuellement plus tard
```

---

# 25. DOCUMENTATION

Créer et maintenir la documentation :

```text
docs/
│
├── architecture/
├── authentication/
├── multi-tenancy/
├── database/
├── api/
├── security/
├── billing/
├── subscriptions/
├── permissions/
├── deployment/
├── development/
└── user-guide/
```

Documenter chaque nouvelle fonctionnalité.

---

# 26. TESTS

Avant de considérer une fonctionnalité comme terminée, créer les tests nécessaires.

Minimum :

```text
Unit tests
Integration tests
API tests
Authentication tests
Authorization tests
Tenant isolation tests
Subscription tests
Payment tests
E2E tests
```

Tests critiques :

### Test 1

Un utilisateur de l'entreprise A ne doit jamais accéder aux données de B.

### Test 2

Un utilisateur sans permission ne doit pas accéder à une fonctionnalité protégée.

### Test 3

Un abonnement expiré doit bloquer les fonctionnalités concernées.

### Test 4

Le Super Admin peut gérer toutes les entreprises.

### Test 5

Un administrateur d'entreprise ne peut jamais devenir Super Admin via une requête frontend.

---

# 27. MÉTHODE DE TRAVAIL OBLIGATOIRE POUR L'IA

Tu ne dois pas commencer directement à modifier le code.

Procéder en plusieurs phases.

## PHASE 0 — AUDIT

Analyser entièrement le projet existant.

Produire :

```text
ARCHITECTURE.md
AUDIT.md
DATABASE.md
SECURITY-AUDIT.md
MIGRATION-PLAN.md
```

Ne modifier aucun code critique avant cette analyse.

---

## PHASE 1 — ARCHITECTURE SAAS

Concevoir :

```text
User
Enterprise
Role
Permission
Plan
Subscription
Payment
Invoice
AuditLog
```

Définir les relations.

---

## PHASE 2 — AUTHENTIFICATION

Mettre en place :

```text
Register
Login
Logout
Refresh token
Password reset
Email verification
MFA Super Admin
```

---

## PHASE 3 — MULTI-TENANCY

Implémenter l'isolation :

```text
tenantId / enterpriseId
```

sur tous les modules existants.

---

## PHASE 4 — SUPER ADMIN

Créer le dashboard et les fonctionnalités de gestion globale.

---

## PHASE 5 — ENTREPRISE

Créer le dashboard entreprise et l'administration des utilisateurs.

---

## PHASE 6 — PLANS ET ABONNEMENTS

Implémenter :

```text
Plans
Subscriptions
Features
Limits
Payments
Invoices
```

---

## PHASE 7 — MIGRATION ERP

Adapter progressivement les modules existants :

```text
Clients
Fournisseurs
Produits
Stocks
Ventes
Achats
Facturation
Comptabilité
Rapports
```

pour fonctionner avec le tenant.

---

## PHASE 8 — MOBILE ET DESKTOP

Adapter :

```text
apps/mobile
apps/desktop
```

au système d'authentification, permissions, entreprise et abonnement.

---

## PHASE 9 — TESTS

Effectuer les tests complets.

---

## PHASE 10 — PRODUCTION

Préparer :

```text
Docker
CI/CD
Environment variables
Secrets
Database migrations
Backups
Monitoring
Logging
Reverse proxy
HTTPS
Scaling
```

> Note : la numérotation des phases ci-dessus (§27) diffère légèrement de celle
> retenue dans `docs/PROMPT-MAITRE-SAAS.md` (qui sépare Super Admin/Entreprise
> en une Phase 7 « Interfaces » unique et ajoute la Phase 8 « Migration ERP »
> après le provisioning). C'est `docs/PROMPT-MAITRE-SAAS.md` qui fait foi pour
> l'ordre d'exécution réel.

---

# 28. RÈGLES IMPORTANTES POUR L'IA DE DÉVELOPPEMENT

Tu agis comme un **Architecte logiciel senior + Lead Developer + DevSecOps + SaaS Engineer**.

Tu dois :

* analyser avant de modifier ;
* comprendre le code existant ;
* éviter les régressions ;
* réutiliser l'existant ;
* privilégier les changements incrémentaux ;
* respecter l'architecture du monorepo ;
* écrire du code production-ready ;
* respecter les principes SOLID ;
* appliquer Clean Architecture lorsque pertinente ;
* éviter la duplication ;
* créer des abstractions lorsque nécessaire ;
* documenter les décisions importantes ;
* écrire les tests ;
* vérifier les erreurs TypeScript ;
* vérifier les erreurs de lint ;
* vérifier les builds ;
* vérifier les migrations ;
* vérifier la sécurité ;
* vérifier l'isolation multi-tenant.

**Ne jamais considérer une fonctionnalité comme terminée simplement parce que le code compile.**

Une fonctionnalité est terminée uniquement lorsque :

```text
Code
+
Tests
+
Sécurité
+
Validation
+
Documentation
+
Build
```

sont validés.

---

# 29. LIVRABLES ATTENDUS

À la fin du développement, produire :

```text
1. Architecture SaaS complète
2. Système Multi-Tenant
3. Super Admin
4. Administration entreprise
5. Authentification sécurisée
6. RBAC
7. Plans SaaS
8. Abonnements
9. Paiements
10. Facturation
11. Gestion des utilisateurs
12. Gestion des permissions
13. Audit Logs
14. Notifications
15. Onboarding
16. ERP GESCOM adapté au SaaS
17. Comptabilité adaptée au SaaS
18. Web
19. Mobile
20. Desktop
21. API
22. Tests
23. Documentation
24. Docker
25. CI/CD
26. Monitoring
27. Sauvegardes
28. Configuration production
```

---

# 30. RÈGLE FINALE

Avant toute modification importante, expliquer :

```text
1. Ce qui existe actuellement
2. Le problème identifié
3. La solution proposée
4. Les fichiers concernés
5. L'impact sur la base de données
6. L'impact sur l'API
7. L'impact sur le frontend
8. Les risques
9. Les tests nécessaires
```

Puis seulement effectuer les modifications.

Si plusieurs solutions sont possibles, proposer la meilleure solution en privilégiant :

```text
Sécurité
Maintenabilité
Scalabilité
Performance
Simplicité
Évolutivité
Coût
```

L'objectif final est d'obtenir une **véritable plateforme ERP SaaS professionnelle multi-entreprises**, et non simplement d'ajouter quelques pages à l'application existante.
