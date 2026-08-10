"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Supplier } from "@erp/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SupplierForm } from "@/components/supplier-form";
import { authenticatedFetch, ApiClientError } from "@/lib/api-client";
import { useAuth } from "@/lib/session/auth-provider";
import { useSuppliers } from "@/lib/queries/use-suppliers";

const PAGE_SIZE = 20;

type ActiveFilter = "active" | "inactive" | "all";

function isActiveParam(filter: ActiveFilter): boolean | undefined {
  if (filter === "active") return true;
  if (filter === "inactive") return false;
  return undefined;
}

export default function SuppliersPage() {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("active");
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [confirmingDeactivateId, setConfirmingDeactivateId] = useState<string | null>(null);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  const suppliersQuery = useSuppliers({
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    isActive: isActiveParam(activeFilter),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => authenticatedFetch(`/suppliers/${id}`, accessToken!, { method: "DELETE" }),
    onSuccess: () => {
      setDeactivateError(null);
      setConfirmingDeactivateId(null);
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    },
    onError: (error) => {
      setDeactivateError(error instanceof ApiClientError ? error.message : "Une erreur est survenue");
    },
  });

  const totalPages = suppliersQuery.data ? Math.max(1, Math.ceil(suppliersQuery.data.total / PAGE_SIZE)) : 1;

  return (
    <div className="grid gap-6 p-8">
      <h1 className="text-2xl font-semibold">Fournisseurs</h1>

      <Card>
        <CardHeader>
          <CardTitle>{editingSupplier ? "Modifier le fournisseur" : "Nouveau fournisseur"}</CardTitle>
        </CardHeader>
        <CardContent>
          <SupplierForm
            editingSupplier={editingSupplier}
            onSaved={() => setEditingSupplier(null)}
            onCancelEdit={() => setEditingSupplier(null)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Liste des fournisseurs</CardTitle>
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
              <label className="text-sm text-muted-foreground" htmlFor="supplier-search">
                Recherche
              </label>
              <Input
                id="supplier-search"
                placeholder="Nom ou email…"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <label className="text-sm text-muted-foreground" htmlFor="supplier-active-filter">
                Statut
              </label>
              <select
                id="supplier-active-filter"
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

          {suppliersQuery.isLoading && <p className="text-sm text-muted-foreground">Chargement…</p>}
          {suppliersQuery.isError && <p className="text-sm text-destructive">Impossible de charger les fournisseurs.</p>}
          {suppliersQuery.data?.items.length === 0 && (
            <p className="text-sm text-muted-foreground">Aucun fournisseur pour l&apos;instant.</p>
          )}
          {deactivateError && <p className="text-sm text-destructive">{deactivateError}</p>}

          {suppliersQuery.data && suppliersQuery.data.items.length > 0 && (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4">Nom</th>
                    <th className="py-2 pr-4">Type</th>
                    <th className="py-2 pr-4">Email</th>
                    <th className="py-2 pr-4">Téléphone</th>
                    <th className="py-2 pr-4">Statut</th>
                    <th className="py-2 pr-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {suppliersQuery.data.items.map((supplier) => (
                    <tr key={supplier.id} className="border-b last:border-0">
                      <td className="py-2 pr-4">{supplier.name}</td>
                      <td className="py-2 pr-4">{supplier.type === "COMPANY" ? "Entreprise" : "Particulier"}</td>
                      <td className="py-2 pr-4">{supplier.email ?? "—"}</td>
                      <td className="py-2 pr-4">{supplier.phone ?? "—"}</td>
                      <td className="py-2 pr-4">{supplier.isActive ? "Actif" : "Désactivé"}</td>
                      <td className="py-2 pr-4">
                        {confirmingDeactivateId === supplier.id ? (
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">Confirmer ?</span>
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              disabled={deactivateMutation.isPending}
                              onClick={() => deactivateMutation.mutate(supplier.id)}
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
                            <Button type="button" size="sm" variant="outline" onClick={() => setEditingSupplier(supplier)}>
                              Modifier
                            </Button>
                            {supplier.isActive && (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => setConfirmingDeactivateId(supplier.id)}
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
                  Page {suppliersQuery.data.page} / {totalPages} — {suppliersQuery.data.total} fournisseur(s)
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
