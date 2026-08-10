import { useQuery } from "@tanstack/react-query";
import type { AccountWithBalance } from "@erp/types";
import { authenticatedFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/session/auth-provider";

export interface AccountListResponse {
  items: AccountWithBalance[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AccountsFilters {
  page: number;
  pageSize: number;
  search?: string;
}

export function useAccounts(filters: AccountsFilters) {
  const { accessToken, status } = useAuth();

  const params = new URLSearchParams();
  params.set("page", String(filters.page));
  params.set("pageSize", String(filters.pageSize));
  if (filters.search) params.set("search", filters.search);

  return useQuery({
    queryKey: ["accounting-accounts", filters],
    queryFn: () => authenticatedFetch<AccountListResponse>(`/accounting/accounts?${params.toString()}`, accessToken!),
    enabled: status === "authenticated" && !!accessToken,
    placeholderData: (previous) => previous, // évite un flash "Chargement…" en changeant de page
  });
}

export interface TrialBalanceResponse {
  accounts: AccountWithBalance[];
  totalDebit: number;
  totalCredit: number;
}

export function useTrialBalance() {
  const { accessToken, status } = useAuth();

  return useQuery({
    queryKey: ["accounting-trial-balance"],
    queryFn: () => authenticatedFetch<TrialBalanceResponse>("/accounting/trial-balance", accessToken!),
    enabled: status === "authenticated" && !!accessToken,
  });
}
