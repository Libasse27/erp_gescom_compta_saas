"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Customer } from "@erp/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CustomerForm } from "@/components/customer-form";
import { authenticatedFetch, ApiClientError } from "@/lib/api-client";
import { useAuth } from "@/lib/session/auth-provider";
import { useCustomers } from "@/lib/queries/use-customers";

const PAGE_SIZE = 20;

type ActiveFilter = "active" | "inactive" | "all";

function isActiveParam(filter: ActiveFilter): boolean | undefined {
  if (filter === "active") return true;
  if (filter === "inactive") return false;
  return undefined;
}

export default function ClientsPage() {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("active");
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [confirmingDeactivateId, setConfirmingDeactivateId] = useState<string | null>(null);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  const customersQuery = useCustomers({
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    isActive: isActiveParam(activeFilter),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => authenticatedFetch(`/customers/${id}`, accessToken!, { method: "DELETE" }),
    onSuccess: () => {
      setDeactivateError(null);
      setConfirmingDeactivateId(null);
      queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (error) => {
      setDeactivateError(error instanceof ApiClientError ? error.message : "Une erreur est survenue");
    },
  });

  const totalPages = customersQuery.data ? Math.max(1, Math.ceil(customersQuery.data.total / PAGE_SIZE)) : 1;

  return (
    <div className="grid gap-6 p-8">
      <h1 className="text-2xl font-semibold">Clients</h1>

      <Card>
        <CardHeader>
          <CardTitle>{editingCustomer ? "Modifier le client" : "Nouveau client"}</CardTitle>
        </CardHeader>
        <CardContent>
          <CustomerForm
            editingCustomer={editingCustomer}
            onSaved={() => setEditingCustomer(null)}
            onCancelEdit={() => setEditingCustomer(null)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Liste des clients</CardTitle>
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
              <label className="text-sm text-muted-foreground" htmlFor="customer-search">
                Recherche
              </label>
              <Input
                id="customer-search"
                placeholder="Nom ou email…"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <label className="text-sm text-muted-foreground" htmlFor="customer-active-filter">
                Statut
              </label>
              <select
                id="customer-active-filter"
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

          {customersQuery.isLoading && <p className="text-sm text-muted-foreground">Chargement…</p>}
          {customersQuery.isError && <p className="text-sm text-destructive">Impossible de charger les clients.</p>}
          {customersQuery.data?.items.length === 0 && (
            <p className="text-sm text-muted-foreground">Aucun client pour l&apos;instant.</p>
          )}
          {deactivateError && <p className="text-sm text-destructive">{deactivateError}</p>}

          {customersQuery.data && customersQuery.data.items.length > 0 && (
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
                  {customersQuery.data.items.map((customer) => (
                    <tr key={customer.id} className="border-b last:border-0">
                      <td className="py-2 pr-4">{customer.name}</td>
                      <td className="py-2 pr-4">{customer.type === "COMPANY" ? "Entreprise" : "Particulier"}</td>
                      <td className="py-2 pr-4">{customer.email ?? "—"}</td>
                      <td className="py-2 pr-4">{customer.phone ?? "—"}</td>
                      <td className="py-2 pr-4">{customer.isActive ? "Actif" : "Désactivé"}</td>
                      <td className="py-2 pr-4">
                        {confirmingDeactivateId === customer.id ? (
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">Confirmer ?</span>
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              disabled={deactivateMutation.isPending}
                              onClick={() => deactivateMutation.mutate(customer.id)}
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
                            <Button type="button" size="sm" variant="outline" onClick={() => setEditingCustomer(customer)}>
                              Modifier
                            </Button>
                            {customer.isActive && (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => setConfirmingDeactivateId(customer.id)}
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
                  Page {customersQuery.data.page} / {totalPages} — {customersQuery.data.total} client(s)
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
