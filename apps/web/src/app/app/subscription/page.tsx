"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMySubscription } from "@/lib/queries/use-my-subscription";

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("fr-SN");
}

function formatFCFA(amount: number): string {
  return `${amount.toLocaleString("fr-SN")} FCFA`;
}

// Lecture seule : le changement de plan reste une action Super Admin
// (Phase 4). Cette page se contente d'afficher l'état réel.
export default function SubscriptionPage() {
  const subscriptionQuery = useMySubscription();

  return (
    <div className="grid gap-6 p-8">
      <h1 className="text-2xl font-semibold">Abonnement</h1>

      {subscriptionQuery.isLoading && <p className="text-sm text-muted-foreground">Chargement…</p>}
      {subscriptionQuery.isError && (
        <p className="text-sm text-destructive">Aucun abonnement actif pour cette entreprise.</p>
      )}

      {subscriptionQuery.data && (
        <Card>
          <CardHeader>
            <CardTitle>{subscriptionQuery.data.planName}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <p>
              <span className="text-muted-foreground">Statut : </span>
              {subscriptionQuery.data.status}
            </p>
            <p>
              <span className="text-muted-foreground">Prix mensuel : </span>
              {formatFCFA(subscriptionQuery.data.priceMonthly)}
            </p>
            {subscriptionQuery.data.priceYearly !== null && (
              <p>
                <span className="text-muted-foreground">Prix annuel : </span>
                {formatFCFA(subscriptionQuery.data.priceYearly)}
              </p>
            )}
            <p>
              <span className="text-muted-foreground">Utilisateurs max : </span>
              {subscriptionQuery.data.maxUsers ?? "Illimité"}
            </p>
            <p>
              <span className="text-muted-foreground">Début : </span>
              {formatDate(subscriptionQuery.data.startDate)}
            </p>
            {subscriptionQuery.data.trialEndDate && (
              <p>
                <span className="text-muted-foreground">Fin d&apos;essai : </span>
                {formatDate(subscriptionQuery.data.trialEndDate)}
              </p>
            )}
            {subscriptionQuery.data.renewalDate && (
              <p>
                <span className="text-muted-foreground">Renouvellement : </span>
                {formatDate(subscriptionQuery.data.renewalDate)}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
