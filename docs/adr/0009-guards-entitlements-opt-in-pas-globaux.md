# 0009 — Guards d'entitlements (feature/limite/statut abonnement) opt-in, pas globaux

## Statut
Tranché — 2026-08-09

## Contexte
En implémentant la Phase 4 (`docs/PROMPT-MAITRE-SAAS.md`), un premier essai a
enregistré `SubscriptionAccessGuard` comme guard global (`APP_GUARD`), sur le
modèle de `ThrottlerGuard` : bloquer toute requête non-GET dès qu'un
`TenantContext` est actif et que l'abonnement de l'entreprise est
EXPIRED/SUSPENDED/CANCELLED — y compris l'absence totale de `Subscription`.

Ce guard global a immédiatement cassé des tests Phase 2/3 qui passaient
jusque-là (`super-admin-privilege-escalation.integration.spec.ts`,
`invitations.integration.spec.ts`, `auth.integration.spec.ts` — le logout).
Cause : `POST /auth/logout` est une action non-GET exécutée avec un
`TenantContext` actif (l'utilisateur appartient à une entreprise), et aucune
des entreprises de test n'a de `Subscription` — normal, la Phase 6
(provisioning automatique) n'existe pas encore. Le guard global bloquait donc
la déconnexion elle-même, ce qui n'a aucun sens produit (on doit toujours
pouvoir se déconnecter, abonnement actif ou non) et casse un flux qui n'a
strictement rien à voir avec des données métier tenant.

## Décision
Les guards d'entitlements (`SubscriptionAccessGuard`, `FeatureGuard`,
`LimitGuard`) sont **opt-in**, posés explicitement via `@UseGuards(...)` sur
chaque route métier tenant concernée — exactement comme `PermissionsGuard`
déjà en place depuis la Phase 2. Aucun n'est enregistré en `APP_GUARD`.

Corollaire : une entreprise **sans aucune `Subscription`** n'est **pas**
traitée comme un abonnement expiré. Avant la Phase 6, rien ne garantit
qu'une `Subscription` existe ; ce n'est pas un signal de blocage. Seul un
statut EXPIRED/SUSPENDED/CANCELLED **effectivement présent** bloque les
écritures (`entitlements/guards/subscription-access.guard.ts`).

Aujourd'hui, seul `POST /users/invite` porte ces guards
(`PermissionsGuard`, `SubscriptionAccessGuard`, `LimitGuard`) : c'est
l'unique endpoint d'écriture tenant qui existe avant la Phase 8.

## Conséquences
- Chaque futur module ERP (Phase 8) doit explicitement poser les guards
  d'entitlements pertinents sur ses routes d'écriture, comme il pose déjà
  `PermissionsGuard` — ce n'est pas automatique. Un oubli laisse la route
  non protégée par le statut d'abonnement ou les quotas (mais reste protégée
  par RLS/TenantContext, qui eux restent structurels).
- Les routes d'authentification, de logout, et les routes Super Admin ne
  sont jamais affectées par le statut d'un abonnement tenant, par
  construction (elles ne portent pas ces guards).
- Écarté : guard global avec liste d'exceptions ("skip pour /auth/*, /admin/*
  ..."). Écarté car une liste d'exceptions maintenue à la main est plus
  fragile qu'un opt-in explicite — un nouvel endpoint plateforme oublié dans
  la liste d'exceptions serait bloqué à tort, alors qu'un nouvel endpoint
  métier oublié dans l'opt-in reste non protégé mais fonctionnel (échec plus
  sûr pour un projet en construction, cohérent avec le fait qu'aucune donnée
  métier n'existe encore avant la Phase 8).
