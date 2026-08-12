import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SalesInvoice, SalesInvoiceStatus } from "@erp/types";
import { extractErrorMessage } from "@erp/utils";
import type { CreateSalesInvoiceInput } from "@erp/validation";
import { apiFetch } from "../api";
import { useAuth } from "../auth-context";
import { assertMutationSucceeded, enqueueMutation, processQueue, useIsOnline } from "../offline";

// Forme allégée renvoyée par GET /invoices (pas le détail complet avec les
// lignes — voir SalesInvoice de @erp/types pour le détail utilisé par GET
// /invoices/:id). Miroir de apps/web/src/lib/queries/use-invoices.ts et de
// apps/mobile/src/lib/queries/use-purchases.ts (module 6).
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

async function fetchJson<T>(path: string, accessToken: string): Promise<T> {
  const res = await apiFetch(path, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(extractErrorMessage(data, "Une erreur est survenue"));
  }
  return data as T;
}

function buildInvoicesQueryString(filters: InvoicesFilters): string {
  const params = new URLSearchParams();
  params.set("page", String(filters.page));
  params.set("pageSize", String(filters.pageSize));
  if (filters.search) params.set("search", filters.search);
  if (filters.status) params.set("status", filters.status);
  return params.toString();
}

// Contrairement à Sale/Purchase : pas de statut DRAFT (une facture est émise
// directement à la création — voir createSalesInvoiceSchema), donc pas de
// mutation de création de brouillon suivie d'une confirmation séparée.
export function useInvoices(filters: InvoicesFilters) {
  const { accessToken, status } = useAuth();

  return useQuery({
    queryKey: ["invoices", filters],
    queryFn: () => fetchJson<SalesInvoiceListResponse>(`/invoices?${buildInvoicesQueryString(filters)}`, accessToken!),
    enabled: status === "authenticated" && !!accessToken,
    // évite un flash "Chargement…" en changeant de page
    placeholderData: (previous) => previous,
  });
}

// Alimente InvoiceDetailScreen — détail complet avec les lignes (SalesInvoice,
// pas SalesInvoiceListItem).
export function useInvoice(id: string | undefined) {
  const { accessToken, status } = useAuth();

  return useQuery({
    queryKey: ["invoice", id],
    queryFn: () => fetchJson<SalesInvoice>(`/invoices/${encodeURIComponent(id!)}`, accessToken!),
    enabled: status === "authenticated" && !!accessToken && !!id,
  });
}

// Contrairement à useCreateSale/useCreatePurchase : ne prend que saleId, pas
// de lignes — une facture transforme une vente CONFIRMED déjà existante
// (ses lignes ne sont jamais ressaisies). Une vente déjà facturée renvoie un
// 409, propagé comme n'importe quel rejet de mutation en file.
export function useCreateInvoice() {
  const { accessToken } = useAuth();
  const isOnline = useIsOnline();
  const queryClient = useQueryClient();

  return async (values: CreateSalesInvoiceInput): Promise<void> => {
    const queued = await enqueueMutation({
      method: "POST",
      path: "/invoices",
      body: values,
    });
    if (isOnline) {
      await processQueue({ getAccessToken: () => accessToken });
      await assertMutationSucceeded(queued.id);
      await queryClient.invalidateQueries({ queryKey: ["invoices"] });
    }
  };
}

// Marquer payée n'a aucun effet sur le stock (contrairement à confirmer une
// vente/un achat) : pas d'invalidation du cache Stock ici.
export function useMarkInvoicePaid() {
  const { accessToken } = useAuth();
  const isOnline = useIsOnline();
  const queryClient = useQueryClient();

  return async (invoiceId: string): Promise<void> => {
    const queued = await enqueueMutation({
      method: "POST",
      path: `/invoices/${encodeURIComponent(invoiceId)}/mark-paid`,
    });
    if (isOnline) {
      await processQueue({ getAccessToken: () => accessToken });
      await assertMutationSucceeded(queued.id);
      await queryClient.invalidateQueries({ queryKey: ["invoices"] });
      await queryClient.invalidateQueries({ queryKey: ["invoice", invoiceId] });
    }
  };
}

// Annuler (void) une facture ISSUED — PAID ne peut plus être annulée
// (contrôlé côté serveur, le bouton n'est qu'une commodité d'affichage,
// comme pour Sale/Purchase).
export function useVoidInvoice() {
  const { accessToken } = useAuth();
  const isOnline = useIsOnline();
  const queryClient = useQueryClient();

  return async (invoiceId: string): Promise<void> => {
    const queued = await enqueueMutation({
      method: "POST",
      path: `/invoices/${encodeURIComponent(invoiceId)}/void`,
    });
    if (isOnline) {
      await processQueue({ getAccessToken: () => accessToken });
      await assertMutationSucceeded(queued.id);
      await queryClient.invalidateQueries({ queryKey: ["invoices"] });
      await queryClient.invalidateQueries({ queryKey: ["invoice", invoiceId] });
    }
  };
}
