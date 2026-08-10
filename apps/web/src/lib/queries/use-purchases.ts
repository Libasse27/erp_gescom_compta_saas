import { useQuery } from "@tanstack/react-query";
import type { Purchase, PurchaseStatus } from "@erp/types";
import { authenticatedFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/session/auth-provider";

// Miroir de use-sales.ts (module 5). Forme allégée renvoyée par GET
// /purchases (pas le détail complet avec les lignes — voir PurchaseView côté
// API, @erp/types Purchase pour le détail utilisé par GET /purchases/:id et
// la réponse de création).
export interface PurchaseListItem {
  id: string;
  supplierId: string;
  supplierName: string;
  status: PurchaseStatus;
  purchaseDate: string;
  totalExcludingTax: number;
  totalVat: number;
  totalIncludingTax: number;
  linesCount: number;
  createdAt: string;
}

export interface PurchaseListResponse {
  items: PurchaseListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PurchasesFilters {
  page: number;
  pageSize: number;
  search?: string;
  status?: PurchaseStatus;
}

export function usePurchases(filters: PurchasesFilters) {
  const { accessToken, status } = useAuth();

  const params = new URLSearchParams();
  params.set("page", String(filters.page));
  params.set("pageSize", String(filters.pageSize));
  if (filters.search) params.set("search", filters.search);
  if (filters.status) params.set("status", filters.status);

  return useQuery({
    queryKey: ["purchases", filters],
    queryFn: () => authenticatedFetch<PurchaseListResponse>(`/purchases?${params.toString()}`, accessToken!),
    enabled: status === "authenticated" && !!accessToken,
    placeholderData: (previous) => previous, // évite un flash "Chargement…" en changeant de page
  });
}

export function usePurchase(id: string | null) {
  const { accessToken, status } = useAuth();

  return useQuery({
    queryKey: ["purchase", id],
    queryFn: () => authenticatedFetch<Purchase>(`/purchases/${id}`, accessToken!),
    enabled: status === "authenticated" && !!accessToken && !!id,
  });
}
