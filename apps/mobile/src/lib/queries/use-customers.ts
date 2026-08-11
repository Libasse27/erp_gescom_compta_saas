import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Customer } from "@erp/types";
import { extractErrorMessage } from "@erp/utils";
import type { CreateCustomerInput } from "@erp/validation";
import { apiFetch } from "../api";
import { useAuth } from "../auth-context";
import { assertMutationSucceeded, enqueueMutation, processQueue, useIsOnline } from "../offline";

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

async function fetchJson<T>(path: string, accessToken: string): Promise<T> {
  const res = await apiFetch(path, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(extractErrorMessage(data, "Une erreur est survenue"));
  }
  return data as T;
}

function buildCustomersQueryString(filters: CustomersFilters): string {
  const params = new URLSearchParams();
  params.set("page", String(filters.page));
  params.set("pageSize", String(filters.pageSize));
  if (filters.search) params.set("search", filters.search);
  if (filters.isActive !== undefined) params.set("isActive", String(filters.isActive));
  return params.toString();
}

// Miroir de apps/web/src/lib/queries/use-customers.ts, porté sur apiFetch.
export function useCustomers(filters: CustomersFilters) {
  const { accessToken, status } = useAuth();

  return useQuery({
    queryKey: ["customers", filters],
    queryFn: () => fetchJson<CustomerListResponse>(`/customers?${buildCustomersQueryString(filters)}`, accessToken!),
    enabled: status === "authenticated" && !!accessToken,
    // évite un flash "Chargement…" en changeant de page
    placeholderData: (previous) => previous,
  });
}

// Alimente ClientFormScreen en mode édition.
export function useCustomer(id: string | undefined) {
  const { accessToken, status } = useAuth();

  return useQuery({
    queryKey: ["customers", id],
    queryFn: () => fetchJson<Customer>(`/customers/${encodeURIComponent(id!)}`, accessToken!),
    enabled: status === "authenticated" && !!accessToken && !!id,
  });
}

// Les écritures passent par la file de mutations hors-ligne (ADR-0014 :
// TanStack Query ne sert qu'au cache de lecture dans cette architecture
// mobile) — pas par un useMutation classique comme sur le web.
export function useSaveCustomer() {
  const { accessToken } = useAuth();
  const isOnline = useIsOnline();
  const queryClient = useQueryClient();

  return async (input: { customerId?: string; values: CreateCustomerInput }): Promise<void> => {
    const path = input.customerId ? `/customers/${encodeURIComponent(input.customerId)}` : "/customers";
    const queued = await enqueueMutation({
      method: input.customerId ? "PATCH" : "POST",
      path,
      body: input.values,
    });
    // useSyncEngine ne re-déclenche processQueue que sur une transition de
    // statut/connectivité (apps/mobile/src/lib/offline/sync-engine.ts) — pas
    // quand cette mutation vient d'être insérée pendant qu'on est déjà en
    // ligne. Sans ce rejeu immédiat, elle resterait "pending" en SQLite
    // jusqu'au prochain changement de connectivité.
    if (isOnline) {
      await processQueue({ getAccessToken: () => accessToken });
      // Un rejet serveur définitif (ex: 403 si la permission a été retirée
      // entre-temps) ne doit jamais ressortir comme un succès silencieux —
      // revue sécurité Phase 9.4.
      await assertMutationSucceeded(queued.id);
      await queryClient.invalidateQueries({ queryKey: ["customers"] });
    }
    // Hors-ligne : pas la peine d'attendre le timeout de 15s d'apiFetch pour
    // rien — apiFetch ne consulte pas NetInfo lui-même. L'écran affiche des
    // données non rafraîchies ; sync-engine.ts rejouera au retour réseau et
    // invalidera alors le cache lui-même.
  };
}

export function useDeactivateCustomer() {
  const { accessToken } = useAuth();
  const isOnline = useIsOnline();
  const queryClient = useQueryClient();

  return async (customerId: string): Promise<void> => {
    const queued = await enqueueMutation({
      method: "DELETE",
      path: `/customers/${encodeURIComponent(customerId)}`,
    });
    if (isOnline) {
      await processQueue({ getAccessToken: () => accessToken });
      await assertMutationSucceeded(queued.id);
      await queryClient.invalidateQueries({ queryKey: ["customers"] });
    }
  };
}
