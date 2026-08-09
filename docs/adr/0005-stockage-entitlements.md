# 0005 — Stockage et évaluation des entitlements (features/limites de plan)

## Statut
Tranché — 2026-08-09

## Contexte
Chaque `Plan` porte des features booléennes (ex. `accounting = true`) et des
limites chiffrées (ex. `maxUsers = 10`). Deux approches pour les évaluer à
chaque requête :
1. Recalcul côté serveur à chaque requête (lecture base ou cache court).
2. Mise en cache dans le JWT au moment du login.

Critère d'arbitrage : latence vs fraîcheur après changement de plan par le
Super Admin.

## Décision
**Recalcul côté serveur à chaque requête**, via un guard NestJS dédié
(`@RequiresFeature('accounting')`, `@WithinLimit('users')`), lisant l'état
courant du plan/abonnement de l'entreprise (avec cache applicatif court —
quelques secondes à minute — pour limiter la charge, jamais dans le JWT).

Le JWT ne conserve pas les entitlements : seulement `userId`, `enterpriseId`,
`roles`. Écarté : mise en cache dans le JWT, qui obligerait soit à accepter
une fenêtre de désynchronisation potentiellement longue (durée de vie du
token) après un changement de plan côté Super Admin, soit à révoquer tous les
tokens actifs à chaque changement de plan — les deux options sont pires que le
coût d'un recalcul serveur.

## Conséquences
- Un changement de plan par le Super Admin se répercute sans attendre
  l'expiration ou le renouvellement du token de l'utilisateur (critère
  d'acceptation Phase 4).
- Le guard d'entitlements est le point d'application unique — pas de
  vérification de feature dispersée dans les services métier.
- Le frontend masque également les modules indisponibles (UX), mais ce n'est
  jamais la seule protection : le backend refuse systématiquement, testé.
