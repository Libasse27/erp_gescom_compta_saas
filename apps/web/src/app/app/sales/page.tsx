"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SaleStatus } from "@erp/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SaleForm } from "@/components/sale-form";
import { authenticatedFetch, ApiClientError } from "@/lib/api-client";
import { useAuth } from "@/lib/session/auth-provider";
import { useSale, useSales } from "@/lib/queries/use-sales";

const PAGE_SIZE = 20;

type StatusFilter = SaleStatus | "ALL";

function formatFCFA(amount: number): string {
  return `${amount.toLocaleString("fr-SN")} FCFA`;
}

const STATUS_LABELS: Record<SaleStatus, string> = {
  DRAFT: "Brouillon",
  CONFIRMED: "Confirmée",
  CANCELLED: "Annulée",
};

export default function SalesPage() {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const salesQuery = useSales({
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    status: statusFilter === "ALL" ? undefined : statusFilter,
  });
  const selectedSaleQuery = useSale(selectedSaleId);

  const confirmMutation = useMutation({
    mutationFn: (id: string) => authenticatedFetch(`/sales/${id}/confirm`, accessToken!, { method: "POST" }),
    onSuccess: (_data, id) => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["sale", id] });
    },
    onError: (error) => {
      setActionError(error instanceof ApiClientError ? error.message : "Une erreur est survenue");
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => authenticatedFetch(`/sales/${id}/cancel`, accessToken!, { method: "POST" }),
    onSuccess: (_data, id) => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["sale", id] });
    },
    onError: (error) => {
      setActionError(error instanceof ApiClientError ? error.message : "Une erreur est survenue");
    },
  });

  const totalPages = salesQuery.data ? Math.max(1, Math.ceil(salesQuery.data.total / PAGE_SIZE)) : 1;

  return (
    <div className="grid gap-6 p-8">
      <h1 className="text-2xl font-semibold">Ventes</h1>

      <Card>
        <CardHeader>
          <CardTitle>Nouvelle vente</CardTitle>
        </CardHeader>
        <CardContent>
          <SaleForm onSaved={() => setActionError(null)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Liste des ventes</CardTitle>
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
              <label className="text-sm text-muted-foreground" htmlFor="sale-search">
                Recherche
              </label>
              <Input
                id="sale-search"
                placeholder="Nom du client…"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <label className="text-sm text-muted-foreground" htmlFor="sale-status-filter">
                Statut
              </label>
              <select
                id="sale-status-filter"
                className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
                value={statusFilter}
                onChange={(event) => {
                  setPage(1);
                  setStatusFilter(event.target.value as StatusFilter);
                }}
              >
                <option value="ALL">Tous</option>
                <option value="DRAFT">Brouillon</option>
                <option value="CONFIRMED">Confirmée</option>
                <option value="CANCELLED">Annulée</option>
              </select>
            </div>
            <Button type="submit" variant="outline">
              Rechercher
            </Button>
          </form>

          {salesQuery.isLoading && <p className="text-sm text-muted-foreground">Chargement…</p>}
          {salesQuery.isError && <p className="text-sm text-destructive">Impossible de charger les ventes.</p>}
          {salesQuery.data?.items.length === 0 && (
            <p className="text-sm text-muted-foreground">Aucune vente pour l&apos;instant.</p>
          )}
          {actionError && <p className="text-sm text-destructive">{actionError}</p>}

          {salesQuery.data && salesQuery.data.items.length > 0 && (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4">Client</th>
                    <th className="py-2 pr-4">Date</th>
                    <th className="py-2 pr-4">Lignes</th>
                    <th className="py-2 pr-4">Total TTC</th>
                    <th className="py-2 pr-4">Statut</th>
                    <th className="py-2 pr-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {salesQuery.data.items.map((sale) => (
                    <tr key={sale.id} className="border-b last:border-0">
                      <td className="py-2 pr-4">{sale.customerName}</td>
                      <td className="py-2 pr-4">{new Date(sale.saleDate).toLocaleDateString("fr-SN")}</td>
                      <td className="py-2 pr-4">{sale.linesCount}</td>
                      <td className="py-2 pr-4">{formatFCFA(sale.totalIncludingTax)}</td>
                      <td className="py-2 pr-4">{STATUS_LABELS[sale.status]}</td>
                      <td className="py-2 pr-4">
                        <div className="flex items-center gap-2">
                          <Button type="button" size="sm" variant="outline" onClick={() => setSelectedSaleId(sale.id)}>
                            Détail
                          </Button>
                          {sale.status === "DRAFT" && (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                disabled={confirmMutation.isPending}
                                onClick={() => confirmMutation.mutate(sale.id)}
                              >
                                Confirmer
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={cancelMutation.isPending}
                                onClick={() => cancelMutation.mutate(sale.id)}
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
                  Page {salesQuery.data.page} / {totalPages} — {salesQuery.data.total} vente(s)
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

      {selectedSaleId && (
        <Card>
          <CardHeader>
            <CardTitle>
              Détail de la vente
              {selectedSaleQuery.data ? ` — ${selectedSaleQuery.data.customerName}` : ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            {selectedSaleQuery.isLoading && <p className="text-sm text-muted-foreground">Chargement…</p>}
            {selectedSaleQuery.data && (
              <>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-4">Produit</th>
                      <th className="py-2 pr-4">Quantité</th>
                      <th className="py-2 pr-4">Prix HT</th>
                      <th className="py-2 pr-4">Total HT</th>
                      <th className="py-2 pr-4">Total TTC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedSaleQuery.data.lines.map((line) => (
                      <tr key={line.id} className="border-b last:border-0">
                        <td className="py-2 pr-4">
                          {line.productCode} — {line.productName}
                        </td>
                        <td className="py-2 pr-4">{line.quantity}</td>
                        <td className="py-2 pr-4">{formatFCFA(line.unitPriceExcludingTax)}</td>
                        <td className="py-2 pr-4">{formatFCFA(line.lineTotalExcludingTax)}</td>
                        <td className="py-2 pr-4">{formatFCFA(line.lineTotalIncludingTax)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-sm text-muted-foreground">
                  Total HT {formatFCFA(selectedSaleQuery.data.totalExcludingTax)} — TVA{" "}
                  {formatFCFA(selectedSaleQuery.data.totalVat)} — TTC{" "}
                  {formatFCFA(selectedSaleQuery.data.totalIncludingTax)}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
