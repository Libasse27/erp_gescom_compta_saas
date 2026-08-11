import { useLayoutEffect, useState } from "react";
import { useIsFocused } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import type { Supplier } from "@erp/types";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { listMutations, useIsOnline } from "../lib/offline";
import { useDeactivateSupplier, useSuppliers } from "../lib/queries/use-suppliers";
import type { AppStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<AppStackParamList, "SuppliersList">;

const PAGE_SIZE = 20;
type ActiveFilter = "active" | "inactive" | "all";

function isActiveParam(filter: ActiveFilter): boolean | undefined {
  if (filter === "active") return true;
  if (filter === "inactive") return false;
  return undefined;
}

const SUPPLIER_TYPE_LABELS: Record<Supplier["type"], string> = {
  COMPANY: "Entreprise",
  INDIVIDUAL: "Particulier",
};

const FILTER_LABELS: Record<ActiveFilter, string> = {
  active: "Actifs",
  inactive: "Désactivés",
  all: "Tous",
};

export function SuppliersListScreen({ navigation }: Props) {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("active");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const isOnline = useIsOnline();
  const isFocused = useIsFocused();
  const suppliersQuery = useSuppliers({
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    isActive: isActiveParam(activeFilter),
  });
  const deactivateSupplier = useDeactivateSupplier();

  // Réalise la promesse déjà inscrite en commentaire dans mutation-queue.ts
  // ("exposé pour une future UI") : signale les mutations en échec terminal,
  // sans UI de retry/dismiss par ligne (reporté, docs/adr/0015-...). Poll
  // léger, uniquement pendant que cet écran est affiché.
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
        <Pressable onPress={() => navigation.navigate("SupplierForm", undefined)} hitSlop={8}>
          <Text style={styles.headerButton}>+ Nouveau</Text>
        </Pressable>
      ),
    });
  }, [navigation]);

  const totalPages = suppliersQuery.data ? Math.max(1, Math.ceil(suppliersQuery.data.total / PAGE_SIZE)) : 1;

  const handleDeactivate = async (id: string) => {
    setActionError(null);
    try {
      await deactivateSupplier(id);
      setConfirmingId(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Une erreur est survenue");
    }
  };

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
        placeholder="Nom ou email…"
        value={searchInput}
        onChangeText={setSearchInput}
        onSubmitEditing={() => {
          setPage(1);
          setSearch(searchInput);
        }}
        returnKeyType="search"
      />

      <View style={styles.filterRow}>
        {(Object.keys(FILTER_LABELS) as ActiveFilter[]).map((filter) => (
          <Pressable
            key={filter}
            style={[styles.filterChip, activeFilter === filter && styles.filterChipActive]}
            onPress={() => {
              setPage(1);
              setActiveFilter(filter);
            }}
          >
            <Text style={[styles.filterChipText, activeFilter === filter && styles.filterChipTextActive]}>
              {FILTER_LABELS[filter]}
            </Text>
          </Pressable>
        ))}
      </View>

      {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}
      {suppliersQuery.isLoading ? <ActivityIndicator style={styles.loader} /> : null}
      {suppliersQuery.isError ? <Text style={styles.errorText}>Impossible de charger les fournisseurs.</Text> : null}
      {suppliersQuery.data?.items.length === 0 ? (
        <Text style={styles.emptyText}>Aucun fournisseur pour l&apos;instant.</Text>
      ) : null}

      <FlatList
        data={suppliersQuery.data?.items ?? []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <SupplierRow
            supplier={item}
            confirming={confirmingId === item.id}
            onPress={() => navigation.navigate("SupplierForm", { supplierId: item.id })}
            onRequestDeactivate={() => setConfirmingId(item.id)}
            onCancelDeactivate={() => setConfirmingId(null)}
            onConfirmDeactivate={() => handleDeactivate(item.id)}
          />
        )}
      />

      {suppliersQuery.data && suppliersQuery.data.items.length > 0 ? (
        <View style={styles.pagination}>
          <Text style={styles.pageInfo}>
            Page {suppliersQuery.data.page} / {totalPages} — {suppliersQuery.data.total} fournisseur(s)
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

function SupplierRow({
  supplier,
  confirming,
  onPress,
  onRequestDeactivate,
  onCancelDeactivate,
  onConfirmDeactivate,
}: {
  supplier: Supplier;
  confirming: boolean;
  onPress: () => void;
  onRequestDeactivate: () => void;
  onCancelDeactivate: () => void;
  onConfirmDeactivate: () => void;
}) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle}>{supplier.name}</Text>
        <Text style={styles.rowSubtitle}>
          {SUPPLIER_TYPE_LABELS[supplier.type]}
          {supplier.city ? ` — ${supplier.city}` : ""}
        </Text>
      </View>
      {confirming ? (
        <View style={styles.rowActions}>
          <Text style={styles.confirmText}>Confirmer ?</Text>
          <Pressable onPress={onConfirmDeactivate} hitSlop={8}>
            <Text style={styles.destructiveAction}>Oui</Text>
          </Pressable>
          <Pressable onPress={onCancelDeactivate} hitSlop={8}>
            <Text style={styles.cancelAction}>Annuler</Text>
          </Pressable>
        </View>
      ) : supplier.isActive ? (
        <Pressable onPress={onRequestDeactivate} hitSlop={8}>
          <Text style={styles.deactivateAction}>Désactiver</Text>
        </Pressable>
      ) : (
        <Text style={styles.inactiveLabel}>Désactivé</Text>
      )}
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
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  confirmText: {
    fontSize: 13,
    color: "#555",
  },
  destructiveAction: {
    color: "#b00020",
    fontWeight: "600",
  },
  cancelAction: {
    color: "#1a5fb4",
  },
  deactivateAction: {
    color: "#b00020",
  },
  inactiveLabel: {
    color: "#999",
    fontSize: 13,
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
