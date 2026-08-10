"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Product } from "@erp/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ProductForm } from "@/components/product-form";
import { authenticatedFetch, ApiClientError } from "@/lib/api-client";
import { useAuth } from "@/lib/session/auth-provider";
import { useProducts } from "@/lib/queries/use-products";

const PAGE_SIZE = 20;

type ActiveFilter = "active" | "inactive" | "all";

function isActiveParam(filter: ActiveFilter): boolean | undefined {
  if (filter === "active") return true;
  if (filter === "inactive") return false;
  return undefined;
}

function formatFCFA(amount: number): string {
  return `${amount.toLocaleString("fr-SN")} FCFA`;
}

export default function ProductsPage() {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("active");
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [confirmingDeactivateId, setConfirmingDeactivateId] = useState<string | null>(null);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  const productsQuery = useProducts({
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    isActive: isActiveParam(activeFilter),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => authenticatedFetch(`/products/${id}`, accessToken!, { method: "DELETE" }),
    onSuccess: () => {
      setDeactivateError(null);
      setConfirmingDeactivateId(null);
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (error) => {
      setDeactivateError(error instanceof ApiClientError ? error.message : "Une erreur est survenue");
    },
  });

  const totalPages = productsQuery.data ? Math.max(1, Math.ceil(productsQuery.data.total / PAGE_SIZE)) : 1;

  return (
    <div className="grid gap-6 p-8">
      <h1 className="text-2xl font-semibold">Produits</h1>

      <Card>
        <CardHeader>
          <CardTitle>{editingProduct ? "Modifier le produit" : "Nouveau produit"}</CardTitle>
        </CardHeader>
        <CardContent>
          <ProductForm
            editingProduct={editingProduct}
            onSaved={() => setEditingProduct(null)}
            onCancelEdit={() => setEditingProduct(null)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Liste des produits</CardTitle>
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
              <label className="text-sm text-muted-foreground" htmlFor="product-search">
                Recherche
              </label>
              <Input
                id="product-search"
                placeholder="Nom, code ou code-barres…"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <label className="text-sm text-muted-foreground" htmlFor="product-active-filter">
                Statut
              </label>
              <select
                id="product-active-filter"
                className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
                value={activeFilter}
                onChange={(event) => {
                  setPage(1);
                  setActiveFilter(event.target.value as ActiveFilter);
                }}
              >
                <option value="active">Actifs</option>
                <option value="inactive">Désactivés</option>
                <option value="all">Tous</option>
              </select>
            </div>
            <Button type="submit" variant="outline">
              Rechercher
            </Button>
          </form>

          {productsQuery.isLoading && <p className="text-sm text-muted-foreground">Chargement…</p>}
          {productsQuery.isError && <p className="text-sm text-destructive">Impossible de charger les produits.</p>}
          {productsQuery.data?.items.length === 0 && (
            <p className="text-sm text-muted-foreground">Aucun produit pour l&apos;instant.</p>
          )}
          {deactivateError && <p className="text-sm text-destructive">{deactivateError}</p>}

          {productsQuery.data && productsQuery.data.items.length > 0 && (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4">Code</th>
                    <th className="py-2 pr-4">Désignation</th>
                    <th className="py-2 pr-4">Prix HT</th>
                    <th className="py-2 pr-4">TVA</th>
                    <th className="py-2 pr-4">Stock suivi</th>
                    <th className="py-2 pr-4">Statut</th>
                    <th className="py-2 pr-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {productsQuery.data.items.map((product) => (
                    <tr key={product.id} className="border-b last:border-0">
                      <td className="py-2 pr-4">{product.code}</td>
                      <td className="py-2 pr-4">{product.name}</td>
                      <td className="py-2 pr-4">{formatFCFA(product.sellingPriceExcludingTax)}</td>
                      <td className="py-2 pr-4">{(product.vatRateBasisPoints / 100).toLocaleString("fr-SN")} %</td>
                      <td className="py-2 pr-4">{product.trackStock ? "Oui" : "Non"}</td>
                      <td className="py-2 pr-4">{product.isActive ? "Actif" : "Désactivé"}</td>
                      <td className="py-2 pr-4">
                        {confirmingDeactivateId === product.id ? (
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">Confirmer ?</span>
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              disabled={deactivateMutation.isPending}
                              onClick={() => deactivateMutation.mutate(product.id)}
                            >
                              Oui
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => setConfirmingDeactivateId(null)}
                            >
                              Annuler
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Button type="button" size="sm" variant="outline" onClick={() => setEditingProduct(product)}>
                              Modifier
                            </Button>
                            {product.isActive && (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => setConfirmingDeactivateId(product.id)}
                              >
                                Désactiver
                              </Button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Page {productsQuery.data.page} / {totalPages} — {productsQuery.data.total} produit(s)
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
    </div>
  );
}
