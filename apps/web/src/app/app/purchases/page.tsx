"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PurchaseStatus } from "@erp/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PurchaseForm } from "@/components/purchase-form";
import { authenticatedFetch, ApiClientError } from "@/lib/api-client";
import { useAuth } from "@/lib/session/auth-provider";
import { usePurchase, usePurchases } from "@/lib/queries/use-purchases";

const PAGE_SIZE = 20;

type StatusFilter = PurchaseStatus | "ALL";

function formatFCFA(amount: number): string {
  return `${amount.toLocaleString("fr-SN")} FCFA`;
}

const STATUS_LABELS: Record<PurchaseStatus, string> = {
  DRAFT: "Brouillon",
  CONFIRMED: "Confirmé",
  CANCELLED: "Annulé",
};

// Miroir de apps/app/sales/page.tsx (module 5).
export default function PurchasesPage() {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [selectedPurchaseId, setSelectedPurchaseId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const purchasesQuery = usePurchases({
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    status: statusFilter === "ALL" ? undefined : statusFilter,
  });
  const selectedPurchaseQuery = usePurchase(selectedPurchaseId);

  const confirmMutation = useMutation({
    mutationFn: (id: string) => authenticatedFetch(`/purchases/${id}/confirm`, accessToken!, { method: "POST" }),
    onSuccess: (_data, id) => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ["purchases"] });
      queryClient.invalidateQueries({ queryKey: ["purchase", id] });
    },
    onError: (error) => {
      setActionError(error instanceof ApiClientError ? error.message : "Une erreur est survenue");
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => authenticatedFetch(`/purchases/${id}/cancel`, accessToken!, { method: "POST" }),
    onSuccess: (_data, id) => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ["purchases"] });
      queryClient.invalidateQueries({ queryKey: ["purchase", id] });
    },
    onError: (error) => {
      setActionError(error instanceof ApiClientError ? error.message : "Une erreur est survenue");
    },
  });

  const totalPages = purchasesQuery.data ? Math.max(1, Math.ceil(purchasesQuery.data.total / PAGE_SIZE)) : 1;

  return (
    <div className="grid gap-6 p-8">
      <h1 className="text-2xl font-semibold">Achats</h1>

      <Card>
        <CardHeader>
          <CardTitle>Nouvel achat</CardTitle>
        </CardHeader>
        <CardContent>
          <PurchaseForm onSaved={() => setActionError(null)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Liste des achats</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              setSearch(searchInput);
            }}
          >
            <div className="grid gap-1.5">
              <label className="text-sm text-muted-foreground" htmlFor="purchase-search">
                Recherche
              </label>
              <Input
                id="purchase-search"
                placeholder="Nom du fournisseur…"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <label className="text-sm text-muted-foreground" htmlFor="purchase-status-filter">
                Statut
              </label>
              <select
                id="purchase-status-filter"
                className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
                value={statusFilter}
                onChange={(event) => {
                  setPage(1);
                  setStatusFilter(event.target.value as StatusFilter);
                }}
              >
                <option value="ALL">Tous</option>
                <option value="DRAFT">Brouillon</option>
                <option value="CONFIRMED">Confirmé</option>
                <option value="CANCELLED">Annulé</option>
              </select>
            </div>
            <Button type="submit" variant="outline">
              Rechercher
            </Button>
          </form>

          {purchasesQuery.isLoading && <p className="text-sm text-muted-foreground">Chargement…</p>}
          {purchasesQuery.isError && <p className="text-sm text-destructive">Impossible de charger les achats.</p>}
          {purchasesQuery.data?.items.length === 0 && (
            <p className="text-sm text-muted-foreground">Aucun achat pour l&apos;instant.</p>
          )}
          {actionError && <p className="text-sm text-destructive">{actionError}</p>}

          {purchasesQuery.data && purchasesQuery.data.items.length > 0 && (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4">Fournisseur</th>
                    <th className="py-2 pr-4">Date</th>
                    <th className="py-2 pr-4">Lignes</th>
                    <th className="py-2 pr-4">Total TTC</th>
                    <th className="py-2 pr-4">Statut</th>
                    <th className="py-2 pr-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {purchasesQuery.data.items.map((purchase) => (
                    <tr key={purchase.id} className="border-b last:border-0">
                      <td className="py-2 pr-4">{purchase.supplierName}</td>
                      <td className="py-2 pr-4">{new Date(purchase.purchaseDate).toLocaleDateString("fr-SN")}</td>
                      <td className="py-2 pr-4">{purchase.linesCount}</td>
                      <td className="py-2 pr-4">{formatFCFA(purchase.totalIncludingTax)}</td>
                      <td className="py-2 pr-4">{STATUS_LABELS[purchase.status]}</td>
                      <td className="py-2 pr-4">
                        <div className="flex items-center gap-2">
                          <Button type="button" size="sm" variant="outline" onClick={() => setSelectedPurchaseId(purchase.id)}>
                            Détail
                          </Button>
                          {purchase.status === "DRAFT" && (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                disabled={confirmMutation.isPending}
                                onClick={() => confirmMutation.mutate(purchase.id)}
                              >
                                Confirmer
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={cancelMutation.isPending}
                                onClick={() => cancelMutation.mutate(purchase.id)}
                              >
                                Annuler
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Page {purchasesQuery.data.page} / {totalPages} — {purchasesQuery.data.total} achat(s)
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Précédent
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Suivant
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {selectedPurchaseId && (
        <Card>
          <CardHeader>
            <CardTitle>
              Détail de l&apos;achat
              {selectedPurchaseQuery.data ? ` — ${selectedPurchaseQuery.data.supplierName}` : ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            {selectedPurchaseQuery.isLoading && <p className="text-sm text-muted-foreground">Chargement…</p>}
            {selectedPurchaseQuery.data && (
              <>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-4">Produit</th>
                      <th className="py-2 pr-4">Quantité</th>
                      <th className="py-2 pr-4">Coût HT</th>
                      <th className="py-2 pr-4">Total HT</th>
                      <th className="py-2 pr-4">Total TTC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedPurchaseQuery.data.lines.map((line) => (
                      <tr key={line.id} className="border-b last:border-0">
                        <td className="py-2 pr-4">
                          {line.productCode} — {line.productName}
                        </td>
                        <td className="py-2 pr-4">{line.quantity}</td>
                        <td className="py-2 pr-4">{formatFCFA(line.unitCostExcludingTax)}</td>
                        <td className="py-2 pr-4">{formatFCFA(line.lineTotalExcludingTax)}</td>
                        <td className="py-2 pr-4">{formatFCFA(line.lineTotalIncludingTax)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-sm text-muted-foreground">
                  Total HT {formatFCFA(selectedPurchaseQuery.data.totalExcludingTax)} — TVA{" "}
                  {formatFCFA(selectedPurchaseQuery.data.totalVat)} — TTC{" "}
                  {formatFCFA(selectedPurchaseQuery.data.totalIncludingTax)}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
