import { useQuery } from "@tanstack/react-query";
import { authenticatedFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/session/auth-provider";

export interface MySubscription {
  planCode: string;
  planName: string;
  priceMonthly: number;
  priceYearly: number | null;
  maxUsers: number | null;
  status: string;
  startDate: string;
  trialEndDate: string | null;
  renewalDate: string | null;
  cancelledAt: string | null;
}

export function useMySubscription() {
  const { accessToken, status } = useAuth();

  return useQuery({
    queryKey: ["subscriptions", "me"],
    queryFn: () => authenticatedFetch<MySubscription>("/subscriptions/me", accessToken!),
    enabled: status === "authenticated" && !!accessToken,
    retry: false,
  });
}
