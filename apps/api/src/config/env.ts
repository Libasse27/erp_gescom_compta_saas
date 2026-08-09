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
};
