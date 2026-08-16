# Audit du module Comptabilité — apps/api/src/accounting

Date : 2026-08-16
Auditeur : Administrateur de Bases de Données Senior (DBA), rôle audit
Périmètre : `apps/api/src/accounting/` (Account, JournalEntry, JournalEntryLine,
JournalEntryCounter), `apps/api/prisma/schema.prisma`, `packages/validation/src/accounting.ts`,
`apps/api/src/provisioning/syscohada-chart-of-accounts.ts`, `apps/api/src/reports/reports.repository.ts`,
migrations Prisma associées.

**Méthode** : audit uniquement — aucune modification de code applicatif. Seule
écriture : ce fichier.

**Avertissement méthodologique** : conformément à la consigne du prompt maître,
aucune règle comptable OHADA/SYSCOHADA n'est affirmée de mémoire sans support
dans le code. Tout point qui relève d'une règle métier/réglementaire précise
(numérotation exacte des comptes, règles d'exonération TVA, retenues à la
source, journaux légaux obligatoires) est étiqueté **À VALIDER MÉTIER** et
requiert la validation d'un expert-comptable, pas une affirmation de ma part.

---

## Résumé des constats

| Sévérité | Nombre |
|---|---|
| CRITICAL | 1 |
| HIGH | 2 |
| MEDIUM | 3 |
| LOW | 1 |
| INFO | 2 |
| À VALIDER MÉTIER | 4 |

---

## ACC-01 — Partie double non garantie au niveau base de données ni au niveau repository

- **Sévérité** : CRITICAL
- **Composant** : `JournalRepository.create`, `JournalEntryLine` (schéma), migration `journal_entries`
- **Description** : L'invariant « total débit = total crédit » et « une ligne
  porte soit un débit soit un crédit, jamais les deux, jamais aucun » n'est
  vérifié qu'au niveau du schéma Zod `createJournalEntrySchema`
  (`packages/validation/src/accounting.ts:28-58`), exécuté par
  `ZodValidationPipe` dans `JournalController.create`
  (`apps/api/src/accounting/journal.controller.ts:53-59`). `JournalRepository.create`
  (`apps/api/src/accounting/journal.repository.ts:52-99`) insère les lignes
  telles quelles, sans recalculer ni vérifier la somme des débits/crédits
  avant `tx.journalEntry.create(...)`. Le type `CreateJournalEntryInput` est
  une inférence TypeScript de forme (shape), pas un type qui porte la preuve
  d'exécution du `.refine()` : rien n'empêche, au niveau du langage, d'appeler
  `journalRepository.create(enterpriseId, { lines: [...] })` avec un objet non
  équilibré construit à la main. Aucune contrainte SQL (`CHECK`) ni trigger
  PostgreSQL ne protège la table `journal_entry_lines` ou `journal_entries`.
- **Impact** : toute écriture comptable créée par un chemin de code futur
  n'ayant pas transité par le contrôleur HTTP (ex. job de reprise, script de
  seed, futur module « auto-comptabilisation des ventes » — voir ACC-04) peut
  produire une écriture déséquilibrée, silencieusement acceptée en base. Une
  fois créée, une `JournalEntry` n'est jamais ni modifiable ni supprimable
  (bonne pratique confirmée par ailleurs, voir ACC-05), donc l'unique fenêtre
  de protection est la création — et cette fenêtre n'est protégée qu'à la
  périphérie HTTP, pas à la source de vérité transactionnelle.
- **Risque** : rupture de la partie double, qui est une exigence non
  négociable en comptabilité générale OHADA/SYSCOHADA. Une fois qu'une
  écriture déséquilibrée existe, le grand livre et le compte de résultat
  (dérivés par somme de `JournalEntryLine`, voir ACC-06) deviennent faux, et
  la seule voie de correction restante est une écriture de contre-passation
  manuelle — après coup, sur un système déjà en production.
- **Fichier(s)** :
  `apps/api/src/accounting/journal.repository.ts:52-99` ;
  `packages/validation/src/accounting.ts:28-58` ;
  `apps/api/prisma/migrations/20260810161150_add_journal_entries/migration.sql:44-55`
