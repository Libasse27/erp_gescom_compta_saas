import type { ChildProcess } from "node:child_process";
import path from "node:path";

// 'electron' n'existe que dans le runtime Electron réel — mocké ici pour
// pouvoir importer main.ts sous Jest (Node pur). app.whenReady() renvoie une
// promesse qui ne se résout jamais : le corps de app.whenReady().then(...)
// (qui démarrerait un vrai process pnpm) ne s'exécute donc jamais pendant les
// tests — seules les fonctions exportées sont testées directement, pas
// l'orchestration au chargement du module.
const mockAppOn = jest.fn();
const mockAppQuit = jest.fn();
const mockBrowserWindowConstructor = jest.fn();
const mockLoadURL = jest.fn();
const mockGetAllWindows = jest.fn().mockReturnValue([]);

jest.mock("electron", () => ({
  app: {
    whenReady: jest.fn(() => new Promise(() => {})),
    on: (...args: unknown[]) => mockAppOn(...args),
    quit: (...args: unknown[]) => mockAppQuit(...args),
    isPackaged: false,
  },
  BrowserWindow: Object.assign(
    jest.fn().mockImplementation(function (this: { loadURL: typeof mockLoadURL }, options: unknown) {
      mockBrowserWindowConstructor(options);
      this.loadURL = mockLoadURL;
    }),
    { getAllWindows: mockGetAllWindows },
  ),
}));

// spawn mocké : startWebServer ne doit jamais lancer un vrai `pnpm --filter
// web start` pendant les tests (processus réel, effets de bord hors du
// contrôle de Jest).
const mockSpawn = jest.fn();
jest.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

import { app } from "electron";
import { createMainWindow, handleWindowAllClosed, killWebServerProcess, startWebServer, waitForWebServer } from "./main";

beforeEach(() => {
  jest.clearAllMocks();
  (app as { isPackaged: boolean }).isPackaged = false;
});

describe("startWebServer (développement)", () => {
  it("lance `pnpm --filter web start` depuis la racine du monorepo, en héritant des flux std", () => {
    const fakeChild = { on: jest.fn() } as unknown as ChildProcess;
    mockSpawn.mockReturnValueOnce(fakeChild);

    const child = startWebServer();

    expect(mockSpawn).toHaveBeenCalledWith(
      "pnpm",
      ["--filter", "web", "start"],
      expect.objectContaining({ shell: true, stdio: "inherit" }),
    );
    expect(child).toBe(fakeChild);
  });

  it("journalise une erreur si le process échoue au démarrage, sans lever d'exception", () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    const fakeChild = {
      on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
        handlers[event] = handler;
      }),
    } as unknown as ChildProcess;
    mockSpawn.mockReturnValueOnce(fakeChild);
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

    startWebServer();
    handlers.error?.(new Error("ENOENT"));

    expect(consoleError).toHaveBeenCalledWith(
      "[desktop] Échec du démarrage du serveur web embarqué :",
      expect.any(Error),
    );
    consoleError.mockRestore();
  });
});

describe("startWebServer (packagé)", () => {
  const originalResourcesPath = process.resourcesPath;

  beforeEach(() => {
    (app as { isPackaged: boolean }).isPackaged = true;
    Object.defineProperty(process, "resourcesPath", { value: "C:\\fake\\resources", configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process, "resourcesPath", { value: originalResourcesPath, configurable: true });
  });

  it("lance `next start` via le point d'entrée JS déployé, exécuté en mode Node pur par le binaire Electron", () => {
    const fakeChild = { on: jest.fn() } as unknown as ChildProcess;
    mockSpawn.mockReturnValueOnce(fakeChild);

    const child = startWebServer();

    expect(mockSpawn).toHaveBeenCalledWith(
      process.execPath,
      [
        expect.stringContaining(path.join("web-dist", "node_modules", "next", "dist", "bin", "next")),
        "start",
        "-p",
        "3001",
      ],
      expect.objectContaining({
        cwd: expect.stringContaining("web-dist"),
        env: expect.objectContaining({ ELECTRON_RUN_AS_NODE: "1" }),
      }),
    );
    expect(child).toBe(fakeChild);
  });

  it("ne dépend pas de pnpm ni du monorepo (pas d'appel à pnpm en mode packagé)", () => {
    mockSpawn.mockReturnValueOnce({ on: jest.fn() } as unknown as ChildProcess);

    startWebServer();

    expect(mockSpawn).not.toHaveBeenCalledWith("pnpm", expect.anything(), expect.anything());
  });
});

describe("waitForWebServer", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("résout dès que fetch renvoie ok", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });

    await expect(waitForWebServer("http://localhost:3001", { timeoutMs: 1000, pollIntervalMs: 10 })).resolves.toBeUndefined();
  });

  it("résout sur un statut < 500 même si non ok (le serveur répond, la route importe peu)", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });

    await expect(waitForWebServer("http://localhost:3001", { timeoutMs: 1000, pollIntervalMs: 10 })).resolves.toBeUndefined();
  });

  it("réessaie après un échec réseau puis résout au succès suivant", async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce({ ok: true, status: 200 });
    global.fetch = fetchMock;

    await waitForWebServer("http://localhost:3001", { timeoutMs: 1000, pollIntervalMs: 10 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("lève une erreur explicite après le délai imparti si le serveur ne répond jamais", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(waitForWebServer("http://localhost:3001", { timeoutMs: 50, pollIntervalMs: 10 })).rejects.toThrow(
      /n'a pas répondu sur http:\/\/localhost:3001 après 50ms/,
    );
  });
});

describe("createMainWindow", () => {
  it("crée la fenêtre avec contextIsolation et nodeIntegration désactivée (docs/adr/0013)", () => {
    createMainWindow("http://localhost:3001");

    expect(mockBrowserWindowConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        webPreferences: expect.objectContaining({
          contextIsolation: true,
          nodeIntegration: false,
          preload: expect.stringContaining("preload.js"),
        }),
      }),
    );
  });

  it("charge l'URL du serveur web embarqué", () => {
    createMainWindow("http://localhost:3001");

    expect(mockLoadURL).toHaveBeenCalledWith("http://localhost:3001");
  });
});

describe("handleWindowAllClosed", () => {
  it("quitte l'application hors macOS", () => {
    handleWindowAllClosed("win32");

    expect(mockAppQuit).toHaveBeenCalled();
  });

  it("ne quitte pas l'application sur macOS (convention de plateforme)", () => {
    handleWindowAllClosed("darwin");

    expect(mockAppQuit).not.toHaveBeenCalled();
  });
});

describe("killWebServerProcess", () => {
  it("tue le process du serveur web s'il existe", () => {
    const fakeChild = { kill: jest.fn() } as unknown as ChildProcess;

    killWebServerProcess(fakeChild);

    expect(fakeChild.kill).toHaveBeenCalled();
  });

  it("ne lève pas d'exception si aucun process n'a été démarré", () => {
    expect(() => killWebServerProcess(null)).not.toThrow();
  });
});
