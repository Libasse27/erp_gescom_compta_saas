"use client";

import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { createSaleSchema } from "@erp/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { authenticatedFetch, ApiClientError } from "@/lib/api-client";
import { useAuth } from "@/lib/session/auth-provider";
import { useCustomers } from "@/lib/queries/use-customers";
import { useProducts } from "@/lib/queries/use-products";

type SaleFormValues = z.input<typeof createSaleSchema>;

const EMPTY_VALUES: SaleFormValues = {
  customerId: "",
  notes: undefined,
  lines: [{ productId: "", quantity: 1 }],
};

// Prix et TVA ne sont pas dans ce formulaire : résolus côté serveur depuis
// le produit au moment de la vente (voir createSaleSchema, packages/validation).
// Pas de recherche async client/produit dans ce cycle (même simplification
// que StockMovementForm) : liste à plat des 100 premiers.
export function SaleForm({ onSaved }: { onSaved: () => void }) {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);

  const customersQuery = useCustomers({ page: 1, pageSize: 100, isActive: true });
  const productsQuery = useProducts({ page: 1, pageSize: 100, isActive: true });

  const form = useForm<SaleFormValues>({
    resolver: zodResolver(createSaleSchema),
    defaultValues: EMPTY_VALUES,
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });

  const saveMutation = useMutation({
    mutationFn: (values: SaleFormValues) =>
      authenticatedFetch("/sales", accessToken!, { method: "POST", body: JSON.stringify(values) }),
    onSuccess: () => {
      setFormError(null);
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      form.reset(EMPTY_VALUES);
      onSaved();
    },
    onError: (error) => {
      setFormError(error instanceof ApiClientError ? error.message : "Une erreur est survenue");
    },
  });

  const customers = customersQuery.data?.items ?? [];
  const products = productsQuery.data?.items ?? [];

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))} className="grid gap-4">
        <FormField
          control={form.control}
          name="customerId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Client</FormLabel>
              <FormControl>
                <select
                  {...field}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs sm:w-1/2"
                >
                  <option value="">Sélectionner un client…</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                    </option>
                  ))}
                </select>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-2">
          <p className="text-sm font-medium">Lignes</p>
          {fields.map((line, index) => (
            <div key={line.id} className="flex flex-wrap items-end gap-3">
              <FormField
                control={form.control}
                name={`lines.${index}.productId`}
                render={({ field }) => (
                  <FormItem className="grow">
                    <FormLabel className="text-xs text-muted-foreground">Produit</FormLabel>
                    <FormControl>
                      <select
                        {...field}
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
                      >
                        <option value="">Sélectionner un produit…</option>
                        {products.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.code} — {product.name}
                          </option>
                        ))}
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name={`lines.${index}.quantity`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs text-muted-foreground">Quantité</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        step={1}
                        className="w-24"
                        {...field}
                        value={field.value ?? ""}
                        onChange={(event) => field.onChange(event.target.valueAsNumber)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={fields.length <= 1}
                onClick={() => remove(index)}
              >
                Retirer
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => append({ productId: "", quantity: 1 })}
          >
            Ajouter une ligne
          </Button>
        </div>

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Notes (optionnel)</FormLabel>
              <FormControl>
                <Input {...field} value={field.value ?? ""} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {formError && <p className="text-sm text-destructive">{formError}</p>}

        <Button type="submit" disabled={saveMutation.isPending} className="w-fit">
          Créer la vente (brouillon)
        </Button>
      </form>
    </Form>
  );
}
