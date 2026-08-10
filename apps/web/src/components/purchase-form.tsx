"use client";

import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { createPurchaseSchema } from "@erp/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { authenticatedFetch, ApiClientError } from "@/lib/api-client";
import { useAuth } from "@/lib/session/auth-provider";
import { useSuppliers } from "@/lib/queries/use-suppliers";
import { useProducts } from "@/lib/queries/use-products";

type PurchaseFormValues = z.input<typeof createPurchaseSchema>;

const EMPTY_VALUES: PurchaseFormValues = {
  supplierId: "",
  notes: undefined,
  lines: [{ productId: "", quantity: 1, unitCostExcludingTax: 0 }],
};

// Miroir de SaleForm (module 5), avec une différence : unitCostExcludingTax
// est saisi ici (le coût négocié auprès du fournisseur), contrairement au
// prix de vente qui est résolu côté serveur — voir createPurchaseSchema,
// packages/validation. La TVA reste résolue côté serveur depuis le produit.
export function PurchaseForm({ onSaved }: { onSaved: () => void }) {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);

  const suppliersQuery = useSuppliers({ page: 1, pageSize: 100, isActive: true });
  const productsQuery = useProducts({ page: 1, pageSize: 100, isActive: true });

  const form = useForm<PurchaseFormValues>({
    resolver: zodResolver(createPurchaseSchema),
    defaultValues: EMPTY_VALUES,
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });

  const saveMutation = useMutation({
    mutationFn: (values: PurchaseFormValues) =>
      authenticatedFetch("/purchases", accessToken!, { method: "POST", body: JSON.stringify(values) }),
    onSuccess: () => {
      setFormError(null);
      queryClient.invalidateQueries({ queryKey: ["purchases"] });
      form.reset(EMPTY_VALUES);
      onSaved();
    },
    onError: (error) => {
      setFormError(error instanceof ApiClientError ? error.message : "Une erreur est survenue");
    },
  });

  const suppliers = suppliersQuery.data?.items ?? [];
  const products = productsQuery.data?.items ?? [];

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))} className="grid gap-4">
        <FormField
          control={form.control}
          name="supplierId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Fournisseur</FormLabel>
              <FormControl>
                <select
                  {...field}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs sm:w-1/2"
                >
                  <option value="">Sélectionner un fournisseur…</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
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
              <FormField
                control={form.control}
                name={`lines.${index}.unitCostExcludingTax`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs text-muted-foreground">Coût unitaire HT</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        className="w-32"
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
            onClick={() => append({ productId: "", quantity: 1, unitCostExcludingTax: 0 })}
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
          Créer l&apos;achat (brouillon)
        </Button>
      </form>
    </Form>
  );
}
