"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SalesInvoiceStatus } from "@erp/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { InvoiceForm } from "@/components/invoice-form";
import { authenticatedFetch, ApiClientError } from "@/lib/api-client";
import { useAuth } from "@/lib/session/auth-provider";
import { useInvoice, useInvoices } from "@/lib/queries/use-invoices";

const PAGE_SIZE = 20;

type StatusFilter = SalesInvoiceStatus | "ALL";

function formatFCFA(amount: number): string {
  return `${amount.toLocaleString("fr-SN")} FCFA`;
}

const STATUS_LABELS: Record<SalesInvoiceStatus, string> = {
  ISSUED: "Émise",
  PAID: "Payée",
  VOID: "Annulée",
};

// Module 7 de la Phase 8, miroir de apps/app/sales/page.tsx et
// apps/app/purchases/page.tsx.
export default function InvoicingPage() {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const invoicesQuery = useInvoices({
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    status: statusFilter === "ALL" ? undefined : statusFilter,
  });
  const selectedInvoiceQuery = useInvoice(selectedInvoiceId);

  const markPaidMutation = useMutation({
    mutationFn: (id: string) => authenticatedFetch(`/invoices/${id}/mark-paid`, accessToken!, { method: "POST" }),
    onSuccess: (_data, id) => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["invoice", id] });
    },
    onError: (error) => {
      setActionError(error instanceof ApiClientError ? error.message : "Une erreur est survenue");
    },
  });

  const voidMutation = useMutation({
    mutationFn: (id: string) => authenticatedFetch(`/invoices/${id}/void`, accessToken!, { method: "POST" }),
    onSuccess: (_data, id) => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["invoice", id] });
    },
    onError: (error) => {
      setActionError(error instanceof ApiClientError ? error.message : "Une erreur est survenue");
    },
  });

  const totalPages = invoicesQuery.data ? Math.max(1, Math.ceil(invoicesQuery.data.total / PAGE_SIZE)) : 1;

  return (
    <div className="grid gap-6 p-8">
      <h1 className="text-2xl font-semibold">Facturation</h1>

      <Card>
        <CardHeader>
          <CardTitle>Nouvelle facture</CardTitle>
        </CardHeader>
        <CardContent>
          <InvoiceForm onSaved={() => setActionError(null)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Liste des factures</CardTitle>
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
              <label className="text-sm text-muted-foreground" htmlFor="invoice-search">
                Recherche
              </label>
              <Input
                id="invoice-search"
                placeholder="N° facture ou nom du client…"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <label className="text-sm text-muted-foreground" htmlFor="invoice-status-filter">
                Statut
              </label>
              <select
                id="invoice-status-filter"
                className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
                value={statusFilter}
                onChange={(event) => {
                  setPage(1);
                  setStatusFilter(event.target.value as StatusFilter);
                }}
              >
                <option value="ALL">Tous</option>
                <option value="ISSUED">Émise</option>
                <option value="PAID">Payée</option>
                <option value="VOID">Annulée</option>
              </select>
            </div>
            <Button type="submit" variant="outline">
              Rechercher
            </Button>
          </form>

          {invoicesQuery.isLoading && <p className="text-sm text-muted-foreground">Chargement…</p>}
          {invoicesQuery.isError && <p className="text-sm text-destructive">Impossible de charger les factures.</p>}
          {invoicesQuery.data?.items.length === 0 && (
            <p className="text-sm text-muted-foreground">Aucune facture pour l&apos;instant.</p>
          )}
          {actionError && <p className="text-sm text-destructive">{actionError}</p>}

          {invoicesQuery.data && invoicesQuery.data.items.length > 0 && (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4">N° facture</th>
                    <th className="py-2 pr-4">Client</th>
                    <th className="py-2 pr-4">Date</th>
                    <th className="py-2 pr-4">Total TTC</th>
                    <th className="py-2 pr-4">Statut</th>
                    <th className="py-2 pr-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {invoicesQuery.data.items.map((invoice) => (
                    <tr key={invoice.id} className="border-b last:border-0">
                      <td className="py-2 pr-4">{invoice.number}</td>
                      <td className="py-2 pr-4">{invoice.customerName}</td>
                      <td className="py-2 pr-4">{new Date(invoice.issuedAt).toLocaleDateString("fr-SN")}</td>
                      <td className="py-2 pr-4">{formatFCFA(invoice.totalIncludingTax)}</td>
                      <td className="py-2 pr-4">{STATUS_LABELS[invoice.status]}</td>
                      <td className="py-2 pr-4">
                        <div className="flex items-center gap-2">
                          <Button type="button" size="sm" variant="outline" onClick={() => setSelectedInvoiceId(invoice.id)}>
                            Détail
                          </Button>
                          {invoice.status === "ISSUED" && (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                disabled={markPaidMutation.isPending}
                                onClick={() => markPaidMutation.mutate(invoice.id)}
                              >
                                Marquer payée
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={voidMutation.isPending}
                                onClick={() => voidMutation.mutate(invoice.id)}
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
                  Page {invoicesQuery.data.page} / {totalPages} — {invoicesQuery.data.total} facture(s)
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

      {selectedInvoiceId && (
        <Card>
          <CardHeader>
            <CardTitle>
              Détail de la facture
              {selectedInvoiceQuery.data ? ` — ${selectedInvoiceQuery.data.number}` : ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            {selectedInvoiceQuery.isLoading && <p className="text-sm text-muted-foreground">Chargement…</p>}
            {selectedInvoiceQuery.data && (
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
                    {selectedInvoiceQuery.data.lines.map((line) => (
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
                  Total HT {formatFCFA(selectedInvoiceQuery.data.totalExcludingTax)} — TVA{" "}
                  {formatFCFA(selectedInvoiceQuery.data.totalVat)} — TTC{" "}
                  {formatFCFA(selectedInvoiceQuery.data.totalIncludingTax)}
                </p>
                <pre className="whitespace-pre-wrap rounded-md border border-input p-3 text-xs text-muted-foreground">
                  {selectedInvoiceQuery.data.legalMentions}
                </pre>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
