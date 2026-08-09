export interface RateLimits {
  global: { ttl: number; limit: number };
  auth: { default: { limit: number; ttl: number } };
}

// Limites désactivées en pratique sous Jest (NODE_ENV=test, positionné
// automatiquement par le test runner) : les tests d'intégration enchaînent
// volontairement plus de requêtes que ce qu'un utilisateur ferait en 60s.
export function computeRateLimits(nodeEnv: string | undefined): RateLimits {
  const isTestEnv = nodeEnv === "test";
  return {
    global: { ttl: 60_000, limit: isTestEnv ? 1_000_000 : 100 },
    auth: { default: { limit: isTestEnv ? 1_000_000 : 10, ttl: 60_000 } },
  };
}

const rateLimits = computeRateLimits(process.env.NODE_ENV);
export const GLOBAL_RATE_LIMIT = rateLimits.global;
export const AUTH_RATE_LIMIT = rateLimits.auth;
