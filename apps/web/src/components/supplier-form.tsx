"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { createSupplierSchema } from "@erp/validation";
import { CUSTOMER_TYPES, type Supplier } from "@erp/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { authenticatedFetch, ApiClientError } from "@/lib/api-client";
import { useAuth } from "@/lib/session/auth-provider";

// z.input (pas z.infer/output) : createSupplierSchema a des .default() sur
// type/country — même astuce que customer-form.tsx (voir son commentaire).
type SupplierFormValues = z.input<typeof createSupplierSchema>;

const CUSTOMER_TYPE_LABELS: Record<(typeof CUSTOMER_TYPES)[number], string> = {
  COMPANY: "Entreprise",
  INDIVIDUAL: "Particulier",
};

const EMPTY_VALUES: SupplierFormValues = {
  type: "COMPANY",
  name: "",
  email: undefined,
  phone: undefined,
  address: undefined,
  city: undefined,
  country: "Sénégal",
  ninea: undefined,
  rccm: undefined,
  notes: undefined,
};

function toFormValues(supplier: Supplier): SupplierFormValues {
  return {
    type: supplier.type,
    name: supplier.name,
    email: supplier.email ?? undefined,
    phone: supplier.phone ?? undefined,
    address: supplier.address ?? undefined,
    city: supplier.city ?? undefined,
    country: supplier.country,
    ninea: supplier.ninea ?? undefined,
    rccm: supplier.rccm ?? undefined,
    notes: supplier.notes ?? undefined,
  };
}

// Un seul formulaire pour la création ET l'édition : editingSupplier=null =>
// création (réinitialisé après succès) ; sinon édition de ce fournisseur précis.
export function SupplierForm({
  editingSupplier,
  onSaved,
  onCancelEdit,
}: {
  editingSupplier: Supplier | null;
  onSaved: () => void;
  onCancelEdit: () => void;
}) {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<SupplierFormValues>({
    resolver: zodResolver(createSupplierSchema),
    values: editingSupplier ? toFormValues(editingSupplier) : EMPTY_VALUES,
  });

  const saveMutation = useMutation({
    mutationFn: (values: SupplierFormValues) =>
      editingSupplier
        ? authenticatedFetch(`/suppliers/${editingSupplier.id}`, accessToken!, {
            method: "PATCH",
            body: JSON.stringify(values),
          })
        : authenticatedFetch("/suppliers", accessToken!, { method: "POST", body: JSON.stringify(values) }),
    onSuccess: () => {
      setFormError(null);
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      if (!editingSupplier) {
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
          name="type"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Type</FormLabel>
              <FormControl>
                <select
                  {...field}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
                >
                  {CUSTOMER_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {CUSTOMER_TYPE_LABELS[type]}
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
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nom</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" {...field} value={field.value ?? ""} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Téléphone</FormLabel>
              <FormControl>
                <Input {...field} value={field.value ?? ""} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="address"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Adresse</FormLabel>
              <FormControl>
                <Input {...field} value={field.value ?? ""} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="city"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Ville</FormLabel>
              <FormControl>
                <Input {...field} value={field.value ?? ""} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="country"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Pays</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="ninea"
          render={({ field }) => (
            <FormItem>
              <FormLabel>NINEA</FormLabel>
              <FormControl>
                <Input {...field} value={field.value ?? ""} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="rccm"
          render={({ field }) => (
            <FormItem>
              <FormLabel>RCCM</FormLabel>
              <FormControl>
                <Input {...field} value={field.value ?? ""} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem className="sm:col-span-2">
              <FormLabel>Notes</FormLabel>
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
            {editingSupplier ? "Enregistrer" : "Créer le fournisseur"}
          </Button>
          {editingSupplier && (
            <Button type="button" variant="outline" className="w-fit" onClick={onCancelEdit}>
              Annuler
            </Button>
          )}
        </div>
      </form>
    </Form>
  );
}
