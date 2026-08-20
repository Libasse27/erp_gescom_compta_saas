export interface RateLimits {
  global: { ttl: number; limit: number };
  auth: { default: { limit: number; ttl: number } };
  webhooks: { default: { limit: number; ttl: number } };
}

// Limites désactivées en pratique sous Jest (NODE_ENV=test, positionné
// automatiquement par le test runner) : les tests d'intégration enchaînent
// volontairement plus de requêtes que ce qu'un utilisateur ferait en 60s.
export function computeRateLimits(nodeEnv: string | undefined): RateLimits {
  const isTestEnv = nodeEnv === "test";
  return {
    global: { ttl: 60_000, limit: isTestEnv ? 1_000_000 : 100 },
    auth: { default: { limit: isTestEnv ? 1_000_000 : 10, ttl: 60_000 } },
    // Corrige BIL-15 (docs/audit/BILLING-AUDIT.md) : /webhooks/payments/:provider
    // reçoit du trafic serveur-à-serveur (fournisseur de paiement livrant en
    // rafale ou rejouant un lot après panne réseau), pas du trafic
    // utilisateur — la limite globale (100/min) le pénaliserait à tort.
    // 300/min : nettement au-dessus du global, sans ouvrir un accès illimité.
    webhooks: { default: { limit: isTestEnv ? 1_000_000 : 300, ttl: 60_000 } },
  };
}

const rateLimits = computeRateLimits(process.env.NODE_ENV);
export const GLOBAL_RATE_LIMIT = rateLimits.global;
export const AUTH_RATE_LIMIT = rateLimits.auth;
export const WEBHOOK_RATE_LIMIT = rateLimits.webhooks;
