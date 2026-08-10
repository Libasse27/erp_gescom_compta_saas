import { useQuery } from "@tanstack/react-query";
import type { SalesInvoice, SalesInvoiceStatus } from "@erp/types";
import { authenticatedFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/session/auth-provider";

// Miroir de use-sales.ts/use-purchases.ts (modules 5 et 6). Forme allégée
// renvoyée par GET /invoices (pas le détail complet avec les lignes — voir
// SalesInvoiceView côté API, @erp/types SalesInvoice pour le détail utilisé
// par GET /invoices/:id et la réponse de création).
export interface SalesInvoiceListItem {
  id: string;
  saleId: string;
  customerId: string;
  customerName: string;
  number: string;
  status: SalesInvoiceStatus;
  issuedAt: string;
  totalExcludingTax: number;
  totalVat: number;
  totalIncludingTax: number;
  createdAt: string;
}

export interface SalesInvoiceListResponse {
  items: SalesInvoiceListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface InvoicesFilters {
  page: number;
  pageSize: number;
  search?: string;
  status?: SalesInvoiceStatus;
}

export function useInvoices(filters: InvoicesFilters) {
  const { accessToken, status } = useAuth();

  const params = new URLSearchParams();
  params.set("page", String(filters.page));
  params.set("pageSize", String(filters.pageSize));
  if (filters.search) params.set("search", filters.search);
  if (filters.status) params.set("status", filters.status);

  return useQuery({
    queryKey: ["invoices", filters],
    queryFn: () => authenticatedFetch<SalesInvoiceListResponse>(`/invoices?${params.toString()}`, accessToken!),
    enabled: status === "authenticated" && !!accessToken,
    placeholderData: (previous) => previous, // évite un flash "Chargement…" en changeant de page
  });
}

export function useInvoice(id: string | null) {
  const { accessToken, status } = useAuth();

  return useQuery({
    queryKey: ["invoice", id],
    queryFn: () => authenticatedFetch<SalesInvoice>(`/invoices/${id}`, accessToken!),
    enabled: status === "authenticated" && !!accessToken && !!id,
  });
}
