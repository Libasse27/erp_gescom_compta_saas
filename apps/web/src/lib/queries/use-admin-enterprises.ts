import { useQuery } from "@tanstack/react-query";
import { authenticatedFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/session/auth-provider";

export interface AdminEnterpriseEntry {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  planCode: string | null;
  planName: string | null;
  subscriptionStatus: string | null;
}

export function useAdminEnterprises() {
  const { accessToken, status, user } = useAuth();

  return useQuery({
    queryKey: ["admin", "enterprises"],
    queryFn: () => authenticatedFetch<AdminEnterpriseEntry[]>("/admin/enterprises", accessToken!),
    enabled: status === "authenticated" && !!accessToken && !!user?.isSuperAdmin,
  });
}
