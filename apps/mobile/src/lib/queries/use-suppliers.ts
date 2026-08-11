import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Supplier } from "@erp/types";
import { extractErrorMessage } from "@erp/utils";
import type { CreateSupplierInput } from "@erp/validation";
import { apiFetch } from "../api";
import { useAuth } from "../auth-context";
import { assertMutationSucceeded, enqueueMutation, processQueue, useIsOnline } from "../offline";

export interface SupplierListResponse {
  items: Supplier[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SuppliersFilters {
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

function buildSuppliersQueryString(filters: SuppliersFilters): string {
  const params = new URLSearchParams();
  params.set("page", String(filters.page));
  params.set("pageSize", String(filters.pageSize));
  if (filters.search) params.set("search", filters.search);
  if (filters.isActive !== undefined) params.set("isActive", String(filters.isActive));
  return params.toString();
}

// Miroir de apps/web/src/lib/queries/use-suppliers.ts, porté sur apiFetch —
// et de apps/mobile/src/lib/queries/use-customers.ts (Phase 9.4), Supplier
// étant une copie conforme de Customer (packages/types/src/index.ts).
export function useSuppliers(filters: SuppliersFilters) {
  const { accessToken, status } = useAuth();

  return useQuery({
    queryKey: ["suppliers", filters],
    queryFn: () => fetchJson<SupplierListResponse>(`/suppliers?${buildSuppliersQueryString(filters)}`, accessToken!),
    enabled: status === "authenticated" && !!accessToken,
    // évite un flash "Chargement…" en changeant de page
    placeholderData: (previous) => previous,
  });
}

// Alimente SupplierFormScreen en mode édition.
export function useSupplier(id: string | undefined) {
  const { accessToken, status } = useAuth();

  return useQuery({
    queryKey: ["suppliers", id],
    queryFn: () => fetchJson<Supplier>(`/suppliers/${encodeURIComponent(id!)}`, accessToken!),
    enabled: status === "authenticated" && !!accessToken && !!id,
  });
}

// Les écritures passent par la file de mutations hors-ligne (ADR-0014 :
// TanStack Query ne sert qu'au cache de lecture dans cette architecture
// mobile) — pas par un useMutation classique comme sur le web.
export function useSaveSupplier() {
  const { accessToken } = useAuth();
  const isOnline = useIsOnline();
  const queryClient = useQueryClient();

  return async (input: { supplierId?: string; values: CreateSupplierInput }): Promise<void> => {
    const path = input.supplierId ? `/suppliers/${encodeURIComponent(input.supplierId)}` : "/suppliers";
    const queued = await enqueueMutation({
      method: input.supplierId ? "PATCH" : "POST",
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
      await queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    }
    // Hors-ligne : pas la peine d'attendre le timeout de 15s d'apiFetch pour
    // rien — apiFetch ne consulte pas NetInfo lui-même. L'écran affiche des
    // données non rafraîchies ; sync-engine.ts rejouera au retour réseau et
    // invalidera alors le cache lui-même.
  };
}

export function useDeactivateSupplier() {
  const { accessToken } = useAuth();
  const isOnline = useIsOnline();
  const queryClient = useQueryClient();

  return async (supplierId: string): Promise<void> => {
    const queued = await enqueueMutation({
      method: "DELETE",
      path: `/suppliers/${encodeURIComponent(supplierId)}`,
    });
    if (isOnline) {
      await processQueue({ getAccessToken: () => accessToken });
      await assertMutationSucceeded(queued.id);
      await queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    }
  };
}
