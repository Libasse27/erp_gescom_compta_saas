import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Product } from "@erp/types";
import { extractErrorMessage } from "@erp/utils";
import type { CreateProductInput } from "@erp/validation";
import { apiFetch } from "../api";
import { useAuth } from "../auth-context";
import { assertMutationSucceeded, enqueueMutation, processQueue, useIsOnline } from "../offline";

export interface ProductListResponse {
  items: Product[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ProductsFilters {
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

function buildProductsQueryString(filters: ProductsFilters): string {
  const params = new URLSearchParams();
  params.set("page", String(filters.page));
  params.set("pageSize", String(filters.pageSize));
  if (filters.search) params.set("search", filters.search);
  if (filters.isActive !== undefined) params.set("isActive", String(filters.isActive));
  return params.toString();
}

// Miroir de apps/web/src/lib/queries/use-products.ts, porté sur apiFetch —
// et de apps/mobile/src/lib/queries/use-suppliers.ts (Phase 9.5).
export function useProducts(filters: ProductsFilters) {
  const { accessToken, status } = useAuth();

  return useQuery({
    queryKey: ["products", filters],
    queryFn: () => fetchJson<ProductListResponse>(`/products?${buildProductsQueryString(filters)}`, accessToken!),
    enabled: status === "authenticated" && !!accessToken,
    // évite un flash "Chargement…" en changeant de page
    placeholderData: (previous) => previous,
  });
}

// Alimente ProductFormScreen en mode édition.
export function useProduct(id: string | undefined) {
  const { accessToken, status } = useAuth();

  return useQuery({
    queryKey: ["products", id],
    queryFn: () => fetchJson<Product>(`/products/${encodeURIComponent(id!)}`, accessToken!),
    enabled: status === "authenticated" && !!accessToken && !!id,
  });
}

// Les écritures passent par la file de mutations hors-ligne (ADR-0014 :
// TanStack Query ne sert qu'au cache de lecture dans cette architecture
// mobile) — pas par un useMutation classique comme sur le web.
export function useSaveProduct() {
  const { accessToken } = useAuth();
  const isOnline = useIsOnline();
  const queryClient = useQueryClient();

  return async (input: { productId?: string; values: CreateProductInput }): Promise<void> => {
    const path = input.productId ? `/products/${encodeURIComponent(input.productId)}` : "/products";
    const queued = await enqueueMutation({
      method: input.productId ? "PATCH" : "POST",
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
      // Un rejet serveur définitif (ex: 409 sur un code produit déjà utilisé)
      // ne doit jamais ressortir comme un succès silencieux — revue sécurité
      // Phase 9.4, message désormais fiable depuis le correctif
      // mutation-queue.ts de la Phase 9.6.
      await assertMutationSucceeded(queued.id);
      await queryClient.invalidateQueries({ queryKey: ["products"] });
    }
    // Hors-ligne : pas la peine d'attendre le timeout de 15s d'apiFetch pour
    // rien — apiFetch ne consulte pas NetInfo lui-même. L'écran affiche des
    // données non rafraîchies ; sync-engine.ts rejouera au retour réseau et
    // invalidera alors le cache lui-même.
  };
}

export function useDeactivateProduct() {
  const { accessToken } = useAuth();
  const isOnline = useIsOnline();
  const queryClient = useQueryClient();

  return async (productId: string): Promise<void> => {
    const queued = await enqueueMutation({
      method: "DELETE",
      path: `/products/${encodeURIComponent(productId)}`,
    });
    if (isOnline) {
      await processQueue({ getAccessToken: () => accessToken });
      await assertMutationSucceeded(queued.id);
      await queryClient.invalidateQueries({ queryKey: ["products"] });
    }
  };
}