- **Solution** :
  1. Ajouter dans `JournalRepository.create` une vérification explicite
     `totalDebit === totalCredit && totalDebit > 0` avant l'insertion, dans la
     même transaction, qui lève une exception si l'invariant est violé —
     indépendante de la validation Zod amont (défense en profondeur, comme
     demandé par le mandat de cet audit).
  2. Ajouter une contrainte `CHECK` PostgreSQL par ligne (`(debit_amount > 0)
     != (credit_amount > 0)`, `debit_amount >= 0`, `credit_amount >= 0`) via
     une migration versionnée — dernier filet, non contournable même par un
     accès direct à la base.
  3. Un `CHECK`/trigger garantissant `SUM(debit_amount) = SUM(credit_amount)`
     par `journal_entry_id` est plus difficile en PostgreSQL pur (nécessite un
     trigger `AFTER INSERT/DELETE` agrégé, ou une contrainte différée) —
     à concevoir avec `backend`/`architect` si le niveau de garantie du point 1
     est jugé insuffisant.
- **Priorité** : P0 — à corriger avant tout chemin de code qui créerait des
  écritures hors du contrôleur HTTP actuel.
- **Statut** : PARTIELLEMENT CORRIGÉ (2026-08-16) — points 1 et 2 de la
  solution traités : `JournalRepository.create` revérifie l'équilibre
  débit=crédit et la règle par ligne indépendamment de Zod (même
  transaction), et une contrainte `CHECK` SQL
  (`journal_entry_lines_amounts_check`, migration
  `20260816150000_add_journal_entry_line_check_constraint`) protège
  `journal_entry_lines` même contre un accès direct à la base. Tests ajoutés
  dans `journal.repository.spec.ts` (contournement direct du repository,
  ligne invalide malgré des totaux équilibrés, contrainte SQL). Point 3
  (somme débit=crédit garantie par écriture au niveau SQL, via trigger
  agrégé) volontairement non traité — décision explicitement renvoyée par
  l'audit à une conception séparée avec `architect` si le niveau de garantie
  applicatif est jugé insuffisant.

---

## ACC-02 — Aucun exercice comptable / aucune clôture de période

