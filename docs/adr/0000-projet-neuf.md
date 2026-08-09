# 0000 — Le projet démarre sans code legacy

## Statut
Constaté — 2026-08-09

## Contexte
La spécification d'origine (`docs/SPECIFICATIONS-SAAS.md`) et le plan de phases
(`docs/PROMPT-MAITRE-SAAS.md`) décrivent une transformation d'un ERP GESCOM/
Compta **existant et fonctionnel** vers une plateforme SaaS multi-tenant.

À l'ouverture de ce dépôt (`ERP_GESCOM_COMPTA_SAAS`), le répertoire de travail
était vide : aucun code, aucun commit. Un `.git` préexistant a été trouvé avec
un remote configuré (`https://github.com/libasse27/erp_gescom_compta_saas.git`)
mais sans historique.

Interrogé, l'utilisateur a confirmé qu'il n'existe pas d'ERP legacy : le projet
démarre from scratch dans ce dépôt.

## Décision
- La Phase 0 du plan est adaptée : pas d'audit de code legacy (`AUDIT.md`,
  `DATABASE.md`, `SECURITY-AUDIT.md`, `MIGRATION-PLAN.md` n'ont pas d'objet
  pour l'instant — ils seront produits en Phase 7/8 au fur et à mesure que du
  code métier existera réellement à auditer).
- Le remote GitHub existant est conservé tel quel. Aucun `git push` n'est
  effectué sans accord explicite de l'utilisateur (voir `CLAUDE.md` §3).
- La spécification fonctionnelle complète reste la référence produit ; seule la
  prémisse « code existant » ne s'applique pas.

## Conséquences
- Les phases suivantes (1 à 10) s'appliquent normalement, sans étape de
  migration de données legacy ni de compatibilité ascendante d'API.
- `docs/adr/0006-backfill-sans-objet.md` et
  `docs/adr/0007-versionnage-api-sans-objet.md` découlent directement de cette
  décision.
