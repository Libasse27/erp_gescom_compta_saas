#!/usr/bin/env bash
# À exécuter sur l'hôte (VPS), depuis la racine du dépôt, une fois la stack
# prod démarrée (`docker compose -f docker/docker-compose.prod.yml up -d`).
# Prend une sauvegarde logique complète (schéma + données + policies RLS +
# grants) de la base applicative via `pg_dump` au format custom (`-Fc`,
# compressé, compatible `pg_restore --clean`). N'inclut PAS le rôle
# `erp_app_tenant` : c'est un objet de cluster, pas de base, recréé par la
# migration `20260809113836_add_tenant_role_and_rls` — voir
# docs/deployment/BACKUPS.md pour la procédure de restauration complète sur
# une infrastructure neuve.
#
# Prévu pour être appelé depuis cron (voir docs/deployment/BACKUPS.md pour
# la ligne crontab recommandée).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/docker/docker-compose.prod.yml"
ENV_FILE="$REPO_ROOT/docker/.env.prod"

# Répertoire de sauvegarde hors dépôt par défaut (ne jamais committer un
# dump : données personnelles/financières réelles). Surchageable via
# BACKUP_DIR pour un VPS avec une autre convention de chemins.
BACKUP_DIR="${BACKUP_DIR:-/var/backups/erp_saas}"
# Nombre de sauvegardes conservées (les plus anciennes au-delà sont
# supprimées). Une copie hors-hôte (rsync/objet distant) reste à mettre en
# place séparément — non couvert ici, voir docs/deployment/BACKUPS.md.
BACKUP_RETENTION_COUNT="${BACKUP_RETENTION_COUNT:-14}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Erreur : $ENV_FILE introuvable (copier docker/.env.prod.example et le compléter)." >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a
: "${POSTGRES_USER:?POSTGRES_USER manquant dans docker/.env.prod}"
: "${POSTGRES_DB:?POSTGRES_DB manquant dans docker/.env.prod}"

mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP_FILE="$BACKUP_DIR/erp_saas_${TIMESTAMP}.dump"

echo "==> Sauvegarde de la base '$POSTGRES_DB' vers $DUMP_FILE..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$DUMP_FILE"

chmod 600 "$DUMP_FILE"
echo "==> Terminé : $(du -h "$DUMP_FILE" | cut -f1) écrits."

echo "==> Purge des sauvegardes au-delà des $BACKUP_RETENTION_COUNT plus récentes..."
# shellcheck disable=SC2012
ls -1t "$BACKUP_DIR"/erp_saas_*.dump 2>/dev/null | tail -n "+$((BACKUP_RETENTION_COUNT + 1))" | \
  while IFS= read -r old; do
    echo "    suppression : $old"
    rm -f -- "$old"
  done

echo "==> $(ls -1 "$BACKUP_DIR"/erp_saas_*.dump 2>/dev/null | wc -l) sauvegarde(s) conservée(s) dans $BACKUP_DIR."
