const nextJest = require("next/jest");

const createJestConfig = nextJest({ dir: "./" });

/** @type {import('jest').Config} */
const customJestConfig = {
  testEnvironment: "jest-environment-jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  testPathIgnorePatterns: ["<rootDir>/.next/", "<rootDir>/node_modules/"],
  // next/jest ne dérive pas moduleNameMapper de tsconfig.json "paths" — à
  // déclarer explicitement (même alias que "@/*": ["./src/*"]).
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  // Le premier rendu d'un test donné compile à froid (SWC) la chaîne
  // Radix/react-hook-form/zod ; combiné aux délais réels de
  // @testing-library/user-event, ça dépasse les 5s par défaut de Jest sur
  // les tout premiers tests d'un fichier (cf. apps/api/jest.config.js,
  // même justification).
  testTimeout: 15_000,
};

// next/jest injecte la config SWC/CSS/next.config.mjs — nécessaire pour
// transformer le TSX des Server/Client Components sans dépendance babel/ts-jest
// supplémentaire (cf. audit WEB-001, docs/audit/WEB-AUDIT.md).
module.exports = createJestConfig(customJestConfig);
