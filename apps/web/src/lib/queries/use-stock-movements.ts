import { useQuery } from "@tanstack/react-query";
import type { StockMovement } from "@erp/types";
import { authenticatedFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/session/auth-provider";

export interface StockMovementListResponse {
  items: StockMovement[];
  total: number;
  page: number;
  pageSize: number;
}

export interface StockMovementsFilters {
  productId: string | null;
  page: number;
  pageSize: number;
}

export function useStockMovements(filters: StockMovementsFilters) {
  const { accessToken, status } = useAuth();

  const params = new URLSearchParams();
  params.set("page", String(filters.page));
  params.set("pageSize", String(filters.pageSize));

  return useQuery({
    queryKey: ["stock-movements", filters],
    queryFn: () =>
      authenticatedFetch<StockMovementListResponse>(
        `/stock/${filters.productId}/movements?${params.toString()}`,
        accessToken!,
      ),
    enabled: status === "authenticated" && !!accessToken && !!filters.productId,
    placeholderData: (previous) => previous,
  });
}
