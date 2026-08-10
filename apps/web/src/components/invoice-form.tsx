"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { createSalesInvoiceSchema } from "@erp/validation";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { authenticatedFetch, ApiClientError } from "@/lib/api-client";
import { useAuth } from "@/lib/session/auth-provider";
import { useSales } from "@/lib/queries/use-sales";

type InvoiceFormValues = z.input<typeof createSalesInvoiceSchema>;

const EMPTY_VALUES: InvoiceFormValues = { saleId: "" };

function formatFCFA(amount: number): string {
  return `${amount.toLocaleString("fr-SN")} FCFA`;
}

// Contrairement à SaleForm/PurchaseForm : pas de lignes à saisir, une
// facture transforme une vente CONFIRMED déjà existante (voir
// createSalesInvoiceSchema, packages/validation) — ne liste que les ventes
// confirmées, la vente déjà facturée renvoie un 409 affiché comme erreur de
// formulaire (pas de filtre "non facturée" côté API dans ce cycle).
export function InvoiceForm({ onSaved }: { onSaved: () => void }) {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);

  const confirmedSalesQuery = useSales({ page: 1, pageSize: 100, status: "CONFIRMED" });

  const form = useForm<InvoiceFormValues>({
    resolver: zodResolver(createSalesInvoiceSchema),
    defaultValues: EMPTY_VALUES,
  });

  const saveMutation = useMutation({
    mutationFn: (values: InvoiceFormValues) =>
      authenticatedFetch("/invoices", accessToken!, { method: "POST", body: JSON.stringify(values) }),
    onSuccess: () => {
      setFormError(null);
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      form.reset(EMPTY_VALUES);
      onSaved();
    },
    onError: (error) => {
      setFormError(error instanceof ApiClientError ? error.message : "Une erreur est survenue");
    },
  });

  const confirmedSales = confirmedSalesQuery.data?.items ?? [];

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))} className="grid gap-4">
        <FormField
          control={form.control}
          name="saleId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Vente confirmée à facturer</FormLabel>
              <FormControl>
                <select
                  {...field}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs sm:w-1/2"
                >
                  <option value="">Sélectionner une vente…</option>
                  {confirmedSales.map((sale) => (
                    <option key={sale.id} value={sale.id}>
                      {sale.customerName} — {new Date(sale.saleDate).toLocaleDateString("fr-SN")} —{" "}
                      {formatFCFA(sale.totalIncludingTax)}
                    </option>
                  ))}
                </select>
              </FormControl>
              {confirmedSales.length === 0 && !confirmedSalesQuery.isLoading && (
                <p className="text-sm text-muted-foreground">Aucune vente confirmée en attente de facturation.</p>
              )}
              <FormMessage />
            </FormItem>
          )}
        />

        {formError && <p className="text-sm text-destructive">{formError}</p>}

        <Button type="submit" disabled={saveMutation.isPending} className="w-fit">
          Émettre la facture
        </Button>
      </form>
    </Form>
  );
}
