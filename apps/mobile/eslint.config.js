// @ts-check
const tseslint = require("typescript-eslint");
const reactHooks = require("eslint-plugin-react-hooks");
const baseConfig = require("../../eslint.config.js");

// Config locale : voir apps/api/eslint.config.js pour l'explication du même
// motif. Même besoin que apps/web/eslint.config.js (règles React sur du JSX).
module.exports = tseslint.config(...baseConfig, {
  files: ["**/*.{ts,tsx}"],
  ignores: ["**/dist/**", "**/.expo/**"],
  plugins: { "react-hooks": reactHooks },
  rules: reactHooks.configs.flat.recommended.rules,
});
