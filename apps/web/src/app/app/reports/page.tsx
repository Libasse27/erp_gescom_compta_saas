"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useIncomeStatement, usePurchasesReport, useSalesReport } from "@/lib/queries/use-reports";

function formatFCFA(amount: number): string {
  return `${amount.toLocaleString("fr-SN")} FCFA`;
}

// Module 9 (dernier) de la Phase 8 : lecture seule, agrège Ventes/Achats/
// Comptabilité — un seul sélecteur de période partagé par les trois
// sections. Vide par défaut : chaque endpoint applique alors son propre
// défaut côté serveur (mois en cours pour ventes/achats, année civile en
// cours pour le compte de résultat — voir ReportsRepository).
export default function ReportsPage() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const filters = {
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  };

  const salesReportQuery = useSalesReport(filters);
  const purchasesReportQuery = usePurchasesReport(filters);
  const incomeStatementQuery = useIncomeStatement(filters);

  return (
    <div className="grid gap-6 p-8">
      <h1 className="text-2xl font-semibold">Rapports</h1>

      <Card>
        <CardHeader>
          <CardTitle>Période</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1.5">
              <label className="text-sm text-muted-foreground" htmlFor="report-date-from">
                Du
              </label>
              <Input id="report-date-from" type="date" className="w-44" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <label className="text-sm text-muted-foreground" htmlFor="report-date-to">
                Au
              </label>
              <Input id="report-date-to" type="date" className="w-44" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <p className="text-sm text-muted-foreground">
              Laisser vide pour le mois en cours (ventes/achats) ou l&apos;année en cours (compte de résultat).
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rapport des ventes</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {salesReportQuery.isLoading && <p className="text-sm text-muted-foreground">Chargement…</p>}
          {salesReportQuery.data && (
            <>
              <p className="text-sm text-muted-foreground">
                {salesReportQuery.data.count} vente(s) — Total HT {formatFCFA(salesReportQuery.data.totalExcludingTax)} — TVA{" "}
                {formatFCFA(salesReportQuery.data.totalVat)} — TTC {formatFCFA(salesReportQuery.data.totalIncludingTax)}
              </p>
              {salesReportQuery.data.byDay.length > 0 && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-4">Date</th>
                      <th className="py-2 pr-4">Ventes</th>
                      <th className="py-2 pr-4">Total TTC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salesReportQuery.data.byDay.map((point) => (
                      <tr key={point.date} className="border-b last:border-0">
                        <td className="py-2 pr-4">{new Date(point.date).toLocaleDateString("fr-SN")}</td>
                        <td className="py-2 pr-4">{point.count}</td>
                        <td className="py-2 pr-4">{formatFCFA(point.totalIncludingTax)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rapport des achats</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {purchasesReportQuery.isLoading && <p className="text-sm text-muted-foreground">Chargement…</p>}
          {purchasesReportQuery.data && (
            <>
              <p className="text-sm text-muted-foreground">
                {purchasesReportQuery.data.count} achat(s) — Total HT {formatFCFA(purchasesReportQuery.data.totalExcludingTax)} — TVA{" "}
                {formatFCFA(purchasesReportQuery.data.totalVat)} — TTC {formatFCFA(purchasesReportQuery.data.totalIncludingTax)}
              </p>
              {purchasesReportQuery.data.byDay.length > 0 && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-4">Date</th>
                      <th className="py-2 pr-4">Achats</th>
                      <th className="py-2 pr-4">Total TTC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchasesReportQuery.data.byDay.map((point) => (
                      <tr key={point.date} className="border-b last:border-0">
                        <td className="py-2 pr-4">{new Date(point.date).toLocaleDateString("fr-SN")}</td>
                        <td className="py-2 pr-4">{point.count}</td>
                        <td className="py-2 pr-4">{formatFCFA(point.totalIncludingTax)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Compte de résultat</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {incomeStatementQuery.isLoading && <p className="text-sm text-muted-foreground">Chargement…</p>}
          {incomeStatementQuery.data && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="mb-2 text-sm font-medium">Produits (classe 7)</p>
                  {incomeStatementQuery.data.revenueByAccount.length === 0 && (
                    <p className="text-sm text-muted-foreground">Aucun produit sur la période.</p>
                  )}
                  {incomeStatementQuery.data.revenueByAccount.map((line) => (
                    <div key={line.accountId} className="flex justify-between text-sm">
                      <span>
                        {line.accountCode} — {line.accountLabel}
                      </span>
                      <span>{formatFCFA(line.amount)}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <p className="mb-2 text-sm font-medium">Charges (classe 6)</p>
                  {incomeStatementQuery.data.expensesByAccount.length === 0 && (
                    <p className="text-sm text-muted-foreground">Aucune charge sur la période.</p>
                  )}
                  {incomeStatementQuery.data.expensesByAccount.map((line) => (
                    <div key={line.accountId} className="flex justify-between text-sm">
                      <span>
                        {line.accountCode} — {line.accountLabel}
                      </span>
                      <span>{formatFCFA(line.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <p className="text-sm font-medium">
                Total produits {formatFCFA(incomeStatementQuery.data.totalRevenue)} — Total charges{" "}
                {formatFCFA(incomeStatementQuery.data.totalExpenses)} — Résultat net{" "}
                {formatFCFA(incomeStatementQuery.data.netResult)}
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
