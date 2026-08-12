import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Purchase, PurchaseStatus } from "@erp/types";
import { extractErrorMessage } from "@erp/utils";
import type { CreatePurchaseInput } from "@erp/validation";
import { apiFetch } from "../api";
import { useAuth } from "../auth-context";
import { assertMutationSucceeded, enqueueMutation, processQueue, useIsOnline } from "../offline";

// Forme allégée renvoyée par GET /purchases (pas le détail complet avec les
// lignes — voir Purchase de @erp/types pour le détail utilisé par GET
// /purchases/:id). Miroir exact de apps/web/src/lib/queries/use-purchases.ts
// et de apps/mobile/src/lib/queries/use-sales.ts (module 5), avec
// supplierId/supplierName au lieu de customerId/customerName.
export interface PurchaseListItem {
  id: string;
  supplierId: string;
  supplierName: string;
  status: PurchaseStatus;
  purchaseDate: string;
  totalExcludingTax: number;
  totalVat: number;
  totalIncludingTax: number;
  linesCount: number;
  createdAt: string;
}

export interface PurchaseListResponse {
  items: PurchaseListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PurchasesFilters {
  page: number;
  pageSize: number;
  search?: string;
  status?: PurchaseStatus;
}

async function fetchJson<T>(path: string, accessToken: string): Promise<T> {
  const res = await apiFetch(path, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(extractErrorMessage(data, "Une erreur est survenue"));
  }
  return data as T;
}

function buildPurchasesQueryString(filters: PurchasesFilters): string {
  const params = new URLSearchParams();
  params.set("page", String(filters.page));
  params.set("pageSize", String(filters.pageSize));
  if (filters.search) params.set("search", filters.search);
  if (filters.status) params.set("status", filters.status);
  return params.toString();
}

// Miroir de apps/mobile/src/lib/queries/use-sales.ts (module 5). Comme Sale,
// Purchase n'a ni PATCH ni route d'ajout/retrait de ligne : createPurchaseSchema
// accepte productId/quantity/unitCostExcludingTax par ligne — le coût est
// saisi par l'utilisateur (négocié avec le fournisseur), contrairement à
// Sale où le prix est résolu depuis Product. vatRateBasisPoints reste résolu
// côté serveur dans les deux cas.
export function usePurchases(filters: PurchasesFilters) {
  const { accessToken, status } = useAuth();

  return useQuery({
    queryKey: ["purchases", filters],
    queryFn: () => fetchJson<PurchaseListResponse>(`/purchases?${buildPurchasesQueryString(filters)}`, accessToken!),
    enabled: status === "authenticated" && !!accessToken,
    // évite un flash "Chargement…" en changeant de page
    placeholderData: (previous) => previous,
  });
}

// Alimente PurchaseDetailScreen — détail complet avec les lignes (Purchase,
// pas PurchaseListItem).
export function usePurchase(id: string | undefined) {
  const { accessToken, status } = useAuth();

  return useQuery({
    queryKey: ["purchase", id],
    queryFn: () => fetchJson<Purchase>(`/purchases/${encodeURIComponent(id!)}`, accessToken!),
    enabled: status === "authenticated" && !!accessToken && !!id,
  });
}

// Seule écriture qui crée un document complet (fournisseur + toutes les
// lignes en une fois) : aucune route d'ajout/retrait de ligne après création
// — même patron offline (ADR-0014) que les modules précédents.
export function useCreatePurchase() {
  const { accessToken } = useAuth();
  const isOnline = useIsOnline();
  const queryClient = useQueryClient();

  return async (values: CreatePurchaseInput): Promise<void> => {
    const queued = await enqueueMutation({
      method: "POST",
      path: "/purchases",
      body: values,
    });
    if (isOnline) {
      await processQueue({ getAccessToken: () => accessToken });
      await assertMutationSucceeded(queued.id);
      await queryClient.invalidateQueries({ queryKey: ["purchases"] });
    }
  };
}

// Confirmer incrémente le stock côté serveur pour chaque ligne
// trackStock=true (StockRepository.applyMovement IN, jamais bloqué par une
// contrainte de stock insuffisant — voir purchases.repository.ts), dans la
// même transaction que le passage à CONFIRMED. Invalide donc aussi le cache
// Stock, comme useConfirmSale.
export function useConfirmPurchase() {
  const { accessToken } = useAuth();
  const isOnline = useIsOnline();
  const queryClient = useQueryClient();

  return async (purchaseId: string): Promise<void> => {
    const queued = await enqueueMutation({
      method: "POST",
      path: `/purchases/${encodeURIComponent(purchaseId)}/confirm`,
    });
    if (isOnline) {
      await processQueue({ getAccessToken: () => accessToken });
      await assertMutationSucceeded(queued.id);
      await queryClient.invalidateQueries({ queryKey: ["purchases"] });
      await queryClient.invalidateQueries({ queryKey: ["purchase", purchaseId] });
      await queryClient.invalidateQueries({ queryKey: ["stock"] });
      await queryClient.invalidateQueries({ queryKey: ["stock-movements"] });
    }
  };
}

// Annuler hors DRAFT renvoie 400, comme pour une vente.
export function useCancelPurchase() {
  const { accessToken } = useAuth();
  const isOnline = useIsOnline();
  const queryClient = useQueryClient();

  return async (purchaseId: string): Promise<void> => {
    const queued = await enqueueMutation({
      method: "POST",
      path: `/purchases/${encodeURIComponent(purchaseId)}/cancel`,
    });
    if (isOnline) {
      await processQueue({ getAccessToken: () => accessToken });
      await assertMutationSucceeded(queued.id);
      await queryClient.invalidateQueries({ queryKey: ["purchases"] });
      await queryClient.invalidateQueries({ queryKey: ["purchase", purchaseId] });
    }
  };
}
