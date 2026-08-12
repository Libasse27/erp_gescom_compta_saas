import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { JournalEntry } from "@erp/types";
import { extractErrorMessage } from "@erp/utils";
import type { CreateJournalEntryInput } from "@erp/validation";
import { apiFetch } from "../api";
import { useAuth } from "../auth-context";
import { assertMutationSucceeded, enqueueMutation, processQueue, useIsOnline } from "../offline";

// Forme allégée renvoyée par GET /accounting/journal-entries : identique au
// détail (@erp/types JournalEntry inclut déjà les lignes, une écriture n'a
// jamais assez de lignes pour justifier une forme de liste distincte comme
// SaleListItem/PurchaseListItem) — miroir de
// apps/web/src/lib/queries/use-journal-entries.ts.
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

async function fetchJson<T>(path: string, accessToken: string): Promise<T> {
  const res = await apiFetch(path, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(extractErrorMessage(data, "Une erreur est survenue"));
  }
  return data as T;
}

function buildJournalEntriesQueryString(filters: JournalEntriesFilters): string {
  const params = new URLSearchParams();
  params.set("page", String(filters.page));
  params.set("pageSize", String(filters.pageSize));
  if (filters.search) params.set("search", filters.search);
  if (filters.accountId) params.set("accountId", filters.accountId);
  return params.toString();
}

export function useJournalEntries(filters: JournalEntriesFilters) {
  const { accessToken, status } = useAuth();

  return useQuery({
    queryKey: ["journal-entries", filters],
    queryFn: () =>
      fetchJson<JournalEntryListResponse>(
        `/accounting/journal-entries?${buildJournalEntriesQueryString(filters)}`,
        accessToken!,
      ),
    enabled: status === "authenticated" && !!accessToken,
    // évite un flash "Chargement…" en changeant de page
    placeholderData: (previous) => previous,
  });
}

// Alimente JournalEntryDetailScreen.
export function useJournalEntry(id: string | undefined) {
  const { accessToken, status } = useAuth();

  return useQuery({
    queryKey: ["journal-entry", id],
    queryFn: () => fetchJson<JournalEntry>(`/accounting/journal-entries/${encodeURIComponent(id!)}`, accessToken!),
    enabled: status === "authenticated" && !!accessToken && !!id,
  });
}

// Comme StockMovement (module 4) : JournalEntry est un grand livre
// append-only, aucune route PATCH/DELETE côté API (une correction se fait
// par une nouvelle écriture de contre-passation, jamais en modifiant
// l'historique — voir journal.controller.ts). L'équilibre débit=crédit est
// revérifié côté serveur (createJournalEntrySchema), jamais fait confiance
// côté client seul. Invalide aussi les comptes ET la balance : chaque
// écriture change les soldes calculés à la lecture.
export function useCreateJournalEntry() {
  const { accessToken } = useAuth();
  const isOnline = useIsOnline();
  const queryClient = useQueryClient();

  return async (values: CreateJournalEntryInput): Promise<void> => {
    const queued = await enqueueMutation({
      method: "POST",
      path: "/accounting/journal-entries",
      body: values,
    });
    if (isOnline) {
      await processQueue({ getAccessToken: () => accessToken });
      await assertMutationSucceeded(queued.id);
      await queryClient.invalidateQueries({ queryKey: ["journal-entries"] });
      await queryClient.invalidateQueries({ queryKey: ["accounting-accounts"] });
      await queryClient.invalidateQueries({ queryKey: ["accounting-trial-balance"] });
    }
  };
}
