"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { inviteUserSchema, type InviteUserInput } from "@erp/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useRoles } from "@/lib/queries/use-roles";
import { authenticatedFetch, ApiClientError } from "@/lib/api-client";
import { useAuth } from "@/lib/session/auth-provider";

export function InviteUserForm({ onInvited }: { onInvited?: (email: string) => void }) {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const rolesQuery = useRoles();
  const [formError, setFormError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

  const form = useForm<InviteUserInput>({
    resolver: zodResolver(inviteUserSchema),
    defaultValues: { email: "", firstName: "", lastName: "", roleId: "" },
  });

  const inviteMutation = useMutation({
    mutationFn: (values: InviteUserInput) =>
      authenticatedFetch("/users/invite", accessToken!, { method: "POST", body: JSON.stringify(values) }),
    onSuccess: (_data, values) => {
      setFormError(null);
      setInviteSuccess(`Invitation envoyée à ${values.email}.`);
      form.reset({ email: "", firstName: "", lastName: "", roleId: "" });
      queryClient.invalidateQueries({ queryKey: ["users"] });
      onInvited?.(values.email);
    },
    onError: (error) => {
      setInviteSuccess(null);
      setFormError(error instanceof ApiClientError ? error.message : "Une erreur est survenue");
    },
  });

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((values) => inviteMutation.mutate(values))}
        className="grid gap-4 sm:grid-cols-2"
      >
        <FormField
          control={form.control}
          name="firstName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Prénom</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="lastName"
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
                <Input type="email" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="roleId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Rôle</FormLabel>
              <FormControl>
                <select
                  {...field}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
                >
                  <option value="" disabled>
                    Sélectionner un rôle
                  </option>
                  {rolesQuery.data?.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {formError && <p className="text-sm text-destructive sm:col-span-2">{formError}</p>}
        {inviteSuccess && <p className="text-sm sm:col-span-2">{inviteSuccess}</p>}
        <Button type="submit" disabled={inviteMutation.isPending} className="sm:col-span-2 sm:w-fit">
          Inviter
        </Button>
      </form>
    </Form>
  );
}
