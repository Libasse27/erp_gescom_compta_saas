const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

// Les tests d'intégration ne doivent jamais toucher la base de dev : on
// dérive DATABASE_URL vers une base dédiée (créée une fois localement, voir
// docs/database/SCHEMA.md).
if (process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace(/\/erp_saas_dev(\?|$)/, "/erp_saas_test$1");
}
if (process.env.TENANT_DATABASE_URL) {
  process.env.TENANT_DATABASE_URL = process.env.TENANT_DATABASE_URL.replace(/\/erp_saas_dev(\?|$)/, "/erp_saas_test$1");
}

// Entitlements recalculés à chaque appel en test (pas de cache) : un
// changement de plan/abonnement doit être visible immédiatement dans la
// requête suivante, sans dépendre d'un délai (docs/adr/0005-...).
process.env.ENTITLEMENTS_CACHE_TTL_MS = "0";
