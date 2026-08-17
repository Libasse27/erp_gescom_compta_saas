# Audit — Frontend web (Next.js 15 App Router, `apps/web`)

Date : 2026-08-16
Périmètre : `apps/web/src` (App Router, BFF `route.ts`, hooks TanStack Query,
formulaires, design system local), croisé avec `packages/types`,
`packages/utils`, `packages/validation`.
Méthode : lecture directe du code source, aucune confiance accordée aux
messages de commit. `pnpm --filter @erp/web typecheck` et
`pnpm --filter @erp/web lint` exécutés réellement (résultats rapportés
ci-dessous, aucune correction appliquée).

Flux couverts par la consigne d'audit et statut constaté :

| Flux | Route(s) | Existe et fonctionnel (vrais appels API) |
|---|---|---|
| Register | `(auth)/register` | Oui — formulaire 3 étapes, appel `/plans`, `useAuth().register` |
| Login | `(auth)/login` | Oui |
| MFA | `(auth)/login` (étape intégrée) + `api/session/mfa-verify` | Oui |
| Dashboard | `app/page.tsx` | Partiel — page d'accueil = onboarding uniquement, aucune statistique métier (assumé et commenté comme tel dans le code) |
| Clients | `app/clients` | Oui — liste paginée, recherche, filtre, création/édition, désactivation |
| Produits | `app/products` | Oui |
| Ventes | `app/sales` | Oui |
| Achats | `app/purchases` | Oui |
| Stock | `app/stock` | Oui — niveaux + mouvements |
| Facturation | `app/invoicing` | Oui — liste, détail, marquage payé |
| Comptabilité | `app/accounting` | Oui — plan comptable, écritures, balance |
| Rapports | `app/reports` | Oui — ventes/achats/compte de résultat par période |
| Users | `app/users` | Oui — liste + invitation |
| Subscription | `app/subscription` | Oui — lecture seule |
| Logout | `AppSidebar` → `api/session/logout` | Oui |

Note hors périmètre demandé mais découverte pendant l'audit : les 9 pages
sous `super-admin/*` (Users, Subscriptions, Settings, Plans, Payments,
Notifications, Logs, Invoices, Audit) sont **toutes** des stubs
`<ComingSoon />` honnêtes (aucune donnée inventée), pas des flux terminés.
Ce n'est pas un défaut en soi — juste un rappel que « super-admin » et
« espace entreprise » (`/app/*`, le périmètre réellement audité ici) sont à
des stades très différents.

---

## AUDIT-WEB-001 — Aucun test pour `apps/web` : les scripts `test`/`test:tenant` sont des stubs qui « réussissent » toujours

**Sévérité** : CRITICAL
**Composant** : `apps/web` (globalement — CI/DoD)

**Description** : `apps/web/package.json` définit :
```json
"test": "echo \"no tests yet\" && exit 0",
"test:tenant": "echo \"no tests yet\" && exit 0"
```
Recherche exhaustive de fichiers `*.test.*` / `*.spec.*` / config Playwright
sous `apps/web` : **aucun résultat**. Aucun composant n'a de test unitaire,
de test comportemental (Testing Library) ni de test E2E. Aucune config
Playwright n'existe nulle part dans le dépôt (le seul module testé du
frontend est `apps/mobile`, qui a 16 fichiers `.spec.ts`). Storybook est
absent également (aucune story trouvée dans `apps/web`).

Comme les deux scripts sortent avec le code `0` sans rien exécuter, une CI
qui appelle `pnpm test` / `pnpm test:tenant` sur ce workspace rapportera un
succès trompeur — indistinguable d'une vraie suite verte.

**Impact** : aucune régression n'est détectée automatiquement sur les flux
critiques (connexion, MFA, création de facture/écriture comptable,
désactivation client). CLAUDE.md §4 (Définition de « terminé », critères 2 et
3) et le mandat de l'agent Frontend (règle d'or #8 : « Aucun composant livré
sans test et sans entrée Storybook ») sont tous deux violés sur l'intégralité
du frontend web livré à ce jour.

**Risque** : élevé. Le module comptabilité/facturation (montants FCFA,
statuts de facture, balance) est le plus exposé — une régression silencieuse
sur `markPaidMutation`, la pagination des écritures ou le calcul affiché
côté client ne serait détectée qu'en production.

