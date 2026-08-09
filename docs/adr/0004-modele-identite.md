# 0004 — Modèle d'identité utilisateur ↔ entreprise

## Statut
Tranché — 2026-08-09

## Contexte
Un compte utilisateur peut soit appartenir à une seule entreprise, soit
pouvoir en gérer plusieurs (cas d'usage : cabinet comptable externe gérant
plusieurs clients). Interrogé explicitement, l'utilisateur a choisi la V1
la plus simple.

## Décision
**Un compte = une entreprise.** `User.enterpriseId` est une relation directe
et obligatoire (sauf pour `SUPER_ADMIN`, qui n'appartient à aucune
entreprise — voir §4.1 `docs/SPECIFICATIONS-SAAS.md`). Un même individu qui
gère plusieurs entreprises crée un compte distinct par entreprise (email
pouvant différer ou, si le même email doit être réutilisé, ce sera un cas
d'exception traité plus tard).

## Conséquences
- Le `tenantId` se lit directement et sans ambiguïté depuis le JWT
  (`user.enterpriseId`), sans notion d'« entreprise active » à gérer en
  session.
- Simplifie fortement le modèle de permissions, le RLS (ADR 0002) et les
  tests d'isolation (Phase 3).
- Unicité de l'email : globale (un email = un compte = une entreprise), pas
  par tenant.
- Si le besoin multi-entreprises par compte apparaît plus tard (ex. cabinets
  comptables), il nécessitera une migration de modèle (table de liaison
  `UserEnterprise` + notion d'entreprise active en session) — anticipé mais
  non implémenté en V1.
