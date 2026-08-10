"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { createAccountSchema } from "@erp/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { authenticatedFetch, ApiClientError } from "@/lib/api-client";
import { useAuth } from "@/lib/session/auth-provider";

type AccountFormValues = z.input<typeof createAccountSchema>;

const EMPTY_VALUES: AccountFormValues = { code: "", label: "" };

export function AccountForm({ onSaved }: { onSaved: () => void }) {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<AccountFormValues>({
    resolver: zodResolver(createAccountSchema),
    defaultValues: EMPTY_VALUES,
  });

  const saveMutation = useMutation({
    mutationFn: (values: AccountFormValues) =>
      authenticatedFetch("/accounting/accounts", accessToken!, { method: "POST", body: JSON.stringify(values) }),
    onSuccess: () => {
      setFormError(null);
      queryClient.invalidateQueries({ queryKey: ["accounting-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["accounting-trial-balance"] });
      form.reset(EMPTY_VALUES);
      onSaved();
    },
    onError: (error) => {
      setFormError(error instanceof ApiClientError ? error.message : "Une erreur est survenue");
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))} className="flex flex-wrap items-end gap-3">
        <FormField
          control={form.control}
          name="code"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Code (SYSCOHADA)</FormLabel>
              <FormControl>
                <Input placeholder="601000" className="w-32" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="label"
          render={({ field }) => (
            <FormItem className="grow">
              <FormLabel>Libellé</FormLabel>
              <FormControl>
                <Input placeholder="Achats de marchandises" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={saveMutation.isPending}>
          Créer le compte
        </Button>
        {formError && <p className="w-full text-sm text-destructive">{formError}</p>}
      </form>
    </Form>
  );
}
