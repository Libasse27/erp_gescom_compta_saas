#!/usr/bin/env bash
# P-01 (docs/audit/PRODUCTION-READINESS.md) : SCA bloquant en CI.
#
# `pnpm audit` seul ne suffit pas comme porte bloquante brute : au moment
# d'écrire ce script, deux avis HIGH pré-existants (image-size, dépendance de
# build de apps/mobile via Metro) n'ont *aucun correctif publié*
# (patched_versions = "<0.0.0") — les traiter comme bloquants créerait une
# porte rouge en permanence, jamais corrigible avant une mise à jour majeure
# de react-native/Expo, ce qui reviendrait à devoir désactiver la vérification
# (interdit, CLAUDE.md §3). Ce script ne bloque donc que sur les avis
# high/critical qui ont un correctif réellement disponible aujourd'hui —
# les avis sans correctif sont listés en clair (pas silencieusement ignorés)
# pour rester visibles sans casser la CI sur un sujet hors de notre contrôle.
set -euo pipefail

cd "$(dirname "$0")/.."

AUDIT_JSON="$(mktemp)"
trap 'rm -f "$AUDIT_JSON"' EXIT

# pnpm audit sort en erreur (exit != 0) dès qu'une vulnérabilité >= --audit-level
# est trouvée — on capture donc la sortie sans laisser `set -e` interrompre le
# script ici, l'analyse ci-dessous décide seule du code de sortie final.
pnpm audit --prod --audit-level=high --json > "$AUDIT_JSON" 2>/dev/null || true

node -e '
const fs = require("fs");
const path = process.argv[1];
const data = JSON.parse(fs.readFileSync(path, "utf8"));
const advisories = Object.values(data.advisories || {});
const blocking = advisories.filter(
  (a) => ["high", "critical"].includes(a.severity) && a.patched_versions !== "<0.0.0",
);
const unfixable = advisories.filter(
  (a) => ["high", "critical"].includes(a.severity) && a.patched_versions === "<0.0.0",
);

if (unfixable.length > 0) {
  console.log("Avis high/critical sans correctif publié (non bloquant, à surveiller) :");
  for (const a of unfixable) {
    console.log(`  - ${a.module_name} (${a.severity}) : ${a.title}`);
  }
}

if (blocking.length > 0) {
  console.error("\nAvis high/critical avec correctif disponible (bloquant) :");
  for (const a of blocking) {
    console.error(`  - ${a.module_name} (${a.severity}) : ${a.title} -> corrigé en ${a.patched_versions}`);
  }
  process.exit(1);
}

console.log("\nAucun avis high/critical avec correctif disponible non traité.");
' "$AUDIT_JSON"
