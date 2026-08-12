import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AccountWithBalance } from "@erp/types";
import { extractErrorMessage } from "@erp/utils";
import type { CreateAccountInput } from "@erp/validation";
import { apiFetch } from "../api";
import { useAuth } from "../auth-context";
import { assertMutationSucceeded, enqueueMutation, processQueue, useIsOnline } from "../offline";

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

export interface TrialBalanceResponse {
  accounts: AccountWithBalance[];
  totalDebit: number;
  totalCredit: number;
}

async function fetchJson<T>(path: string, accessToken: string): Promise<T> {
  const res = await apiFetch(path, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(extractErrorMessage(data, "Une erreur est survenue"));
  }
  return data as T;
}

// Miroir de apps/web/src/lib/queries/use-accounts.ts, porté sur apiFetch.
// Contrairement à Sale/Purchase/SalesInvoice : pas de useAccount(id) — la
// liste renvoie déjà AccountWithBalance (solde calculé à la lecture, jamais
// stocké), et il n'y a pas d'écran de détail dédié (voir AccountFormScreen,
// création uniquement — pas d'édition sur mobile, comme sur le web : seul
// label est modifiable côté API mais aucune UI ne l'expose dans ce cycle).
export function useAccounts(filters: AccountsFilters) {
  const { accessToken, status } = useAuth();

  return useQuery({
    queryKey: ["accounting-accounts", filters],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("page", String(filters.page));
      params.set("pageSize", String(filters.pageSize));
      if (filters.search) params.set("search", filters.search);
      return fetchJson<AccountListResponse>(`/accounting/accounts?${params.toString()}`, accessToken!);
    },
    enabled: status === "authenticated" && !!accessToken,
    // évite un flash "Chargement…" en changeant de page
    placeholderData: (previous) => previous,
  });
}

// Jamais paginée (voir AccountsRepository.trialBalance côté API) — une forme
// de réponse différente de la liste standard, alimente TrialBalanceScreen.
export function useTrialBalance() {
  const { accessToken, status } = useAuth();

  return useQuery({
    queryKey: ["accounting-trial-balance"],
    queryFn: () => fetchJson<TrialBalanceResponse>("/accounting/trial-balance", accessToken!),
    enabled: status === "authenticated" && !!accessToken,
  });
}

// Pas de PATCH exposé ici (voir accounts.controller.ts : update existe côté
// API mais aucune UI mobile ou web ne le propose dans ce cycle — le code
// SYSCOHADA est immuable une fois créé, seul label serait modifiable). Une
// écriture invalide aussi la balance : un nouveau compte y apparaît avec un
// solde à zéro.
export function useCreateAccount() {
  const { accessToken } = useAuth();
  const isOnline = useIsOnline();
  const queryClient = useQueryClient();

  return async (values: CreateAccountInput): Promise<void> => {
    const queued = await enqueueMutation({
      method: "POST",
      path: "/accounting/accounts",
      body: values,
    });
    if (isOnline) {
      await processQueue({ getAccessToken: () => accessToken });
      await assertMutationSucceeded(queued.id);
      await queryClient.invalidateQueries({ queryKey: ["accounting-accounts"] });
      await queryClient.invalidateQueries({ queryKey: ["accounting-trial-balance"] });
    }
  };
}
