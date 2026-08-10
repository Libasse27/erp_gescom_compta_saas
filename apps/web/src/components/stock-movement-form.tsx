"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { createStockMovementSchema } from "@erp/validation";
import type { StockLevel } from "@erp/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { authenticatedFetch, ApiClientError } from "@/lib/api-client";
import { useAuth } from "@/lib/session/auth-provider";
import { useStock } from "@/lib/queries/use-stock";

type MovementFormValues = z.input<typeof createStockMovementSchema>;

const EMPTY_VALUES: MovementFormValues = {
  productId: "",
  type: "IN",
  quantity: 0,
  note: undefined,
};

const MOVEMENT_TYPE_LABELS: Record<MovementFormValues["type"], string> = {
  IN: "Entrée (réception)",
  OUT: "Sortie",
  ADJUSTMENT: "Correction d'inventaire (+/-)",
};

// Pas de recherche async de produit dans ce cycle (aucun composant de ce
// type n'existe encore dans apps/web/src/components/ui/) : liste à plat des
// 100 premiers produits qui suivent le stock, suffisant pour un catalogue de
// démarrage — à revoir si un tenant dépasse ce volume.
export function StockMovementForm({ onSaved }: { onSaved: () => void }) {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);

  const productsQuery = useStock({ page: 1, pageSize: 100 });

  const form = useForm<MovementFormValues>({
    resolver: zodResolver(createStockMovementSchema),
    defaultValues: EMPTY_VALUES,
  });

  const saveMutation = useMutation({
    mutationFn: (values: MovementFormValues) =>
      authenticatedFetch("/stock/movements", accessToken!, { method: "POST", body: JSON.stringify(values) }),
    onSuccess: () => {
      setFormError(null);
      queryClient.invalidateQueries({ queryKey: ["stock"] });
      queryClient.invalidateQueries({ queryKey: ["stock-movements"] });
      form.reset(EMPTY_VALUES);
      onSaved();
    },
    onError: (error) => {
      setFormError(error instanceof ApiClientError ? error.message : "Une erreur est survenue");
    },
  });

  const products: StockLevel[] = productsQuery.data?.items ?? [];

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))}
        className="grid gap-4 sm:grid-cols-2"
      >
        <FormField
          control={form.control}
          name="productId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Produit</FormLabel>
              <FormControl>
                <select
                  {...field}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
                >
                  <option value="">Sélectionner un produit…</option>
                  {products.map((product) => (
                    <option key={product.productId} value={product.productId}>
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
          name="type"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Type de mouvement</FormLabel>
              <FormControl>
                <select
                  {...field}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
                >
                  {(Object.keys(MOVEMENT_TYPE_LABELS) as MovementFormValues["type"][]).map((type) => (
                    <option key={type} value={type}>
                      {MOVEMENT_TYPE_LABELS[type]}
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
          name="quantity"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Quantité</FormLabel>
              <FormControl>
                <Input
                  type="number"
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
          name="note"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Note (optionnel)</FormLabel>
              <FormControl>
                <Input {...field} value={field.value ?? ""} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {formError && <p className="text-sm text-destructive sm:col-span-2">{formError}</p>}

        <div className="sm:col-span-2">
          <Button type="submit" disabled={saveMutation.isPending} className="w-fit">
            Enregistrer le mouvement
          </Button>
        </div>
      </form>
    </Form>
  );
}
