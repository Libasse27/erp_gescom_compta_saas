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

## Mise à jour — 2026-08-18 (BIL-10, docs/audit/BILLING-AUDIT.md)
L'invariant « aucune entreprise à moitié créée » tel que formulé ci-dessus ne
portait, dans son implémentation d'origine, que sur les tables couvertes par
`prisma.$transaction` (Enterprise, Subscription, User, rôles, plan comptable,
settings) — toutes bien atomiques, testé. Mais **quatre opérations
s'enchaînaient après le commit, hors transaction et sans protection** :
émission du jeton de vérification, envoi de l'email de bienvenue, écriture de
l'audit `ENTERPRISE_PROVISIONED`, émission de la paire de tokens. Une panne
sur l'une d'elles laissait une entreprise **entièrement créée en base** mais
un client recevant un 500, sans tokens, incapable de se réinscrire (409 sur
l'email déjà pris). L'invariant était donc tenu au sens strictement base de
données, pas au sens du parcours d'inscription complet.

Corrigé en deux temps :
1. **L'écriture d'audit `ENTERPRISE_PROVISIONED` a rejoint la transaction**
   (`AuditLogService.record()` accepte désormais un `tx: Prisma.TransactionClient`
   optionnel) — elle ne peut structurellement plus manquer si l'entreprise
   existe.
2. **L'émission du jeton de vérification et l'envoi de l'email de bienvenue
   restent hors transaction mais sont désormais en best-effort** : une panne y
   est journalisée (log structuré) mais ne fait plus échouer l'inscription.
   Assumé sans risque fonctionnel aujourd'hui : `User.emailVerifiedAt` n'est
   lu ni imposé nulle part dans le code — sa perte reste cosmétique tant
   qu'aucune fonctionnalité ne vérifie ce champ. **À revoir** si un jour la
   vérification d'email devient bloquante (ex. accès restreint tant que
   l'email n'est pas confirmé) : il faudra alors un vrai mécanisme de reprise
   (renvoi de jeton, file d'attente), pas seulement un log.

L'émission de la paire de tokens (`AuthService.issueTokenPair`) reste, elle,
bloquante : elle fait partie intégrante du contrat de réponse de l'endpoint
(`{ accessToken, refreshToken }`). Une panne à cette étape reste possible en
théorie (résiduel assumé) — mais le compte créé demeure utilisable via le
flux `/auth/login` standard, indépendant et déjà testé, qui sert de filet de
secours implicite sans nécessiter de mécanisme dédié.
