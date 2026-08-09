import { useQuery } from "@tanstack/react-query";
import { authenticatedFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/session/auth-provider";

export interface UserContext {
  permissions: string[];
  planCode: string | null;
  subscriptionStatus: string | null;
  features: string[];
}

// Pilote le menu de l'espace entreprise (Rôle × Permissions × Plan, jamais
// codé en dur — docs/PROMPT-MAITRE-SAAS.md Phase 7.2).
export function useMyContext() {
  const { accessToken, status } = useAuth();

  return useQuery({
    queryKey: ["users", "me", "context"],
    queryFn: () => authenticatedFetch<UserContext>("/users/me/context", accessToken!),
    enabled: status === "authenticated" && !!accessToken,
  });
}
