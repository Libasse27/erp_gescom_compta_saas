#!/usr/bin/env node
// Assemble un dossier autonome pour apps/web (build + node_modules de
// production, sans dépendre de pnpm ni du reste du monorepo à l'exécution),
// puis compile le process principal Electron et invoque electron-builder.
//
// Utilise `pnpm deploy` plutôt que la sortie Next.js `output: "standalone"` :
// ce dernier recrée des symlinks via fs.symlink lors du traçage des
// fichiers, ce qui échoue avec EPERM sur Windows sans privilèges élevés.
//
// `--config.node-linker=hoisted` est déterminant : par défaut, `pnpm deploy`
// matérialise le node_modules déployé avec des jonctions Windows vers un
// store virtuel `.pnpm/` — electron-builder copie ces jonctions sans erreur,
// mais son parcours de fichiers ne les traverse pas, si bien que le paquet
// final se retrouvait avec un `node_modules` vide (voir
// docs/desktop/PACKAGING.md, section « Ce qui ne fonctionne pas encore »).
// Le linker "hoisted" produit un node_modules classique, à plat, sans aucune
// jonction ni store virtuel — un simple arbre de fichiers réels que
// n'importe quel outil de copie (electron-builder inclus) gère normalement.
const NODE_LINKER = "--config.node-linker=hoisted";
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
run(`pnpm --filter web deploy "${webDistDir}" --prod ${NODE_LINKER}`, monorepoRoot);

run("pnpm build", desktopRoot);
run("electron-builder", desktopRoot);
