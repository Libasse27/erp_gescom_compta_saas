// @ts-check
const tseslint = require("typescript-eslint");
const baseConfig = require("../../eslint.config.js");

// Config locale : voir apps/api/eslint.config.js pour l'explication du même
// motif. Process principal Electron (Node), pas de JSX ici.
module.exports = tseslint.config(...baseConfig, {
  ignores: ["**/dist/**", "**/release/**"],
});
