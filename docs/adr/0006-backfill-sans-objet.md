# 0006 — Backfill des données existantes vers un tenant « legacy »

## Statut
Sans objet — 2026-08-09

## Contexte
Le plan de phases prévoit une étape de backfill des données pré-existantes
sans `tenantId` vers un tenant « legacy » par défaut, pour les projets qui
migrent un ERP mono-entreprise déjà en production.

## Décision
Sans objet. Ce dépôt démarre sans aucune donnée pré-existante
(`docs/adr/0000-projet-neuf.md`). Chaque enregistrement créé à partir de la
Phase 1 porte un `tenantId` dès sa création — il n'y a jamais d'état
« sans tenant » à corriger.

## Conséquences
- L'étape « Backfill » de la Phase 3 (`docs/PROMPT-MAITRE-SAAS.md`) est
  retirée du chemin critique pour cette V1.
- Si ce projet importe un jour un ERP legacy externe (rachat, fusion de
  code), cet ADR devra être révisé et remplacé par une vraie stratégie de
  backfill.
