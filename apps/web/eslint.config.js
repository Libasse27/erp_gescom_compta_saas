// @ts-check
const tseslint = require("typescript-eslint");
const reactHooks = require("eslint-plugin-react-hooks");
const baseConfig = require("../../eslint.config.js");

// Config locale : voir apps/api/eslint.config.js pour l'explication du même
// motif. Aucune règle React n'existe dans le config racine (partagé avec des
// packages non-React) — ajoutée ici, au premier code JSX du monorepo.
module.exports = tseslint.config(...baseConfig, {
  files: ["src/**/*.{ts,tsx}"],
  plugins: { "react-hooks": reactHooks },
  rules: reactHooks.configs.flat.recommended.rules,
});
