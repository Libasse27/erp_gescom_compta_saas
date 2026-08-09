"use client";

import { Card, CardContent } from "@/components/ui/card";
import { useAdminEnterprises } from "@/lib/queries/use-admin-enterprises";

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("fr-SN");
}

export default function SuperAdminEnterprisesPage() {
  const enterprisesQuery = useAdminEnterprises();

  return (
    <div className="grid gap-6 p-8">
      <h1 className="text-2xl font-semibold">Entreprises</h1>

      <Card>
        <CardContent className="pt-6">
          {enterprisesQuery.isLoading && <p className="text-sm text-muted-foreground">Chargement…</p>}
          {enterprisesQuery.isError && (
            <p className="text-sm text-destructive">Impossible de charger les entreprises.</p>
          )}
          {enterprisesQuery.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">Aucune entreprise pour l&apos;instant.</p>
          )}
          {enterprisesQuery.data && enterprisesQuery.data.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4">Nom</th>
                  <th className="py-2 pr-4">Statut</th>
                  <th className="py-2 pr-4">Forfait</th>
                  <th className="py-2 pr-4">Abonnement</th>
                  <th className="py-2 pr-4">Créée le</th>
                </tr>
              </thead>
              <tbody>
                {enterprisesQuery.data.map((enterprise) => (
                  <tr key={enterprise.id} className="border-b last:border-0">
                    <td className="py-2 pr-4">{enterprise.name}</td>
                    <td className="py-2 pr-4">{enterprise.status}</td>
                    <td className="py-2 pr-4">{enterprise.planName ?? "—"}</td>
                    <td className="py-2 pr-4">{enterprise.subscriptionStatus ?? "—"}</td>
                    <td className="py-2 pr-4">{formatDate(enterprise.createdAt)}</td>
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
