# apps/desktop

Application desktop de l'ERP — Electron encapsulant le serveur Next.js
existant (`apps/web`). Décision et alternatives écartées :
`docs/adr/0013-stack-desktop.md`.

## Principe

Le process principal Electron (`electron/main.ts`) démarre `apps/web` et
ouvre une fenêtre pointant dessus. Tout le code web (écrans ERP,
authentification BFF, shadcn/ui) est réutilisé sans modification — rien
n'est dupliqué ici.

En développement (`pnpm dev`), le serveur web est lancé via
`pnpm --filter web start` depuis le monorepo (pnpm doit être disponible).
En application packagée, `app.isPackaged` bascule vers un serveur `next
start` déployé sans pnpm — voir « Packaging » ci-dessous.

## État

- **Scaffold + tests** (Phase 9.0 + suivi) : lancement du serveur web
  embarqué, fenêtre minimale avec `contextIsolation`/`nodeIntegration`
  durcis, 14 tests unitaires sur `electron/main.ts` (`pnpm test`).
- **Packaging local** (Phase 9.5, en cours) : `pnpm package` produit un
  `.zip` Windows non signé fonctionnel pour le process Electron, mais
  **le serveur web embarqué qu'il contient ne démarre pas encore** — le
  `node_modules` déployé par `pnpm deploy` est perdu lors de la copie
  `extraResources` d'electron-builder (celui-ci applique sa propre logique
  de résolution de dépendances aux ressources copiées, qui ne reconnaît pas
  un `node_modules` pré-construit). Voir le détail des blocages et
  décisions prises jusqu'ici dans `docs/desktop/PACKAGING.md`.
- **Auto-update** (`electron-updater`) : dépendance installée, non câblée —
  nécessite de choisir un hébergement pour le flux de mise à jour (GitHub
  Releases, S3, serveur générique) avant de commencer.
- **Signature de code** : aucune. L'installeur/zip produit est utilisable
  localement pour tester, pas pour une distribution publique (Windows
  SmartScreen et Gatekeeper macOS avertiront sans certificat).

## Commandes

```bash
pnpm --filter web build         # apps/web doit être construit avant `pnpm dev`
pnpm --filter @erp/desktop dev
pnpm --filter @erp/desktop test
pnpm --filter @erp/desktop package   # voir docs/desktop/PACKAGING.md — web-dist actuellement non fonctionnel
```
