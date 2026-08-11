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

let webServerProcess: ChildProcess | null = null;

function startWebServer(): ChildProcess {
  // Suppose apps/web déjà construit (`pnpm --filter web build`) — le
  // packaging Phase 9.5 embarquera le build et ce Node runtime dans
  // l'installeur ; ce scaffold couvre uniquement le lancement en
  // développement local.
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

async function waitForWebServer(url: string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) {
        return;
      }
    } catch {
      // Serveur pas encore prêt — nouvelle tentative après un court délai.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  throw new Error(`Le serveur web embarqué n'a pas répondu sur ${url} après ${READY_TIMEOUT_MS}ms`);
}

function createMainWindow(url: string): BrowserWindow {
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

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  webServerProcess?.kill();
});
