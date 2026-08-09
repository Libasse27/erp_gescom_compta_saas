// Les 8 classes racines du plan comptable SYSCOHADA révisé (système normal),
// commun aux États membres de l'OHADA/UEMOA. Point de départ initialisé au
// provisioning de chaque entreprise (docs/PROMPT-MAITRE-SAAS.md Phase 6) —
// le détail des sous-comptes est l'objet du module Comptabilité (Phase 8).
export const SYSCOHADA_ACCOUNT_CLASSES: ReadonlyArray<{ code: string; label: string }> = [
  { code: "1", label: "Comptes de ressources durables" },
  { code: "2", label: "Comptes d'actif immobilisé" },
  { code: "3", label: "Comptes de stocks" },
  { code: "4", label: "Comptes de tiers" },
  { code: "5", label: "Comptes de trésorerie" },
  { code: "6", label: "Comptes de charges des activités ordinaires" },
  { code: "7", label: "Comptes de produits des activités ordinaires" },
  { code: "8", label: "Comptes des autres charges et autres produits" },
];