**Fichiers** :
- `apps/web/package.json:11-12`
- (absence constatée) aucun fichier sous `apps/web/src` ne matche
  `*.test.*`, `*.spec.*` ; aucun `playwright.config.*` dans le dépôt.

**Solution** : mettre en place Vitest + Testing Library + MSW pour
`apps/web` (les handlers MSW peuvent être dérivés des mêmes schémas Zod que
`packages/validation`), au minimum sur les flux Login/MFA, Clients et
Facturation (mutation d'argent). Ajouter Playwright avec un parcours E2E
« connexion → émission de facture » comme l'exige CLAUDE.md
(`tests: ... Playwright (E2E) à mettre en place Phase 9/10`). Remplacer les
scripts stub par de vraies commandes une fois la première suite en place —
ne jamais laisser `exit 0` inconditionnel dans un script nommé `test`.

**Priorité** : P0
**Statut** : PARTIEL (2026-08-17) — `apps/web` a maintenant une infrastructure
de test réelle (Jest + `next/jest` + Testing Library, pas Vitest comme suggéré
ci-dessus : choix délibéré pour rester cohérent avec `apps/api`/`apps/mobile`,
qui utilisent déjà Jest — éviter un second framework de test sans nécessité).
`pnpm --filter @erp/web test` exécute désormais 3 suites / 13 tests réels
(plus de stub `exit 0`) : `AuthProvider` (refresh silencieux, login
succès/échec, MFA, logout — `src/lib/session/auth-provider.spec.tsx`),
`ProtectedRoute` (redirection non authentifié, affichage authentifié —
`src/lib/session/protected-route.spec.tsx`), et la page de connexion
bout-en-bout (`src/app/(auth)/login/page.spec.tsx` : rejet Zod d'un email
invalide, connexion réussie avec redirection `/app`/`/super-admin` selon
`isSuperAdmin`, bascule vers le formulaire MFA, message d'erreur serveur).
Deux vrais bugs trouvés et corrigés en écrivant ces tests (pas seulement des
suppositions) : `components/ui/input.tsx` n'était pas enveloppé dans
`React.forwardRef`, cassant silencieusement `field.ref` de react-hook-form ;
aucun `<form>` de l'application ne déclarait `noValidate`, donc la validation
HTML5 native (`type="email"`) bloquait la soumission avant que Zod/RHF ne
s'exécute — corrigé uniquement sur la page de connexion (périmètre de ce
correctif), les autres formulaires métier ont probablement le même
comportement et restent à corriger séparément.
`test:tenant` reste un stub, mais désormais justifié explicitement (comme
`apps/desktop`) plutôt que silencieux : le web ne lit/n'écrit jamais
`tenantId` côté client.
**Reste ouvert** : Clients/Facturation (les flux à plus fort risque financier
cités dans "Risque" ci-dessus) n'ont toujours aucun test, ni `packages/validation`
ni `packages/utils/format-fcfa.ts` (voir `TEST-AUDIT.md` MAJOR-1/2/3) ; aucun
Playwright/E2E ; pas de MSW (les tests actuels mockent `global.fetch`
directement, suffisant à ce périmètre mais pas généralisé).

---

## AUDIT-WEB-002 — `formatFCFA()` de `@erp/utils` existe mais n'est importé nulle part : 11 réimplémentations locales divergentes du formatage monétaire

**Sévérité** : HIGH
**Composant** : formatage monétaire, toutes les pages `app/*` affichant des montants + page d'inscription

**Description** : `packages/utils/src/format-fcfa.ts` exporte `formatFCFA()`
et son propre commentaire dit explicitement : « Source unique — évite la
duplication déjà présente sur ~10 pages web (...) pour tout nouveau
consommateur, mobile compris. » Ce package est bien une dépendance déclarée
de `@erp/web` (`apps/web/package.json:16`, `"@erp/utils": "workspace:*"`).
Or aucune page ne l'importe : chaque page redéfinit sa propre fonction locale
`formatFCFA(amount)` identique par copier-coller —
`${amount.toLocaleString("fr-SN")} FCFA` — et une page (inscription) fait
même l'appel `toLocaleString` en ligne sans aucune fonction :

- `apps/web/src/app/(auth)/register/page.tsx:310` (inline, sans fonction)
- `apps/web/src/components/journal-entry-form.tsx:27-28`
- `apps/web/src/components/invoice-form.tsx:19-20`
- `apps/web/src/app/app/accounting/page.tsx:14-15`
- `apps/web/src/app/app/subscription/page.tsx:11-12`
- `apps/web/src/app/super-admin/page.tsx:6-7`
- `apps/web/src/app/app/sales/page.tsx:18-19`
- `apps/web/src/app/app/invoicing/page.tsx:18-19`
- `apps/web/src/app/app/reports/page.tsx:8-9`
- `apps/web/src/app/app/products/page.tsx:24-25`
- `apps/web/src/app/app/purchases/page.tsx:18-19`

**Impact** : deux implémentations existent en parallèle avec la même
signature. Aujourd'hui elles produisent le même résultat, mais rien
n'empêche une dérive future (ex. `packages/utils` migré vers
`Intl.NumberFormat` avec `style: "currency"` pour corriger un cas limite —
espace insécable, gestion de `0`/négatif — sans que les 11 copies locales
suivent). C'est exactement le scénario que le commentaire du package a été
écrit pour prévenir, et qui s'est produit malgré tout côté web.

