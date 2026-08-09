const path = require("node:path");
const { execSync } = require("node:child_process");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

// Jest exécute globalSetup dans un processus séparé des workers de test :
// on ne peut pas compter sur setup-env.js ici, donc on recalcule l'URL.
// Prérequis local (une fois) : `CREATE DATABASE erp_saas_test;` — voir
// docs/database/SCHEMA.md.
module.exports = async function globalSetup() {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) {
    throw new Error("DATABASE_URL manquant (apps/api/.env) pour les tests d'intégration");
  }
  const testDatabaseUrl = baseUrl.replace(/\/erp_saas_dev(\?|$)/, "/erp_saas_test$1");

  execSync("npx prisma migrate deploy", {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: testDatabaseUrl },
    stdio: "inherit",
  });
};
