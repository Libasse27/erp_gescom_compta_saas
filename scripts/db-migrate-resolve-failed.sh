#!/usr/bin/env bash
# À exécuter sur l'hôte (VPS), depuis la racine du dépôt, uniquement après
# qu'un `prisma migrate deploy` a échoué en production (erreur P3018) et que
# la cause a été corrigée (voir docs/deployment/MIGRATIONS.md).
#
# Prisma Migrate n'applique jamais une nouvelle migration tant qu'une
# précédente est marquée en échec dans `_prisma_migrations` — ce script
# débloque l'historique en la marquant "rolled back" (finished_at reste
# NULL, rolled_back_at est posé), sans toucher au schéma lui-même : chaque
# migration.sql de ce dépôt s'exécute dans une transaction Postgres unique
# (aucun `CREATE INDEX CONCURRENTLY` ni équivalent non-transactionnel), donc
# un échec ne laisse jamais de DDL partiel en base — seul l'historique
# Prisma a besoin d'être débloqué.
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: $0 <nom_de_la_migration_en_echec>" >&2
  echo "  (voir la colonne migration_name de _prisma_migrations, ou le nom du dossier sous prisma/migrations/)" >&2
  exit 1
fi

MIGRATION_NAME="$1"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/docker/docker-compose.prod.yml"
ENV_FILE="$REPO_ROOT/docker/.env.prod"

if [ ! -f "$ENV_FILE" ]; then
  echo "Erreur : $ENV_FILE introuvable (copier docker/.env.prod.example et le compléter)." >&2
  exit 1
fi

echo "==> Marquage de '$MIGRATION_NAME' comme rolled-back dans _prisma_migrations..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm api \
  pnpm --filter=@erp/api exec prisma migrate resolve --rolled-back "$MIGRATION_NAME"

echo "==> Terminé. Relancez scripts/prod-post-deploy.sh (ou prisma migrate deploy) pour appliquer la suite."
