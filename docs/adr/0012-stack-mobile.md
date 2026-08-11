# 0012 — Stack mobile (Phase 9.0)

## Statut
Tranché — 2026-08-11

## Contexte
`apps/mobile` était un scaffold nu (`CLAUDE.md` §2 : « mobile : à trancher en
Phase 9 (ADR à venir) »). Contraintes connues dès le prompt maître (Phase 9) :
réseau 3G/4G intermittent au Sénégal/UEMOA ⇒ stratégie offline-first
obligatoire, purge complète du cache local au changement de tenant ou à la
déconnexion, alignement sur l'authentification/permissions/abonnement déjà
construits côté API (Phases 2 à 6).

Constat déterminant sur l'auth : contrairement à ce qu'on aurait pu craindre,
l'API NestJS (`apps/api/src/auth/`) renvoie déjà `accessToken` et
`refreshToken` **dans le corps JSON** de `/auth/login`, `/auth/mfa/verify` et
`/auth/refresh` — le cookie httpOnly est une décision du BFF Next.js
(`apps/web/src/app/api/session/*`), pas de l'API elle-même
(`docs/adr/0011-...`). Un client mobile peut donc consommer l'API directement,
sans reconstruire de couche BFF.

## Décision
**Expo (managed workflow) + TypeScript.**

- **Navigation** : React Navigation (standard de facto de l'écosystème RN/Expo,
  pas de choix concurrent sérieux à évaluer ici).
- **État serveur** : TanStack Query, même outil et mêmes conventions de clés de
  requête que `apps/web` — portabilité du pattern de data-fetching, pas du JSX.
- **Formulaires** : react-hook-form + `@hookform/resolvers/zod`, réutilisant
  directement `packages/validation` (mêmes règles qu'en base et sur le web,
  jamais dupliquées — `packages/validation` est 100 % agnostique du framework,
  aucune dépendance DOM/Next).
- **Authentification** : appels directs à l'API (`/v1/auth/*`, cf.
  `docs/adr/0007-...`). Refresh token stocké via `expo-secure-store` (Keychain
  iOS / Keystore Android, chiffré au repos, non lisible par du JS injecté de la
  même façon qu'un `localStorage` navigateur). Access token en mémoire
  (contexte React), jamais persisté — silent-refresh au lancement de l'app,
  même principe que `apps/web/src/lib/session/auth-provider.tsx` mais sans
  cookie ni route BFF intermédiaire, puisque l'app mobile n'est pas un
  navigateur exposé à l'écosystème XSS d'une page web.
- **Style** : NativeWind (syntaxe Tailwind pour React Native), avec un petit
  jeu de primitives (Button, Card, Input…) **local à `apps/mobile`** — pas de
  nouveau package `packages/ui-*` tant qu'aucun deuxième consommateur React
  Native n'existe (éviter l'abstraction prématurée ; `packages/ui` actuel est
  shadcn/Radix, basé DOM, non réutilisable ici).
- **Offline-first** : `@react-native-community/netinfo` pour l'état réseau,
  persistance du cache TanStack Query sur stockage local, file d'attente de
  mutations en attente avec retry lors du retour réseau. Purge complète du
  cache et de la file au logout ou changement de tenant (exigence explicite du
  prompt maître, Phase 9). Le détail de la résolution de conflits et du choix
  exact de stockage (AsyncStorage vs MMKV) est reporté à la Phase 9.3 : ce
  n'est pas nécessaire pour le scaffold initial et mérite sa propre validation
  dédiée vu l'impact sur des données financières (factures, écritures).

## Écarté
- **React Native bare** : build/CI plus lourd (Xcode/Android Studio requis en
  local), pas d'OTA update géré nativement, et aucun besoin de module natif
  hors du périmètre Expo n'a été identifié pour un ERP de gestion. Écarté par
  le critère Simplicité/Maintenabilité.
- **WebView React Native encapsulant `apps/web`** : éviterait de reconstruire
  l'UI, mais casse l'offline-first (une WebView ne fonctionne pas sans réseau
  sauf réplication complète du build web embarqué) et la performance/l'UX
  natives attendues sur le terrain (commerciaux, caissiers). Écarté.

## Conséquences
- `packages/types`, `packages/validation`, `packages/permissions` sont
  réutilisés tels quels par `apps/mobile` — aucune duplication de schéma ou de
  catalogue de permissions.
- `docs/adr/0007-versionnage-api-sans-objet.md` doit être tranché en même
  temps que cet ADR : un client mobile distribué (stores) ne peut pas être mis
  à jour de façon synchrone avec l'API.
- La Phase 9.2 (auth mobile réelle) devra faire l'objet d'une revue par
  l'agent `security` avant clôture, conformément à `CLAUDE.md` §3 (toute
  modification touchant l'authentification).
