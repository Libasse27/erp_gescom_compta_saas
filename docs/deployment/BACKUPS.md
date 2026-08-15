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

## Copie hors-hôte (comble l'écart initialement assumé ci-dessus)

Une sauvegarde qui ne vit que sur le VPS qu'elle est censée protéger ne
survit pas à la perte de ce VPS. `scripts/backup-offsite-sync.sh` — à
enchaîner juste après `db-backup.sh` dans le même cron :

```cron
0 3 * * * cd /opt/erp_saas && BACKUP_DIR=/var/backups/erp_saas ./scripts/db-backup.sh >> /var/log/erp_saas/backup.log 2>&1 && ./scripts/backup-offsite-sync.sh >> /var/log/erp_saas/backup.log 2>&1
```

**Outils** : `age` (chiffrement moderne, une clé publique/privée X25519,
alternative plus simple que GPG — pas de trousseau à gérer) et `rclone`
(client S3-compatible, un seul binaire statique, standard de fait pour ce
type de synchronisation). Aucun des deux n'est un paquet npm du projet —
ce sont des outils d'exploitation à installer sur le VPS
(`apt install age rclone` sur Debian/Ubuntu, `apk add age rclone` sur
Alpine, ou binaires officiels). Écartés : AWS CLI (dépendance Python plus
lourde, spécifique à la syntaxe AWS) et le chiffrement natif de `rclone`
(`rclone crypt`) qui aurait mélangé transport et chiffrement dans un seul
outil/config plutôt que deux responsabilités séparées.

**Chiffrement asymétrique, clé privée jamais sur le VPS** : `docker/.env.prod`
ne contient que `BACKUP_AGE_RECIPIENT`, la clé **publique** age (générée une
fois, hors du VPS, via `age-keygen -o cle.txt` — la ligne `# public key:
age1...` de la sortie). La clé privée reste hors du VPS (poste de
l'opérateur, coffre-fort de secrets) : même si le VPS est compromis,
l'attaquant ne peut déchiffrer ni les sauvegardes déjà envoyées ni les
futures — il peut seulement en chiffrer de nouvelles avec la clé publique,
ce qui ne lui donne accès à rien.

**Stockage** : n'importe quel fournisseur S3-compatible (Scaleway, OVH,
Backblaze B2...) — pas de fournisseur imposé, `S3_ENDPOINT`/`S3_BUCKET`/
`S3_REGION`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` dans
`docker/.env.prod`. `rclone` est configuré par variables d'environnement
(`RCLONE_CONFIG_ERPOFFSITE_*`), pas par `rclone config` interactif — un
souci de plus en moins à refaire à chaque nouvel hôte, et cohérent avec le
reste de ce dépôt (tout piloté par `docker/.env.prod`).

Idempotent : chaque dump synchronisé reçoit un marqueur local
(`<dump>.uploaded`, 0 octet) — un dump déjà marqué n'est jamais rechiffré
ni renvoyé, donc rejouable sans double envoi. `db-backup.sh` nettoie le
marqueur en même temps que le dump quand la rétention locale purge un
fichier ancien (la copie distante, elle, reste sur le stockage S3).

### Restauration depuis la copie hors-hôte

`scripts/backup-offsite-fetch.sh <nom_du_fichier.dump.age> <répertoire_de_sortie>`
télécharge et déchiffre — nécessite `AGE_IDENTITY_FILE` (chemin vers la clé
**privée**, fournie séparément, jamais dans `docker/.env.prod`). À exécuter
depuis le poste de l'opérateur ou temporairement sur le VPS de remplacement
lors d'un sinistre réel — jamais en usage courant sur un VPS de production
(la clé privée n'y a rien à faire). Puis `scripts/db-restore.sh
<fichier déchiffré> --yes` comme d'habitude (scénario B ci-dessus si
l'infrastructure est neuve).

### Vérifié de bout en bout (stockage S3 réel simulé, pas de compte cloud dans cet environnement)

Même limite que Caddy/Let's Encrypt (Phase 10.6) : aucun compte S3 réel
disponible ici. Vérifié malgré tout avec un MinIO jetable (serveur
S3-compatible auto-hébergé, dans un conteneur Docker séparé, jamais utilisé
en production) comme cible — exerce exactement le même chemin de code
`age`/`rclone` qu'un vrai fournisseur, seuls `S3_ENDPOINT`/les identifiants
diffèrent :

1. Fichier de sauvegarde factice créé, empreinte SHA-256 calculée.
2. `scripts/backup-offsite-sync.sh` exécuté → chiffrement `age` réussi,
   objet effectivement présent sur le bucket MinIO (confirmé par
   `rclone lsf`), marqueur local créé.
3. Rejoué une seconde fois → `0 sauvegarde(s) nouvellement synchronisée(s)`,
   confirme l'idempotence (pas de double chiffrement/envoi).
4. **Perte totale de l'hôte simulée** : répertoire de sauvegarde local
   supprimé entièrement.
5. `scripts/backup-offsite-fetch.sh` exécuté avec la clé privée générée à
   l'étape 1 → fichier téléchargé et déchiffré.
6. Empreinte SHA-256 du fichier restauré comparée à l'originale : **identique
   bit à bit**.

Un bug réel a été trouvé et corrigé pendant cette vérification (pas
seulement une syntaxe qui "a l'air" correcte) : la syntaxe `rclone`
"remote en ligne" (`:s3,endpoint=...,...:bucket`) casse dès qu'un paramètre
contient lui-même un `:` — le cas de tout `S3_ENDPOINT` réel
(`https://s3.exemple.com`). Remplacée par la configuration via variables
d'environnement `RCLONE_CONFIG_ERPOFFSITE_*` (ci-dessus), qui n'a pas ce
problème.

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
