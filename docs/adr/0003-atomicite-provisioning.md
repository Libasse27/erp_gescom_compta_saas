# 0003 — Atomicité du provisioning d'une nouvelle entreprise

## Statut
Tranché — 2026-08-09

## Contexte
Le provisioning d'une entreprise enchaîne plusieurs créations (User,
Enterprise, Subscription, rôle ADMIN, paramètres, plan comptable SYSCOHADA,
config commerciale — voir `docs/PROMPT-MAITRE-SAAS.md` Phase 6). L'invariant
non négociable : aucune entreprise à moitié créée ne doit exister.

Le choix initial du prompt maître opposait « transaction ACID » et « saga +
compensation », en notant explicitement que MongoDB standalone imposerait une
saga (pas de transaction multi-documents).

## Décision
Le SGBD retenu est **PostgreSQL** (`docs/adr/0001-...`), qui fournit des
transactions ACID multi-tables natives. Le provisioning s'exécute donc dans
**une seule transaction Prisma** (`prisma.$transaction`) : soit toutes les
étapes réussissent, soit tout est annulé automatiquement. Pas de saga ni de
compensation applicative nécessaire.

## Conséquences
- Le service de provisioning est un point d'entrée unique qui ouvre une
  transaction, exécute les créations dans l'ordre, et ne commit qu'à la fin.
- Un échec à n'importe quelle étape (Phase 6, critère d'acceptation) laisse la
  base dans l'état antérieur — testé par injection de panne à chaque étape.
- L'idempotence (rejouer avec le même email ne crée pas deux entreprises) est
  assurée par une contrainte d'unicité sur l'email (ADR 0004) combinée à la
  transaction : la seconde tentative échoue proprement sur la contrainte.
- Si un jour un fournisseur de paiement externe doit être appelé *pendant* le
  provisioning (webhook asynchrone, Phase 5), cet appel reste hors transaction
  DB — traité séparément via file d'attente, sans remettre en cause cette
  décision pour la partie strictement base de données.
