import { useQuery } from "@tanstack/react-query";
import { authenticatedFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/session/auth-provider";

export interface EnterpriseUserSummary {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  roles: string[];
  createdAt: string;
}

export function useEnterpriseUsers() {
  const { accessToken, status } = useAuth();

  return useQuery({
    queryKey: ["users"],
    queryFn: () => authenticatedFetch<EnterpriseUserSummary[]>("/users", accessToken!),
    enabled: status === "authenticated" && !!accessToken,
  });
}
