# 0013 — Stack desktop (Phase 9.0)

## Statut
Tranché — 2026-08-11

## Contexte
`apps/desktop` était un scaffold nu (`CLAUDE.md` §2 : « desktop : à trancher en
Phase 9 (ADR à venir) »). Contrairement au mobile, l'usage attendu (poste de
gestion commerciale/comptabilité en agence, réseau généralement stable) ne
justifie pas une contrainte offline-first aussi forte, ni une reconstruction
d'interface native.

`apps/web` (Next.js 15, `docs/adr/0011-...`) existe déjà et couvre l'ensemble
des écrans ERP, le RBAC, les entitlements de plan, et le pattern BFF de session
(cookie httpOnly pour le refresh token, access token en mémoire). Ce pattern
BFF dépend d'un vrai serveur Next.js (Route Handlers côté Node) — il ne
fonctionne pas si on se contente de servir un export statique.

## Décision
**Electron encapsulant l'application Next.js existante**, plutôt qu'un
renderer natif dupliquant l'UI web.

Mécanique : le processus principal Electron (`apps/desktop/electron/main.ts`)
démarre un serveur Next.js packagé (`next build` puis `next start` en
production) sur un port local, attend qu'il soit prêt, puis ouvre une
`BrowserWindow` pointant vers `http://localhost:<port>`. Conséquence directe :
**tout le code web est réutilisé sans modification** — le pattern BFF
(cookies httpOnly, routes `app/api/session/*`), tous les écrans ERP,
shadcn/ui, TanStack Query — puisque le serveur Next tourne côté Node : ni CORS
(ce n'est pas un appel navigateur cross-origin, le Route Handler appelle l'API
serveur à serveur) ni changement de stratégie de cookie ne sont nécessaires.

Sécurité de la fenêtre Electron : `contextIsolation: true`,
`nodeIntegration: false` — la page chargée (le Next.js local) ne doit pas avoir
d'accès direct à l'API Node/Electron, seulement au `preload.ts` minimal exposé
via `contextBridge` si un besoin natif apparaît plus tard (impression, accès
fichier local pour les exports).

Packaging : `electron-builder` (Windows/macOS/Linux), auto-update via
`electron-updater` — configuration détaillée reportée à la Phase 9.5.

## Écarté
- **Renderer Electron natif dupliquant l'UI web** (React sans Next, appels
  directs à l'API via IPC proxy dans le process principal pour contourner
  CORS) : techniquement viable, mais duplique la totalité des écrans ERP déjà
  construits dans `apps/web` sans bénéfice UX identifié pour un usage
  bureautique classique (poste de gestion/comptabilité). Coût de maintenance
  double pour deux implémentations d'un même écran (web et desktop) à chaque
  évolution d'un module ERP. Écarté par le critère Maintenabilité, contraire à
  la règle CLAUDE.md §9 « réutiliser l'existant plutôt que réécrire ».
- **Tauri** : bundle plus léger et performant, mais backend en Rust — l'équipe
  est 100 % TypeScript/Node aujourd'hui (aucune compétence Rust dans le
  périmètre du projet), écosystème plus jeune que celui d'Electron. Écarté par
  le critère Maintenabilité (confirmé par l'utilisateur avant rédaction de cet
  ADR).

## Conséquences
- Une évolution d'écran ERP dans `apps/web` se répercute automatiquement sur
  le client desktop au prochain build — pas de synchronisation manuelle entre
  deux bases de code UI.
- Packager un serveur Next.js à l'intérieur d'une app Electron ajoute de la
  complexité de packaging (runtime Node embarqué, sélection de port libre,
  séquencement démarrage serveur → ouverture fenêtre) — accepté comme
  contrepartie du gain de réutilisation. Point de vigilance pour la Phase 9.5.
- `docs/adr/0007-versionnage-api-sans-objet.md` doit être tranché en même
  temps que cet ADR, pour la même raison qu'en mobile (client distribué non
  synchronisable avec l'API).
