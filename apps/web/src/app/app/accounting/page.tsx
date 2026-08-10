"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AccountForm } from "@/components/account-form";
import { JournalEntryForm } from "@/components/journal-entry-form";
import { useAccounts, useTrialBalance } from "@/lib/queries/use-accounts";
import { useJournalEntries } from "@/lib/queries/use-journal-entries";

const PAGE_SIZE = 20;

function formatFCFA(amount: number): string {
  return `${amount.toLocaleString("fr-SN")} FCFA`;
}

// Module 8 de la Phase 8 : trois sections indépendantes (plan comptable,
// écritures, balance) plutôt qu'un miroir de sales/purchases/invoicing —
// Comptabilité a deux ressources distinctes (Account, JournalEntry), pas une
// seule fiche/liste.
export default function AccountingPage() {
  const [accountsPage, setAccountsPage] = useState(1);
  const [entriesPage, setEntriesPage] = useState(1);
  const [entriesSearchInput, setEntriesSearchInput] = useState("");
  const [entriesSearch, setEntriesSearch] = useState("");

  const accountsQuery = useAccounts({ page: accountsPage, pageSize: PAGE_SIZE });
  const entriesQuery = useJournalEntries({ page: entriesPage, pageSize: PAGE_SIZE, search: entriesSearch || undefined });
  const trialBalanceQuery = useTrialBalance();

  const accountsTotalPages = accountsQuery.data ? Math.max(1, Math.ceil(accountsQuery.data.total / PAGE_SIZE)) : 1;
  const entriesTotalPages = entriesQuery.data ? Math.max(1, Math.ceil(entriesQuery.data.total / PAGE_SIZE)) : 1;

  return (
    <div className="grid gap-6 p-8">
      <h1 className="text-2xl font-semibold">Comptabilité</h1>

      <Card>
        <CardHeader>
          <CardTitle>Plan comptable</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <AccountForm onSaved={() => {}} />

          {accountsQuery.isLoading && <p className="text-sm text-muted-foreground">Chargement…</p>}
          {accountsQuery.data?.items.length === 0 && (
            <p className="text-sm text-muted-foreground">Aucun compte pour l&apos;instant.</p>
          )}
          {accountsQuery.data && accountsQuery.data.items.length > 0 && (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4">Code</th>
                    <th className="py-2 pr-4">Libellé</th>
                    <th className="py-2 pr-4">Solde</th>
                  </tr>
                </thead>
                <tbody>
                  {accountsQuery.data.items.map((account) => (
                    <tr key={account.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-mono">{account.code}</td>
                      <td className="py-2 pr-4">{account.label}</td>
                      <td className="py-2 pr-4">{formatFCFA(account.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Page {accountsQuery.data.page} / {accountsTotalPages} — {accountsQuery.data.total} compte(s)
                </p>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" disabled={accountsPage <= 1} onClick={() => setAccountsPage((p) => Math.max(1, p - 1))}>
                    Précédent
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={accountsPage >= accountsTotalPages} onClick={() => setAccountsPage((p) => Math.min(accountsTotalPages, p + 1))}>
                    Suivant
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Nouvelle écriture</CardTitle>
        </CardHeader>
        <CardContent>
          <JournalEntryForm onSaved={() => {}} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Écritures</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              setEntriesPage(1);
              setEntriesSearch(entriesSearchInput);
            }}
          >
            <div className="grid gap-1.5">
              <label className="text-sm text-muted-foreground" htmlFor="entry-search">
                Recherche
              </label>
              <Input
                id="entry-search"
                placeholder="N° écriture, libellé ou référence…"
                value={entriesSearchInput}
                onChange={(event) => setEntriesSearchInput(event.target.value)}
              />
            </div>
            <Button type="submit" variant="outline">
              Rechercher
            </Button>
          </form>

          {entriesQuery.isLoading && <p className="text-sm text-muted-foreground">Chargement…</p>}
          {entriesQuery.data?.items.length === 0 && (
            <p className="text-sm text-muted-foreground">Aucune écriture pour l&apos;instant.</p>
          )}
          {entriesQuery.data && entriesQuery.data.items.length > 0 && (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4">N° écriture</th>
                    <th className="py-2 pr-4">Date</th>
                    <th className="py-2 pr-4">Libellé</th>
                    <th className="py-2 pr-4">Référence</th>
                    <th className="py-2 pr-4">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {entriesQuery.data.items.map((entry) => (
                    <tr key={entry.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-mono">{entry.number}</td>
                      <td className="py-2 pr-4">{new Date(entry.entryDate).toLocaleDateString("fr-SN")}</td>
                      <td className="py-2 pr-4">{entry.description}</td>
                      <td className="py-2 pr-4">{entry.reference ?? "—"}</td>
                      <td className="py-2 pr-4">{formatFCFA(entry.totalDebit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Page {entriesQuery.data.page} / {entriesTotalPages} — {entriesQuery.data.total} écriture(s)
                </p>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" disabled={entriesPage <= 1} onClick={() => setEntriesPage((p) => Math.max(1, p - 1))}>
                    Précédent
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={entriesPage >= entriesTotalPages} onClick={() => setEntriesPage((p) => Math.min(entriesTotalPages, p + 1))}>
                    Suivant
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Balance des comptes</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {trialBalanceQuery.isLoading && <p className="text-sm text-muted-foreground">Chargement…</p>}
          {trialBalanceQuery.data && (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4">Code</th>
                    <th className="py-2 pr-4">Libellé</th>
                    <th className="py-2 pr-4">Total débit</th>
                    <th className="py-2 pr-4">Total crédit</th>
                    <th className="py-2 pr-4">Solde</th>
                  </tr>
                </thead>
                <tbody>
                  {trialBalanceQuery.data.accounts.map((account) => (
                    <tr key={account.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-mono">{account.code}</td>
                      <td className="py-2 pr-4">{account.label}</td>
                      <td className="py-2 pr-4">{formatFCFA(account.totalDebit)}</td>
                      <td className="py-2 pr-4">{formatFCFA(account.totalCredit)}</td>
                      <td className="py-2 pr-4">{formatFCFA(account.balance)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t font-medium">
                    <td className="py-2 pr-4" colSpan={2}>
                      Total
                    </td>
                    <td className="py-2 pr-4">{formatFCFA(trialBalanceQuery.data.totalDebit)}</td>
                    <td className="py-2 pr-4">{formatFCFA(trialBalanceQuery.data.totalCredit)}</td>
                    <td className="py-2 pr-4" />
                  </tr>
                </tfoot>
              </table>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
