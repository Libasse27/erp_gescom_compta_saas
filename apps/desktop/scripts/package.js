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

function run(command, cwd, extraEnv = {}) {
  console.log(`[package] ${command}`);
  execSync(command, { cwd, stdio: "inherit", shell: true, env: { ...process.env, ...extraEnv } });
}

// Corrige D-01 (docs/audit/DESKTOP-AUDIT.md) : NEXT_PUBLIC_API_URL est
// inlinée dans le bundle JavaScript au moment du build Next.js (comme toute
// variable NEXT_PUBLIC_*), jamais lue au runtime — sans ce garde-fou, ce
// script buildait silencieusement avec le défaut de développement
// (http://localhost:3000, voir apps/web/src/lib/api.ts), rendant tout
// paquet inutilisable hors du poste où il a été construit. Contrairement à
// apps/web/Dockerfile (qui documente déjà ce piège via --build-arg),
// aucune valeur de repli n'est fournie ici : le projet n'a pas encore de
// domaine de production réel (docker/.env.prod.example utilise encore le
// placeholder "https://api.change-me.example") — un défaut inventé serait
// aussi silencieusement trompeur qu'un défaut localhost. À l'opérateur de
// fournir explicitement l'URL de l'API visée par ce paquet.
const DESKTOP_API_URL = process.env.DESKTOP_API_URL;
if (!DESKTOP_API_URL) {
  console.error(
    "[package] DESKTOP_API_URL manquant. L'URL de l'API NestJS que ce paquet " +
      "doit contacter n'a jamais de valeur par défaut (corrige D-01, " +
      "docs/audit/DESKTOP-AUDIT.md) : un défaut localhost ou inventé produirait " +
      "silencieusement un paquet inutilisable hors du poste de build.\n" +
      '  Exemple : DESKTOP_API_URL="https://api.mondomaine.example" pnpm --filter @erp/desktop package',
  );
  process.exit(1);
}

run("pnpm --filter web build", monorepoRoot, { NEXT_PUBLIC_API_URL: DESKTOP_API_URL });

fs.rmSync(webDistDir, { recursive: true, force: true });
run(`pnpm --filter web deploy "${webDistDir}" --prod ${NODE_LINKER}`, monorepoRoot);

run("pnpm build", desktopRoot);
run("electron-builder", desktopRoot);
