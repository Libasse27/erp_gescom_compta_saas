import { useLayoutEffect, useState } from "react";
import { useIsFocused } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import type { StockLevel } from "@erp/types";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { listMutations, useIsOnline } from "../lib/offline";
import { useStockLevels } from "../lib/queries/use-stock";
import type { AppStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<AppStackParamList, "StockLevels">;

const PAGE_SIZE = 20;

// Écran d'entrée du module Stock — remplace le patron XListScreen (Clients/
// Fournisseurs/Produits) : StockLevel est une vue calculée (agrégation côté
// API, pas un modèle), donc pas de désactivation/suppression logique ici, et
// pas de filtre actif/inactif (aucun champ isActive sur StockLevel).
export function StockLevelsScreen({ navigation }: Props) {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const isOnline = useIsOnline();
  const isFocused = useIsFocused();
  const stockQuery = useStockLevels({ page, pageSize: PAGE_SIZE, search: search || undefined });

  // Même patron que ProductsListScreen/SuppliersListScreen (Phase 9.4+) :
  // signale les mutations en échec terminal (ex: 409 "Stock insuffisant"
  // découvert lors d'un rejeu hors-ligne), sans UI de retry/dismiss par ligne.
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
        <Pressable onPress={() => navigation.navigate("StockMovementForm", undefined)} hitSlop={8}>
          <Text style={styles.headerButton}>+ Mouvement</Text>
        </Pressable>
      ),
    });
  }, [navigation]);

  const totalPages = stockQuery.data ? Math.max(1, Math.ceil(stockQuery.data.total / PAGE_SIZE)) : 1;

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
        placeholder="Code ou nom…"
        value={searchInput}
        onChangeText={setSearchInput}
        onSubmitEditing={() => {
          setPage(1);
          setSearch(searchInput);
        }}
        returnKeyType="search"
      />

      {stockQuery.isLoading ? <ActivityIndicator style={styles.loader} /> : null}
      {stockQuery.isError ? <Text style={styles.errorText}>Impossible de charger les niveaux de stock.</Text> : null}
      {stockQuery.data?.items.length === 0 ? (
        <Text style={styles.emptyText}>Aucun produit suivi en stock pour l&apos;instant.</Text>
      ) : null}

      <FlatList
        data={stockQuery.data?.items ?? []}
        keyExtractor={(item) => item.productId}
        renderItem={({ item }) => (
          <StockLevelRow
            level={item}
            onPress={() =>
              navigation.navigate("StockMovementHistory", {
                productId: item.productId,
                productCode: item.code,
                productName: item.name,
              })
            }
            onRequestMovement={() => navigation.navigate("StockMovementForm", { productId: item.productId })}
          />
        )}
      />

      {stockQuery.data && stockQuery.data.items.length > 0 ? (
        <View style={styles.pagination}>
          <Text style={styles.pageInfo}>
            Page {stockQuery.data.page} / {totalPages} — {stockQuery.data.total} produit(s)
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

function StockLevelRow({
  level,
  onPress,
  onRequestMovement,
}: {
  level: StockLevel;
  onPress: () => void;
  onRequestMovement: () => void;
}) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle}>
          {level.code} — {level.name}
        </Text>
        <Text style={styles.rowSubtitle}>
          {level.quantityOnHand} {level.unit}
        </Text>
      </View>
      <Pressable onPress={onRequestMovement} hitSlop={8}>
        <Text style={styles.movementAction}>+</Text>
      </Pressable>
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
  movementAction: {
    color: "#1a5fb4",
    fontWeight: "700",
    fontSize: 20,
    paddingHorizontal: 8,
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
