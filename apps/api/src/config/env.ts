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
};
