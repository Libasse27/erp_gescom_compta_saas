# PROJECT-AUDIT.md — Synthèse Phase 9.5.1

> Consolidation des 10 audits de domaine ci-dessous. Aucune correction n'a été
> appliquée durant cette phase — audit uniquement, conformément à la consigne
> du prompt maître (§45). Chaque agent a vérifié directement le code source,
> les migrations, les tests, et a exécuté les commandes de vérification
> lorsque c'était pertinent — aucun constat n'est basé sur un message de
> commit ou un rapport d'avancement pris pour argent comptant.

Fichiers sources :

- `docs/audit/SECURITY-AUDIT.md`
- `docs/audit/MULTI-TENANT-AUDIT.md`
- `docs/audit/RBAC-AUDIT.md`
- `docs/audit/BILLING-AUDIT.md`
- `docs/audit/ERP-AUDIT.md`
- `docs/audit/ACCOUNTING-AUDIT.md`
- `docs/audit/WEB-AUDIT.md`
- `docs/audit/MOBILE-AUDIT.md`
- `docs/audit/DESKTOP-AUDIT.md`
- `docs/audit/PRODUCTION-READINESS.md`
- `docs/audit/TEST-AUDIT.md`

---

## 1. Comptage agrégé par sévérité

| Domaine | CRITICAL | HIGH | MEDIUM | LOW | INFO |
|---|---|---|---|---|---|
| Sécurité (auth/MFA/logs/secrets) | 0 | 5 | 8 | 8 | 3 |
| Multi-tenant / RLS | 0 (voir §2, reclassé) | 1 | 5 | 3 | 2 |
| RBAC / permissions | 0 | 1 | 6 | 3 | 1 |
| Paiements / abonnements / webhooks | 0 | 5 | 9 | 5 | 3 |
| Modules ERP (7 modules) | 0 | 1 | 4 | 1 | 0 |
| Comptabilité SYSCOHADA | 1 | 2 | 3 | 1 | 2 (+4 À VALIDER MÉTIER) |
| Web (Next.js) | 1 | 1 | 2 | 1 | 0 |
| Mobile offline-first | 1 | 1 | 4 | 1 | 2 |
| Desktop (Electron) | 1 | 2 | 1 | 1 | 1 |
| Production-readiness (Docker/CI/monitoring) | 0 | 2 | 4 | 2 | 1 |
| Tests (exécution réelle) | 1 (fiabilité pipeline) | — | — | — | — |
| **TOTAL** | **5** (6 avec reclassement §2) | **21** (20 avec reclassement) | **46** | **26** | **15** (+4 À VALIDER MÉTIER) |

---

## 2. Reclassement de synthèse

Un constat a été noté HIGH par l'agent spécialisé mais est reclassé **CRITICAL**
dans cette synthèse, car il touche directement la garantie que CLAUDE.md §5
qualifie explicitement de « règle la plus critique du projet » et d'interdit
absolu :

- **MT-01** — `PrismaService` se connecte avec l'utilisateur `POSTGRES_USER`,
  qui est le **superuser propriétaire des tables**. La RLS ne s'applique donc
  pas pour les 10 classes qui injectent `PrismaService` directement
  (`AuthService`, `NotificationsService`, `InvitationsService`,
  `PaymentWebhookService`, `AuditLogService`…). La RLS elle-même est bien
  conçue (27 tables `FORCE ROW LEVEL SECURITY`, `set_config` par transaction,
  rôle `erp_app_tenant` non-superuser vérifié par test) — c'est la
  **configuration de connexion** qui contourne la garantie, exactement le
  scénario que CLAUDE.md §5 interdit explicitement.

Aucun autre reclassement n'a été jugé nécessaire — les autres avis de sévérité
des agents spécialisés sont conservés tels quels.

---

## 3. CRITICAL — à traiter en premier

