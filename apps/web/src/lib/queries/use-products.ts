import { useQuery } from "@tanstack/react-query";
import type { Product } from "@erp/types";
import { authenticatedFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/session/auth-provider";

export interface ProductListResponse {
  items: Product[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ProductsFilters {
  page: number;
  pageSize: number;
  search?: string;
  isActive?: boolean;
}

export function useProducts(filters: ProductsFilters) {
  const { accessToken, status } = useAuth();

  const params = new URLSearchParams();
  params.set("page", String(filters.page));
  params.set("pageSize", String(filters.pageSize));
  if (filters.search) params.set("search", filters.search);
  if (filters.isActive !== undefined) params.set("isActive", String(filters.isActive));

  return useQuery({
    queryKey: ["products", filters],
    queryFn: () => authenticatedFetch<ProductListResponse>(`/products?${params.toString()}`, accessToken!),
    enabled: status === "authenticated" && !!accessToken,
    placeholderData: (previous) => previous, // évite un flash "Chargement…" en changeant de page
  });
}
