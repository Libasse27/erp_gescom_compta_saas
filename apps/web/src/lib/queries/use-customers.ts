import { useQuery } from "@tanstack/react-query";
import type { Customer } from "@erp/types";
import { authenticatedFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/session/auth-provider";

export interface CustomerListResponse {
  items: Customer[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CustomersFilters {
  page: number;
  pageSize: number;
  search?: string;
  isActive?: boolean;
}

export function useCustomers(filters: CustomersFilters) {
  const { accessToken, status } = useAuth();

  const params = new URLSearchParams();
  params.set("page", String(filters.page));
  params.set("pageSize", String(filters.pageSize));
  if (filters.search) params.set("search", filters.search);
  if (filters.isActive !== undefined) params.set("isActive", String(filters.isActive));

  return useQuery({
    queryKey: ["customers", filters],
    queryFn: () => authenticatedFetch<CustomerListResponse>(`/customers?${params.toString()}`, accessToken!),
    enabled: status === "authenticated" && !!accessToken,
    placeholderData: (previous) => previous, // évite un flash "Chargement…" en changeant de page
  });
}
