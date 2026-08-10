import { useQuery } from "@tanstack/react-query";
import type { IncomeStatement, PurchasesReport, SalesReport } from "@erp/types";
import { authenticatedFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/session/auth-provider";

export interface ReportPeriodFilters {
  dateFrom?: string;
  dateTo?: string;
}

function toParams(filters: ReportPeriodFilters): string {
  const params = new URLSearchParams();
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  return params.toString();
}

export function useSalesReport(filters: ReportPeriodFilters) {
  const { accessToken, status } = useAuth();

  return useQuery({
    queryKey: ["reports-sales", filters],
    queryFn: () => authenticatedFetch<SalesReport>(`/reports/sales?${toParams(filters)}`, accessToken!),
    enabled: status === "authenticated" && !!accessToken,
  });
}

export function usePurchasesReport(filters: ReportPeriodFilters) {
  const { accessToken, status } = useAuth();

  return useQuery({
    queryKey: ["reports-purchases", filters],
    queryFn: () => authenticatedFetch<PurchasesReport>(`/reports/purchases?${toParams(filters)}`, accessToken!),
    enabled: status === "authenticated" && !!accessToken,
  });
}

export function useIncomeStatement(filters: ReportPeriodFilters) {
  const { accessToken, status } = useAuth();

  return useQuery({
    queryKey: ["reports-income-statement", filters],
    queryFn: () => authenticatedFetch<IncomeStatement>(`/reports/income-statement?${toParams(filters)}`, accessToken!),
    enabled: status === "authenticated" && !!accessToken,
  });
}
