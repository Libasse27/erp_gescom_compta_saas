#!/usr/bin/env bash
# À exécuter sur l'hôte (VPS), depuis la racine du dépôt, juste après
# scripts/db-backup.sh (même cron — voir docs/deployment/BACKUPS.md).
# Chiffre chaque sauvegarde locale pas encore synchronisée avec `age`
# (clé publique seule sur le VPS — la clé privée ne doit JAMAIS s'y trouver,
# voir docs/deployment/BACKUPS.md) puis l'envoie vers un stockage
# S3-compatible via `rclone`, sans configuration `rclone config` interactive
# préalable (remote construit à la volée depuis les variables
# d'environnement — cohérent avec le reste des scripts de ce dépôt,
# entièrement pilotés par docker/.env.prod).
#
# Idempotent : un fichier déjà marqué "envoyé" (marqueur .uploaded à côté du
# dump) n'est jamais retraité, donc rejouable sans double envoi.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/docker/.env.prod"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/erp_saas}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Erreur : $ENV_FILE introuvable (copier docker/.env.prod.example et le compléter)." >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a
: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT manquant dans docker/.env.prod (clé publique age, jamais la clé privée)}"
: "${S3_ENDPOINT:?S3_ENDPOINT manquant dans docker/.env.prod}"
: "${S3_BUCKET:?S3_BUCKET manquant dans docker/.env.prod}"
: "${S3_ACCESS_KEY_ID:?S3_ACCESS_KEY_ID manquant dans docker/.env.prod}"
: "${S3_SECRET_ACCESS_KEY:?S3_SECRET_ACCESS_KEY manquant dans docker/.env.prod}"
S3_REGION="${S3_REGION:-auto}"

for tool in age rclone; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Erreur : '$tool' introuvable sur cet hôte (voir docs/deployment/BACKUPS.md pour l'installation)." >&2
    exit 1
  fi
done

# Remote rclone défini par variables d'environnement (RCLONE_CONFIG_*) :
# évite une étape `rclone config` interactive, provider-spécifique, à
# refaire à chaque nouvel hôte — ET la syntaxe alternative ":s3,key=val:bucket"
# ("remote en ligne"), qui casse dès qu'une valeur contient elle-même un
# ":" (ex. endpoint="http://host:port" — vécu en vérifiant cette phase).
# Fonctionne avec tout stockage S3-compatible (Scaleway, OVH, Backblaze
# B2, MinIO auto-hébergé...).
export RCLONE_CONFIG_ERPOFFSITE_TYPE=s3
export RCLONE_CONFIG_ERPOFFSITE_PROVIDER=Other
export RCLONE_CONFIG_ERPOFFSITE_ENV_AUTH=false
export RCLONE_CONFIG_ERPOFFSITE_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID"
export RCLONE_CONFIG_ERPOFFSITE_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_ERPOFFSITE_ENDPOINT="$S3_ENDPOINT"
export RCLONE_CONFIG_ERPOFFSITE_REGION="$S3_REGION"
RCLONE_REMOTE="erpoffsite:${S3_BUCKET}"

shopt -s nullglob
synced=0
for dump in "$BACKUP_DIR"/erp_saas_*.dump; do
  marker="${dump}.uploaded"
  if [ -f "$marker" ]; then
    continue
  fi

  encrypted="${dump}.age"
  echo "==> Chiffrement de $(basename "$dump")..."
  age --recipient "$BACKUP_AGE_RECIPIENT" --output "$encrypted" "$dump"
  chmod 600 "$encrypted"

  echo "==> Envoi vers $S3_BUCKET (endpoint $S3_ENDPOINT)..."
  rclone copyto "$encrypted" "${RCLONE_REMOTE}/$(basename "$encrypted")"

  rm -f "$encrypted"
  touch "$marker"
  synced=$((synced + 1))
  echo "==> $(basename "$dump") synchronisé."
done

echo "==> Terminé : $synced sauvegarde(s) nouvellement synchronisée(s)."