| ID | Domaine | Constat | Fichier(s) |
|---|---|---|---|
| MT-01 | Multi-tenant | RLS contournée : connexion Prisma via le rôle superuser/propriétaire des tables | `apps/api/src/*` (10 classes), config `DATABASE_URL` |
| BIL-01 | Paiements | Idempotence webhook non atomique → double facturation possible sur rejeu (comportement normal Mobile Money) | `apps/api/src/payments/payments-webhook.service.ts:44-46,59,74` |
| ACC-01 | Comptabilité | Débit = crédit non vérifié en base (ni CHECK ni trigger), seulement au niveau Zod HTTP | `apps/api/src/accounting/journal.repository.ts:52-99` |
| ERP-001 / MOBILE-001 | ERP + Mobile | Aucune idempotence sur les mutations Stock/Ventes/Achats/Facturation, y compris la file de mutations offline mobile → doublons réels de documents financiers sur retry réseau | `apps/mobile/src/lib/offline/mutation-queue.ts:104-128` + endpoints API concernés |
| D-01 | Desktop | URL API figée à `localhost:3000` au build → tout paquet desktop distribué est inutilisable hors poste de dev | `apps/desktop/scripts/package.js:33` |
| WEB-001 | Web | `test`/`test:tenant` sont des stubs `exit 0` → succès trompeur en CI, zéro couverture réelle sur tout le frontend web | `apps/web/package.json:11-12` |
| TEST-CRITICAL-1 | Fiabilité tests | `pnpm test`/`test:tenant` échouent à 100 % côté API sans bootstrap manuel de Docker/Postgres — aucun `pretest` ne le vérifie, risque de masquer silencieusement une régression en CI | racine du monorepo |

Notes complémentaires directement liées à ces CRITICAL :
- **SEC-03 / BIL-04** (HIGH dans les rapports source, mais à traiter dans le
  même lot) : `EnterpriseStatus` n'est lu nulle part dans `apps/api/src`, et
  `User.status` n'est vérifié ni au login ni au refresh — un compte ou une
  entreprise suspendus conservent l'accès complet. Cela invalide une partie
  du critère de succès §46 du prompt maître (« un abonnement contrôle
  réellement les fonctionnalités »).
- **RBAC-01** (HIGH) : `PermissionsGuard`, `FeatureGuard`, `LimitGuard` sont
  fail-open (autorisent par défaut si aucun décorateur trouvé). Aucune route
  n'exploite ce défaut aujourd'hui, mais c'est une mine structurelle pour
  toute future route mal décorée.
- **SEC-04** (HIGH) : jetons bruts de réinitialisation de mot de passe / invitation
  partent en clair dans les logs de production (`ConsoleMailSender` sans
  bascule d'environnement) → prise de compte via simple accès en lecture aux
  logs agrégés.

---

## 4. Constats positifs vérifiés (pas pris pour acquis)

- RLS réellement implémentée sur 27 tables avec `FORCE ROW LEVEL SECURITY` et
  `set_config` par transaction (le mécanisme est solide — seul le rôle de
  connexion casse la garantie, cf. MT-01).
- Signature HMAC des webhooks de paiement vérifiée en temps constant avant
  tout traitement ; `enterpriseId`/`subscriptionId` toujours relus depuis la
  base, jamais acceptés du payload.
- Tous les montants financiers en `Int`/`BigInt`, aucun `Float`.
- Écritures comptables immuables après création (pas de PATCH/DELETE exposé).
- Numérotation de facture sûre en concurrence.
- Purge du cache offline mobile au logout/expiration de session vérifiée
  saine sur les 4 chemins de code (cold start, échec refresh, logout,
  exception de restauration) — aucune fuite cross-utilisateur trouvée.
- Frontend web : aucun `tenantId`/`enterpriseId` client détecté (grep
  exhaustif = 0 résultat), token d'accès en mémoire, refresh httpOnly
  rotatif, guards de route explicitement documentées comme UX-only.
- Backup/restore Postgres : chiffrement `age` réel (clé privée jamais sur le
  VPS), restauration effectivement exercée avec vérification RLS
  post-restauration — preuve concrète, pas une allégation.
- HTTPS/Caddy : redirection HTTP→HTTPS vérifiée, helmet actif, CORS en liste
  blanche.
- Aucun secret commité trouvé sur l'ensemble du dépôt.
- `pnpm typecheck`, `pnpm lint`, `pnpm build` passent tous à 0 erreur sur tout
  le monorepo.
- Les 5 scénarios `test:tenant` obligatoires de CLAUDE.md §5 : 4/5 couverts
  réellement (404 vs 403, tenantId forgé ignoré, hors-TenantContext lève une
  erreur, auto-promotion SUPER_ADMIN bloquée par DTO Zod + contrainte CHECK
  Postgres) ; le 5ᵉ (couverture générique de toutes les listes) est couvert
  par duplication module par module plutôt que par un test factorisé — un
  futur endpoint de liste pourrait échapper à la vérification (MEDIUM).

---

## 5. À VALIDER MÉTIER (comptabilité, ne pas trancher techniquement)

Quatre points réglementaires ne peuvent pas être vérifiés par la lecture du
code seul et nécessitent un professionnel comptable SYSCOHADA/UEMOA :
numérotation exacte du plan comptable, exonérations TVA, règles de retenue à
la source, obligations légales de journaux/clôture d'exercice. Détail dans
`docs/audit/ACCOUNTING-AUDIT.md`.

---

## 6. Blocages production (au sens §37 du prompt maître)

Le projet **ne peut pas** être déclaré production-ready en l'état :

- Isolation tenant : mécanisme solide mais **contourné par la configuration
  de connexion** sur des chemins sensibles (auth, paiements, audit log).
- Paiements : webhook non idempotent en conditions de concurrence réelle.
- Comptabilité : invariant partie double non garanti en base.
- Continuité réseau (marché cible 3G/4G intermittent, CLAUDE.md §7) :
  absence totale d'idempotence sur les mutations critiques, API et mobile.
- Desktop : paquet distribuable non fonctionnel par construction hors poste
  de build.
- Web : zéro test réel, masqué par un stub qui « réussit » toujours.
- Monitoring/alerting : absent au-delà des logs et du `/health` basique —
  aucune alerte sur échec paiement, échec webhook, 5xx, latence.
- Suspension d'entreprise/compte : non appliquée dans le code malgré un
  modèle de données qui la prévoit.

Ce qui est en revanche déjà solide et ne nécessite pas de reprise : backup/
restore Postgres (chiffré, testé réellement), HTTPS/Caddy, pipeline CI
bloquant de base (typecheck/lint/build/test/test:tenant), absence de secret
commité, architecture technique des 7 modules ERP (permissions, tenant
scoping, validation Zod, pagination).

---

## 7. Ordre de correction recommandé

Suivant l'arbitrage de CLAUDE.md §42 (Sécurité → Maintenabilité →
Scalabilité → Performance → Simplicité → Coût) et le §38 du prompt maître :

