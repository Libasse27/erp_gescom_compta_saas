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

## Mise à jour — BIL-12 (docs/audit/BILLING-AUDIT.md, 2026-08-19)

Corrige un écart entre ce document et le code réel : jusqu'ici, aucune route
n'existait pour éditer le catalogue de plans/features/limites — seul
`prisma/seed.ts` (rôle propriétaire, hors runtime) y écrivait, malgré des
commentaires `schema.prisma` affirmant le contraire.

`PlansAdminController` (`PUT/PATCH/POST /admin/plans/...`, Super Admin
uniquement) permet désormais de créer/éditer un plan et d'activer une
feature ou fixer une limite **déjà présente dans le catalogue de clés**
(`Feature.key`/`Limit.key`) — jamais d'en créer une nouvelle dynamiquement,
ce catalogue de clés reste défini par le code + le seed, exactement comme
`PERMISSION_KEYS`.

Ce changement ne remet pas en cause la décision ci-dessus : le cache court
d'`EntitlementsService` (§ Décision) n'est **pas invalidé explicitement**
par ces nouvelles routes, exactement comme `SubscriptionsService.changePlan`
ne l'invalide pas non plus déjà aujourd'hui — la même garantie de fraîcheur
"au pire la durée du TTL" (`ENTITLEMENTS_CACHE_TTL_MS`, 5s par défaut)
s'applique, cohérente avec le reste du système plutôt qu'une nouvelle
mécanique d'invalidation ad hoc.
