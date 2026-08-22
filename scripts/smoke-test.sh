#!/usr/bin/env bash
# Smoke test minimal après un déploiement (P3, docs/deployment/PRODUCTION.md
# §Mise à jour d'un déploiement existant) : prouve qu'un environnement
# répond réellement, pas seulement que `docker compose ps` affiche "Up"
# (P3 : un conteneur `unhealthy` reste `Up`, voir la doc). Deux contrôles,
# tous deux obligatoires pour un succès :
#   1. GET <health-path> — doit répondre EXACTEMENT 200 (readiness réelle,
#      vérifie Postgres — voir /health/live vs /health/ready, P-06). Pas
#      /health/live : ça ne vérifie aucune dépendance et ne détecterait pas
#      une panne Postgres.
#   2. GET <business-path>, authentifié — doit répondre 2xx. Prouve que
#      JWT + TenantContext + RLS fonctionnent de bout en bout, pas
#      seulement que Postgres répond à un SELECT 1.
#
# Ne se fie jamais au seul code de sortie de curl (reste 0 même sur 404/500
# sans l'option -f, qui masquerait le corps de la réponse en cas d'échec) :
# le code HTTP est toujours extrait explicitement via -w '%{http_code}' et
# comparé numériquement. Sortie 1 si au moins un contrôle échoue.
set -euo pipefail

BASE_URL=""
HEALTH_PATH="/health/ready"
BUSINESS_PATH="/v1/auth/me"
TOKEN=""
LOGIN_EMAIL=""
LOGIN_PASSWORD=""
TIMEOUT_SECONDS=10

usage() {
  cat <<'EOF'
Usage: scripts/smoke-test.sh --base-url <url> [options]

Requis :
  --base-url URL            Racine de l'environnement à tester
                             (ex: https://api-staging.example.com)

Authentification pour le contrôle métier (l'une des deux formes requise) :
  --token TOKEN              Access token JWT déjà valide (Authorization: Bearer)
  --login-email EMAIL        Avec --login-password : obtient un token via
  --login-password PASSWORD  POST <base-url>/v1/auth/login

Options :
  --health-path PATH        Défaut : /health/ready
  --business-path PATH      Défaut : /v1/auth/me (endpoint authentifié minimal)
  --timeout SECONDS         Défaut : 10 (par requête curl)
  -h, --help                Affiche cette aide

Codes de sortie :
  0  les deux contrôles ont réussi (200 exact sur --health-path ET 2xx sur --business-path)
  1  au moins un contrôle a échoué, ou paramètres invalides

Exemples :
  scripts/smoke-test.sh --base-url https://api-staging.example.com \
    --login-email smoke-test@example.com --login-password '...'

  scripts/smoke-test.sh --base-url https://api-staging.example.com \
    --token "$SMOKE_TEST_TOKEN" --business-path /v1/plans
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --base-url) BASE_URL="$2"; shift 2 ;;
    --health-path) HEALTH_PATH="$2"; shift 2 ;;
    --business-path) BUSINESS_PATH="$2"; shift 2 ;;
    --token) TOKEN="$2"; shift 2 ;;
    --login-email) LOGIN_EMAIL="$2"; shift 2 ;;
    --login-password) LOGIN_PASSWORD="$2"; shift 2 ;;
    --timeout) TIMEOUT_SECONDS="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Option inconnue : $1" >&2; usage >&2; exit 1 ;;
  esac
done

if [ -z "$BASE_URL" ]; then
  echo "Erreur : --base-url est requis." >&2
  usage >&2
  exit 1
fi

if [ -z "$TOKEN" ] && { [ -z "$LOGIN_EMAIL" ] || [ -z "$LOGIN_PASSWORD" ]; }; then
  echo "Erreur : fournir --token, ou --login-email + --login-password." >&2
  usage >&2
  exit 1
fi

BASE_URL="${BASE_URL%/}"
FAILED=0

# Capture le code HTTP et le corps séparément dans tous les cas (y compris
# une connexion qui échoue totalement : curl imprime alors "000" via
# %{http_code} plutôt que de faire échouer la substitution de commande).
http_status() {
  local method="$1" url="$2" body_file="$3"
  shift 3
  local code
  # `if ! code=$(...)` plutôt qu'une affectation directe : sous `set -e`,
  # une affectation directe dont la substitution de commande échoue (hôte
  # injoignable, timeout, TLS invalide...) ferait avorter tout le script
  # avec le code de sortie brut de curl, sans jamais atteindre la
  # comparaison explicite ci-dessous — la condition d'un `if` est exemptée
  # de `set -e`, donc "000" est bien assigné au lieu de planter.
  if ! code="$(curl -sS --max-time "$TIMEOUT_SECONDS" -o "$body_file" -w '%{http_code}' -X "$method" "$@" "$url")"; then
    code="000"
  fi
  echo "$code"
}

echo "==> Contrôle 1/2 : GET ${HEALTH_PATH} doit répondre exactement 200"
health_body="$(mktemp)"
health_status="$(http_status GET "${BASE_URL}${HEALTH_PATH}" "$health_body")"
if [ "$health_status" = "200" ]; then
  echo "    OK (200)"
else
  echo "    ÉCHEC : reçu ${health_status}, corps :" >&2
  cat "$health_body" >&2
  FAILED=1
fi
rm -f "$health_body"

if [ -z "$TOKEN" ]; then
  echo "==> Authentification : POST /v1/auth/login (${LOGIN_EMAIL})"
  login_body="$(mktemp)"
  login_status="$(http_status POST "${BASE_URL}/v1/auth/login" "$login_body" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${LOGIN_EMAIL}\",\"password\":\"${LOGIN_PASSWORD}\"}")"
  if [ "$login_status" != "200" ]; then
    echo "    ÉCHEC : login a répondu ${login_status}, corps :" >&2
    cat "$login_body" >&2
    rm -f "$login_body"
    echo "==> Résultat : ÉCHEC (impossible d'obtenir un token, contrôle métier non exécuté)." >&2
    exit 1
  fi
  # Extraction volontairement minimale (pas de dépendance jq obligatoire,
  # cohérent avec les autres scripts d'exploitation de ce dépôt) : suppose
  # que la réponse JSON contient littéralement "accessToken":"...".
  TOKEN="$(grep -o '"accessToken":"[^"]*"' "$login_body" | head -n1 | sed -E 's/.*:"([^"]*)"/\1/')"
  rm -f "$login_body"
  if [ -z "$TOKEN" ]; then
    echo "    ÉCHEC : accessToken introuvable dans la réponse de /v1/auth/login." >&2
    exit 1
  fi
  echo "    OK (token obtenu)"
fi

echo "==> Contrôle 2/2 : GET ${BUSINESS_PATH} (authentifié) doit répondre 2xx"
business_body="$(mktemp)"
business_status="$(http_status GET "${BASE_URL}${BUSINESS_PATH}" "$business_body" \
  -H "Authorization: Bearer ${TOKEN}")"
if [ "$business_status" -ge 200 ] && [ "$business_status" -lt 300 ]; then
  echo "    OK (${business_status})"
else
  echo "    ÉCHEC : reçu ${business_status}, corps :" >&2
  cat "$business_body" >&2
  FAILED=1
fi
rm -f "$business_body"

if [ "$FAILED" -ne 0 ]; then
  echo "==> Résultat : ÉCHEC — au moins un contrôle a échoué." >&2
  exit 1
fi

echo "==> Résultat : SUCCÈS — les deux contrôles ont réussi."
