/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$",
  setupFiles: ["<rootDir>/../test/setup-env.js"],
  globalSetup: "<rootDir>/../test/global-setup.js",
  // Les tests d'intégration enchaînent plusieurs hachages argon2id (coûteux
  // par conception) et des allers-retours Postgres réels ; le timeout par
  // défaut de 5s est trop court une fois plusieurs suites lancées en
  // parallèle (contention CPU entre workers Jest).
  testTimeout: 20_000,
};
