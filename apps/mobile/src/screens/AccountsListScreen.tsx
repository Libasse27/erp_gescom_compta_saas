import { useLayoutEffect, useState } from "react";
import { useIsFocused } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import type { AccountWithBalance } from "@erp/types";
import { formatFCFA } from "@erp/utils";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { listMutations, useIsOnline } from "../lib/offline";
import { useAccounts } from "../lib/queries/use-accounts";
import type { AppStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<AppStackParamList, "AccountsList">;

const PAGE_SIZE = 20;

// Écran d'entrée du module Comptabilité (module 8) — contrairement aux
// modules précédents, Comptabilité a deux ressources distinctes (Account,
// JournalEntry) plutôt qu'une seule fiche/liste : cet écran ne montre que le
// plan comptable, avec des liens d'en-tête vers les écritures et la balance
// (même sortie que StockLevelsScreen vers StockMovementHistory/Form, module
// 4). Pas de detail/edit par compte : AccountWithBalance porte déjà tout ce
// qui est affiché ici, et seule la création est exposée (voir
// AccountFormScreen — même limitation que le web, aucune UI n'expose le PATCH
// label).
export function AccountsListScreen({ navigation }: Props) {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const isOnline = useIsOnline();
  const isFocused = useIsFocused();
  const accountsQuery = useAccounts({ page, pageSize: PAGE_SIZE, search: search || undefined });

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
        <Pressable onPress={() => navigation.navigate("AccountForm")} hitSlop={8}>
          <Text style={styles.headerButton}>+ Compte</Text>
        </Pressable>
      ),
    });
  }, [navigation]);

  const totalPages = accountsQuery.data ? Math.max(1, Math.ceil(accountsQuery.data.total / PAGE_SIZE)) : 1;

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

      <View style={styles.subNavRow}>
        <Pressable style={styles.subNavLink} onPress={() => navigation.navigate("JournalEntriesList")}>
          <Text style={styles.subNavLinkText}>Écritures →</Text>
        </Pressable>
        <Pressable style={styles.subNavLink} onPress={() => navigation.navigate("TrialBalance")}>
          <Text style={styles.subNavLinkText}>Balance →</Text>
        </Pressable>
      </View>

      <TextInput
        style={styles.searchInput}
        placeholder="Code ou libellé…"
        value={searchInput}
        onChangeText={setSearchInput}
        onSubmitEditing={() => {
          setPage(1);
          setSearch(searchInput);
        }}
        returnKeyType="search"
      />

      {accountsQuery.isLoading ? <ActivityIndicator style={styles.loader} /> : null}
      {accountsQuery.isError ? <Text style={styles.errorText}>Impossible de charger le plan comptable.</Text> : null}
      {accountsQuery.data?.items.length === 0 ? (
        <Text style={styles.emptyText}>Aucun compte pour l&apos;instant.</Text>
      ) : null}

      <FlatList
        data={accountsQuery.data?.items ?? []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <AccountRow account={item} />}
      />

      {accountsQuery.data && accountsQuery.data.items.length > 0 ? (
        <View style={styles.pagination}>
          <Text style={styles.pageInfo}>
            Page {accountsQuery.data.page} / {totalPages} — {accountsQuery.data.total} compte(s)
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

function AccountRow({ account }: { account: AccountWithBalance }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle}>
          {account.code} — {account.label}
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
  subNavRow: {
    flexDirection: "row",
    gap: 16,
  },
  subNavLink: {
    paddingVertical: 4,
  },
  subNavLinkText: {
    color: "#1a5fb4",
    fontWeight: "600",
    fontSize: 14,
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
  rowBalance: {
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