**Risque** : moyen à court terme (affichage), mais dette qui grandit à chaque
nouvelle page copiant le même motif au lieu d'importer le paquet partagé —
déjà 11 sites de duplication.

**Solution** : remplacer les 11 définitions locales par
`import { formatFCFA } from "@erp/utils";` et supprimer l'import obsolète de
`toLocaleString` direct dans `register/page.tsx:310`. Changement mécanique,
à faible risque, testable par un test de composant simple par page une fois
AUDIT-WEB-001 traité.

**Priorité** : P1
**Statut** : OUVERT

---

## AUDIT-WEB-003 — État « non autorisé » jamais distingué : toutes les erreurs (401/403/5xx/réseau) sont fondues dans un message générique

**Sévérité** : MEDIUM
**Composant** : toutes les vues de liste (`useCustomers`, `useProducts`, `useSales`, `usePurchases`, `useInvoices`, `useAccounts`, `useJournalEntries`, `useStock`, `useEnterpriseUsers`, `useMySubscription`, etc.)

**Description** : chaque page traite l'échec de requête via un seul booléen
`isError` (ex. `apps/web/src/app/app/clients/page.tsx:122` :
`{customersQuery.isError && <p>Impossible de charger les clients.</p>}`).
Aucune page n'inspecte le code HTTP retourné (401 vs 403 vs 500 vs coupure
réseau) pour afficher un état « Vous n'avez pas accès à cette ressource »
distinct d'une simple panne technique. `ApiClientError`
(`apps/web/src/lib/api-client.ts:6`) ne porte pas le `status` HTTP, seulement
un message texte extrait du corps — l'information est donc perdue avant
même d'atteindre le composant.

**Impact** : un utilisateur dont les permissions viennent d'être révoquées
(ou un compte d'un rôle insuffisant qui atteint une page via un lien direct
malgré le masquage du menu) voit exactement le même message qu'en cas de
panne réseau — expérience confuse, et impossibilité pour l'équipe support de
distinguer les deux cas depuis un rapport utilisateur.

**Risque** : faible en sécurité (le serveur reste seul juge, confirmé —
voir points positifs ci-dessous), mais réel en qualité d'UX/support, et c'est
un critère explicite de la Definition of Done de l'agent Frontend (« Cinq
états traités : chargement, vide, erreur, succès, non autorisé »).

**Fichiers** : `apps/web/src/lib/api-client.ts:6-24` (perte du status),
tous les fichiers `apps/web/src/app/app/*/page.tsx` (traitement `isError`
générique, motif répété).

**Solution** : porter `res.status` sur `ApiClientError`, puis dans chaque
page distinguer `error.status === 403` (« Vous n'avez pas accès à ce
module ») du reste. Peut être centralisé dans un composant `<QueryState>`
partagé plutôt que dupliqué à nouveau page par page.

**Priorité** : P2
**Statut** : OUVERT

---

