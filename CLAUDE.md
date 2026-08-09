# CLAUDE.md — Règles permanentes du projet

> Ce fichier est chargé automatiquement à chaque session Claude Code.
> Il contient les règles **non négociables**. La mission et les phases sont dans
> `docs/PROMPT-MAITRE-SAAS.md`.

---

## 1. Contexte

Plateforme ERP SaaS multi-entreprises (gestion commerciale + comptabilité),
construite **from scratch** (aucun code legacy à auditer — voir `docs/adr/`
pour la décision). Priorité : construire une base saine dès la Phase 0/1,
puisqu'il n'y a pas de dette technique héritée à composer avec.

Marché cible : Sénégal / Afrique de l'Ouest (UEMOA).

Dépôt distant : `https://github.com/libasse27/erp_gescom_compta_saas.git`
(remote configuré, aucun push automatique sans accord explicite).

---

## 2. Stack et commandes

```yaml
runtime:        Node.js >= 20
langage:        TypeScript 5.6 (strict: true)
monorepo:       pnpm workspaces + Turborepo — gestionnaire: pnpm 9.12
api:            NestJS 10 (Express platform)
base_donnees:   PostgreSQL 16 + Prisma
web:            Next.js 15 (App Router)
mobile:         à trancher en Phase 9 (ADR à venir)
desktop:        à trancher en Phase 9 (ADR à venir)
etat_serveur:   à trancher en Phase 7 (TanStack Query pressenti)
ui:             à trancher en Phase 7 (Tailwind + shadcn/ui pressenti)
tests:          Jest + Supertest (API) — Playwright (E2E) à mettre en place Phase 9/10
```

Commandes de vérification (Claude DOIT les exécuter avant de déclarer une tâche terminée) :

```bash
pnpm install
pnpm typecheck      # tsc --noEmit sur tout le monorepo (turbo run typecheck)
pnpm lint
pnpm test
pnpm test:tenant    # suite dédiée isolation multi-tenant (voir §5) — créée en Phase 3
pnpm build
```

---

## 3. Garde-fous — Claude s'ARRÊTE et demande validation avant

- toute suppression de fichier, de modèle, de table ou de champ ;
- toute migration Prisma **destructive ou irréversible** ;
- toute réécriture d'un module métier existant (> 200 lignes modifiées) ;
- tout ajout de dépendance non triviale (justifier : pourquoi, poids, alternative) ;
- tout changement de contrat d'API public (breaking change) ;
- toute modification touchant l'authentification, les rôles ou la facturation ;
- tout `git push`, en particulier vers `origin` (dépôt GitHub déjà configuré).

Interdits absolus :

- committer un secret, une clé API, un `.env` ;
- exécuter une commande sur une base de production ;
- `git push --force`, `git reset --hard` sur une branche partagée ;
- désactiver un test qui échoue au lieu de corriger la cause ;
- utiliser `as any`, `@ts-ignore` ou `eslint-disable` pour faire passer un build.

---

## 4. Définition de « terminé »

Une tâche n'est **jamais** terminée parce que le code compile. Elle l'est quand :

| # | Critère | Preuve |
|---|---------|--------|
| 1 | Code écrit et typé strictement | `typecheck` OK, aucun `any` implicite |
| 2 | Tests unitaires + intégration | `test` OK, chemins nominal ET erreur couverts |
| 3 | Isolation tenant vérifiée | `test:tenant` OK sur les nouveaux endpoints |
| 4 | Autorisation vérifiée | test « utilisateur sans permission → 403 » |
| 5 | Validation d'entrée | schéma Zod (`@erp/validation`) sur chaque DTO |
| 6 | Lint | `lint` OK, zéro warning nouveau |
| 7 | Build | `build` OK sur toutes les apps impactées |
| 8 | Migration | `prisma migrate dev` **et** rollback testés sur base de dev |
| 9 | Documentation | `docs/` mis à jour + ADR si décision structurante |
| 10 | Commit | conventional commit, atomique, message en français |

Si un critère ne peut pas être satisfait, Claude le **déclare explicitement** au lieu
de prétendre que la tâche est finie.

---

## 5. Multi-tenancy — règle la plus critique du projet

L'isolation ne repose **jamais** sur la discipline du développeur. Elle est **structurelle**.

### Contexte de requête

Le `tenantId` provient **uniquement** du JWT vérifié côté serveur, jamais du body,
des query params, des headers ou d'un état frontend. Il est propagé via
`AsyncLocalStorage` (`TenantContext`), pas passé en paramètre de fonction en fonction.

```
Requête → AuthGuard (vérifie JWT)
        → TenantContext.run({ tenantId, userId, roles, planFeatures })
        → Contrôleur → Service → Repository (scope automatique)
```

### Application au niveau données (PostgreSQL + Prisma)

Row Level Security activée sur chaque table tenant (`FORCE ROW LEVEL SECURITY`),
policy basée sur `current_setting('app.tenant_id')`, positionné **par transaction**
(`SET LOCAL app.tenant_id = '<uuid>'` en tête de chaque transaction Prisma).
L'utilisateur applicatif Postgres ne doit **pas** être `superuser` ni propriétaire
des tables (sinon RLS est contournée par défaut).

