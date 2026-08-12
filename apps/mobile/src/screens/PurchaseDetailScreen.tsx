import { useState } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { PurchaseLine, PurchaseStatus } from "@erp/types";
import { formatFCFA } from "@erp/utils";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useIsOnline } from "../lib/offline";
import { useCancelPurchase, useConfirmPurchase, usePurchase } from "../lib/queries/use-purchases";
import type { AppStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<AppStackParamList, "PurchaseDetail">;

const STATUS_LABELS: Record<PurchaseStatus, string> = {
  DRAFT: "Brouillon",
  CONFIRMED: "Confirmé",
  CANCELLED: "Annulé",
};

// Miroir de SaleDetailScreen.tsx (module 5) : lecture seule + actions de
// cycle de vie. Confirmer un achat DRAFT incrémente le stock côté serveur
// (jamais bloqué par une contrainte de stock insuffisant, contrairement à
// une vente) — voir useConfirmPurchase.
export function PurchaseDetailScreen({ route }: Props) {
  const { purchaseId } = route.params;
  const purchaseQuery = usePurchase(purchaseId);
  const confirmPurchase = useConfirmPurchase();
  const cancelPurchase = useCancelPurchase();
  const isOnline = useIsOnline();
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"confirm" | "cancel" | null>(null);

  const runAction = async (action: "confirm" | "cancel", run: () => Promise<void>) => {
    setActionError(null);
    setActionInfo(null);
    setPendingAction(action);
    try {
      await run();
      if (!isOnline) {
        setActionInfo("Action mise en file d'attente — elle sera appliquée à la reconnexion.");
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Une erreur est survenue");
    } finally {
      setPendingAction(null);
    }
  };

  const handleConfirm = () => runAction("confirm", () => confirmPurchase(purchaseId));
  const handleCancel = () => runAction("cancel", () => cancelPurchase(purchaseId));

  if (purchaseQuery.isLoading) {
    return <ActivityIndicator style={styles.loader} />;
  }

  if (purchaseQuery.isError || !purchaseQuery.data) {
    return <Text style={styles.errorText}>Impossible de charger cet achat.</Text>;
  }

  const purchase = purchaseQuery.data;

  return (
    <View style={styles.container}>
      {!isOnline ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Hors-ligne — les données affichées peuvent être obsolètes.</Text>
        </View>
      ) : null}

      <View style={styles.header}>
        <Text style={styles.supplierName}>{purchase.supplierName}</Text>
        <Text style={styles.statusText}>{STATUS_LABELS[purchase.status]}</Text>
        <Text style={styles.dateText}>{new Date(purchase.purchaseDate).toLocaleDateString("fr-SN")}</Text>
        {purchase.notes ? <Text style={styles.notesText}>{purchase.notes}</Text> : null}
      </View>

      {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}
      {actionInfo ? <Text style={styles.infoText}>{actionInfo}</Text> : null}

      <FlatList
        data={purchase.lines}
        keyExtractor={(line) => line.id}
        renderItem={({ item }) => <LineRow line={item} />}
        ListHeaderComponent={<Text style={styles.sectionLabel}>Lignes</Text>}
      />

      <View style={styles.totals}>
        <Text style={styles.totalRow}>Total HT : {formatFCFA(purchase.totalExcludingTax)}</Text>
        <Text style={styles.totalRow}>TVA : {formatFCFA(purchase.totalVat)}</Text>
        <Text style={styles.totalRowStrong}>Total TTC : {formatFCFA(purchase.totalIncludingTax)}</Text>
      </View>

      {purchase.status === "DRAFT" ? (
        <View style={styles.actions}>
          <Pressable
            style={[styles.button, styles.confirmButton]}
            onPress={handleConfirm}
            disabled={pendingAction !== null || purchaseQuery.isFetching}
          >
            {pendingAction === "confirm" ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Confirmer</Text>
            )}
          </Pressable>
          <Pressable
            style={[styles.button, styles.cancelButton]}
            onPress={handleCancel}
            disabled={pendingAction !== null || purchaseQuery.isFetching}
          >
            {pendingAction === "cancel" ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Annuler</Text>
            )}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function LineRow({ line }: { line: PurchaseLine }) {
  return (
    <View style={styles.lineRow}>
      <View style={styles.lineMain}>
        <Text style={styles.lineTitle}>
          {line.productCode} — {line.productName}
        </Text>
        <Text style={styles.lineSubtitle}>
          {line.quantity} × {formatFCFA(line.unitCostExcludingTax)}
        </Text>
      </View>
      <Text style={styles.lineTotal}>{formatFCFA(line.lineTotalIncludingTax)}</Text>
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
  infoText: {
    color: "#1a5fb4",
    fontSize: 14,
  },
  header: {
    gap: 2,
  },
  supplierName: {
    fontSize: 18,
    fontWeight: "700",
  },
  statusText: {
    fontSize: 14,
    color: "#1a5fb4",
    fontWeight: "600",
  },
  dateText: {
    fontSize: 13,
    color: "#555",
  },
  notesText: {
    fontSize: 13,
    color: "#777",
    fontStyle: "italic",
    marginTop: 4,
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
  lineTotal: {
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
  actions: {
    flexDirection: "row",
    gap: 12,
  },
  button: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  confirmButton: {
    backgroundColor: "#1a7a3a",
  },
  cancelButton: {
    backgroundColor: "#b00020",
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
