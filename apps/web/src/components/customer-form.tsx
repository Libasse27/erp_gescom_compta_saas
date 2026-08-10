"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { createCustomerSchema } from "@erp/validation";
import { CUSTOMER_TYPES, type Customer } from "@erp/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { authenticatedFetch, ApiClientError } from "@/lib/api-client";
import { useAuth } from "@/lib/session/auth-provider";

// z.input (pas z.infer/output) : createCustomerSchema a des .default() sur
// type/country, ce qui rend ces champs optionnels côté saisie (input) mais
// requis côté résultat validé (output). react-hook-form + zodResolver doivent
// être typés sur la forme d'entrée, sinon TS refuse le resolver (mismatch
// input/output bien connu de zodResolver quand le schéma a des .default()).
type CustomerFormValues = z.input<typeof createCustomerSchema>;

const CUSTOMER_TYPE_LABELS: Record<(typeof CUSTOMER_TYPES)[number], string> = {
  COMPANY: "Entreprise",
  INDIVIDUAL: "Particulier",
};

const EMPTY_VALUES: CustomerFormValues = {
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

function toFormValues(customer: Customer): CustomerFormValues {
  return {
    type: customer.type,
    name: customer.name,
    email: customer.email ?? undefined,
    phone: customer.phone ?? undefined,
    address: customer.address ?? undefined,
    city: customer.city ?? undefined,
    country: customer.country,
    ninea: customer.ninea ?? undefined,
    rccm: customer.rccm ?? undefined,
    notes: customer.notes ?? undefined,
  };
}

// Un seul formulaire pour la création ET l'édition : editingCustomer=null =>
// création (réinitialisé après succès) ; sinon édition de ce client précis.
export function CustomerForm({
  editingCustomer,
  onSaved,
  onCancelEdit,
}: {
  editingCustomer: Customer | null;
  onSaved: () => void;
  onCancelEdit: () => void;
}) {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<CustomerFormValues>({
    resolver: zodResolver(createCustomerSchema),
    values: editingCustomer ? toFormValues(editingCustomer) : EMPTY_VALUES,
  });

  const saveMutation = useMutation({
    mutationFn: (values: CustomerFormValues) =>
      editingCustomer
        ? authenticatedFetch(`/customers/${editingCustomer.id}`, accessToken!, {
            method: "PATCH",
            body: JSON.stringify(values),
          })
        : authenticatedFetch("/customers", accessToken!, { method: "POST", body: JSON.stringify(values) }),
    onSuccess: () => {
      setFormError(null);
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      if (!editingCustomer) {
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
            {editingCustomer ? "Enregistrer" : "Créer le client"}
          </Button>
          {editingCustomer && (
            <Button type="button" variant="outline" className="w-fit" onClick={onCancelEdit}>
              Annuler
            </Button>
          )}
        </div>
      </form>
    </Form>
  );
}
