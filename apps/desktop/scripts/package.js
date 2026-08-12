#!/usr/bin/env node
// Assemble un dossier autonome pour apps/web (build + node_modules de
// production, sans dépendre de pnpm ni du reste du monorepo à l'exécution),
// puis compile le process principal Electron et invoque electron-builder.
//
// Utilise `pnpm deploy` plutôt que la sortie Next.js `output: "standalone"` :
// ce dernier recrée des symlinks via fs.symlink lors du traçage des
// fichiers, ce qui échoue avec EPERM sur Windows sans privilèges élevés.
// `pnpm deploy` matérialise le node_modules déployé avec des jonctions
// Windows (autorisées sans élévation), qu'electron-builder peut ensuite
// empaqueter normalement (voir docs/desktop/PACKAGING.md).
const { execSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const desktopRoot = path.join(__dirname, "..");
const monorepoRoot = path.join(desktopRoot, "..", "..");
const webDistDir = path.join(desktopRoot, "web-dist");

function run(command, cwd) {
  console.log(`[package] ${command}`);
  execSync(command, { cwd, stdio: "inherit", shell: true });
}

run("pnpm --filter web build", monorepoRoot);

fs.rmSync(webDistDir, { recursive: true, force: true });
run(`pnpm --filter web deploy "${webDistDir}" --prod`, monorepoRoot);

run("pnpm build", desktopRoot);
run("electron-builder", desktopRoot);