- **Sévérité** : HIGH
- **Composant** : modèle de données comptable (absence de modèle)
- **Description** : Le schéma Prisma ne contient aucun modèle `Exercice`,
  `FiscalYear` ou `Period`. `JournalEntry.entryDate` accepte n'importe quelle
  date (`z.coerce.date().optional()`, `packages/validation/src/accounting.ts:46`),
  passée ou future, sans aucune vérification qu'elle appartient à une période
  ouverte. Il n'existe donc aucun mécanisme de clôture (`clôture d'exercice`)
  empêchant la création d'une écriture sur une période déjà arrêtée — ni au
  niveau service, ni au niveau base de données. Recherche exhaustive
  (`Grep` sur `exercice|clôture|cloture|fiscal year` dans `docs/`) : aucun ADR
  ne documente ce choix comme une décision différée assumée pour ce cycle —
  ce n'est donc pas une dette déclarée, mais une absence non tracée.
- **Impact** : rien n'empêche un utilisateur autorisé (`accounting.create`) de
  saisir une écriture sur un exercice N-2 après que les comptes annuels de
  cet exercice ont été arrêtés, transmis à l'administration fiscale ou signés
  par le commissaire aux comptes. Le compte de résultat et le grand livre
  d'un exercice « clos » restent mutables indéfiniment.
- **Risque** : non-conformité potentielle à l'exigence OHADA d'immuabilité des
  comptes après clôture (**À VALIDER MÉTIER** pour la formulation exacte de
  cette exigence, voir ACC-08) ; risque de divergence entre les états
  financiers déjà produits/déclarés et l'état vivant de la base.
- **Fichier(s)** : `apps/api/prisma/schema.prisma` (absence de modèle) ;
  `packages/validation/src/accounting.ts:44-58` (`entryDate` sans borne).
- **Solution** : introduire un modèle `FiscalPeriod`
  (`enterpriseId`, `startDate`, `endDate`, `status: OPEN | CLOSED`), et faire
  vérifier par `JournalRepository.create` (dans la même transaction) que
  `entryDate` tombe dans une période `OPEN` du tenant avant insertion. Décision
  structurante : à trancher avec `architect` (frontière d'agrégat) — voir §13
  de mon mandat, point d'escalade.
- **Priorité** : P1
- **Statut** : OUVERT

---

## ACC-03 — Aucun concept de journal (type de journal) : un seul flux d'écritures indifférencié

- **Sévérité** : MEDIUM
- **Composant** : `JournalEntry` (schéma)
- **Description** : `JournalEntry` n'a pas de champ identifiant un journal
  (ex. code `VE` Ventes, `AC` Achats, `BQ` Banque, `CA` Caisse, `OD` Opérations
  diverses). Toutes les écritures partagent une seule séquence de numérotation
  par tenant (`JournalEntryCounter`, clé `enterpriseId` seule), formatée
  `ECR-<enterpriseId>-NNNNNN` (`journal.repository.ts:67-75`). Le nom de
  classe/route (« Journal » singulier) et le commentaire du schéma laissent
  entendre un seul journal générique, pas une pluralité de journaux
  auxiliaires légaux.
- **Impact** : impossible aujourd'hui de produire un journal des ventes, un
  journal de banque, etc. séparément — seul un grand livre par compte
  (`accountId` en filtre de liste) est disponible.
- **Risque** : **À VALIDER MÉTIER** — je ne peux pas affirmer depuis le code
  seul si la tenue de journaux auxiliaires distincts (au sens SYSCOHADA) est
  une obligation stricte pour le régime normal ou si un unique journal général
  suffit pour la taille de client visée. À faire trancher par un
  expert-comptable/`architect`.
- **Fichier(s)** : `apps/api/prisma/schema.prisma:385-450`.
- **Solution proposée (si confirmé nécessaire)** : ajouter un champ
  `journalCode` (ou modèle `Journal` séparé si les journaux doivent être
  configurables par tenant) sur `JournalEntry`, avec séquence de numérotation
  par `(enterpriseId, journalCode)` plutôt que par `enterpriseId` seul.
- **Priorité** : P2 (conditionnée à la validation métier)
- **Statut** : OUVERT

---

## ACC-04 — Gescom et Comptabilité non intégrées : aucune écriture générée automatiquement depuis Ventes/Achats/Facturation

- **Sévérité** : HIGH
- **Composant** : `apps/api/src/sales`, `apps/api/src/purchases`, `apps/api/src/invoicing`, `apps/api/src/accounting`
- **Description** : recherche exhaustive (`Grep` sur `journalEntry|JournalRepository`)
  dans `apps/api/src/sales`, `apps/api/src/purchases` et `apps/api/src/invoicing` :
  aucune occurrence. La confirmation d'une vente (`Sale.status = CONFIRMED`),
  d'un achat, ou l'émission d'une `SalesInvoice` ne déclenche jamais la
  création d'une `JournalEntry`. Seule voie de création d'écriture :
  `POST /accounting/journal-entries`, saisie manuelle.
  Or `ReportsRepository.incomeStatement`
  (`apps/api/src/reports/reports.repository.ts:182-228`) calcule le compte de
  résultat en agrégeant `JournalEntryLine` filtrées sur les classes 6/7 — donc
  strictement déconnecté de l'activité commerciale réellement enregistrée dans
  `Sale`/`Purchase`/`SalesInvoice`, sauf si chaque transaction commerciale est
  re-saisie manuellement en écriture comptable par un opérateur.
- **Impact** : double saisie manuelle obligatoire pour que la comptabilité
  reflète l'activité commerciale ; risque élevé d'oubli, de divergence entre
  chiffre d'affaires commercial et chiffre d'affaires comptable, et de
  compte de résultat vide ou faux si la saisie manuelle n'est pas
  systématique. Pour un ERP dont le nom même est GESCOM_COMPTA, c'est un écart
  d'intégration structurel entre les deux moitiés du produit.
- **Risque** : ce n'est pas un risque d'intégrité technique (chaque module
  reste correct isolément) mais un risque fonctionnel majeur — le produit ne
  tient pas la promesse implicite d'une comptabilité alimentée par la gestion
  commerciale.
- **Fichier(s)** : `apps/api/src/sales/sales.repository.ts` (aucune référence
  à JournalEntry) ; `apps/api/src/purchases/purchases.repository.ts` (idem) ;
  `apps/api/src/invoicing/invoicing.repository.ts` (idem) ;
  `apps/api/src/reports/reports.repository.ts:182-228`.
- **Solution** : décision structurante à porter devant `architect` — soit (a)
  génération automatique d'écritures à la confirmation d'une vente/d'un achat
  ou à l'émission d'une facture (schéma comptable standard : `411 Clients` /
  `701 Ventes` / `4431 TVA collectée`, **À VALIDER MÉTIER** pour le schéma
  d'imputation exact), avec la même garantie transactionnelle que ACC-01, soit
  (b) confirmation explicite que la saisie manuelle est le choix assumé pour
  ce cycle, documentée en ADR. Je ne tranche pas ce choix, il dépasse mon
  mandat.
- **Priorité** : P1
- **Statut** : OUVERT

---

## ACC-05 — Immuabilité des écritures validées : conforme au niveau API, incomplète au niveau privilèges Postgres

- **Sévérité** : MEDIUM
- **Composant** : `JournalController`, `AccountsController`, grants PostgreSQL
- **Description** : côté API, le constat est positif — `JournalController`
  (`apps/api/src/accounting/journal.controller.ts`) n'expose que `GET`/`POST`,
  aucune route `PATCH`/`DELETE` sur `/accounting/journal-entries`.
  `AccountsController` n'expose pas de `DELETE` non plus, et aucune permission
  `accounting.delete` n'existe dans le catalogue
  (`packages/permissions/src/permission-keys.ts:40-42`). `JournalRepository`
  n'a pas de méthode `update`/`delete`. C'est le comportement attendu (une
  correction se fait par contre-passation, jamais par mutation en place).
  Cependant, au niveau du rôle applicatif PostgreSQL, la migration accorde
  `GRANT SELECT, INSERT, UPDATE, DELETE ON journal_entries TO erp_app_tenant`
  et la même chose sur `journal_entry_lines`
  (`apps/api/prisma/migrations/20260810161150_add_journal_entries/migration.sql:105-107`).
  Le rôle applicatif dispose donc, au niveau base, du privilège de modifier ou
  supprimer des écritures — un privilège que l'application ne doit
  structurellement jamais exercer sur ces deux tables. Ce même patron
  (`UPDATE, DELETE` accordés même sur des tables voulues append-only) est
  répété sur `stock_movements` et `sales_invoices` : ce n'est pas spécifique
  au module comptable, c'est une convention du dépôt.
- **Impact** : l'immuabilité des écritures repose aujourd'hui entièrement sur
  « aucune route ne l'expose », pas sur un privilège minimal au niveau base
  (Règle d'or n°5 et n°9 de mon mandat). Un bug applicatif, une regression de
  routing, ou un accès direct au pool de connexion applicatif (ex. script
  interne mal isolé) pourrait modifier ou supprimer une écriture validée sans
  qu'aucune barrière base de données ne s'y oppose.
- **Risque** : violation potentielle de l'exigence OHADA d'immuabilité des
  écritures validées si ce privilège venait à être exercé, par erreur ou par
  compromission applicative.
- **Fichier(s)** :
  `apps/api/prisma/migrations/20260810161150_add_journal_entries/migration.sql:105-107` ;
  comparable sur `apps/api/prisma/migrations/20260810132132_add_stock_movement/migration.sql:39`
  et `apps/api/prisma/migrations/20260810153035_add_sales_invoice/migration.sql:62`.
- **Solution** : migration dédiée retirant `UPDATE`/`DELETE` du `GRANT` sur
  `journal_entries` et `journal_entry_lines` pour le rôle `erp_app_tenant`
  (conserver `SELECT, INSERT` uniquement) ; `journal_entry_counters` doit
  conserver `UPDATE` (compteur incrémenté par `ON CONFLICT DO UPDATE`, usage
  légitime). Effet de bord à vérifier avec `backend` : s'assurer qu'aucun code
  existant ne dépend d'un `UPDATE`/`DELETE` implicite sur ces deux tables
  avant de retirer le privilège (aucun trouvé dans `journal.repository.ts` à
  ce jour). Si le principe est adopté, envisager de l'étendre à
  `stock_movements`/`sales_invoices` dans un audit séparé (hors périmètre de
  celui-ci).
- **Priorité** : P2
- **Statut** : OUVERT

---

## ACC-06 — Grand livre et balance : dérivés à la lecture, pas de stockage redondant

- **Sévérité** : INFO (constat positif)
- **Composant** : `AccountsRepository.trialBalance`, `AccountsRepository.aggregateBalances`
- **Description** : `AccountView.balance`/`totalDebit`/`totalCredit` ne sont
  jamais des colonnes stockées — ils sont recalculés à chaque lecture par
  `groupBy` sur `journal_entry_lines`
  (`apps/api/src/accounting/accounts.repository.ts:137-160`). Aucun champ
  `balance`/`total` n'existe sur le modèle `Account` ou `JournalEntry` dans le
  schéma Prisma. Le grand livre d'un compte est simplement la liste des
  `JournalEntry` filtrée par `accountId`
  (`journal.repository.ts:101-130`, testé `journal.repository.spec.ts:109-139`,
  commentaire explicite « grand livre d'un compte »).
- **Impact** : aucun risque de dérive entre une donnée dénormalisée et sa
  source de vérité — il n'y a pas de dénormalisation. Conforme à la Règle
  d'or n°8 de mon mandat et à CLAUDE.md §9 (pas de donnée dérivée stockée).
- **Fichier(s)** : `apps/api/src/accounting/accounts.repository.ts:100-160` ;
  `apps/api/src/accounting/journal.repository.ts:101-130`.
- **Solution** : néant — à surveiller si le volume d'écritures par tenant
  grossit au point que l'agrégation à la lecture devienne coûteuse (voir
  ACC-07 sur la pagination de la balance).
- **Priorité** : —
- **Statut** : OUVERT (suivi, pas un défaut)

---

## ACC-07 — Balance des comptes et compte de résultat non paginés

- **Sévérité** : LOW
- **Composant** : `AccountsRepository.trialBalance`, `ReportsRepository.incomeStatement`
- **Description** : `trialBalance` charge `tx.account.findMany({ where: {
  enterpriseId } })` sans `skip`/`take`
  (`apps/api/src/accounting/accounts.repository.ts:103-123`, commentaire
  assumé : « pas de pagination, un comptable doit voir l'ensemble »).
  `incomeStatement` charge `tx.journalEntryLine.findMany(...)` sans limite sur
  la période demandée (`apps/api/src/reports/reports.repository.ts:186-194`).
- **Impact** : pour un plan comptable de quelques centaines de comptes et un
  exercice de quelques milliers de lignes, l'impact est négligeable
  aujourd'hui. Le risque grandit avec le volume (nombreuses écritures sur un
  exercice complet, tenants à forte activité).
- **Risque** : dégradation de performance progressive, pas un défaut
  d'intégrité.
- **Fichier(s)** : `apps/api/src/accounting/accounts.repository.ts:103-123` ;
  `apps/api/src/reports/reports.repository.ts:182-228`.
- **Solution** : acceptable pour le volume actuel (choix assumé et documenté
  dans le code, cohérent avec « une balance se lit dans son ensemble »). À
  réévaluer si un tenant approche plusieurs milliers d'écritures par exercice
  — envisager alors une vue agrégée matérialisée côté reporting plutôt qu'une
  pagination qui casserait la sémantique « balance complète ».
- **Priorité** : P3
- **Statut** : OUVERT (dette assumée, pas d'action immédiate requise)

---

## ACC-08 — Points réglementaires nécessitant validation par un expert-comptable (À VALIDER MÉTIER)

- **Sévérité** : À VALIDER MÉTIER
- **Composant** : plan comptable, TVA, journaux, clôture
- **Description** — quatre points ne peuvent pas être tranchés depuis le code
  seul, et ne doivent **pas** être présumés corrects ou incorrects sans
  validation d'un expert-comptable qualifié SYSCOHADA/OHADA :
  1. **Numérotation exacte des comptes** : le provisioning ne seed que les 8
     classes racines génériques (`apps/api/src/provisioning/syscohada-chart-of-accounts.ts:1-15`)
     — libellés « Comptes de ressources durables », etc. Le détail des
     sous-comptes (ex. `411000 Clients`, `4457 TVA collectée`, `601000 Achats
     de marchandises`) est laissé à la saisie libre de l'ADMIN/COMPTABLE de
     chaque entreprise, avec seulement une contrainte de format
     (`/^[1-8][0-9]{0,7}$/`, `packages/validation/src/accounting.ts:7`), sans
     validation de conformité au détail officiel du plan SYSCOHADA révisé. Il
     n'est pas possible depuis le code de confirmer si un plan comptable
     minimal proposé par défaut (au-delà des 8 classes) est attendu ou non
     pour l'usage visé.
  2. **Taux de TVA** : confirmé **configurable par produit**
     (`Product.vatRateBasisPoints`, défaut `1800` = 18 %,
     `apps/api/prisma/schema.prisma:548`), résolu côté serveur à la vente/achat
     (`sales.repository.ts:61-63,109`), jamais transmis par le client, jamais
     codé en dur dans une formule métier (aucune occurrence de `0.18` ou `18`
     magique trouvée dans `apps/api/src`, hors le défaut `1800` documenté).
     C'est un constat positif sur la non-codification en dur. Reste
     **À VALIDER MÉTIER** : les règles d'exonération, de taux réduit, ou de
     TVA suspendue (le cas échéant en UEMOA) ne sont pas modélisées — un seul
     taux par produit, pas de statut d'exonération.
  3. **Retenues à la source** : aucune retenue (RAS/AIB ou équivalent) n'est
     modélisée nulle part dans `apps/api/src/accounting`,
     `apps/api/src/invoicing`, ni dans le schéma Prisma. Absence totale, ni
     codée en dur ni configurable. À valider si cela relève d'un besoin non
     encore exprimé pour ce cycle (cohérent avec CLAUDE.md §9 « pas de
     conception pour un besoin hypothétique ») ou d'un manque.
  4. **Obligation légale de journaux auxiliaires distincts et de clôture
     d'exercice formelle** : voir ACC-02 et ACC-03. Je ne peux pas, depuis le
     code, affirmer que l'absence de ces concepts constitue une non-conformité
     — cela dépend du régime comptable exact applicable aux tenants cibles
     (système normal vs. système minimal de trésorerie SYSCOHADA), à trancher
     par un expert-comptable.
- **Fichier(s)** : voir points 1 à 4 ci-dessus.
- **Solution** : faire réviser ces quatre points par un expert-comptable
  qualifié SYSCOHADA avant d'ouvrir le module à des clients en production, et
  transformer chaque réponse en ADR (`docs/adr/`) pour qu'elle devienne une
  référence traçable plutôt qu'une connaissance implicite.
- **Priorité** : P1 (bloquant avant mise en production réelle, pas bloquant
  pour la poursuite du développement)
- **Statut** : OUVERT

---

## ACC-09 — Auxiliaires (comptes tiers clients/fournisseurs) non implémentés

- **Sévérité** : MEDIUM
- **Composant** : `Account`, `JournalEntryLine`
- **Description** : `JournalEntryLine` référence uniquement `Account`
  (`apps/api/prisma/schema.prisma:418-438`) — aucune référence optionnelle
  vers `Customer`/`Supplier` permettant de ventiler un compte collectif
  (ex. `411 Clients`) par tiers. Une lettre de recherche
  (`Grep` sur `customerId|supplierId|auxiliaire` dans
  `apps/api/src/accounting`) ne retourne aucun résultat.
- **Impact** : impossible aujourd'hui de produire un état de compte client ou
  fournisseur individuel depuis la comptabilité (qui client X doit encore à
  l'entreprise, par exemple) autrement qu'en filtrant les `Sale`/`Purchase`
  du module commercial — pas via le grand livre comptable.
- **Risque** : fonctionnel, pas d'intégrité. Cohérent avec le constat ACC-04
  (comptabilité non alimentée automatiquement par le commercial) — les deux
  gaps sont liés.
- **Fichier(s)** : `apps/api/prisma/schema.prisma:418-438`.
- **Solution** : si confirmé nécessaire, ajouter un champ optionnel
  `auxiliaryPartyId` (référence par ID uniquement vers `Customer` ou
  `Supplier`, jamais un document imbriqué) sur `JournalEntryLine`, avec index
  `(enterpriseId, auxiliaryPartyId)`. Décision à porter avec `architect` en
  lien avec ACC-04.
- **Priorité** : P2
- **Statut** : OUVERT

---

## ACC-10 — Montants : conformes (Int, pas de flottant)

- **Sévérité** : INFO (constat positif)
- **Composant** : `JournalEntryLine.debitAmount`/`creditAmount`, `Product.sellingPriceExcludingTax`
- **Description** : recherche exhaustive de `Float`/`Decimal` dans
  `apps/api/prisma/schema.prisma` : aucune occurrence. Tous les montants
  comptables et commerciaux (`debitAmount`, `creditAmount`,
  `sellingPriceExcludingTax`, `unitCostExcludingTax`, `amount`, `vatAmount`,
  etc.) sont typés `Int` en base, cohérent avec CLAUDE.md §7 (XOF entier,
  jamais de flottant).
- **Fichier(s)** : `apps/api/prisma/schema.prisma:429-430,547-548,673-674,742-743,981-983`.
- **Priorité** : —
- **Statut** : OUVERT (suivi, pas un défaut)

---

## Points à valider par l'architecte ou le backend

- ACC-02 (modèle `FiscalPeriod`/clôture) et ACC-03 (journaux typés) sont des
  décisions structurantes de modélisation — à trancher avec `architect` avant
  implémentation, pas une décision DBA seule.
- ACC-04 (auto-comptabilisation Ventes/Achats/Facturation) est la décision la
  plus impactante de cet audit — elle touche `architect` (schéma
  d'imputation, frontière entre Bounded Contexts Gescom et Compta) et
  `backend` (transaction couvrant création de vente + écriture). Je
  n'implémente pas cette solution moi-même : elle dépasse mon mandat
  d'audit et nécessite un arbitrage produit sur le comportement attendu
  (automatique à la confirmation ? à l'émission de facture ? validation
  manuelle avant comptabilisation ?).
- ACC-08 : les quatre points listés nécessitent la validation d'un
  expert-comptable qualifié SYSCOHADA avant toute mise en production réelle
  auprès de clients.

## Dette assumée

- ACC-07 (absence de pagination sur la balance/compte de résultat) : dette
  raisonnable au volume actuel, documentée dans le code lui-même, pas
  d'action immédiate.
- ACC-06 : pas une dette, un constat positif — dérivation à la lecture
  correctement appliquée, aucune action requise.
- Le patron `GRANT ... UPDATE, DELETE` sur les tables append-only (ACC-05)
  est une convention répétée sur plusieurs modules du dépôt (stock, factures
  de vente) : la corriger uniquement pour la comptabilité créerait une
  incohérence de patron sans régler le problème ailleurs — signalé ici mais
  la correction complète relève d'un audit transverse, hors périmètre de
  cette revue centrée sur `accounting/`.
