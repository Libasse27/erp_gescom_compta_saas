"use client";

import { useState } from "react";
import type { StockLevel } from "@erp/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StockMovementForm } from "@/components/stock-movement-form";
import { useStock } from "@/lib/queries/use-stock";
import { useStockMovements } from "@/lib/queries/use-stock-movements";

const PAGE_SIZE = 20;
const MOVEMENTS_PAGE_SIZE = 10;

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  IN: "Entrée",
  OUT: "Sortie",
  ADJUSTMENT: "Correction",
};

export default function StockPage() {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<StockLevel | null>(null);
  const [movementsPage, setMovementsPage] = useState(1);

  const stockQuery = useStock({ page, pageSize: PAGE_SIZE, search: search || undefined });
  const movementsQuery = useStockMovements({
    productId: selectedProduct?.productId ?? null,
    page: movementsPage,
    pageSize: MOVEMENTS_PAGE_SIZE,
  });

  const totalPages = stockQuery.data ? Math.max(1, Math.ceil(stockQuery.data.total / PAGE_SIZE)) : 1;
  const movementsTotalPages = movementsQuery.data
    ? Math.max(1, Math.ceil(movementsQuery.data.total / MOVEMENTS_PAGE_SIZE))
    : 1;

  return (
    <div className="grid gap-6 p-8">
      <h1 className="text-2xl font-semibold">Stocks</h1>

      <Card>
        <CardHeader>
          <CardTitle>Nouveau mouvement</CardTitle>
        </CardHeader>
        <CardContent>
          <StockMovementForm onSaved={() => setMovementsPage(1)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Niveaux de stock</CardTitle>
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
              <label className="text-sm text-muted-foreground" htmlFor="stock-search">
                Recherche
              </label>
              <Input
                id="stock-search"
                placeholder="Nom ou code produit…"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
              />
            </div>
            <Button type="submit" variant="outline">
              Rechercher
            </Button>
          </form>

          {stockQuery.isLoading && <p className="text-sm text-muted-foreground">Chargement…</p>}
          {stockQuery.isError && <p className="text-sm text-destructive">Impossible de charger les stocks.</p>}
          {stockQuery.data?.items.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Aucun produit suivi en stock pour l&apos;instant (le suivi de stock se configure sur la fiche produit).
            </p>
          )}

          {stockQuery.data && stockQuery.data.items.length > 0 && (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4">Code</th>
                    <th className="py-2 pr-4">Désignation</th>
                    <th className="py-2 pr-4">Unité</th>
                    <th className="py-2 pr-4">Quantité en stock</th>
                    <th className="py-2 pr-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {stockQuery.data.items.map((level) => (
                    <tr key={level.productId} className="border-b last:border-0">
                      <td className="py-2 pr-4">{level.code}</td>
                      <td className="py-2 pr-4">{level.name}</td>
                      <td className="py-2 pr-4">{level.unit}</td>
                      <td className="py-2 pr-4">{level.quantityOnHand}</td>
                      <td className="py-2 pr-4">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSelectedProduct(level);
                            setMovementsPage(1);
                          }}
                        >
                          Historique
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Page {stockQuery.data.page} / {totalPages} — {stockQuery.data.total} produit(s)
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

      {selectedProduct && (
        <Card>
          <CardHeader>
            <CardTitle>
              Historique — {selectedProduct.code} ({selectedProduct.name})
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            {movementsQuery.isLoading && <p className="text-sm text-muted-foreground">Chargement…</p>}
            {movementsQuery.data?.items.length === 0 && (
              <p className="text-sm text-muted-foreground">Aucun mouvement pour ce produit.</p>
            )}
            {movementsQuery.data && movementsQuery.data.items.length > 0 && (
              <>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-4">Date</th>
                      <th className="py-2 pr-4">Type</th>
                      <th className="py-2 pr-4">Quantité</th>
                      <th className="py-2 pr-4">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movementsQuery.data.items.map((movement) => (
                      <tr key={movement.id} className="border-b last:border-0">
                        <td className="py-2 pr-4">{new Date(movement.createdAt).toLocaleString("fr-SN")}</td>
                        <td className="py-2 pr-4">{MOVEMENT_TYPE_LABELS[movement.type] ?? movement.type}</td>
                        <td className="py-2 pr-4">{movement.quantity}</td>
                        <td className="py-2 pr-4">{movement.note ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    Page {movementsQuery.data.page} / {movementsTotalPages} — {movementsQuery.data.total} mouvement(s)
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={movementsPage <= 1}
                      onClick={() => setMovementsPage((p) => Math.max(1, p - 1))}
                    >
                      Précédent
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={movementsPage >= movementsTotalPages}
                      onClick={() => setMovementsPage((p) => Math.min(movementsTotalPages, p + 1))}
                    >
                      Suivant
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
