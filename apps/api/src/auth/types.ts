// Contexte utilisateur attaché à la requête par JwtAuthGuard. Toujours
// re-dérivé du JWT vérifié côté serveur — jamais fourni par le client
// (CLAUDE.md §6).
export interface AuthenticatedUser {
  id: string;
  enterpriseId: string | null;
  isSuperAdmin: boolean;
}
