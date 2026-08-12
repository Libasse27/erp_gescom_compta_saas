import { useLayoutEffect, useState } from "react";
import { useIsFocused } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import type { JournalEntry } from "@erp/types";
import { formatFCFA } from "@erp/utils";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { listMutations, useIsOnline } from "../lib/offline";
import { useJournalEntries } from "../lib/queries/use-journal-entries";
import type { AppStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<AppStackParamList, "JournalEntriesList">;

const PAGE_SIZE = 20;

// Comme StockMovementHistoryScreen (module 4) : JournalEntry est un grand
// livre append-only, aucune action de cycle de vie sur une ligne de liste —
// juste une navigation vers le détail. Atteint uniquement depuis
// AccountsListScreen (pas d'entrée Home dédiée), comme
// StockMovementHistory/Form depuis StockLevelsScreen.
export function JournalEntriesListScreen({ navigation }: Props) {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const isOnline = useIsOnline();
  const isFocused = useIsFocused();
  const entriesQuery = useJournalEntries({ page, pageSize: PAGE_SIZE, search: search || undefined });

  const failedMutationsQuery = useQuery({
    queryKey: ["offline-mutations"],
    queryFn: listMutations,
    refetchInterval: 5000,
    enabled: isFocused,
  });
  const failedCount = failedMutationsQuery.data?.filter((mutation) => mutation.status === "failed").length ?? 0;

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable onPress={() => navigation.navigate("JournalEntryForm")} hitSlop={8}>
          <Text style={styles.headerButton}>+ Écriture</Text>
        </Pressable>
      ),
    });
  }, [navigation]);

  const totalPages = entriesQuery.data ? Math.max(1, Math.ceil(entriesQuery.data.total / PAGE_SIZE)) : 1;

  return (
    <View style={styles.container}>
      {!isOnline ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Hors-ligne — les données affichées peuvent être obsolètes.</Text>
        </View>
      ) : null}
      {failedCount > 0 ? (
        <View style={[styles.banner, styles.bannerWarning]}>
          <Text style={styles.bannerText}>{failedCount} modification(s) non synchronisée(s).</Text>
        </View>
      ) : null}

      <TextInput
        style={styles.searchInput}
        placeholder="N° écriture, libellé ou référence…"
        value={searchInput}
        onChangeText={setSearchInput}
        onSubmitEditing={() => {
          setPage(1);
          setSearch(searchInput);
        }}
        returnKeyType="search"
      />

      {entriesQuery.isLoading ? <ActivityIndicator style={styles.loader} /> : null}
      {entriesQuery.isError ? <Text style={styles.errorText}>Impossible de charger les écritures.</Text> : null}
      {entriesQuery.data?.items.length === 0 ? (
        <Text style={styles.emptyText}>Aucune écriture pour l&apos;instant.</Text>
      ) : null}

      <FlatList
        data={entriesQuery.data?.items ?? []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <EntryRow entry={item} onPress={() => navigation.navigate("JournalEntryDetail", { entryId: item.id })} />
        )}
      />

      {entriesQuery.data && entriesQuery.data.items.length > 0 ? (
        <View style={styles.pagination}>
          <Text style={styles.pageInfo}>
            Page {entriesQuery.data.page} / {totalPages} — {entriesQuery.data.total} écriture(s)
          </Text>
          <View style={styles.pageButtons}>
            <Pressable
              style={[styles.pageButton, page <= 1 && styles.pageButtonDisabled]}
              disabled={page <= 1}
              onPress={() => setPage((current) => Math.max(1, current - 1))}
            >
              <Text style={styles.pageButtonText}>Précédent</Text>
            </Pressable>
            <Pressable
              style={[styles.pageButton, page >= totalPages && styles.pageButtonDisabled]}
              disabled={page >= totalPages}
              onPress={() => setPage((current) => Math.min(totalPages, current + 1))}
            >
              <Text style={styles.pageButtonText}>Suivant</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function EntryRow({ entry, onPress }: { entry: JournalEntry; onPress: () => void }) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle}>
          {entry.number} — {entry.description}
        </Text>
        <Text style={styles.rowSubtitle}>
          {new Date(entry.entryDate).toLocaleDateString("fr-SN")}
          {entry.reference ? ` · ${entry.reference}` : ""}
        </Text>
      </View>
      <Text style={styles.rowAmount}>{formatFCFA(entry.totalDebit)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    gap: 12,
  },
  banner: {
    backgroundColor: "#fff3cd",
    borderRadius: 8,
    padding: 10,
  },
  bannerWarning: {
    backgroundColor: "#f8d7da",
  },
  bannerText: {
    fontSize: 13,
    color: "#5c4a1a",
  },
  searchInput: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  loader: {
    marginVertical: 12,
  },
  errorText: {
    color: "#b00020",
    fontSize: 14,
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
  rowAmount: {
    fontSize: 15,
    fontWeight: "700",
    marginLeft: 12,
  },
  pagination: {
    gap: 8,
  },
  pageInfo: {
    fontSize: 13,
    color: "#555",
    textAlign: "center",
  },
  pageButtons: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
  },
  pageButton: {
    borderWidth: 1,
    borderColor: "#1a5fb4",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  pageButtonDisabled: {
    borderColor: "#ccc",
  },
  pageButtonText: {
    color: "#1a5fb4",
    fontWeight: "600",
  },
  headerButton: {
    color: "#1a5fb4",
    fontWeight: "600",
    fontSize: 15,
  },
});
