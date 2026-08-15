#!/usr/bin/env bash
# Récupère et déchiffre une sauvegarde hors-hôte (Phase 10.4+, voir
# docs/deployment/BACKUPS.md) — première moitié d'une restauration après
# sinistre (perte du VPS et de ses sauvegardes locales). Seconde moitié :
# scripts/db-restore.sh <fichier déchiffré ici> --yes, sur le nouveau VPS.
#
# Ne PAS exécuter sur le VPS lui-même en usage normal : la clé privée age
# (AGE_IDENTITY_FILE) ne doit jamais y résider (docs/deployment/BACKUPS.md,
# "clé privée jamais sur le VPS"). Prévu pour tourner depuis le poste de
# l'opérateur, ou temporairement sur le VPS de remplacement lors d'un
# sinistre réel uniquement.
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "Usage: $0 <nom_du_fichier_distant.dump.age> <repertoire_de_sortie>" >&2
  exit 1
fi

REMOTE_FILENAME="$1"
OUTPUT_DIR="$2"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/docker/.env.prod"

if [ ! -f "$ENV_FILE" ]; then
  echo "Erreur : $ENV_FILE introuvable." >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a
: "${S3_ENDPOINT:?S3_ENDPOINT manquant dans docker/.env.prod}"
: "${S3_BUCKET:?S3_BUCKET manquant dans docker/.env.prod}"
: "${S3_ACCESS_KEY_ID:?S3_ACCESS_KEY_ID manquant dans docker/.env.prod}"
: "${S3_SECRET_ACCESS_KEY:?S3_SECRET_ACCESS_KEY manquant dans docker/.env.prod}"
: "${AGE_IDENTITY_FILE:?AGE_IDENTITY_FILE manquant (chemin vers la clé privée age — jamais dans docker/.env.prod lui-même, fournie séparément)}"
S3_REGION="${S3_REGION:-auto}"

if [ ! -f "$AGE_IDENTITY_FILE" ]; then
  echo "Erreur : clé privée age introuvable : $AGE_IDENTITY_FILE" >&2
  exit 1
fi

for tool in age rclone; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Erreur : '$tool' introuvable sur cet hôte." >&2
    exit 1
  fi
done

# Voir scripts/backup-offsite-sync.sh pour l'explication du choix
# RCLONE_CONFIG_* plutôt que la syntaxe "remote en ligne" (":s3,...:bucket").
export RCLONE_CONFIG_ERPOFFSITE_TYPE=s3
export RCLONE_CONFIG_ERPOFFSITE_PROVIDER=Other
export RCLONE_CONFIG_ERPOFFSITE_ENV_AUTH=false
export RCLONE_CONFIG_ERPOFFSITE_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID"
export RCLONE_CONFIG_ERPOFFSITE_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_ERPOFFSITE_ENDPOINT="$S3_ENDPOINT"
export RCLONE_CONFIG_ERPOFFSITE_REGION="$S3_REGION"
RCLONE_REMOTE="erpoffsite:${S3_BUCKET}"

mkdir -p "$OUTPUT_DIR"
encrypted_path="$OUTPUT_DIR/$REMOTE_FILENAME"
decrypted_path="${encrypted_path%.age}"

echo "==> Téléchargement de $REMOTE_FILENAME depuis $S3_BUCKET..."
rclone copyto "${RCLONE_REMOTE}/${REMOTE_FILENAME}" "$encrypted_path"

echo "==> Déchiffrement..."
age --decrypt --identity "$AGE_IDENTITY_FILE" --output "$decrypted_path" "$encrypted_path"
chmod 600 "$decrypted_path"
rm -f "$encrypted_path"

echo "==> Terminé : $decrypted_path"
echo "    Restaurer avec : scripts/db-restore.sh $decrypted_path --yes"
