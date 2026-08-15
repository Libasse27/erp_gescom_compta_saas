# Sauvegardes et restauration (Phase 10.4)

## Ce qui est sauvegardé

`scripts/db-backup.sh` prend une sauvegarde logique complète de la base
applicative via `pg_dump -Fc` (format custom, compressé, compatible
`pg_restore --clean`) : schéma, données, policies RLS, grants — tout ce qui
est propre à la base `erp_saas_prod`.

**Non inclus, volontairement** : le rôle Postgres `erp_app_tenant`. C'est un
objet de **cluster** (`CREATE ROLE`), pas un objet de base — `pg_dump` ne le
capture jamais, quel que soit le format. Ce rôle est déjà recréé de façon
idempotente par la migration `20260809113836_add_tenant_role_and_rls`
(`DO $$ ... IF NOT EXISTS ...`) — dupliquer ce mécanisme dans les scripts de
sauvegarde ajouterait une deuxième source de vérité pour le même objet,
sans bénéfice : la procédure de restauration (ci-dessous) réutilise
`scripts/prod-post-deploy.sh`, qui exécute déjà cette migration.

## Fréquence et rétention

Pas d'automatisation cron livrée à ce commit (aucun VPS réel où l'installer
— même limite que la CD, Phase 10.2). Ligne crontab recommandée une fois un
VPS cible provisionné, sauvegarde quotidienne à 3h du matin (heure serveur,
à aligner sur `Africa/Dakar`) :

```cron
0 3 * * * cd /opt/erp_saas && BACKUP_DIR=/var/backups/erp_saas ./scripts/db-backup.sh >> /var/log/erp_saas/backup.log 2>&1
```

`scripts/db-backup.sh` supprime lui-même les sauvegardes au-delà des
`BACKUP_RETENTION_COUNT` plus récentes (défaut : 14 — deux semaines à raison
d'une sauvegarde par jour). Chaque dump est écrit avec `chmod 600`
(contient des données personnelles et financières réelles — NINEA/RCCM,
montants, emails).

**Non couvert à ce commit** : copie hors-hôte (objet distant type S3, ou
`rsync` vers un second serveur). Une sauvegarde qui ne vit que sur le VPS
qu'elle est censée protéger ne survit pas à la perte de ce VPS. À traiter
dès qu'une cible de stockage distant est choisie — chiffrement (`age` ou
`gpg`) recommandé avant tout transfert hors-hôte, le dump n'étant pas
chiffré par lui-même.

## Restauration — deux scénarios

### A. Incident sur le cluster en place (le plus courant)

Le rôle `erp_app_tenant` existe déjà (cluster jamais reconstruit). Sur un
`postgres` déjà démarré :

```bash
scripts/db-restore.sh /var/backups/erp_saas/erp_saas_<horodatage>.dump --yes
docker compose --env-file docker/.env.prod -f docker/docker-compose.prod.yml restart api
```

`--clean --if-exists` fait tomber les objets existants avant de les
recréer depuis le dump — la base cible est entièrement remplacée par l'état
du dump, y compris les policies RLS et les grants.

### B. Sinistre sur infrastructure neuve (nouveau VPS, cluster Postgres vierge)

Le dump seul ne suffit pas : le rôle `erp_app_tenant` n'y est pas (voir
« Ce qui est sauvegardé » ci-dessus). Ordre obligatoire :

```bash
docker compose --env-file docker/.env.prod -f docker/docker-compose.prod.yml up -d postgres
scripts/prod-post-deploy.sh                              # recrée schéma + rôle erp_app_tenant
scripts/db-restore.sh <dump> --yes                        # écrase le schéma vide par les vraies données
docker compose --env-file docker/.env.prod -f docker/docker-compose.prod.yml up -d api web
```

Le rôle, objet de cluster, n'est pas touché par `--clean` (qui ne porte que
sur les objets de la base présents dans le dump) : il survit intact à la
restauration, mot de passe compris.

## Vérifié de bout en bout (pas seulement "le script s'exécute sans erreur")

Sur la stack prod réelle (`docker-compose.prod.yml`, service `postgres` +
image `api` déjà construite en Phase 10.1), secrets jetables générés dans un
`docker/.env.prod` temporaire (jamais commité, supprimé après coup) :

1. `scripts/prod-post-deploy.sh` exécuté (migrations + rotation du mot de
   passe `erp_app_tenant`) — établit un schéma réel avec RLS active.
2. Données de test insérées directement en base : deux entreprises
   (« Tenant A », « Tenant B »), un utilisateur par entreprise.
3. `scripts/db-backup.sh` exécuté → dump réel de 116 Ko produit.
4. **Sinistre simulé** : `TRUNCATE ... CASCADE` sur `users`/`enterprises`
   (et 27 tables liées par cascade) → 0 ligne dans les deux tables,
   confirmé par requête.
5. `scripts/db-restore.sh <dump> --yes` exécuté sur la base ainsi vidée.
6. **Vérifié après restauration** :
   - les 2 entreprises et les 2 utilisateurs sont revenus, avec les bons
     `enterprise_id` (aucune donnée perdue ni mélangée) ;
   - l'isolation RLS fonctionne toujours à l'identique : connecté en
     `erp_app_tenant` avec `app.tenant_id` positionné sur le tenant A,
     seule l'entreprise A est visible ;
   - **sans aucun `TenantContext`** (`app.tenant_id` non positionné),
     `erp_app_tenant` ne voit **aucune ligne** — la policy RLS
     (`FORCE ROW LEVEL SECURITY`) a bien été restaurée avec les données, pas
     seulement les tables ;
   - le rôle `erp_app_tenant` et son mot de passe (rotationné à l'étape 1,
     *avant* la sauvegarde) fonctionnent toujours après la restauration —
     confirme qu'un objet de cluster survit bien, intact, à un
     `pg_restore --clean` porté sur une seule base.
7. Stack éteinte proprement (`down -v`), `docker/.env.prod` et les dumps de
   test supprimés — rien de tout cela n'a été commité.
