# 0011 — Pile frontend et stratégie de session (Phase 7.1)

## Statut
Tranché — 2026-08-09

## Contexte
`apps/web` (Next.js 15, App Router) était un scaffold nu jusqu'ici — `ui`,
`etat_serveur` et `web` étaient marqués « à trancher en Phase 7 » dans
`CLAUDE.md` §2. Le backend (Phases 2 à 6) expose déjà login/MFA/refresh
rotatif/logout/register/forgot-reset-password/verify-email : il faut
décider comment le frontend consomme ces jetons sans affaiblir le travail
déjà fait côté API sur la rotation et la détection de réutilisation
(CLAUDE.md §6).

## Décisions

### UI et état serveur
**Tailwind CSS + shadcn/ui + TanStack Query**, comme pressenti. shadcn/ui
n'est pas un package mais des composants copiés dans le repo au-dessus de
Radix UI (accessibilité clavier/ARIA gérée par Radix — pertinent pour le
critère d'acceptation Phase 7 « accessibilité de base »), stylés par
Tailwind, sans verrou fournisseur. TanStack Query pour l'état serveur
(cache, revalidation) dès que les dashboards (7.2+) auront de vraies listes
à afficher ; pas encore utilisé par les pages Auth de 7.1 elles-mêmes
(formulaires ponctuels, pas de données mises en cache).

Formulaires : **react-hook-form + @hookform/resolvers/zod**, réutilisant
directement les schémas déjà partagés dans `@erp/validation` (mêmes règles
de validation qu'en base, jamais dupliquées).

### Stratégie de session (BFF)
Next.js sert de **backend-for-frontend** pour le seul cycle de vie de la
session : `app/api/session/{login,mfa-verify,register,refresh,logout}`
(Route Handlers) appellent l'API NestJS et gèrent le refresh token, jamais
le client React directement.

- Le **refresh token** est posé dans un cookie `httpOnly`, `Secure` (hors
  dev), `SameSite=Lax`, jamais lu ni accessible en JavaScript côté
  navigateur — un XSS ne peut pas l'exfiltrer.
- L'**access token** (courte durée de vie, ≤15 min) reste en mémoire côté
  client (contexte React), jamais dans `localStorage`/`sessionStorage`. Une
  tentative de refresh silencieux au montage de l'application restaure la
  session après un rechargement de page.
- Les appels authentifiés vers des données (ex. `/auth/me`, futurs
  dashboards) partent **directement du navigateur vers l'API NestJS** avec
  l'access token en en-tête `Authorization` — pas de proxy Next.js pour
  ceux-là, pour ne pas construire une couche de proxy générique dès
  maintenant. Nécessite CORS activé côté API (liste blanche stricte,
  `CORS_ALLOWED_ORIGINS`) — ajouté avec cette Phase.

### Écarté
- **localStorage pour les deux jetons** : plus simple (pas de couche BFF),
  mais un XSS quelconque vole alors le refresh token directement — annule
  l'intérêt de la rotation + détection de réutilisation déjà construite
  côté API (Phase 2.3). Écarté.
- **Proxy Next.js pour tous les appels API** (pas seulement session) :
  éviterait complètement la question CORS, mais ajoute une couche de proxy
  générique à construire et maintenir dès la Phase 7.1 pour un bénéfice pas
  encore nécessaire — à reconsidérer si un besoin concret apparaît (ex.
  masquer l'URL de l'API, mutualiser du cache serveur).

## Conséquences
- Toute page qui a besoin de l'utilisateur courant lit le contexte React
  (access token + profil), jamais un cookie directement (le cookie n'est
  même pas lisible en JS).
- `NEXT_PUBLIC_API_URL` doit correspondre à une origine listée dans
  `CORS_ALLOWED_ORIGINS` côté API, sous peine de blocage silencieux par le
  navigateur.
- Un nouveau composant chargé d'afficher/consommer des données doit décider
  s'il passe par TanStack Query (données mises en cache, revalidées) — les
  simples soumissions de formulaire (login, register...) n'en ont pas
  besoin.
