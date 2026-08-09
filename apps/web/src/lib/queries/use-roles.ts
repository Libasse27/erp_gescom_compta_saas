import { useQuery } from "@tanstack/react-query";
import { authenticatedFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/session/auth-provider";

export interface RoleSummary {
  id: string;
  name: string;
}

export function useRoles() {
  const { accessToken, status } = useAuth();

  return useQuery({
    queryKey: ["roles"],
    queryFn: () => authenticatedFetch<RoleSummary[]>("/roles", accessToken!),
    enabled: status === "authenticated" && !!accessToken,
  });
}
