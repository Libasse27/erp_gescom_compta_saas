import type { AccountWithBalance } from "@erp/types";
import { formatFCFA } from "@erp/utils";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import { useIsOnline } from "../lib/offline";
import { useTrialBalance } from "../lib/queries/use-accounts";

// Lecture seule, jamais paginée (voir AccountsRepository.trialBalance côté
// API) — une forme de réponse différente de la liste standard, atteint
// uniquement depuis AccountsListScreen.
export function TrialBalanceScreen() {
  const trialBalanceQuery = useTrialBalance();
  const isOnline = useIsOnline();

  if (trialBalanceQuery.isLoading) {
    return <ActivityIndicator style={styles.loader} />;
  }

  if (trialBalanceQuery.isError || !trialBalanceQuery.data) {
    return <Text style={styles.errorText}>Impossible de charger la balance.</Text>;
  }

  const trialBalance = trialBalanceQuery.data;

  return (
    <View style={styles.container}>
      {!isOnline ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Hors-ligne — les données affichées peuvent être obsolètes.</Text>
        </View>
      ) : null}

      {trialBalance.accounts.length === 0 ? (
        <Text style={styles.emptyText}>Aucun compte pour l&apos;instant.</Text>
      ) : null}

      <FlatList
        data={trialBalance.accounts}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <AccountRow account={item} />}
      />

      <View style={styles.totals}>
        <Text style={styles.totalRow}>Total débit : {formatFCFA(trialBalance.totalDebit)}</Text>
        <Text style={styles.totalRowStrong}>Total crédit : {formatFCFA(trialBalance.totalCredit)}</Text>
      </View>
    </View>
  );
}

function AccountRow({ account }: { account: AccountWithBalance }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle}>
          {account.code} — {account.label}
        </Text>
        <Text style={styles.rowSubtitle}>
          Débit {formatFCFA(account.totalDebit)} — Crédit {formatFCFA(account.totalCredit)}
        </Text>
      </View>
      <Text style={styles.rowBalance}>{formatFCFA(account.balance)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    gap: 12,
  },
  loader: {
    marginTop: 24,
  },
  errorText: {
    color: "#b00020",
    fontSize: 14,
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
  emptyText: {
    color: "#555",
    fontSize: 14,
    textAlign: "center",
    marginVertical: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  rowMain: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  rowSubtitle: {
    fontSize: 13,
    color: "#555",
  },
  rowBalance: {
    fontSize: 15,
    fontWeight: "700",
    marginLeft: 12,
  },
  totals: {
    borderTopWidth: 1,
    borderTopColor: "#ccc",
    paddingTop: 10,
    gap: 2,
  },
  totalRow: {
    fontSize: 14,
    color: "#555",
    textAlign: "right",
  },
  totalRowStrong: {
    fontSize: 17,
    fontWeight: "700",
    textAlign: "right",
  },
});
