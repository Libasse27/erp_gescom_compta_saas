"use client";

import { StatCard } from "@/components/stat-card";
import { usePlatformOverview } from "@/lib/queries/use-platform-overview";

function formatFCFA(amount: number): string {
  return `${amount.toLocaleString("fr-SN")} FCFA`;
}

export default function SuperAdminOverviewPage() {
  const overviewQuery = usePlatformOverview();

  return (
    <div className="grid gap-6 p-8">
      <h1 className="text-2xl font-semibold">Vue générale</h1>

      {overviewQuery.isLoading && <p className="text-sm text-muted-foreground">Chargement…</p>}
      {overviewQuery.isError && (
        <p className="text-sm text-destructive">Impossible de charger les statistiques plateforme.</p>
      )}

      {overviewQuery.data && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard label="Entreprises (total)" value={overviewQuery.data.totalEnterprises} />
          <StatCard label="Entreprises actives" value={overviewQuery.data.activeEnterprises} />
          <StatCard label="Entreprises suspendues" value={overviewQuery.data.suspendedEnterprises} />
          <StatCard label="Nouveaux comptes (30j)" value={overviewQuery.data.newEnterprisesLast30Days} />
          <StatCard label="Abonnements actifs" value={overviewQuery.data.activeSubscriptions} />
          <StatCard label="Abonnements expirés" value={overviewQuery.data.expiredSubscriptions} />
          <StatCard label="Revenus" value={formatFCFA(overviewQuery.data.totalRevenue)} />
          <StatCard label="Paiements en attente" value={overviewQuery.data.pendingPayments} />
          <StatCard label="Paiements échoués" value={overviewQuery.data.failedPayments} />
          <StatCard label="Utilisateurs (total)" value={overviewQuery.data.totalUsers} />
        </div>
      )}
    </div>
  );
}
