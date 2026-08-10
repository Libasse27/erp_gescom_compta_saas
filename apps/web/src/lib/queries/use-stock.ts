import { useQuery } from "@tanstack/react-query";
import type { StockLevel } from "@erp/types";
import { authenticatedFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/session/auth-provider";

export interface StockLevelListResponse {
  items: StockLevel[];
  total: number;
  page: number;
  pageSize: number;
}

export interface StockFilters {
  page: number;
  pageSize: number;
  search?: string;
}

export function useStock(filters: StockFilters) {
  const { accessToken, status } = useAuth();

  const params = new URLSearchParams();
  params.set("page", String(filters.page));
  params.set("pageSize", String(filters.pageSize));
  if (filters.search) params.set("search", filters.search);

  return useQuery({
    queryKey: ["stock", filters],
    queryFn: () => authenticatedFetch<StockLevelListResponse>(`/stock?${params.toString()}`, accessToken!),
    enabled: status === "authenticated" && !!accessToken,
    placeholderData: (previous) => previous, // évite un flash "Chargement…" en changeant de page
  });
}
