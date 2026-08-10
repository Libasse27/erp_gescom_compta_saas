import { useQuery } from "@tanstack/react-query";
import type { JournalEntry } from "@erp/types";
import { authenticatedFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/session/auth-provider";

// Forme allégée renvoyée par GET /accounting/journal-entries : identique au
// détail (@erp/types JournalEntry inclut déjà les lignes, une écriture n'a
// jamais assez de lignes pour justifier une forme de liste distincte comme
// SaleListItem/PurchaseListItem).
export interface JournalEntryListResponse {
  items: JournalEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export interface JournalEntriesFilters {
  page: number;
  pageSize: number;
  search?: string;
  accountId?: string;
}

export function useJournalEntries(filters: JournalEntriesFilters) {
  const { accessToken, status } = useAuth();

  const params = new URLSearchParams();
  params.set("page", String(filters.page));
  params.set("pageSize", String(filters.pageSize));
  if (filters.search) params.set("search", filters.search);
  if (filters.accountId) params.set("accountId", filters.accountId);

  return useQuery({
    queryKey: ["journal-entries", filters],
    queryFn: () =>
      authenticatedFetch<JournalEntryListResponse>(`/accounting/journal-entries?${params.toString()}`, accessToken!),
    enabled: status === "authenticated" && !!accessToken,
    placeholderData: (previous) => previous, // évite un flash "Chargement…" en changeant de page
  });
}

export function useJournalEntry(id: string | null) {
  const { accessToken, status } = useAuth();

  return useQuery({
    queryKey: ["journal-entry", id],
    queryFn: () => authenticatedFetch<JournalEntry>(`/accounting/journal-entries/${id}`, accessToken!),
    enabled: status === "authenticated" && !!accessToken && !!id,
  });
}
