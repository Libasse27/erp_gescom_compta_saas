/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$",
  setupFiles: ["<rootDir>/../test/setup-env.js"],
  globalSetup: "<rootDir>/../test/global-setup.js",
};
