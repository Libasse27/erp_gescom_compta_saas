const path = require("node:path");
const net = require("node:net");
const { execSync } = require("node:child_process");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const DOCKER_COMPOSE_FILE = path.resolve(__dirname, "../../../docker/docker-compose.dev.yml");

function isPortOpen(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port, timeout: timeoutMs });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

// En CI (service container GitHub Actions), Postgres est déjà joignable avant
// ce script : cette fonction ne touche alors jamais à Docker. En local, si
// personne n'a démarré `docker compose`, on le fait ici plutôt que de laisser
// Prisma échouer avec un P1001 opaque.
async function ensurePostgresReachable(host, port) {
  if (await isPortOpen(host, port, 500)) {
    return;
  }

  try {
    execSync(`docker compose -f "${DOCKER_COMPOSE_FILE}" up -d --wait`, {
      stdio: "inherit",
    });
  } catch (err) {
    throw new Error(
      `Postgres de dev est injoignable sur ${host}:${port} et le démarrage ` +
        `automatique via Docker a échoué (${DOCKER_COMPOSE_FILE}). ` +
        "Démarre Docker Desktop puis relance `pnpm test` / `pnpm test:tenant`. " +
        `Erreur d'origine : ${err.message}`,
    );
  }

  if (!(await isPortOpen(host, port, 10_000))) {
    throw new Error(
      `Postgres reste injoignable sur ${host}:${port} après démarrage de ` +
        `${DOCKER_COMPOSE_FILE} — vérifie l'état du conteneur ` +
        "(`docker compose -f docker/docker-compose.dev.yml ps`).",
    );
  }
}

module.exports = async function globalSetup() {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) {
    throw new Error("DATABASE_URL manquant (apps/api/.env) pour les tests d'intégration");
  }

  const { hostname, port } = new URL(baseUrl);
  await ensurePostgresReachable(hostname, Number(port) || 5432);

  const testDatabaseUrl = baseUrl.replace(/\/erp_saas_dev(\?|$)/, "/erp_saas_test$1");

  execSync("npx prisma migrate deploy", {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: testDatabaseUrl },
    stdio: "inherit",
  });
};
