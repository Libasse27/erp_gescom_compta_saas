import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { StockLevel, StockMovement } from "@erp/types";
import { extractErrorMessage } from "@erp/utils";
import type { CreateStockMovementInput } from "@erp/validation";
import { apiFetch } from "../api";
import { useAuth } from "../auth-context";
import { assertMutationSucceeded, enqueueMutation, processQueue, useIsOnline } from "../offline";

export interface StockLevelListResponse {
  items: StockLevel[];
  total: number;
  page: number;
  pageSize: number;
}

export interface StockLevelsFilters {
  page: number;
  pageSize: number;
  search?: string;
}

export interface StockMovementListResponse {
  items: StockMovement[];
  total: number;
  page: number;
  pageSize: number;
}

export interface StockMovementsFilters {
  productId: string;
  page: number;
  pageSize: number;
}

async function fetchJson<T>(path: string, accessToken: string): Promise<T> {
  const res = await apiFetch(path, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(extractErrorMessage(data, "Une erreur est survenue"));
  }
  return data as T;
}

function buildStockLevelsQueryString(filters: StockLevelsFilters): string {
  const params = new URLSearchParams();
  params.set("page", String(filters.page));
  params.set("pageSize", String(filters.pageSize));
  if (filters.search) params.set("search", filters.search);
  return params.toString();
}

// Miroir de apps/web/src/lib/queries/use-stock.ts, porté sur apiFetch —
// et de apps/mobile/src/lib/queries/use-products.ts (Phase 9.6). Contrairement
// à Clients/Fournisseurs/Produits (des fiches), StockLevel est une vue
// calculée (agrégation Prisma groupBy côté API, pas un modèle) : pas de
// useStockLevel(id) unique, pas d'écriture sur ce endpoint (lecture seule).
export function useStockLevels(filters: StockLevelsFilters) {
  const { accessToken, status } = useAuth();

  return useQuery({
    queryKey: ["stock", filters],
    queryFn: () => fetchJson<StockLevelListResponse>(`/stock?${buildStockLevelsQueryString(filters)}`, accessToken!),
    enabled: status === "authenticated" && !!accessToken,
    // évite un flash "Chargement…" en changeant de page
    placeholderData: (previous) => previous,
  });
}

// Alimente StockMovementHistoryScreen. Contrairement à use-stock-movements.ts
// (web), productId est toujours défini côté mobile — la route
// StockMovementHistory l'impose (pas de garde productId: string | null).
export function useStockMovements(filters: StockMovementsFilters) {
  const { accessToken, status } = useAuth();

  return useQuery({
    queryKey: ["stock-movements", filters],
    queryFn: () =>
      fetchJson<StockMovementListResponse>(
        `/stock/${encodeURIComponent(filters.productId)}/movements?page=${filters.page}&pageSize=${filters.pageSize}`,
        accessToken!,
      ),
    enabled: status === "authenticated" && !!accessToken,
  });
}

// Seule écriture de ce module (StockMovement est un grand livre append-only,
// aucune route PATCH/DELETE côté API — voir stock.controller.ts) : toujours
// POST /stock/movements, pas de variante création/édition comme
// useSaveProduct. Même patron offline (ADR-0014) que les 3 modules
// précédents : la file de mutations hors-ligne, pas useMutation classique.
export function useCreateStockMovement() {
  const { accessToken } = useAuth();
  const isOnline = useIsOnline();
  const queryClient = useQueryClient();

  return async (values: CreateStockMovementInput): Promise<void> => {
    const queued = await enqueueMutation({
      method: "POST",
      path: "/stock/movements",
      body: values,
    });
    if (isOnline) {
      await processQueue({ getAccessToken: () => accessToken });
      // Un rejet serveur définitif (409 "Stock insuffisant", ou conflit de
      // concurrence sur la transaction Serializable) ne doit jamais ressortir
      // comme un succès silencieux — revue sécurité Phase 9.4, message
      // désormais fiable depuis le correctif mutation-queue.ts de la Phase 9.6.
      await assertMutationSucceeded(queued.id);
      // Préfixe large côté invalidation (comme le web) : un mouvement sur un
      // produit peut faire évoluer n'importe quelle vue affichée, pas la peine
      // de cibler un seul productId.
      await queryClient.invalidateQueries({ queryKey: ["stock"] });
      await queryClient.invalidateQueries({ queryKey: ["stock-movements"] });
    }
    // Hors-ligne : pas la peine d'attendre le timeout de 15s d'apiFetch pour
    // rien — apiFetch ne consulte pas NetInfo lui-même. L'écran affiche des
    // données non rafraîchies ; sync-engine.ts rejouera au retour réseau et
    // invalidera alors le cache lui-même.
  };
}
