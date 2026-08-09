import { PaymentProvider } from "@prisma/client";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variable d'environnement manquante : ${name}`);
  }
  return value;
}

// Point d'accès unique aux variables d'environnement de apps/api. Lazy (des
// fonctions, pas des constantes évaluées à l'import) pour que les tests
// puissent surcharger process.env avant le premier appel.
export const env = {
  jwtAccessSecret: () => requireEnv("JWT_ACCESS_SECRET"),
  jwtAccessTtl: () => process.env.JWT_ACCESS_TTL ?? "15m",
  jwtRefreshTtl: () => process.env.JWT_REFRESH_TTL ?? "30d",
  mfaEncryptionKey: () => requireEnv("MFA_ENCRYPTION_KEY"),
  tenantDatabaseUrl: () => requireEnv("TENANT_DATABASE_URL"),
  // Recalcul serveur à chaque requête (docs/adr/0005-...), jamais dans le
  // JWT ; ce court cache mémoire borne juste la charge Postgres. 0 en test
  // pour un comportement déterministe (voir test/setup-env.js).
  entitlementsCacheTtlMs: () => Number(process.env.ENTITLEMENTS_CACHE_TTL_MS ?? 5000),
  // Secret HMAC générique par fournisseur (Phase 5, docs/adr/0010-...) : un
  // placeholder par fournisseur en attendant le schéma de signature réel de
  // chaque vendeur (identifiants marchands non disponibles à ce stade).
  paymentWebhookSecret: (provider: PaymentProvider) => requireEnv(`PAYMENT_WEBHOOK_SECRET_${provider}`),
  paymentGracePeriodDays: () => Number(process.env.PAYMENT_GRACE_PERIOD_DAYS ?? 7),
  // Liste blanche stricte (CLAUDE.md §6) — jamais "*". apps/web appelle
  // l'API directement depuis le navigateur pour les requêtes authentifiées
  // (Phase 7) ; séparées par virgule pour couvrir plusieurs environnements
  // (ex: preview Vercel + prod) sans redéploiement de code.
  corsAllowedOrigins: () =>
    requireEnv("CORS_ALLOWED_ORIGINS")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
};
