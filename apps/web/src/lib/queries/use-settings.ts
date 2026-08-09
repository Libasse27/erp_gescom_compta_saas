import { useQuery } from "@tanstack/react-query";
import { authenticatedFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/session/auth-provider";

export interface SettingSummary {
  key: string;
  value: unknown;
  updatedAt: string;
}

export function useSettings() {
  const { accessToken, status } = useAuth();

  return useQuery({
    queryKey: ["settings"],
    queryFn: () => authenticatedFetch<SettingSummary[]>("/settings", accessToken!),
    enabled: status === "authenticated" && !!accessToken,
  });
}
