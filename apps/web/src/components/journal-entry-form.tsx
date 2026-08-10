"use client";

import { useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { createJournalEntrySchema } from "@erp/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { authenticatedFetch, ApiClientError } from "@/lib/api-client";
import { useAuth } from "@/lib/session/auth-provider";
import { useAccounts } from "@/lib/queries/use-accounts";

type JournalEntryFormValues = z.input<typeof createJournalEntrySchema>;

const EMPTY_VALUES: JournalEntryFormValues = {
  description: "",
  reference: undefined,
  lines: [
    { accountId: "", debitAmount: 0, creditAmount: 0 },
    { accountId: "", debitAmount: 0, creditAmount: 0 },
  ],
};

function formatFCFA(amount: number): string {
  return `${amount.toLocaleString("fr-SN")} FCFA`;
}

// Contrairement à SaleForm/PurchaseForm (une seule "colonne" par ligne), une
// ligne d'écriture a deux montants (débit/crédit) dont un seul doit être
// renseigné — voir createJournalEntrySchema, packages/validation. Le total
// affiché en bas est purement indicatif (UX) : l'équilibre réel est
// revalidé côté serveur, jamais fait confiance côté client seul.
export function JournalEntryForm({ onSaved }: { onSaved: () => void }) {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);

  const accountsQuery = useAccounts({ page: 1, pageSize: 100 });

  const form = useForm<JournalEntryFormValues>({
    resolver: zodResolver(createJournalEntrySchema),
    defaultValues: EMPTY_VALUES,
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });
  const lines = useWatch({ control: form.control, name: "lines" });

  const saveMutation = useMutation({
    mutationFn: (values: JournalEntryFormValues) =>
      authenticatedFetch("/accounting/journal-entries", accessToken!, { method: "POST", body: JSON.stringify(values) }),
    onSuccess: () => {
      setFormError(null);
      queryClient.invalidateQueries({ queryKey: ["journal-entries"] });
      queryClient.invalidateQueries({ queryKey: ["accounting-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["accounting-trial-balance"] });
      form.reset(EMPTY_VALUES);
      onSaved();
    },
    onError: (error) => {
      setFormError(error instanceof ApiClientError ? error.message : "Une erreur est survenue");
    },
  });

  const accounts = accountsQuery.data?.items ?? [];
  const totalDebit = lines?.reduce((sum, line) => sum + (line?.debitAmount ?? 0), 0) ?? 0;
  const totalCredit = lines?.reduce((sum, line) => sum + (line?.creditAmount ?? 0), 0) ?? 0;
  const balanced = totalDebit === totalCredit && totalDebit > 0;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))} className="grid gap-4">
        <div className="flex flex-wrap gap-3">
          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem className="grow">
                <FormLabel>Libellé</FormLabel>
                <FormControl>
                  <Input placeholder="Vente au comptant" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="reference"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Référence (optionnel)</FormLabel>
                <FormControl>
                  <Input placeholder="FACT-000123" {...field} value={field.value ?? ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid gap-2">
          <p className="text-sm font-medium">Lignes</p>
          {fields.map((line, index) => (
            <div key={line.id} className="flex flex-wrap items-end gap-3">
              <FormField
                control={form.control}
                name={`lines.${index}.accountId`}
                render={({ field }) => (
                  <FormItem className="grow">
                    <FormLabel className="text-xs text-muted-foreground">Compte</FormLabel>
                    <FormControl>
                      <select
                        {...field}
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
                      >
                        <option value="">Sélectionner un compte…</option>
                        {accounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.code} — {account.label}
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
                name={`lines.${index}.debitAmount`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs text-muted-foreground">Débit</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        className="w-32"
                        {...field}
                        value={field.value ?? 0}
                        onChange={(event) => field.onChange(event.target.valueAsNumber || 0)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name={`lines.${index}.creditAmount`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs text-muted-foreground">Crédit</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        className="w-32"
                        {...field}
                        value={field.value ?? 0}
                        onChange={(event) => field.onChange(event.target.valueAsNumber || 0)}
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
                disabled={fields.length <= 2}
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
            onClick={() => append({ accountId: "", debitAmount: 0, creditAmount: 0 })}
          >
            Ajouter une ligne
          </Button>
        </div>

        <p className={`text-sm ${balanced ? "text-muted-foreground" : "text-destructive"}`}>
          Total débit {formatFCFA(totalDebit)} — Total crédit {formatFCFA(totalCredit)}
          {!balanced && " — écriture non équilibrée"}
        </p>

        {formError && <p className="text-sm text-destructive">{formError}</p>}

        <Button type="submit" disabled={saveMutation.isPending || !balanced} className="w-fit">
          Enregistrer l&apos;écriture
        </Button>
      </form>
    </Form>
  );
}
