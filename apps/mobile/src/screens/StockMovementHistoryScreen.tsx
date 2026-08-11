import { useLayoutEffect, useState } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { StockMovement, StockMovementType } from "@erp/types";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useStockMovements } from "../lib/queries/use-stock";
import type { AppStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<AppStackParamList, "StockMovementHistory">;

const PAGE_SIZE = 20;

const MOVEMENT_TYPE_LABELS: Record<StockMovementType, string> = {
  IN: "Entrée (réception)",
  OUT: "Sortie",
  ADJUSTMENT: "Correction d'inventaire (+/-)",
};

function formatSignedQuantity(movement: StockMovement): string {
  if (movement.type === "OUT") return `-${movement.quantity}`;
  if (movement.type === "IN") return `+${movement.quantity}`;
  // ADJUSTMENT : quantity porte déjà son signe (delta positif ou négatif).
  return movement.quantity > 0 ? `+${movement.quantity}` : String(movement.quantity);
}

// Historique en lecture seule d'un produit — pas de bannière hors-ligne ni
// mutations en échec (patron réservé à l'écran de liste principal
// StockLevelsScreen, cohérent avec l'absence de cette bannière sur
// ClientFormScreen/SupplierFormScreen/ProductFormScreen).
export function StockMovementHistoryScreen({ route, navigation }: Props) {
  const { productId, productCode, productName } = route.params;
  const [page, setPage] = useState(1);

  const movementsQuery = useStockMovements({ productId, page, pageSize: PAGE_SIZE });

  useLayoutEffect(() => {
    navigation.setOptions({
      title: `${productCode} — ${productName}`,
      headerRight: () => (
        <Pressable onPress={() => navigation.navigate("StockMovementForm", { productId })} hitSlop={8}>
          <Text style={styles.headerButton}>+ Mouvement</Text>
        </Pressable>
      ),
    });
  }, [navigation, productId, productCode, productName]);

  const totalPages = movementsQuery.data ? Math.max(1, Math.ceil(movementsQuery.data.total / PAGE_SIZE)) : 1;

  return (
    <View style={styles.container}>
      {movementsQuery.isLoading ? <ActivityIndicator style={styles.loader} /> : null}
      {movementsQuery.isError ? <Text style={styles.errorText}>Impossible de charger l&apos;historique.</Text> : null}
      {movementsQuery.data?.items.length === 0 ? (
        <Text style={styles.emptyText}>Aucun mouvement enregistré pour l&apos;instant.</Text>
      ) : null}

      <FlatList
        data={movementsQuery.data?.items ?? []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <MovementRow movement={item} />}
      />

      {movementsQuery.data && movementsQuery.data.items.length > 0 ? (
        <View style={styles.pagination}>
          <Text style={styles.pageInfo}>
            Page {movementsQuery.data.page} / {totalPages} — {movementsQuery.data.total} mouvement(s)
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

function MovementRow({ movement }: { movement: StockMovement }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle}>{MOVEMENT_TYPE_LABELS[movement.type]}</Text>
        <Text style={styles.rowSubtitle}>{new Date(movement.createdAt).toLocaleString("fr-SN")}</Text>
        {movement.note ? <Text style={styles.rowNote}>{movement.note}</Text> : null}
      </View>
      <Text style={[styles.quantity, movement.type === "OUT" && styles.quantityNegative]}>
        {formatSignedQuantity(movement)}
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
    fontSize: 15,
    fontWeight: "600",
  },
  rowSubtitle: {
    fontSize: 13,
    color: "#555",
  },
  rowNote: {
    fontSize: 13,
    color: "#777",
    fontStyle: "italic",
  },
  quantity: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1a7a3a",
    marginLeft: 12,
  },
  quantityNegative: {
    color: "#b00020",
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