En complément, un repository de base scopé côté Prisma (middleware `$extends` ou
Client Extension) refuse toute requête sur un modèle tenant exécutée hors
`TenantContext` — défense en profondeur, la RLS reste la garantie ultime côté base.

### Interdits

- accès direct au `PrismaClient` depuis un contrôleur ou un service métier ;
- une requête Prisma sur un modèle tenant en dehors d'un repository ;
- un `tenantId` reçu du client et utilisé tel quel ;
- une route Super Admin qui traverse les tenants sans passer par un
  `CrossTenantRepository` explicite, journalisé dans l'audit log ;
- un rôle applicatif Postgres `superuser`/propriétaire de table utilisé par l'API.

### Suite `test:tenant` (obligatoire, bloquante en CI — créée en Phase 3)

1. Un utilisateur du tenant A reçoit 404 (pas 403) sur une ressource du tenant B.
2. Une requête forgée avec `tenantId` de B dans le body reste scopée sur A.
3. Toute liste retournée par un endpoint ne contient que des documents de A
   (test générique appliqué à **tous** les endpoints de liste).
4. Une requête hors `TenantContext` lève une erreur au lieu de tout retourner.
5. Un `ADMIN` du tenant A ne peut jamais s'attribuer `SUPER_ADMIN` via l'API.

---

## 6. Sécurité — invariants

- Le backend ne fait **jamais** confiance à : `tenantId`, `userId`, `role`,
  `permissions`, `planId`, `status`. Tout est re-résolu côté serveur.
- Mots de passe : argon2id (ou bcrypt coût ≥ 12). Jamais de hash maison.
- JWT access court (≤ 15 min) + refresh token **rotatif**, stocké haché, révocable,
  avec détection de réutilisation (= compromission → révocation de la famille).
- MFA obligatoire pour `SUPER_ADMIN`. Le premier Super Admin est créé par un
  script CLI seedé (`prisma/seed.ts` ou équivalent), **jamais** via une route HTTP.
- Rate limiting : global, par IP, par compte, plus strict sur `/auth/*`.
- Réponses d'erreur d'authentification uniformes (pas d'énumération de comptes).
- Audit log immuable (append-only) pour : connexion, échec de connexion, gestion
  utilisateurs, changement de rôle/permission, changement de plan, paiement,
  suspension, export de données, accès cross-tenant.
- Chiffrement au repos des champs sensibles ; secrets via variables d'environnement
  ou gestionnaire de secrets, jamais en dur.
- Headers de sécurité (helmet), CORS en liste blanche stricte, HTTPS obligatoire.

---

## 7. Contexte régional (Sénégal / UEMOA)

- Devise : **XOF (FCFA)**, entier sans décimale. Montants stockés en **entiers**
  (jamais en `float`, colonnes Prisma en `Int` ou `BigInt`). Formatage via
  l'utilitaire unique `formatFCFA()` (`packages/utils`).
- Locale par défaut `fr-SN`, timezone `Africa/Dakar`, interface en **français**.
- Comptabilité : plan comptable **SYSCOHADA révisé**. TVA 18 %. Retenues et
  taxes locales paramétrables par entreprise, jamais codées en dur.
- Identifiants légaux : **NINEA**, **RCCM** — validation de format, unicité par pays.
- Paiement : **Wave**, **Orange Money**, **Free Money** en priorité ; carte/Stripe
  ensuite. Contraintes réseau 3G/4G intermittent → penser reprise et idempotence.

---

## 8. Conventions de code

- TypeScript `strict`. Types partagés dans `packages/types`, jamais dupliqués
  entre `api`, `web`, `mobile`, `desktop`.
- Validation dans `packages/validation` (schémas Zod partagés front/back).
- Permissions dans `packages/permissions` (source unique de vérité, typée).
- Architecture par couches (NestJS) : `controller` (HTTP) → `service` (métier) →
  `repository` (Prisma). Aucune logique métier dans un contrôleur, aucun accès
  base dans un service.
- Erreurs : classes d'erreur typées + filtre d'exception global NestJS. Jamais de
  `throw new Error("...")` nu dans une route.
- Nommage : code et commentaires en **anglais**, textes utilisateur et documentation
  en **français**.
- Commits : `feat|fix|refactor|test|docs|chore(scope): message`, un commit = un
  changement cohérent.

---

## 9. Méthode de travail

- **Analyser avant de modifier.** Lire les fichiers concernés, ne pas supposer.
- **Incrémental.** Petits changements vérifiables plutôt qu'une grande refonte.
- **Réutiliser l'existant** plutôt que réécrire. Toute réécriture doit être justifiée.
- Ne pas lire tout le dépôt : cibler les fichiers pertinents, utiliser des sous-agents
  pour l'exploration large, résumer les découvertes dans `docs/`.
- Toute décision structurante → un ADR dans `docs/adr/NNNN-titre.md`
  (contexte, options envisagées, décision, conséquences).
- Ne pas produire de résumé narratif à chaque étape : montrer le diff et le
  résultat des vérifications.
