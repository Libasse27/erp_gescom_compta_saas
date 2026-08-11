// Préchargement Electron (contextIsolation: true, nodeIntegration: false).
// Rien n'est exposé au renderer pour l'instant : la page chargée est le
// serveur Next.js local (apps/web), qui n'a besoin d'aucune API Node/Electron
// pour fonctionner (docs/adr/0013-stack-desktop.md). Un futur besoin natif
// (impression, accès fichier local pour un export) s'ajoutera ici via
// contextBridge.exposeInMainWorld, jamais par nodeIntegration.
