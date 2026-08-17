# Audit des tests automatises - ERP Gescom Compta SaaS

**Date** : 2026-08-16
**Portee** : `pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:tenant`, `pnpm build`
sur l'ensemble du monorepo (`apps/api`, `apps/web`, `apps/mobile`, `apps/desktop`, `packages/*`).
**Methode** : execution reelle des 6 commandes depuis la racine du depot (Docker Desktop a du etre
demarre manuellement pour rendre le conteneur Postgres de dev disponible - sans lui, `pnpm test` et
`pnpm test:tenant` echouent integralement cote API, voir Constat CRITICAL-1), puis inventaire et
lecture du code de test reel (pas seulement des noms de fichiers).

---

## Resume de la revue

Le socle `apps/api` est le seul module teste serieusement du monorepo : 58 suites / 293 tests, tous
verts, avec des assertions comportementales reelles (codes HTTP, etat base apres action, rejets
d'entree invalide, tentatives de forge de tenantId/isSuperAdmin). La suite `pnpm test:tenant`
existe reellement en tant que script separe au niveau racine et est effective cote API (10 suites /
41 tests, filtrage Jest sur *.tenant.spec.ts), mais elle est un stub `echo "no tests yet"` (ou une
justification ecrite en dur) dans `apps/web`, `apps/mobile` et `apps/desktop` - seul le desktop
documente explicitement pourquoi (le process Electron ne touche jamais aux donnees metier), web et
mobile non, alors que les deux consomment des donnees scopees par tenant.

`apps/web` n'a AUCUN fichier de test (0 fichier *.spec.ts/*.test.ts), malgre des formulaires
metier (React Hook Form + Zod) deja en place. Les packages partages auth, config, types, ui,
utils, validation n'ont aucun test non plus, a l'exception de permissions (1 suite, 5 tests,
reels et pertinents). Cela inclut packages/utils/src/format-fcfa.ts (formatage de la devise FCFA,
utilitaire unique impose par CLAUDE.md paragraphe 7) et l'integralite des schemas Zod partages dans
packages/validation/src/*.ts, qui ne sont valides qu'indirectement via les tests d'integration API.

Les 5 scenarios obligatoires test:tenant de CLAUDE.md paragraphe 5 sont couverts de facon reelle et
verifiee par execution, avec une reserve mineure sur le scenario 3 (voir tableau).

---

## Verifications automatisees executees

| # | Commande | Resultat | Detail |
|---|----------|----------|--------|
| 1 | pnpm install | Non re-execute | node_modules present et a jour a la racine et dans apps/api ; pas de reinstallation necessaire pour ce constat. |
| 2 | pnpm typecheck (turbo run typecheck --force, sans cache) | PASS | 15/15 taches reussies, 0 erreur TypeScript, 3m18s (run a froid). Un premier essai via `pnpm typecheck -- --force` avait echoue sur @erp/config#typecheck (probable interaction pnpm/turbo sur le passage d'argument, pas une vraie erreur de type - confirme par deux runs `npx turbo run typecheck --force` propres a la suite, 15/15 a chaque fois). |
| 3 | pnpm lint (turbo run lint --force, sans cache) | PASS | 15/15 taches reussies, exit 0, 2m40s, aucun warning ESLint affiche dans les logs. |
| 4 | pnpm test (turbo run test --force, sans cache) | PASS (apres demarrage manuel de Docker Desktop) | Voir detail ci-dessous. Sans Postgres actif : @erp/api#test echoue a 100% (Error P1001: Can't reach database server at localhost:5432), les 293 tests API ne s'executent pas du tout. |
| 5 | pnpm test:tenant (turbo run test:tenant --force) | PASS | Script existe reellement a la racine ("test:tenant": "turbo run test:tenant"). Reel seulement dans apps/api (10 suites / 41 tests) ; stub echo "no tests yet" && exit 0 dans web, mobile, packages/* ; stub justifie dans desktop. |
| 6 | pnpm build (turbo run build --force, sans cache) | PASS | 11/11 taches reussies, 4m12s. |

### Detail pnpm test (avec Postgres actif)

```
@erp/desktop:test:      Test Suites: 1 passed, 1 total   / Tests: 14 passed, 14 total
@erp/permissions:test:  Test Suites: 1 passed, 1 total   / Tests: 5 passed, 5 total
@erp/mobile:test:       Test Suites: 16 passed, 16 total / Tests: 161 passed, 161 total
@erp/api:test:          Test Suites: 58 passed, 58 total / Tests: 293 passed, 293 total  (235.9s)
@erp/utils, @erp/ui, @erp/config, @erp/types, @erp/auth, @erp/validation, @erp/web:
                        "no tests yet" (script stub, exit 0)
```

### Detail pnpm test:tenant

```
@erp/api:test:tenant:   Test Suites: 10 passed, 10 total / Tests: 41 passed, 41 total  (62.7s)
  invoicing.tenant.spec.ts, sales.tenant.spec.ts, purchases.tenant.spec.ts,
  customers.tenant.spec.ts, suppliers.tenant.spec.ts, accounting.tenant.spec.ts,
  reports.tenant.spec.ts, products.tenant.spec.ts, stock.tenant.spec.ts,
  tenant-isolation.tenant.spec.ts
@erp/web / @erp/mobile / packages/*: "no tests yet" (stub)
@erp/desktop:test:tenant: "pas de tenant cote desktop - le process principal Electron ne touche
  jamais aux donnees metier, tout passe par apps/web" (stub justifie)
```

---

## Inventaire des fichiers de test

| Zone | Fichiers *.spec.ts | Nature |
|------|----------------------|--------|
| apps/api/src | 58 | Integration (Supertest + Postgres reel), repository, unitaire (state machine, guards, hachage, HMAC) |
| apps/mobile/src | 16 | Hooks TanStack Query, contexte auth, moteur offline/sync, permissions |
| apps/desktop/electron | 1 | Cycle de vie process principal Electron |
| apps/web/src | 0 | Aucun |
| packages/permissions/src | 1 | Catalogue de permissions / roles par defaut |
| packages/auth, config, types, ui, utils, validation | 0 | Aucun |

Aucune occurrence de expect(true).toBe(true), it.skip, xit(, describe.skip ou assertion
placeholder equivalente n'a ete trouvee dans l'ensemble de apps/api/src (recherche exhaustive par
grep). Les tests lus en echantillon (customers.tenant.spec.ts, tenant-isolation.tenant.spec.ts,
super-admin-privilege-escalation.integration.spec.ts, roles.integration.spec.ts,
payments-webhook.integration.spec.ts, stock.integration.spec.ts) asserent tous sur du comportement
observable reel : codes HTTP precis, etat en base apres action (prisma.xxx.findUniqueOrThrow),
rejet explicite des cas d'erreur (403 sans permission, 404 cross-tenant, 400/409 sur stock invalide,
signature webhook invalide, idempotence sur rejeu 3 fois).

---

## Couverture des 5 scenarios obligatoires (CLAUDE.md paragraphe 5)

| # | Scenario | Statut | Preuve |
|---|----------|--------|--------|
| 1 | Utilisateur du tenant A recoit 404 (pas 403) sur une ressource du tenant B | Oui | Replique dans les 8 modules metier (customers, suppliers, products, stock, sales, purchases, invoicing, accounting), ex. customers.tenant.spec.ts lignes 100-114. |
| 2 | tenantId/enterpriseId forge dans le body reste scope au tenant appelant | Oui | customers.tenant.spec.ts lignes 140-152, products.tenant.spec.ts ligne 139, suppliers.tenant.spec.ts ligne 139 - la ligne creee est verifiee en base (stored.enterpriseId === tenantA.enterpriseId), pas seulement la reponse HTTP. |
| 3 | Test generique cross-tenant applique a tous les endpoints de liste | Partiel | Chaque module a bien son propre test "never returns another tenant's X from the list endpoint" (9 endpoints de liste couverts au total), mais il s'agit de 9 tests dupliques module par module plutot que d'un test generique factorise parcourant automatiquement tous les endpoints enregistres - un nouvel endpoint de liste peut etre ajoute sans qu'aucun test n'echoue s'il oublie l'isolation, tant qu'un *.tenant.spec.ts dedie n'est pas ecrit a la main. |
| 4 | Requete hors TenantContext leve une erreur au lieu de tout retourner | Oui | tenant-isolation.tenant.spec.ts lignes 33-35 ("rejects any query when no TenantContext is active"). |
| 5 | Un ADMIN du tenant A ne peut jamais s'attribuer SUPER_ADMIN via l'API | Oui | super-admin-privilege-escalation.integration.spec.ts - 3 tests : DTO Zod qui filtre isSuperAdmin, contrainte CHECK Postgres qui rejette isSuperAdmin=true + enterpriseId non nul en creation et en update. |

---

## Constats bloquants

### [CRITICAL-1] pnpm test et pnpm test:tenant echouent a 100% cote API sans intervention manuelle prealable

**Severite** : CRITICAL
**Composant** : apps/api (infrastructure de test)
**Fichier(s)** : apps/api/test/global-setup.js lignes 9-21, apps/api/.env lignes 1-2

**Description** : Sans un conteneur Postgres actif sur localhost:5432, pnpm test echoue des
globalSetup (Error P1001: Can't reach database server at localhost:5432), avant qu'aucun des 293
tests API ne s'execute - Test Suites: 0 de facto cote API. Dans cet environnement d'audit, Docker
Desktop n'etait pas demarre au lancement (docker ps echouait avec "failed to connect to the docker
API"), il a fallu le demarrer manuellement (Docker Desktop.exe) puis attendre que le conteneur
erp_saas_postgres_dev redevienne healthy avant d'obtenir un resultat exploitable. La definition de
"termine" de CLAUDE.md paragraphe 4 (typecheck+tests+test:tenant+lint+build tous verts) ne peut donc
pas etre verifiee de facon fiable sans une etape de bootstrap infra non documentee dans package.json
ni dans un script pretest.

**Impact** : en CI/CD comme pour tout contributeur, une execution de pnpm test sur une machine ou
Docker n'est pas demarre retourne un echec qui ressemble a une regression de code, alors que c'est un
probleme d'environnement.

**Risque** : Eleve - risque de faux negatifs (on ignore l'echec en pensant que "c'est encore le
Docker") et de faux positifs inverses (on croit avoir verifie les tests alors qu'aucun test API n'a
tourne). Sape la fiabilite du critere de "termine" de CLAUDE.md paragraphe 4 sur toute la partie API,
qui concentre 293 des environ 460 tests du depot.

**Solution** : ajouter un script pretest/predev qui verifie la disponibilite de Postgres et demarre
docker/docker-compose.dev.yml si necessaire (docker compose up -d --wait), avec un message d'erreur
explicite si Docker lui-meme n'est pas demarre, plutot que de laisser Prisma echouer avec un message
generique P1001. Documenter ce prerequis dans le README racine.

**Priorite** : Haute
**Statut** : CORRIGE (2026-08-17) — `apps/api/test/global-setup.js` sonde
maintenant `DATABASE_URL` (simple connexion TCP) avant tout : si Postgres
repond deja (cas CI, service container GitHub Actions deja demarre avant
l'etape de test), rien ne touche a Docker, zero risque de regression CI. Si
injoignable (cas local, Docker Desktop pas demarre), lance automatiquement
`docker compose -f docker/docker-compose.dev.yml up -d --wait` ; si Docker
lui-meme est indisponible, leve une erreur explicite ("Demarre Docker Desktop
puis relance...") au lieu du P1001 Prisma opaque d'origine. Verifie
reellement dans les deux sens : Docker Desktop coupe -> message clair
obtenu ; Docker Desktop demarre -> `docker compose up -d --wait` demarre
seul le conteneur `erp_saas_postgres_dev` et les tests passent normalement.
`pnpm test`/`pnpm test:tenant` executes deux fois de suite pour confirmer
(60/60 suites puis a nouveau 60/60 — la premiere execution avait 2 echecs
isoles sur `sales`/`invoicing`, non reproduits au rerun : flakiness de
parallelisation Jest preexistante, sans rapport avec ce correctif, a
surveiller mais non traitee ici).

---

## Constats majeurs

### [MAJOR-1] apps/web n'a aucun test alors qu'elle contient deja de la logique de formulaire

**Severite** : MAJOR
**Composant** : apps/web
**Fichier(s)** : apps/web/src/** (0 fichier *.spec.ts/*.test.ts), apps/web/package.json lignes 11-12

**Description** : Le script test de apps/web est un stub (echo "no tests yet" && exit 0) et
test:tenant egalement, alors que l'application consomme deja React Hook Form + Zod
(@hookform/resolvers, react-hook-form en dependances) pour des formulaires metier. Aucune regression
de validation de formulaire, de rendu conditionnel par permission, ou de fuite d'affichage
cross-tenant cote client ne peut etre detectee automatiquement.

**Impact** : le frontend n'a aucun filet de securite automatise ; toute regression n'est detectable
qu'en test manuel ou en E2E (non encore mis en place - CLAUDE.md indique Playwright prevu Phase
9/10).

**Risque** : Moyen a eleve selon la vitesse a laquelle apps/web grossit - proportionnalite a
reevaluer si le volume de composants/formulaires metier augmente significativement avant la mise en
place de Playwright.

**Solution** : au minimum, des tests unitaires Vitest/Jest sur les schemas de validation partages
utilises cote web et sur les hooks de donnees (a l'image de ce qui existe deja cote apps/mobile,
16 suites bien faites sur ce meme genre de logique) avant que le volume de code web ne rende le
rattrapage couteux.

**Priorite** : Moyenne
**Statut** : OUVERT

### [MAJOR-2] packages/validation (schemas Zod partages front/back) n'a aucun test dedie

**Severite** : MAJOR
**Composant** : packages/validation
**Fichier(s)** : packages/validation/src/*.ts (accounting.ts, auth.ts, customers.ts, invoicing.ts,
onboarding.ts, payments.ts, products.ts, purchases.ts, registration.ts, reports.ts, sales.ts,
stock.ts, subscriptions.ts, suppliers.ts) - 0 fichier *.spec.ts dans packages/validation.

**Description** : CLAUDE.md paragraphe 8 fait de ce package la "source unique de verite" de
validation partagee entre api, web, mobile, desktop. Sa correction n'est aujourd'hui verifiee
qu'indirectement, via les tests d'integration API qui postent des payloads via HTTP - ce qui teste le
comportement bout-en-bout mais ne documente pas explicitement les cas limites du schema lui-meme
(ex. valeurs XOF non entieres, formats NINEA/RCCM invalides, bornes de dates) et ne protege pas
apps/web/apps/mobile d'une regression de schema qui ne casserait aucun test API existant.

**Impact** : une regression sur un schema Zod peut passer inapercue si le test d'integration API
correspondant ne couvre pas exactement ce cas limite, et impacter silencieusement le frontend qui
partage le meme schema.

**Solution** : suite de tests unitaires par fichier de schema, au moins sur les cas limites propres
au contexte UEMOA (montants XOF entiers, NINEA/RCCM), a extraire des assertions deja presentes dans
les tests d'integration API qui postent des payloads invalides.

**Priorite** : Moyenne
**Statut** : OUVERT

### [MAJOR-3] packages/utils/src/format-fcfa.ts non teste

**Severite** : MAJOR
**Composant** : packages/utils
**Fichier(s)** : packages/utils/src/format-fcfa.ts, packages/utils (0 fichier *.spec.ts)

**Description** : CLAUDE.md paragraphe 7 impose formatFCFA() comme utilitaire unique de formatage de
la devise sur tout le depot (montants stockes en entier, jamais en float). C'est une fonction
critique et transverse (comptabilite, factures, rapports) sans aucun test unitaire - arrondis,
separateurs de milliers, valeurs negatives/nulles, tres grands montants ne sont verifies nulle part
explicitement.

**Impact** : une regression de formatage de devise (ex. arrondi incorrect) impacterait simultanement
factures, comptabilite et rapports sans qu'aucun test ne la detecte.

**Solution** : tests unitaires cibles (0, valeurs negatives si pertinent metier, montants superieurs
a 1 milliard FCFA, coherence avec la locale fr-SN).

**Priorite** : Moyenne
**Statut** : OUVERT

---

## Constats mineurs et suggestions

### [MINOR-1] Duplication du test "liste ne fuite pas cross-tenant" sur 8 modules sans factorisation

**Severite** : MINOR
**Composant** : apps/api (suites *.tenant.spec.ts)
**Fichier(s)** : apps/api/src/{customers,suppliers,products,stock,sales,purchases,invoicing,accounting}/*.tenant.spec.ts

**Description** : Le meme gabarit de test (creer 2 tenants, creer une ressource dans chacun,
verifier que la liste de A ne contient jamais celle de B) est reecrit a la main dans 8 fichiers
quasi identiques. Au-dela du seuil de duplication justifiant factorisation retenu par ce depot
(section 4.5 : 3 occurrences similaires), c'est aussi un risque fonctionnel identifie en scenario 3 :
un futur endpoint de liste peut etre ajoute sans que quiconque ajoute manuellement son propre
*.tenant.spec.ts, et rien ne le detecte automatiquement.

**Impact** : cout de maintenance accru et risque de non-couverture silencieuse d'un futur endpoint de
liste.

**Solution** : une fonction utilitaire de test partagee (ex. expectListNeverLeaksAcrossTenants(app,
route, createPayload)) appelee dans chaque module, plus - a plus long terme - un test generique qui
enumere les routes GET de liste enregistrees par Nest pour garantir qu'aucun nouvel endpoint de liste
n'echappe a la verification.

**Priorite** : Basse
**Statut** : OUVERT

### [MINOR-2] Echec isole et non reproductible de "pnpm typecheck -- --force"

**Severite** : MINOR
**Composant** : Outillage monorepo (turbo/pnpm)
**Fichier(s)** : N/A (comportement pnpm/turbo, pas un fichier source)

**Description** : Une seule execution sur les trois effectuees (pnpm typecheck -- --force, par
opposition a npx turbo run typecheck --force execute deux fois avec succes) a echoue sur
@erp/config#typecheck sans message d'erreur TypeScript capture dans la sortie tronquee. Non reproduit
sur les runs suivants. Possible interaction entre le passage d'argument pnpm run -- --force et
l'execution concurrente de plusieurs taches tsc --noEmit partageant potentiellement un fichier
tsbuildinfo.

**Impact** : faible en soi, mais un echec typecheck non reproductible en local peut se manifester de
facon differente en CI.

**Solution** : si ce comportement se reproduit en CI, verifier qu'aucune tache typecheck ne partage
de fichier de sortie incremental entre packages, et documenter la commande canonique (pnpm typecheck
sans arguments additionnels) comme seule commande supportee.

**Priorite** : Basse
**Statut** : OUVERT

### [INFO-1] Stubs test/test:tenant non justifies dans web, mobile, et packages/* (hors desktop)

**Severite** : INFO
**Composant** : Scripts package.json (web, mobile, packages/*)
**Fichier(s)** : apps/web/package.json lignes 11-12, apps/mobile/package.json ligne 16, et les 6
package.json de packages/{auth,config,types,ui,utils,validation}

**Description** : Seul apps/desktop/package.json ligne 13 documente en clair, dans le script
lui-meme, pourquoi test:tenant n'a pas de sens pour ce module. Les autres se contentent d'un
echo "no tests yet" silencieux, ce qui rend impossible de distinguer "pas encore fait" de
"non applicable par design" en lisant seulement package.json.

**Impact** : ambiguite documentaire, pas de risque fonctionnel direct.

**Solution** : reprendre le meme principe que desktop partout ou l'absence de test:tenant est un
choix delibere (ex. packages/types, purement des types, n'a structurellement rien a tester en
isolation tenant), et le laisser en echo "no tests yet" explicite uniquement la ou c'est une vraie
dette (apps/web, apps/mobile).

**Priorite** : Basse
**Statut** : OUVERT

---

## Points positifs a conserver

- La suite apps/api (58 suites / 293 tests, dont 41 dediees test:tenant) est un exemple a repliquer :
  assertions sur l'etat reel en base apres action, pas seulement sur le code HTTP ; couverture
  systematique des chemins d'erreur (400/403/404/409) en plus du chemin nominal ; tests d'idempotence
  explicites sur les webhooks de paiement (rejeu 3 fois ne cree qu'une seule facture) ; verification
  directe des roles Postgres (rolsuper, rolbypassrls, propriete de table) plutot qu'une simple
  confiance declarative dans la configuration RLS.
- Les 5 scenarios obligatoires de CLAUDE.md paragraphe 5 sont chacun tracables jusqu'a un test precis
  et commente en reference au document de plan (docs/PROMPT-MAITRE-SAAS.md section E), ce qui
  facilite l'audit et la maintenance future.
- Le test de contrainte CHECK Postgres sur isSuperAdmin/enterpriseId
  (super-admin-privilege-escalation.integration.spec.ts) verifie la defense en profondeur au niveau
  base, pas seulement au niveau applicatif - exactement la posture attendue par CLAUDE.md
  paragraphes 5/6.
- apps/mobile (16 suites / 161 tests, moteur offline/sync inclus) et apps/desktop (cycle de vie
  process principal Electron) ont une couverture reelle et proportionnee a leur perimetre, avec des
  noms de test qui documentent le comportement attendu en langage clair.

---

## Verdict

**Changements requis** - non pas parce que le code teste echoue (tout est vert une fois l'infra
disponible), mais parce que :
1. le pipeline de test ne peut pas etre considere comme fiable/reproductible sans un bootstrap Docker
   documente (CRITICAL-1) ;
2. des pans entiers du depot (apps/web, packages/validation, packages/utils) n'ont aucun test alors
   qu'ils portent de la logique metier ou une fonction transverse critique (MAJOR-1 a MAJOR-3).

La partie apps/api, qui concentre l'essentiel du risque metier et de l'isolation tenant, est en
revanche dans un etat solide et peut servir de reference pour combler les autres zones.
