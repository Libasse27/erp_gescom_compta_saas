import { useQuery } from "@tanstack/react-query";
import type { PermissionKey } from "@erp/permissions";
import { extractErrorMessage } from "@erp/utils";
import { useAuth } from "./auth-context";
import { apiFetch } from "./api";

export interface UserContext {
  permissions: string[];
  planCode: string | null;
  subscriptionStatus: string | null;
  features: string[];
}

// Miroir de apps/web/src/lib/queries/use-my-context.ts — pilote la
// visibilité des entrées de navigation (Rôle × Permissions × Plan, jamais
// codé en dur). Mis en cache hors-ligne (voir la liste blanche de
// query-client.ts) : sans ça, un cold start hors-ligne masquerait l'entrée
// "Clients" alors que la liste de clients, elle, resterait consultable.
export function useMyContext() {
  const { accessToken, status } = useAuth();

  return useQuery({
    queryKey: ["users", "me", "context"],
    queryFn: async () => {
      const res = await apiFetch("/users/me/context", { headers: { Authorization: `Bearer ${accessToken}` } });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(extractErrorMessage(data, "Impossible de récupérer les permissions"));
      }
      return data as UserContext;
    },
    enabled: status === "authenticated" && !!accessToken,
  });
}

// Gating au niveau de l'entrée de navigation uniquement (masquer un bouton),
// pas de vérification fine par bouton/champ dans les écrans — même
// discipline que le web : le backend reste la seule autorité réelle, cette
// vérification n'est qu'un confort d'affichage.
export function useHasPermission(key: PermissionKey): boolean {
  const { data } = useMyContext();
  return data?.permissions.includes(key) ?? false;
}
