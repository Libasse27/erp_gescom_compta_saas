import { useQuery } from "@tanstack/react-query";
import { authenticatedFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/session/auth-provider";

export interface PlatformOverview {
  totalEnterprises: number;
  activeEnterprises: number;
  suspendedEnterprises: number;
  newEnterprisesLast30Days: number;
  totalUsers: number;
  activeSubscriptions: number;
  expiredSubscriptions: number;
  pendingPayments: number;
  failedPayments: number;
  totalRevenue: number;
}

export function usePlatformOverview() {
  const { accessToken, status, user } = useAuth();

  return useQuery({
    queryKey: ["admin", "overview"],
    queryFn: () => authenticatedFetch<PlatformOverview>("/admin/overview", accessToken!),
    enabled: status === "authenticated" && !!accessToken && !!user?.isSuperAdmin,
  });
}
