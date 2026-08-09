# 0007 — Rétrocompatibilité / versionnage de l'API

## Statut
Sans objet pour l'instant — 2026-08-09, à réévaluer avant la Phase 9

## Contexte
Le plan de phases prévoit d'arbitrer entre versionnage d'API (`/v1`, `/v2`)
et migration en place, selon qu'il existe déjà des clients mobiles/desktop
déployés consommant l'API.

## Décision
Sans objet à ce stade : aucun client (web, mobile, desktop) n'est encore
déployé (`docs/adr/0000-projet-neuf.md`). L'API peut évoluer en place sans
contrainte de rétrocompatibilité jusqu'à la première mise en production
publique.

## Conséquences
- Pas de préfixe `/v1` imposé dans l'immédiat sur les routes NestJS créées en
  Phase 2/3.
- **Cet ADR doit être rouvert avant la Phase 9** (mobile/desktop) : dès qu'une
  app mobile ou desktop est distribuée et ne peut pas être mise à jour de
  façon synchrone avec l'API, une vraie stratégie de versionnage devient
  nécessaire (a minima un préfixe `/v1` dès le premier déploiement public,
  pour éviter d'avoir à le retrofitter plus tard).