1. **MT-01** — faire fonctionner l'API sous un rôle Postgres applicatif non
   superuser/non-propriétaire (`erp_app_tenant` existe déjà pour les
   requêtes tenant-scopées — le sujet est de l'utiliser partout où
   `PrismaService` est injecté, ou de documenter/justifier explicitement les
   exceptions légitimes type lookup de login par email).
2. **RBAC-01 + SEC-04 + SEC-03/BIL-04** — durcir les guards en fail-closed,
   couper la fuite de jetons dans les logs, appliquer réellement
   `EnterpriseStatus`/`User.status`. Ce sont des changements ciblés, peu de
   lignes, fort impact sécurité.
3. **BIL-01 + ACC-01 + ERP-001/MOBILE-001** — traiter l'idempotence comme un
   seul sujet transversal (clé d'idempotence sur les mutations API +
   contrainte compare-and-swap sur le webhook + contrainte DB pour
   l'équilibre débit/crédit), plutôt que quatre correctifs isolés.
4. **TEST-CRITICAL-1** — sécuriser le pipeline de test (bootstrap Docker
   automatique ou détection claire d'échec) pour que les futures régressions
   sur les points 1-3 soient réellement détectées.
5. **WEB-001** — combler la couverture de tests web (au minimum
   Login/MFA/Facturation), remplacer les stubs `exit 0`.
6. **D-01** — corriger l'injection de `NEXT_PUBLIC_API_URL` dans le
   packaging desktop, puis vérifier sur une machine tierce propre.
7. **P-08 + gaps production-readiness** — monitoring/alerting minimal, scan
   sécurité en CI, healthcheck `web`, limites de ressources Docker.
8. **Comptabilité — points À VALIDER MÉTIER** — à faire trancher par un
   professionnel comptable en parallèle des points ci-dessus (ne bloque pas
   le reste du code).

Chaque étape doit suivre le protocole CLAUDE.md §9/§39 : lecture avant
modification, changement incrémental, `typecheck`+`lint`+`test`+`test:tenant`+
`build` après chaque étape, commit atomique par unité cohérente. Les points 1
et 2 touchent l'authentification/les rôles — CLAUDE.md §3 impose un arrêt et
une validation explicite avant d'y toucher.
