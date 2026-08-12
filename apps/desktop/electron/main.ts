import { app, BrowserWindow } from "electron";
import { ChildProcess, spawn } from "node:child_process";
import path from "node:path";

// docs/adr/0013-stack-desktop.md : le process principal Electron encapsule le
// serveur Next.js existant (apps/web) plutôt que de reconstruire un renderer
// natif. Tout le pattern BFF (cookies httpOnly, routes app/api/session/*) et
// tous les écrans ERP sont réutilisés sans modification, car le serveur Next
// tourne côté Node — pas de CORS, pas de nouvelle stratégie de jeton.
// Le port n'est pas paramétrable ici : il reprend celui déjà figé dans le
// script "start" de apps/web/package.json ("next start -p 3001"), pour éviter
// de passer un second -p en conflit avec ce script existant.
const WEB_PORT = 3001;
const MONOREPO_ROOT = path.join(__dirname, "..", "..", "..");
const READY_TIMEOUT_MS = 30_000;
const READY_POLL_INTERVAL_MS = 300;

let webServerProcess: ChildProcess | null = null;

// En app packagée (electron-builder) : apps/web a été déployé sans pnpm ni
// symlinks (`pnpm deploy --prod`, voir scripts/package.js) dans
// resources/web-dist — Next.js output "standalone" a été écarté car son
// traçage de fichiers recrée des symlinks via fs.symlink, qui échouent avec
// EPERM sur Windows sans privilèges élevés (docs/desktop/PACKAGING.md).
// On lance `next start` directement via son point d'entrée JS, exécuté par
// le binaire Electron lui-même en mode Node pur (ELECTRON_RUN_AS_NODE) —
// évite de devoir embarquer un runtime Node séparé dans l'installeur.
function webDistDir(): string {
  return path.join(process.resourcesPath, "web-dist");
}

function startPackagedWebServer(): ChildProcess {
  const dir = webDistDir();
  const nextBin = path.join(dir, "node_modules", "next", "dist", "bin", "next");

  const child = spawn(process.execPath, [nextBin, "start", "-p", String(WEB_PORT)], {
    cwd: dir,
    stdio: "inherit",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });

  child.on("error", (error) => {
    console.error("[desktop] Échec du démarrage du serveur web embarqué (packagé) :", error);
  });

  return child;
}

// En développement : apps/web tourne via le monorepo directement (pnpm doit
// être disponible sur le PATH), pas de dossier déployé à part.
function startDevWebServer(): ChildProcess {
  const child = spawn("pnpm", ["--filter", "web", "start"], {
    cwd: MONOREPO_ROOT,
    shell: true,
    stdio: "inherit",
  });

  child.on("error", (error) => {
    console.error("[desktop] Échec du démarrage du serveur web embarqué :", error);
  });

  return child;
}

export function startWebServer(): ChildProcess {
  return app.isPackaged ? startPackagedWebServer() : startDevWebServer();
}

export interface WaitForWebServerOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
}

// timeoutMs/pollIntervalMs paramétrables (défauts = constantes ci-dessus) :
// permet aux tests d'exercer le chemin "timeout" en millisecondes plutôt
// qu'en attendant réellement READY_TIMEOUT_MS (30s), sans changer le
// comportement par défaut en production.
export async function waitForWebServer(
  url: string,
  { timeoutMs = READY_TIMEOUT_MS, pollIntervalMs = READY_POLL_INTERVAL_MS }: WaitForWebServerOptions = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) {
        return;
      }
    } catch {
      // Serveur pas encore prêt — nouvelle tentative après un court délai.
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Le serveur web embarqué n'a pas répondu sur ${url} après ${timeoutMs}ms`);
}

export function createMainWindow(url: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  window.loadURL(url);
  return window;
}

app.whenReady().then(async () => {
  webServerProcess = startWebServer();

  const url = `http://localhost:${WEB_PORT}`;
  await waitForWebServer(url);

  createMainWindow(url);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow(url);
    }
  });
});

// Extraites en fonctions nommées pour être testables indépendamment de
// l'orchestration app.whenReady() ci-dessus (comportement inchangé).
export function handleWindowAllClosed(platform: NodeJS.Platform = process.platform): void {
  if (platform !== "darwin") {
    app.quit();
  }
}

export function killWebServerProcess(child: ChildProcess | null): void {
  child?.kill();
}

app.on("window-all-closed", () => handleWindowAllClosed());
app.on("before-quit", () => killWebServerProcess(webServerProcess));
