"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InviteUserForm } from "@/components/invite-user-form";
import { useEnterpriseUsers } from "@/lib/queries/use-enterprise-users";

export default function UsersPage() {
  const usersQuery = useEnterpriseUsers();

  return (
    <div className="grid gap-6 p-8">
      <h1 className="text-2xl font-semibold">Utilisateurs</h1>

      <Card>
        <CardHeader>
          <CardTitle>Inviter un utilisateur</CardTitle>
        </CardHeader>
        <CardContent>
          <InviteUserForm />
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