## AUDIT-WEB-004 — Types de données dupliqués localement au lieu d'être partagés depuis `packages/types` (et re-dupliqués côté mobile)

**Sévérité** : MEDIUM
**Composant** : hooks `lib/queries/*`

**Description** : `packages/types/src` ne contient que `auth.ts` (et
`index.ts`) — seuls les types d'authentification (`CurrentUser`, etc.) et
`Customer`/`StockLevel`/`SalesInvoiceStatus` (utilisés côté clients/stock/
invoicing) proviennent bien de `@erp/types`. En revanche, plusieurs DTOs
sont définis en interface TypeScript locale directement dans le fichier de
hook, sans passer par le paquet partagé — par exemple :

- `apps/web/src/lib/queries/use-my-subscription.ts:5-16` (`MySubscription`)
- `apps/web/src/lib/queries/use-enterprise-users.ts:5-13` (`EnterpriseUserSummary`)
- `apps/web/src/lib/queries/use-roles.ts:5-8` (`RoleSummary`)
- `apps/web/src/lib/queries/use-customers.ts:6-11` (`CustomerListResponse`,
  l'enveloppe de pagination elle-même, pas seulement `Customer`)

Confirmation croisée : `apps/mobile/src/lib/queries/use-customers.ts` définit
sa propre interface `CustomerListResponse`/`CustomersFilters` séparément —
la même forme est donc maintenue à la main à deux endroits du monorepo.

**Impact** : si l'API change la forme d'une de ces réponses (ex. ajout d'un
champ `cancelReason` sur l'abonnement), rien ne force une erreur de
compilation côté web ou mobile — c'est justement ce que le contrat
OpenAPI/types générés est censé garantir (règle d'or #5 de l'agent
Frontend : « Toute donnée affichée provient d'un type généré depuis
l'OpenAPI, jamais écrit à la main »).

**Risque** : moyen — pas une faille de sécurité, mais un point de friction
qui grandit avec chaque nouveau module et augmente le risque de divergence
silencieuse entre web/mobile/API.

**Solution** : étendre `packages/types` (ou la génération depuis l'OpenAPI,
si en place côté `architect`/`backend`) pour couvrir Subscription,
EnterpriseUser, Role et les enveloppes de pagination génériques, puis faire
pointer web et mobile sur la même source.

**Priorité** : P2
**Statut** : OUVERT

---

## AUDIT-WEB-005 — `verify-email` viole le motif BFF documenté par le code lui-même (`apiFetch` appelé depuis un composant client, via `useEffect`)

**Sévérité** : LOW
**Composant** : `apps/web/src/app/(auth)/verify-email/page.tsx`

**Description** : `apps/web/src/lib/api.ts:10-11` documente explicitement :
« Utilisé uniquement côté serveur (Route Handlers) pour parler à l'API
NestJS — jamais depuis un composant client (docs/adr/0011-...). » Or
`verify-email/page.tsx` est marqué `"use client"` (ligne 1) et appelle
`apiFetch("/auth/verify-email", ...)` directement dans un `useEffect`
(lignes 3, 6, 20). C'est aussi le seul endroit du frontend web où un appel
réseau de chargement de données passe par `useEffect` + `fetch` plutôt que
TanStack Query ou un Route Handler `/api/session/*` — motif que l'agent
Frontend liste explicitement comme anti-pattern rejeté.

**Impact** : fonctionne aujourd'hui uniquement parce que
`NEXT_PUBLIC_API_URL` est une variable publique et que l'API doit donc déjà
accepter du CORS cross-origin pour ce cas précis — une hypothèse
d'architecture non vérifiée dans ce périmètre d'audit (à confirmer côté
`backend`). Toute évolution qui resserrerait le CORS de l'API NestJS
casserait silencieusement cette seule page.

**Risque** : faible (page à faible trafic, lien à usage unique), mais
incohérence architecturale qui peut servir de mauvais exemple copié dans un
futur flux plus sensible.

**Fichiers** : `apps/web/src/app/(auth)/verify-email/page.tsx:1-41`,
`apps/web/src/lib/api.ts:10-11` (contradiction).

**Solution** : ajouter un Route Handler `api/session/verify-email/route.ts`
suivant le même patron que `login`/`mfa-verify`, et faire de
`VerifyEmailStatus` un composant qui l'appelle via `useMutation` (déclenché
au montage) plutôt qu'un `useEffect` + `fetch` brut.

**Priorité** : P3
**Statut** : OUVERT

---

## Constats positifs (vérifiés directement, pas pris pour acquis)

- **Aucun `tenantId`/`enterpriseId` client** : recherche exhaustive
  (`grep -rn "tenantId|enterpriseId" apps/web/src`) → **zéro résultat**. Le
  frontend web ne transmet ni ne lit jamais ces identifiants depuis un état
  client ; tout passe par le JWT résolu côté API. Conforme à CLAUDE.md §5.
- **Jeton d'accès jamais persisté** : `apps/web/src/lib/session/auth-provider.tsx:46`
  garde l'`accessToken` en `useState` (mémoire uniquement, perdu au
  rechargement, restauré par `/api/session/refresh`). Le refresh token n'est
  jamais exposé au JS client — posé en cookie `httpOnly`/`sameSite=lax`
  uniquement par les Route Handlers (`apps/web/src/lib/session/cookies.ts:9-18`),
  avec rotation à chaque appel (`refresh/route.ts:24`). Conforme à CLAUDE.md
  §6 et à la règle d'or #10 de l'agent Frontend (aucun JWT en
  `localStorage`).
- **Garde-fous client explicitement documentés comme UX-only** :
  `ProtectedRoute` (`protected-route.tsx:8-9`) et `SuperAdminRoute`
  (`super-admin-route.tsx:7-10`) portent tous deux un commentaire qui
  rappelle que la vraie protection est le 403 serveur — le masquage de menu
  dans `AppSidebar` (`app-sidebar.tsx:22-27`) suit le même principe. C'est
  exactement le patron attendu par la règle d'or #9 (« Aucune vérification
  d'autorisation côté client seule »). Spot-check sur Users et Subscription :
  les deux pages/menus sont gérés par ce même mécanisme générique
  (`permission` dans `nav-config.ts`), pas de logique d'autorisation
  ad hoc supplémentaire trouvée.
- **Pas de fuite de détails techniques dans les messages d'erreur** :
  `extractErrorMessage()` (`packages/utils/src/api-errors.ts`) ne lit jamais
  que `message`, `fieldErrors` ou `formErrors` du corps JSON — jamais
  `stack`, jamais l'objet d'erreur brut. Utilisé de façon cohérente dans
  `auth-provider.tsx`, `api-client.ts` et toutes les mutations consultées.
  Aucune page n'affiche `error.stack` ni `JSON.stringify(error)`.
- **Build health** : `pnpm --filter @erp/web typecheck` → succès, 0 erreur.
  `pnpm --filter @erp/web lint` → succès, 0 erreur/avertissement. Aucun
  `any`, `@ts-ignore` ni `eslint-disable` repéré dans le code applicatif
  pendant la lecture (à confirmer de façon exhaustive si `eslint.config.js`
  ne les interdit pas déjà en erreur — non vérifié explicitement ici).

## Constat non couvert par cet audit (à signaler, pas à corriger ici)

`apps/web/eslint.config.js` (et la config racine héritée) ne référence
**aucune règle `jsx-a11y`** — recherche `grep -n "jsx-a11y"` sans résultat
dans `eslint.config.js` (racine et web) ni dans `package.json`. Combiné à
l'absence totale de tests (AUDIT-WEB-001), aucune vérification automatisée
d'accessibilité (`axe-core`, `jsx-a11y`) n'existe actuellement sur ce
frontend, alors que le mandat de l'agent Frontend en fait une exigence
bloquante (§6.2). Signalé ici pour traçabilité ; à traiter avec
AUDIT-WEB-001 plutôt que comme item isolé.

---

## Résumé

| ID | Sévérité | Statut |
|---|---|---|
| AUDIT-WEB-001 | CRITICAL | PARTIEL (2026-08-17) — Login/MFA/session testés, Clients/Facturation/E2E restent ouverts |
| AUDIT-WEB-002 | HIGH | OUVERT |
| AUDIT-WEB-003 | MEDIUM | OUVERT |
| AUDIT-WEB-004 | MEDIUM | OUVERT |
| AUDIT-WEB-005 | LOW | OUVERT |
