#!/usr/bin/env bash
# À exécuter sur l'hôte (VPS), depuis la racine du dépôt, après
# `docker compose -f docker/docker-compose.prod.yml up -d postgres` mais
# avant de démarrer l'API pour la première fois.
#
# La migration Prisma 20260809113836_add_tenant_role_and_rls crée le rôle
# Postgres `erp_app_tenant`, et la migration 20260816120000_add_identity_role
# (correction MT-01, docs/audit/MULTI-TENANT-AUDIT.md) crée le rôle
# `erp_app_identity` — chacun avec un mot de passe en dur
# ("erp_tenant_dev_password" / "erp_identity_dev_password", acceptables en
# dev/CI uniquement) — on ne modifie jamais une migration déjà appliquée
# (CLAUDE.md), donc ce script fait tourner les migrations puis remplace ces
# mots de passe par de vraies valeurs secrètes (TENANT_ROLE_PASSWORD /
# IDENTITY_ROLE_PASSWORD). Idempotent : peut être rejoué sans effet de bord.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/docker/docker-compose.prod.yml"
ENV_FILE="$REPO_ROOT/docker/.env.prod"

if [ ! -f "$ENV_FILE" ]; then
  echo "Erreur : $ENV_FILE introuvable (copier docker/.env.prod.example et le compléter)." >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

: "${TENANT_ROLE_PASSWORD:?TENANT_ROLE_PASSWORD manquant dans docker/.env.prod}"
: "${IDENTITY_ROLE_PASSWORD:?IDENTITY_ROLE_PASSWORD manquant dans docker/.env.prod}"
: "${POSTGRES_USER:?POSTGRES_USER manquant dans docker/.env.prod}"
: "${POSTGRES_DB:?POSTGRES_DB manquant dans docker/.env.prod}"

echo "==> Application des migrations Prisma (rôle superuser)..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm api \
  pnpm --filter=@erp/api exec prisma migrate deploy

echo "==> Rotation du mot de passe du rôle erp_app_tenant..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
  -c "ALTER ROLE erp_app_tenant WITH PASSWORD '${TENANT_ROLE_PASSWORD}';"

echo "==> Rotation du mot de passe du rôle erp_app_identity..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
  -c "ALTER ROLE erp_app_identity WITH PASSWORD '${IDENTITY_ROLE_PASSWORD}';"

echo "==> Terminé. Vérifiez que TENANT_DATABASE_URL et IDENTITY_DATABASE_URL (docker/.env.prod) utilisent bien TENANT_ROLE_PASSWORD / IDENTITY_ROLE_PASSWORD, puis démarrez l'API :"
echo "    docker compose --env-file $ENV_FILE -f $COMPOSE_FILE up -d api web"
