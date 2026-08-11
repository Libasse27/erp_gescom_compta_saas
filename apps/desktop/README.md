# apps/desktop

Application desktop de l'ERP — Electron encapsulant le serveur Next.js
existant (`apps/web`). Décision et alternatives écartées :
`docs/adr/0013-stack-desktop.md`.

## Principe

Le process principal Electron (`electron/main.ts`) démarre `apps/web` en mode
production (`next start`, port 3001) et ouvre une fenêtre pointant dessus.
Tout le code web (écrans ERP, authentification BFF, shadcn/ui) est réutilisé
sans modification — rien n'est dupliqué ici.

## État

Scaffold Phase 9.0 : lancement du serveur web embarqué + fenêtre minimale,
aucune fonctionnalité desktop-spécifique. Packaging (`electron-builder`,
auto-update, installeurs par OS) reporté à la Phase 9.5.

## Commandes

```bash
pnpm --filter web build     # apps/web doit être construit avant de lancer le desktop
pnpm --filter @erp/desktop dev
```
