const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

// Les tests d'intégration ne doivent jamais toucher la base de dev : on
// dérive DATABASE_URL vers une base dédiée (créée une fois localement, voir
// docs/database/SCHEMA.md).
//
// Chaque suite *.integration.spec.ts qui boote AppModule ouvre jusqu'à 3
// PrismaClient distincts (identité, tenant, + RawDbClient de fixtures) ;
// sans connection_limit, chacun ouvre par défaut num_cpus*2+1 connexions.
// Avec plusieurs suites en parallèle (Jest --maxWorkers), le total dépasse
// vite max_connections de Postgres (100 par défaut) — observé en CI dès
// l'ajout de la 38e suite intégration : « Too many database connections
// opened ». Capé ici plutôt que dans .env (qui reste inchangé pour le
// dev/debug local hors suite de tests).
function withConnectionLimit(url) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}connection_limit=3&pool_timeout=20`;
}

if (process.env.DATABASE_URL) {
  process.env.DATABASE_URL = withConnectionLimit(
    process.env.DATABASE_URL.replace(/\/erp_saas_dev(\?|$)/, "/erp_saas_test$1"),
  );
}
if (process.env.IDENTITY_DATABASE_URL) {
  process.env.IDENTITY_DATABASE_URL = withConnectionLimit(
    process.env.IDENTITY_DATABASE_URL.replace(/\/erp_saas_dev(\?|$)/, "/erp_saas_test$1"),
  );
}
if (process.env.TENANT_DATABASE_URL) {
  process.env.TENANT_DATABASE_URL = withConnectionLimit(
    process.env.TENANT_DATABASE_URL.replace(/\/erp_saas_dev(\?|$)/, "/erp_saas_test$1"),
  );
}

// Entitlements recalculés à chaque appel en test (pas de cache) : un
// changement de plan/abonnement doit être visible immédiatement dans la
// requête suivante, sans dépendre d'un délai (docs/adr/0005-...).
process.env.ENTITLEMENTS_CACHE_TTL_MS = "0";
// Corrige BIL-04 (docs/audit/BILLING-AUDIT.md) : même raisonnement pour
// JwtAuthGuard — une suspension doit être visible dès la requête suivante
// en test, sans dépendre d'un délai.
process.env.ACCOUNT_STATUS_CACHE_TTL_MS = "0";
