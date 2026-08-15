# Migrations Prisma — déploiement et rollback (Phase 10.3)

## Déploiement (déjà automatisé, récapitulatif)

Trois contextes, trois déclencheurs, un seul mécanisme (`prisma migrate deploy` —
non-interactif, applique les migrations en attente dans l'ordre, jamais de
`migrate dev` en dehors d'un poste de développement) :

| Contexte | Déclencheur | Où |
|---|---|---|
| Développement local | manuel, `migrate dev` (avec prompts) | poste dev |
| CI (`ci.yml`) | automatique, à chaque run Jest | `apps/api/test/global-setup.js` |
| Production (VPS) | manuel, avant le premier démarrage de l'API | `scripts/prod-post-deploy.sh` (Phase 10.1) |

Aucune étape supplémentaire n'était nécessaire ici : l'automatisation du
`deploy` existait déjà. Ce qui manquait est la stratégie de **rollback**.

## Pourquoi Prisma Migrate n'a pas de rollback automatique

Prisma ne génère pas de migration "down" à côté de chaque "up". C'est un choix
délibéré de l'outil : une inversion automatique de DDL est dangereuse dès
qu'une migration touche à des données (`DROP COLUMN` perd des valeurs qu'aucun
"down" ne peut deviner comment restaurer ; un `NOT NULL` ajouté avec backfill
ne peut pas être inversé sans savoir quelles lignes étaient à `NULL` avant).
Générer un faux sentiment de sécurité serait pire que n'avoir aucun outil.

**Fait vérifié sur ce dépôt** (et à maintenir) : les 16 migrations actuelles
ne contiennent aucune opération non-transactionnelle (`CREATE INDEX
CONCURRENTLY` ou équivalent — vérifié par recherche sur
`apps/api/prisma/migrations/`). Chaque `migration.sql` s'exécute donc dans une
**transaction Postgres unique** : soit elle s'applique intégralement, soit
Postgres l'annule intégralement elle-même en cas d'erreur. Une migration en
échec ne laisse **jamais** de DDL partiel en base — seul l'historique Prisma
(`_prisma_migrations`) a besoin d'être débloqué. **Si une future migration
introduit une opération non-transactionnelle, cette garantie disparaît** :
à documenter/traiter au cas par cas à ce moment-là (ex. migration multi-étapes
avec point de contrôle manuel).

## Stratégie retenue : deux niveaux

### Niveau 1 — Migration qui échoue au déploiement (cas normal)

C'est le cas couvert et vérifié dans cette phase. `prisma migrate deploy`
refuse d'appliquer une migration si SQL invalide, contrainte violée, etc. —
erreur `P3018`. Grâce à l'atomicité (voir ci-dessus), **le schéma reste
inchangé** ; seul `_prisma_migrations` contient une ligne "en échec"
(`finished_at IS NULL`, `rolled_back_at IS NULL`) qui bloque tout déploiement
suivant tant qu'elle n'est pas résolue.

Procédure :

1. Corriger la cause (SQL invalide, contrainte manquante, etc.).
   - Si la migration en échec n'a **jamais réussi nulle part** (détectée en
     CI avant tout merge, ou juste après un déploiement raté avant que
     quiconque d'autre l'ait appliquée) : corriger directement son
     `migration.sql` est acceptable — elle n'a jamais fait partie d'un
     historique partagé réussi.
   - Si elle a pu être appliquée ailleurs avec succès (poste d'un autre
     développeur, environnement de test partagé) : ne **jamais** modifier un
     fichier de migration déjà appliqué (règle `CLAUDE.md` §3/§9) — créer une
     nouvelle migration corrective à la place.
2. `scripts/db-migrate-resolve-failed.sh <nom_de_la_migration>` — débloque
   l'historique (`prisma migrate resolve --rolled-back`), ne touche pas au
   schéma.
3. Relancer `scripts/prod-post-deploy.sh` (ou `prisma migrate deploy`) pour
   appliquer la suite, migration corrigée incluse.

### Niveau 2 — Migration appliquée avec succès mais son effet doit être défait

Si une migration s'est appliquée **sans erreur** mais que son effet se révèle
néfaste une fois en production (mauvais defaut sur une colonne, index qui
dégrade les perfs, erreur logique découverte après coup) : il n'existe pas de
"down" automatique sûr. Deux options, jamais un DDL de rollback improvisé en
urgence :

- **Roll-forward (option par défaut)** : écrire une nouvelle migration qui
  corrige l'effet (ex. `ALTER TABLE ... ALTER COLUMN ... DROP DEFAULT`,
  `DROP INDEX`). Préserve l'historique, cohérent avec tout environnement qui
  a déjà appliqué la migration problématique.
- **Restauration depuis sauvegarde** (Phase 10.4, pas encore implémentée à ce
  commit) : seule option si la migration a corrompu ou perdu des données que
  le roll-forward ne peut pas reconstruire. Restaurer la dernière sauvegarde
  antérieure à la migration, puis rejouer les migrations suivantes
  légitimes une fois le correctif écrit.

## Vérifié de bout en bout (pas seulement documenté sur le papier)

Sur un conteneur Postgres jetable (`erp_migrate_test`, isolé de la base de
dev persistante `erp_saas_postgres_dev`, détruit après test) :

1. Les 16 migrations réelles du dépôt appliquées avec succès via
   `prisma migrate deploy` sur une base vierge.
2. Une migration délibérément invalide injectée (`ALTER TABLE
   "nonexistent_table_xyz" ...`) → `prisma migrate deploy` échoue avec
   `P3018`, exactement le comportement documenté ci-dessus.
3. Vérifié en base : `_prisma_migrations` contient la ligne en échec
   (`finished_at` et `rolled_back_at` tous deux `NULL`, `applied_steps_count
   = 0`).
4. `prisma migrate resolve --rolled-back` exécuté → ligne marquée résolue.
5. Migration invalide supprimée (correctif) → `prisma migrate deploy` relancé
   → `No pending migrations to apply.`, aucune erreur, aucun résidu.

Aucune migration réelle du dépôt n'a été modifiée pour ce test ; la base de
dev persistante n'a pas été touchée.
