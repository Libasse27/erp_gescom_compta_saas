import { useQuery } from "@tanstack/react-query";
import type { Sale, SaleStatus } from "@erp/types";
import { authenticatedFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/session/auth-provider";

// Forme allégée renvoyée par GET /sales (pas le détail complet avec les
// lignes — voir SaleView côté API, @erp/types Sale pour le détail utilisé
// par GET /sales/:id et la réponse de création).
export interface SaleListItem {
  id: string;
  customerId: string;
  customerName: string;
  status: SaleStatus;
  saleDate: string;
  totalExcludingTax: number;
  totalVat: number;
  totalIncludingTax: number;
  linesCount: number;
  createdAt: string;
}

export interface SaleListResponse {
  items: SaleListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SalesFilters {
  page: number;
  pageSize: number;
  search?: string;
  status?: SaleStatus;
}

export function useSales(filters: SalesFilters) {
  const { accessToken, status } = useAuth();

  const params = new URLSearchParams();
  params.set("page", String(filters.page));
  params.set("pageSize", String(filters.pageSize));
  if (filters.search) params.set("search", filters.search);
  if (filters.status) params.set("status", filters.status);

  return useQuery({
    queryKey: ["sales", filters],
    queryFn: () => authenticatedFetch<SaleListResponse>(`/sales?${params.toString()}`, accessToken!),
    enabled: status === "authenticated" && !!accessToken,
    placeholderData: (previous) => previous, // évite un flash "Chargement…" en changeant de page
  });
}

export function useSale(id: string | null) {
  const { accessToken, status } = useAuth();

  return useQuery({
    queryKey: ["sale", id],
    queryFn: () => authenticatedFetch<Sale>(`/sales/${id}`, accessToken!),
    enabled: status === "authenticated" && !!accessToken && !!id,
  });
}
