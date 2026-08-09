"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { inviteUserSchema, type InviteUserInput } from "@erp/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useEnterpriseUsers } from "@/lib/queries/use-enterprise-users";
import { useRoles } from "@/lib/queries/use-roles";
import { authenticatedFetch, ApiClientError } from "@/lib/api-client";
import { useAuth } from "@/lib/session/auth-provider";

export default function UsersPage() {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const usersQuery = useEnterpriseUsers();
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
    },
    onError: (error) => {
      setInviteSuccess(null);
      setFormError(error instanceof ApiClientError ? error.message : "Une erreur est survenue");
    },
  });

  return (
    <div className="grid gap-6 p-8">
      <h1 className="text-2xl font-semibold">Utilisateurs</h1>

      <Card>
        <CardHeader>
          <CardTitle>Inviter un utilisateur</CardTitle>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Membres de l&apos;entreprise</CardTitle>
        </CardHeader>
        <CardContent>
          {usersQuery.isLoading && <p className="text-sm text-muted-foreground">Chargement…</p>}
          {usersQuery.isError && <p className="text-sm text-destructive">Impossible de charger les utilisateurs.</p>}
          {usersQuery.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">Aucun utilisateur pour l&apos;instant.</p>
          )}
          {usersQuery.data && usersQuery.data.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4">Nom</th>
                  <th className="py-2 pr-4">Email</th>
                  <th className="py-2 pr-4">Rôles</th>
                  <th className="py-2 pr-4">Statut</th>
                </tr>
              </thead>
              <tbody>
                {usersQuery.data.map((user) => (
                  <tr key={user.id} className="border-b last:border-0">
                    <td className="py-2 pr-4">
                      {user.firstName} {user.lastName}
                    </td>
                    <td className="py-2 pr-4">{user.email}</td>
                    <td className="py-2 pr-4">{user.roles.join(", ") || "—"}</td>
                    <td className="py-2 pr-4">{user.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
