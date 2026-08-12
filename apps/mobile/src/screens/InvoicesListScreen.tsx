import { useLayoutEffect, useState } from "react";
import { useIsFocused } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import type { SalesInvoiceStatus } from "@erp/types";
import { formatFCFA } from "@erp/utils";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { listMutations, useIsOnline } from "../lib/offline";
import { useInvoices, type SalesInvoiceListItem } from "../lib/queries/use-invoices";
import type { AppStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<AppStackParamList, "InvoicesList">;

const PAGE_SIZE = 20;
type StatusFilter = "all" | SalesInvoiceStatus;

const FILTER_LABELS: Record<StatusFilter, string> = {
  all: "Toutes",
  ISSUED: "Émises",
  PAID: "Payées",
  VOID: "Annulées",
};

const STATUS_LABELS: Record<SalesInvoiceStatus, string> = {
  ISSUED: "Émise",
  PAID: "Payée",
  VOID: "Annulée",
};

const STATUS_BADGE_STYLE_KEYS = {
  ISSUED: "statusISSUED",
  PAID: "statusPAID",
  VOID: "statusVOID",
} as const satisfies Record<SalesInvoiceStatus, keyof typeof styles>;

function statusParam(filter: StatusFilter): SalesInvoiceStatus | undefined {
  return filter === "all" ? undefined : filter;
}

// Miroir de SalesListScreen.tsx/PurchasesListScreen.tsx (modules 5 et 6),
// avec les statuts ISSUED/PAID/VOID (pas de DRAFT ici — une facture est émise
// directement à la création) et pas de bouton "+ Nouvelle facture" générique :
// la création se fait toujours depuis une vente confirmée (voir
// InvoiceFormScreen), le bouton reste néanmoins présent en en-tête, comme
// pour Ventes/Achats.
export function InvoicesListScreen({ navigation }: Props) {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const isOnline = useIsOnline();
  const isFocused = useIsFocused();
  const invoicesQuery = useInvoices({
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
        <Pressable onPress={() => navigation.navigate("InvoiceForm")} hitSlop={8}>
          <Text style={styles.headerButton}>+ Nouvelle facture</Text>
        </Pressable>
      ),
    });
  }, [navigation]);

  const totalPages = invoicesQuery.data ? Math.max(1, Math.ceil(invoicesQuery.data.total / PAGE_SIZE)) : 1;

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
        placeholder="Nom du client…"
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

      {invoicesQuery.isLoading ? <ActivityIndicator style={styles.loader} /> : null}
      {invoicesQuery.isError ? <Text style={styles.errorText}>Impossible de charger les factures.</Text> : null}
      {invoicesQuery.data?.items.length === 0 ? (
        <Text style={styles.emptyText}>Aucune facture pour l&apos;instant.</Text>
      ) : null}

      <FlatList
        data={invoicesQuery.data?.items ?? []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <InvoiceRow invoice={item} onPress={() => navigation.navigate("InvoiceDetail", { invoiceId: item.id })} />
        )}
      />

      {invoicesQuery.data && invoicesQuery.data.items.length > 0 ? (
        <View style={styles.pagination}>
          <Text style={styles.pageInfo}>
            Page {invoicesQuery.data.page} / {totalPages} — {invoicesQuery.data.total} facture(s)
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

function InvoiceRow({ invoice, onPress }: { invoice: SalesInvoiceListItem; onPress: () => void }) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle}>
          {invoice.number} — {invoice.customerName}
        </Text>
        <Text style={styles.rowSubtitle}>
          {new Date(invoice.issuedAt).toLocaleDateString("fr-SN")} · {formatFCFA(invoice.totalIncludingTax)}
        </Text>
      </View>
      <Text style={[styles.statusBadge, styles[STATUS_BADGE_STYLE_KEYS[invoice.status]]]}>
        {STATUS_LABELS[invoice.status]}
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
  statusISSUED: {
    backgroundColor: "#e2e3e5",
    color: "#41464b",
  },
  statusPAID: {
    backgroundColor: "#d1e7dd",
    color: "#0f5132",
  },
  statusVOID: {
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
