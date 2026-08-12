import { useQuery } from "@tanstack/react-query";
import type { IncomeStatement, PurchasesReport, SalesReport } from "@erp/types";
import { extractErrorMessage } from "@erp/utils";
import { apiFetch } from "../api";
import { useAuth } from "../auth-context";

// Module 9 (dernier) de la Phase 9 : lecture seule, aucune écriture — pas de
// file de mutations hors-ligne ici, contrairement à tous les modules
// précédents. Miroir de apps/web/src/lib/queries/use-reports.ts, porté sur
// apiFetch. Une période vide n'est pas remplacée par un défaut ici : chaque
// endpoint applique le sien côté serveur (mois en cours pour ventes/achats,
// année civile en cours pour le compte de résultat — voir ReportsRepository).
export interface ReportPeriodFilters {
  dateFrom?: string;
  dateTo?: string;
}

async function fetchJson<T>(path: string, accessToken: string): Promise<T> {
  const res = await apiFetch(path, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(extractErrorMessage(data, "Une erreur est survenue"));
  }
  return data as T;
}

function buildReportQueryString(filters: ReportPeriodFilters): string {
  const params = new URLSearchParams();
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  return params.toString();
}

export function useSalesReport(filters: ReportPeriodFilters) {
  const { accessToken, status } = useAuth();

  return useQuery({
    queryKey: ["reports-sales", filters],
    queryFn: () => fetchJson<SalesReport>(`/reports/sales?${buildReportQueryString(filters)}`, accessToken!),
    enabled: status === "authenticated" && !!accessToken,
  });
}

export function usePurchasesReport(filters: ReportPeriodFilters) {
  const { accessToken, status } = useAuth();

  return useQuery({
    queryKey: ["reports-purchases", filters],
    queryFn: () => fetchJson<PurchasesReport>(`/reports/purchases?${buildReportQueryString(filters)}`, accessToken!),
    enabled: status === "authenticated" && !!accessToken,
  });
}

export function useIncomeStatement(filters: ReportPeriodFilters) {
  const { accessToken, status } = useAuth();

  return useQuery({
    queryKey: ["reports-income-statement", filters],
    queryFn: () =>
      fetchJson<IncomeStatement>(`/reports/income-statement?${buildReportQueryString(filters)}`, accessToken!),
    enabled: status === "authenticated" && !!accessToken,
  });
}
