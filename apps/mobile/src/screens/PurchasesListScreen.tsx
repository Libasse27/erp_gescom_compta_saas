import { useLayoutEffect, useState } from "react";
import { useIsFocused } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import type { PurchaseStatus } from "@erp/types";
import { formatFCFA } from "@erp/utils";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { listMutations, useIsOnline } from "../lib/offline";
import { usePurchases, type PurchaseListItem } from "../lib/queries/use-purchases";
import type { AppStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<AppStackParamList, "PurchasesList">;

const PAGE_SIZE = 20;
type StatusFilter = "all" | PurchaseStatus;

const FILTER_LABELS: Record<StatusFilter, string> = {
  all: "Tous",
  DRAFT: "Brouillons",
  CONFIRMED: "Confirmés",
  CANCELLED: "Annulés",
};

const STATUS_LABELS: Record<PurchaseStatus, string> = {
  DRAFT: "Brouillon",
  CONFIRMED: "Confirmé",
  CANCELLED: "Annulé",
};

const STATUS_BADGE_STYLE_KEYS = {
  DRAFT: "statusDRAFT",
  CONFIRMED: "statusCONFIRMED",
  CANCELLED: "statusCANCELLED",
} as const satisfies Record<PurchaseStatus, keyof typeof styles>;

function statusParam(filter: StatusFilter): PurchaseStatus | undefined {
  return filter === "all" ? undefined : filter;
}

// Miroir exact de SalesListScreen.tsx (module 5), Purchase étant structurellement
// identique à Sale côté liste (mêmes statuts, même pagination/filtres).
export function PurchasesListScreen({ navigation }: Props) {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const isOnline = useIsOnline();
  const isFocused = useIsFocused();
  const purchasesQuery = usePurchases({
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    status: statusParam(statusFilter),
  });

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
        <Pressable onPress={() => navigation.navigate("PurchaseForm")} hitSlop={8}>
          <Text style={styles.headerButton}>+ Nouvel achat</Text>
        </Pressable>
      ),
    });
  }, [navigation]);

  const totalPages = purchasesQuery.data ? Math.max(1, Math.ceil(purchasesQuery.data.total / PAGE_SIZE)) : 1;

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
        placeholder="Nom du fournisseur…"
        value={searchInput}
        onChangeText={setSearchInput}
        onSubmitEditing={() => {
          setPage(1);
          setSearch(searchInput);
        }}
        returnKeyType="search"
      />

      <View style={styles.filterRow}>
        {(Object.keys(FILTER_LABELS) as StatusFilter[]).map((filter) => (
          <Pressable
            key={filter}
            style={[styles.filterChip, statusFilter === filter && styles.filterChipActive]}
            onPress={() => {
              setPage(1);
              setStatusFilter(filter);
            }}
          >
            <Text style={[styles.filterChipText, statusFilter === filter && styles.filterChipTextActive]}>
              {FILTER_LABELS[filter]}
            </Text>
          </Pressable>
        ))}
      </View>

      {purchasesQuery.isLoading ? <ActivityIndicator style={styles.loader} /> : null}
      {purchasesQuery.isError ? <Text style={styles.errorText}>Impossible de charger les achats.</Text> : null}
      {purchasesQuery.data?.items.length === 0 ? (
        <Text style={styles.emptyText}>Aucun achat pour l&apos;instant.</Text>
      ) : null}

      <FlatList
        data={purchasesQuery.data?.items ?? []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <PurchaseRow
            purchase={item}
            onPress={() => navigation.navigate("PurchaseDetail", { purchaseId: item.id })}
          />
        )}
      />

      {purchasesQuery.data && purchasesQuery.data.items.length > 0 ? (
        <View style={styles.pagination}>
          <Text style={styles.pageInfo}>
            Page {purchasesQuery.data.page} / {totalPages} — {purchasesQuery.data.total} achat(s)
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

function PurchaseRow({ purchase, onPress }: { purchase: PurchaseListItem; onPress: () => void }) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle}>{purchase.supplierName}</Text>
        <Text style={styles.rowSubtitle}>
          {new Date(purchase.purchaseDate).toLocaleDateString("fr-SN")} · {formatFCFA(purchase.totalIncludingTax)}
        </Text>
      </View>
      <Text style={[styles.statusBadge, styles[STATUS_BADGE_STYLE_KEYS[purchase.status]]]}>
        {STATUS_LABELS[purchase.status]}
      </Text>
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
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  filterChip: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  filterChipActive: {
    backgroundColor: "#1a5fb4",
    borderColor: "#1a5fb4",
  },
  filterChipText: {
    fontSize: 13,
    color: "#333",
  },
  filterChipTextActive: {
    color: "#fff",
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
  statusBadge: {
    fontSize: 12,
    fontWeight: "700",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    overflow: "hidden",
  },
  statusDRAFT: {
    backgroundColor: "#e2e3e5",
    color: "#41464b",
  },
  statusCONFIRMED: {
    backgroundColor: "#d1e7dd",
    color: "#0f5132",
  },
  statusCANCELLED: {
    backgroundColor: "#f8d7da",
    color: "#842029",
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
