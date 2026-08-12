import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { JournalEntryLine } from "@erp/types";
import { formatFCFA } from "@erp/utils";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import { useIsOnline } from "../lib/offline";
import { useJournalEntry } from "../lib/queries/use-journal-entries";
import type { AppStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<AppStackParamList, "JournalEntryDetail">;

// Lecture seule, aucune action — contrairement à SaleDetailScreen/
// PurchaseDetailScreen/InvoiceDetailScreen, JournalEntry est un grand livre
// append-only (aucune route PATCH/DELETE côté API, une correction se fait
// par une nouvelle écriture de contre-passation).
export function JournalEntryDetailScreen({ route }: Props) {
  const { entryId } = route.params;
  const entryQuery = useJournalEntry(entryId);
  const isOnline = useIsOnline();

  if (entryQuery.isLoading) {
    return <ActivityIndicator style={styles.loader} />;
  }

  if (entryQuery.isError || !entryQuery.data) {
    return <Text style={styles.errorText}>Impossible de charger cette écriture.</Text>;
  }

  const entry = entryQuery.data;

  return (
    <View style={styles.container}>
      {!isOnline ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Hors-ligne — les données affichées peuvent être obsolètes.</Text>
        </View>
      ) : null}

      <View style={styles.header}>
        <Text style={styles.entryNumber}>{entry.number}</Text>
        <Text style={styles.description}>{entry.description}</Text>
        <Text style={styles.dateText}>{new Date(entry.entryDate).toLocaleDateString("fr-SN")}</Text>
        {entry.reference ? <Text style={styles.referenceText}>Référence : {entry.reference}</Text> : null}
      </View>

      <FlatList
        data={entry.lines}
        keyExtractor={(line) => line.id}
        renderItem={({ item }) => <LineRow line={item} />}
        ListHeaderComponent={<Text style={styles.sectionLabel}>Lignes</Text>}
      />

      <View style={styles.totals}>
        <Text style={styles.totalRowStrong}>
          Total débit {formatFCFA(entry.totalDebit)} — Total crédit {formatFCFA(entry.totalCredit)}
        </Text>
      </View>
    </View>
  );
}

function LineRow({ line }: { line: JournalEntryLine }) {
  return (
    <View style={styles.lineRow}>
      <View style={styles.lineMain}>
        <Text style={styles.lineTitle}>
          {line.accountCode} — {line.accountLabel}
        </Text>
        {line.label ? <Text style={styles.lineSubtitle}>{line.label}</Text> : null}
      </View>
      <Text style={styles.lineAmount}>
        {line.debitAmount > 0 ? formatFCFA(line.debitAmount) : `(${formatFCFA(line.creditAmount)})`}
      </Text>
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
  header: {
    gap: 2,
  },
  entryNumber: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1a5fb4",
  },
  description: {
    fontSize: 18,
    fontWeight: "700",
  },
  dateText: {
    fontSize: 13,
    color: "#555",
  },
  referenceText: {
    fontSize: 13,
    color: "#777",
    marginTop: 2,
  },
  sectionLabel: {
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 4,
  },
  lineRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  lineMain: {
    flex: 1,
    gap: 2,
  },
  lineTitle: {
    fontSize: 15,
    fontWeight: "600",
  },
  lineSubtitle: {
    fontSize: 13,
    color: "#555",
  },
  lineAmount: {
    fontSize: 15,
    fontWeight: "700",
    marginLeft: 12,
  },
  totals: {
    borderTopWidth: 1,
    borderTopColor: "#ccc",
    paddingTop: 10,
  },
  totalRowStrong: {
    fontSize: 15,
    fontWeight: "700",
    textAlign: "right",
  },
});
