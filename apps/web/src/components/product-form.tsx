"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { createProductSchema } from "@erp/validation";
import type { Product } from "@erp/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { authenticatedFetch, ApiClientError } from "@/lib/api-client";
import { useAuth } from "@/lib/session/auth-provider";

// z.input (pas z.infer/output) : createProductSchema a des .default() sur
// unit/vatRateBasisPoints/trackStock — même astuce que supplier-form.tsx.
type ProductFormValues = z.input<typeof createProductSchema>;

const EMPTY_VALUES: ProductFormValues = {
  code: "",
  name: "",
  description: undefined,
  unit: "pièce",
  category: undefined,
  barcode: undefined,
  sellingPriceExcludingTax: 0,
  vatRateBasisPoints: 1_800,
  trackStock: true,
};

function toFormValues(product: Product): ProductFormValues {
  return {
    code: product.code,
    name: product.name,
    description: product.description ?? undefined,
    unit: product.unit,
    category: product.category ?? undefined,
    barcode: product.barcode ?? undefined,
    sellingPriceExcludingTax: product.sellingPriceExcludingTax,
    vatRateBasisPoints: product.vatRateBasisPoints,
    trackStock: product.trackStock,
  };
}

// Un seul formulaire pour la création ET l'édition : editingProduct=null =>
// création (réinitialisé après succès) ; sinon édition de ce produit précis.
export function ProductForm({
  editingProduct,
  onSaved,
  onCancelEdit,
}: {
  editingProduct: Product | null;
  onSaved: () => void;
  onCancelEdit: () => void;
}) {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(createProductSchema),
    values: editingProduct ? toFormValues(editingProduct) : EMPTY_VALUES,
  });

  const saveMutation = useMutation({
    mutationFn: (values: ProductFormValues) =>
      editingProduct
        ? authenticatedFetch(`/products/${editingProduct.id}`, accessToken!, {
            method: "PATCH",
            body: JSON.stringify(values),
          })
        : authenticatedFetch("/products", accessToken!, { method: "POST", body: JSON.stringify(values) }),
    onSuccess: () => {
      setFormError(null);
      queryClient.invalidateQueries({ queryKey: ["products"] });
      if (!editingProduct) {
        form.reset(EMPTY_VALUES);
      }
      onSaved();
    },
    onError: (error) => {
      setFormError(error instanceof ApiClientError ? error.message : "Une erreur est survenue");
    },
  });

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))}
        className="grid gap-4 sm:grid-cols-2"
      >
        <FormField
          control={form.control}
          name="code"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Code</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Désignation</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="sellingPriceExcludingTax"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Prix de vente HT (FCFA)</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={0}
                  step={1}
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
          name="vatRateBasisPoints"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Taux de TVA (points de base, 1800 = 18 %)</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={0}
                  max={10_000}
                  step={1}
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
          name="unit"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Unité</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="category"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Catégorie</FormLabel>
              <FormControl>
                <Input {...field} value={field.value ?? ""} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="barcode"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Code-barres</FormLabel>
              <FormControl>
                <Input {...field} value={field.value ?? ""} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="trackStock"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center gap-2 self-end">
              <FormControl>
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input"
                  checked={field.value ?? true}
                  onChange={(event) => field.onChange(event.target.checked)}
                  ref={field.ref}
                />
              </FormControl>
              <FormLabel className="!mt-0">Suivi de stock</FormLabel>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem className="sm:col-span-2">
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Input {...field} value={field.value ?? ""} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {formError && <p className="text-sm text-destructive sm:col-span-2">{formError}</p>}

        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" disabled={saveMutation.isPending} className="w-fit">
            {editingProduct ? "Enregistrer" : "Créer le produit"}
          </Button>
          {editingProduct && (
            <Button type="button" variant="outline" className="w-fit" onClick={onCancelEdit}>
              Annuler
            </Button>
          )}
        </div>
      </form>
    </Form>
  );
}
