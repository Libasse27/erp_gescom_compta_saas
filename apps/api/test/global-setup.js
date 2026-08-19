const path = require("node:path");
const net = require("node:net");
const { execSync } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");
const { PERMISSION_KEYS } = require("@erp/permissions");
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

  // Catalogue de permissions partagé, seedé une seule fois ici plutôt que
  // par chaque suite *.integration.spec.ts (comme c'était le cas jusqu'ici :
  // ~19 fichiers upsertaient chacun tout ou partie de PERMISSION_KEYS via
  // leur propre PrismaClient). Corrige un P2002 flaky observé en CI : Jest
  // lance plusieurs suites en parallèle (aucun --runInBand/--maxWorkers
  // fixé) contre la même erp_saas_test, et deux upsert() concurrents sur une
  // clé pas encore créée pouvaient tous deux emprunter la branche INSERT,
  // l'un des deux perdant la course sur la contrainte unique Permission.key.
  // globalSetup s'exécute une seule fois dans le process Jest principal,
  // avant que le moindre worker ne démarre : aucune concurrence possible
  // ici. createMany + skipDuplicates (INSERT ... ON CONFLICT DO NOTHING,
  // atomique côté Postgres) plutôt qu'une boucle d'upsert : idempotent et
  // sûr même si globalSetup était réexécuté ou appelé en parallèle d'un
  // `prisma db seed` manuel.
  const prisma = new PrismaClient({ datasources: { db: { url: testDatabaseUrl } } });
  try {
    await prisma.permission.createMany({
      data: PERMISSION_KEYS.map((key) => ({ key })),
      skipDuplicates: true,
    });
  } finally {
    await prisma.$disconnect();
  }
};
