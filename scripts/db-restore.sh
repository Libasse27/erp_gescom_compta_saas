#!/usr/bin/env bash
# À exécuter sur l'hôte (VPS), depuis la racine du dépôt. Restaure un dump
# pris par scripts/db-backup.sh dans la base applicative — écrase toutes les
# données actuelles de cette base (--clean --if-exists). Destructif et
# irréversible sans un autre backup : nécessite le flag --yes explicite,
# jamais d'exécution silencieuse.
#
# Reprise après incident sur le MÊME cluster Postgres (le rôle
# erp_app_tenant existe déjà) : `postgres` de docker-compose.prod.yml doit
# déjà tourner, puis lancer directement ce script.
#
# Reprise après sinistre sur une infrastructure NEUVE (cluster Postgres
# vierge) : le rôle erp_app_tenant n'existe pas encore dans un dump seul
# (objet de cluster, hors dump par base — voir docs/deployment/BACKUPS.md).
# Lancer d'abord `scripts/prod-post-deploy.sh` (migrate deploy + rotation du
# mot de passe du rôle tenant) sur la base vierge pour recréer schéma+rôle,
# PUIS ce script avec --clean pour écraser ce schéma vide par les données
# réelles du dump (le rôle, objet de cluster non touché par le dump, survit
# à l'opération).
set -euo pipefail

if [ $# -lt 2 ] || [ "$2" != "--yes" ]; then
  echo "Usage: $0 <fichier.dump> --yes" >&2
  echo "  --yes confirme explicitement l'écrasement de la base cible." >&2
  exit 1
fi

DUMP_FILE="$1"

if [ ! -f "$DUMP_FILE" ]; then
  echo "Erreur : fichier de sauvegarde introuvable : $DUMP_FILE" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/docker/docker-compose.prod.yml"
ENV_FILE="$REPO_ROOT/docker/.env.prod"

if [ ! -f "$ENV_FILE" ]; then
  echo "Erreur : $ENV_FILE introuvable (copier docker/.env.prod.example et le compléter)." >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a
: "${POSTGRES_USER:?POSTGRES_USER manquant dans docker/.env.prod}"
: "${POSTGRES_DB:?POSTGRES_DB manquant dans docker/.env.prod}"

echo "==> Restauration de $DUMP_FILE dans la base '$POSTGRES_DB' (écrase les données actuelles)..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner \
  < "$DUMP_FILE"

echo "==> Terminé. Redémarrez l'API pour repartir sur les connexions/caches à jour :"
echo "    docker compose --env-file $ENV_FILE -f $COMPOSE_FILE restart api"
