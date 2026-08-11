import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Sale, SaleStatus } from "@erp/types";
import { extractErrorMessage } from "@erp/utils";
import type { CreateSaleInput } from "@erp/validation";
import { apiFetch } from "../api";
import { useAuth } from "../auth-context";
import { assertMutationSucceeded, enqueueMutation, processQueue, useIsOnline } from "../offline";

// Forme allégée renvoyée par GET /sales (pas le détail complet avec les
// lignes — voir Sale de @erp/types pour le détail utilisé par GET
// /sales/:id). Miroir exact de apps/web/src/lib/queries/use-sales.ts.
export interface SaleListItem {
  id: string;
  customerId: string;
  customerName: string;
  status: SaleStatus;
  saleDate: string;
  totalExcludingTax: number;
  totalVat: number;
  totalIncludingTax: number;
  linesCount: number;
  createdAt: string;
}

export interface SaleListResponse {
  items: SaleListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SalesFilters {
  page: number;
  pageSize: number;
  search?: string;
  status?: SaleStatus;
}

async function fetchJson<T>(path: string, accessToken: string): Promise<T> {
  const res = await apiFetch(path, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(extractErrorMessage(data, "Une erreur est survenue"));
  }
  return data as T;
}

function buildSalesQueryString(filters: SalesFilters): string {
  const params = new URLSearchParams();
  params.set("page", String(filters.page));
  params.set("pageSize", String(filters.pageSize));
  if (filters.search) params.set("search", filters.search);
  if (filters.status) params.set("status", filters.status);
  return params.toString();
}

// Miroir de apps/web/src/lib/queries/use-sales.ts, porté sur apiFetch — et de
// apps/mobile/src/lib/queries/use-stock.ts (Phase 9.7). Contrairement à
// Clients/Fournisseurs/Produits (des fiches) et Stock (un grand livre), Sale
// est la première entité à lignes : createSaleSchema n'accepte que
// productId/quantity par ligne, le prix et la TVA sont figés côté serveur
// depuis Product — jamais transmis par le client, jamais modifiables après
// coup (aucune route PATCH sur une ligne).
export function useSales(filters: SalesFilters) {
  const { accessToken, status } = useAuth();

  return useQuery({
    queryKey: ["sales", filters],
    queryFn: () => fetchJson<SaleListResponse>(`/sales?${buildSalesQueryString(filters)}`, accessToken!),
    enabled: status === "authenticated" && !!accessToken,
    // évite un flash "Chargement…" en changeant de page
    placeholderData: (previous) => previous,
  });
}

// Alimente SaleDetailScreen — détail complet avec les lignes (Sale, pas
// SaleListItem).
export function useSale(id: string | undefined) {
  const { accessToken, status } = useAuth();

  return useQuery({
    queryKey: ["sale", id],
    queryFn: () => fetchJson<Sale>(`/sales/${encodeURIComponent(id!)}`, accessToken!),
    enabled: status === "authenticated" && !!accessToken && !!id,
  });
}

// Seule écriture qui crée un document complet (client + toutes les lignes en
// une fois) : aucune route d'ajout/retrait de ligne après création — même
// patron offline (ADR-0014) que les modules précédents.
export function useCreateSale() {
  const { accessToken } = useAuth();
  const isOnline = useIsOnline();
  const queryClient = useQueryClient();

  return async (values: CreateSaleInput): Promise<void> => {
    const queued = await enqueueMutation({
      method: "POST",
      path: "/sales",
      body: values,
    });
    if (isOnline) {
      await processQueue({ getAccessToken: () => accessToken });
      await assertMutationSucceeded(queued.id);
      await queryClient.invalidateQueries({ queryKey: ["sales"] });
    }
  };
}

// Confirmer décrémente le stock côté serveur (StockRepository.applyMovement,
// même transaction Serializable que le passage à CONFIRMED, module Stock
// Phase 9.7) : un rejet 409 "Stock insuffisant" ou un conflit de concurrence
// sont des rejets métier standards déjà couverts par le correctif générique
// de mutation-queue.ts (Phase 9.6) — aucun traitement spécial ici. Invalide
// aussi le cache Stock (amélioration délibérée par rapport au web, qui
// n'affiche pas les niveaux de stock sur le même écran) pour éviter que
// StockLevelsScreen affiche un solde obsolète après une confirmation.
export function useConfirmSale() {
  const { accessToken } = useAuth();
  const isOnline = useIsOnline();
  const queryClient = useQueryClient();

  return async (saleId: string): Promise<void> => {
    const queued = await enqueueMutation({
      method: "POST",
      path: `/sales/${encodeURIComponent(saleId)}/confirm`,
    });
    if (isOnline) {
      await processQueue({ getAccessToken: () => accessToken });
      await assertMutationSucceeded(queued.id);
      await queryClient.invalidateQueries({ queryKey: ["sales"] });
      await queryClient.invalidateQueries({ queryKey: ["sale", saleId] });
      await queryClient.invalidateQueries({ queryKey: ["stock"] });
      await queryClient.invalidateQueries({ queryKey: ["stock-movements"] });
    }
  };
}

// Annuler hors DRAFT renvoie 400 (pas 409, contrairement à confirmer) —
// différence de code déjà tranchée côté API, sans conséquence ici : le
// correctif générique de mutation-queue.ts lit le corps quel que soit le
// code 4xx.
export function useCancelSale() {
  const { accessToken } = useAuth();
  const isOnline = useIsOnline();
  const queryClient = useQueryClient();

  return async (saleId: string): Promise<void> => {
    const queued = await enqueueMutation({
      method: "POST",
      path: `/sales/${encodeURIComponent(saleId)}/cancel`,
    });
    if (isOnline) {
      await processQueue({ getAccessToken: () => accessToken });
      await assertMutationSucceeded(queued.id);
      await queryClient.invalidateQueries({ queryKey: ["sales"] });
      await queryClient.invalidateQueries({ queryKey: ["sale", saleId] });
    }
  };
}
