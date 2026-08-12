import { useState } from "react";
import type { IncomeStatementAccountLine, ReportDailyPoint } from "@erp/types";
import { formatFCFA } from "@erp/utils";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useIsOnline } from "../lib/offline";
import { useIncomeStatement, usePurchasesReport, useSalesReport } from "../lib/queries/use-reports";

// Module 9 (dernier) de la Phase 9 : lecture seule, agrège Ventes/Achats/
// Comptabilité — pas de modèle Prisma propre, donc pas de pagination ni de
// file de mutations hors-ligne ici (contrairement à tous les modules
// précédents). Un seul écran scrollable plutôt que le patron
// liste/formulaire/détail : miroir de apps/web/src/app/app/reports/page.tsx,
// un sélecteur de période texte (pas de date picker natif — CLAUDE.md §3
// interdit les dépendances non triviales, et un DatePicker en introduirait
// une) partagé par les trois sections. Vide par défaut : chaque endpoint
// applique alors son propre défaut côté serveur (mois en cours pour
// ventes/achats, année civile en cours pour le compte de résultat).
export function ReportsScreen() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const isOnline = useIsOnline();

  const filters = {
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  };

  const salesReportQuery = useSalesReport(filters);
  const purchasesReportQuery = usePurchasesReport(filters);
  const incomeStatementQuery = useIncomeStatement(filters);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {!isOnline ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Hors-ligne — les données affichées peuvent être obsolètes.</Text>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Période</Text>
        <View style={styles.periodRow}>
          <View style={styles.periodField}>
            <Text style={styles.label}>Du</Text>
            <TextInput
              style={styles.input}
              value={dateFrom}
              onChangeText={setDateFrom}
              placeholder="AAAA-MM-JJ"
              autoCapitalize="none"
            />
          </View>
          <View style={styles.periodField}>
            <Text style={styles.label}>Au</Text>
            <TextInput
              style={styles.input}
              value={dateTo}
              onChangeText={setDateTo}
              placeholder="AAAA-MM-JJ"
              autoCapitalize="none"
            />
          </View>
        </View>
        <Text style={styles.hintText}>
          Laisser vide pour le mois en cours (ventes/achats) ou l&apos;année en cours (compte de résultat).
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Rapport des ventes</Text>
        {salesReportQuery.isLoading ? <ActivityIndicator style={styles.loader} /> : null}
        {salesReportQuery.isError ? <Text style={styles.errorText}>Impossible de charger ce rapport.</Text> : null}
        {salesReportQuery.data ? (
          <>
            <Text style={styles.summaryText}>
              {salesReportQuery.data.count} vente(s) — Total HT {formatFCFA(salesReportQuery.data.totalExcludingTax)}{" "}
              — TVA {formatFCFA(salesReportQuery.data.totalVat)} — TTC{" "}
              {formatFCFA(salesReportQuery.data.totalIncludingTax)}
            </Text>
            {salesReportQuery.data.byDay.map((point) => (
              <DailyPointRow key={point.date} point={point} />
            ))}
          </>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Rapport des achats</Text>
        {purchasesReportQuery.isLoading ? <ActivityIndicator style={styles.loader} /> : null}
        {purchasesReportQuery.isError ? (
          <Text style={styles.errorText}>Impossible de charger ce rapport.</Text>
        ) : null}
        {purchasesReportQuery.data ? (
          <>
            <Text style={styles.summaryText}>
              {purchasesReportQuery.data.count} achat(s) — Total HT{" "}
              {formatFCFA(purchasesReportQuery.data.totalExcludingTax)} — TVA{" "}
              {formatFCFA(purchasesReportQuery.data.totalVat)} — TTC{" "}
              {formatFCFA(purchasesReportQuery.data.totalIncludingTax)}
            </Text>
            {purchasesReportQuery.data.byDay.map((point) => (
              <DailyPointRow key={point.date} point={point} />
            ))}
          </>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Compte de résultat</Text>
        {incomeStatementQuery.isLoading ? <ActivityIndicator style={styles.loader} /> : null}
        {incomeStatementQuery.isError ? (
          <Text style={styles.errorText}>Impossible de charger le compte de résultat.</Text>
        ) : null}
        {incomeStatementQuery.data ? (
          <>
            <Text style={styles.subsectionTitle}>Produits (classe 7)</Text>
            {incomeStatementQuery.data.revenueByAccount.length === 0 ? (
              <Text style={styles.hintText}>Aucun produit sur la période.</Text>
            ) : (
              incomeStatementQuery.data.revenueByAccount.map((line) => <AccountLineRow key={line.accountId} line={line} />)
            )}

            <Text style={styles.subsectionTitle}>Charges (classe 6)</Text>
            {incomeStatementQuery.data.expensesByAccount.length === 0 ? (
              <Text style={styles.hintText}>Aucune charge sur la période.</Text>
            ) : (
              incomeStatementQuery.data.expensesByAccount.map((line) => <AccountLineRow key={line.accountId} line={line} />)
            )}

            <Text style={styles.summaryTextStrong}>
              Total produits {formatFCFA(incomeStatementQuery.data.totalRevenue)} — Total charges{" "}
              {formatFCFA(incomeStatementQuery.data.totalExpenses)} — Résultat net{" "}
              {formatFCFA(incomeStatementQuery.data.netResult)}
            </Text>
          </>
        ) : null}
      </View>
    </ScrollView>
  );
}

function DailyPointRow({ point }: { point: ReportDailyPoint }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{new Date(point.date).toLocaleDateString("fr-SN")}</Text>
      <Text style={styles.rowValue}>
        {point.count} — {formatFCFA(point.totalIncludingTax)}
      </Text>
    </View>
  );
}

function AccountLineRow({ line }: { line: IncomeStatementAccountLine }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>
        {line.accountCode} — {line.accountLabel}
      </Text>
      <Text style={styles.rowValue}>{formatFCFA(line.amount)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 20,
  },
  banner: {
    backgroundColor: "#fff3cd",
    borderRadius: 8,
    padding: 10,
  },
  bannerText: {
    fontSize: 13,
    color: "#5c4a1a",
  },
  section: {
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
  subsectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginTop: 4,
  },
  periodRow: {
    flexDirection: "row",
    gap: 12,
  },
  periodField: {
    flex: 1,
    gap: 4,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  hintText: {
    fontSize: 13,
    color: "#777",
  },
  loader: {
    marginVertical: 8,
  },
  errorText: {
    color: "#b00020",
    fontSize: 14,
  },
  summaryText: {
    fontSize: 13,
    color: "#555",
  },
  summaryTextStrong: {
    fontSize: 14,
    fontWeight: "600",
    marginTop: 6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  rowLabel: {
    fontSize: 14,
    flex: 1,
  },
  rowValue: {
    fontSize: 14,
    fontWeight: "600",
    marginLeft: 12,
  },
});
