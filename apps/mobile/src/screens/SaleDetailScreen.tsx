import { useState } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { SaleLine, SaleStatus } from "@erp/types";
import { formatFCFA } from "@erp/utils";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useIsOnline } from "../lib/offline";
import { useCancelSale, useConfirmSale, useSale } from "../lib/queries/use-sales";
import type { AppStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<AppStackParamList, "SaleDetail">;

const STATUS_LABELS: Record<SaleStatus, string> = {
  DRAFT: "Brouillon",
  CONFIRMED: "Confirmée",
  CANCELLED: "Annulée",
};

// Lecture seule + actions de cycle de vie — contrairement à
// ClientFormScreen/SupplierFormScreen/ProductFormScreen, il n'y a rien à
// éditer ici (SaleLine est figée à la création, voir SaleFormScreen.tsx).
// Confirmer/Annuler ne sont possibles que sur une vente DRAFT (contrôlé côté
// serveur — les boutons ne sont qu'une commodité d'affichage).
export function SaleDetailScreen({ route }: Props) {
  const { saleId } = route.params;
  const saleQuery = useSale(saleId);
  const confirmSale = useConfirmSale();
  const cancelSale = useCancelSale();
  const isOnline = useIsOnline();
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"confirm" | "cancel" | null>(null);

  // Premier écran mobile qui écrit sans quitter la page (les modules
  // précédents font navigation.goBack() après enqueue) : hors-ligne,
  // confirmSale/cancelSale résolvent après le seul enqueueMutation, sans
  // rafraîchir sale.status — sans ce message, l'utilisateur ne voit aucun
  // retour et peut rappuyer plusieurs fois (revue sécurité Phase 9.8).
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

  const handleConfirm = () => runAction("confirm", () => confirmSale(saleId));
  const handleCancel = () => runAction("cancel", () => cancelSale(saleId));

  if (saleQuery.isLoading) {
    return <ActivityIndicator style={styles.loader} />;
  }

  if (saleQuery.isError || !saleQuery.data) {
    return <Text style={styles.errorText}>Impossible de charger cette vente.</Text>;
  }

  const sale = saleQuery.data;

  return (
    <View style={styles.container}>
      {!isOnline ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Hors-ligne — les données affichées peuvent être obsolètes.</Text>
        </View>
      ) : null}

      <View style={styles.header}>
        <Text style={styles.customerName}>{sale.customerName}</Text>
        <Text style={styles.statusText}>{STATUS_LABELS[sale.status]}</Text>
        <Text style={styles.dateText}>{new Date(sale.saleDate).toLocaleDateString("fr-SN")}</Text>
        {sale.notes ? <Text style={styles.notesText}>{sale.notes}</Text> : null}
      </View>

      {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}
      {actionInfo ? <Text style={styles.infoText}>{actionInfo}</Text> : null}

      <FlatList
        data={sale.lines}
        keyExtractor={(line) => line.id}
        renderItem={({ item }) => <LineRow line={item} />}
        ListHeaderComponent={<Text style={styles.sectionLabel}>Lignes</Text>}
      />

      <View style={styles.totals}>
        <Text style={styles.totalRow}>Total HT : {formatFCFA(sale.totalExcludingTax)}</Text>
        <Text style={styles.totalRow}>TVA : {formatFCFA(sale.totalVat)}</Text>
        <Text style={styles.totalRowStrong}>Total TTC : {formatFCFA(sale.totalIncludingTax)}</Text>
      </View>

      {sale.status === "DRAFT" ? (
        <View style={styles.actions}>
          <Pressable
            style={[styles.button, styles.confirmButton]}
            onPress={handleConfirm}
            // saleQuery.isFetching couvre la fenêtre de refetch après
            // invalidateQueries(["sale", saleId]) : sans elle, un second
            // appui pendant que le cache affiche encore "DRAFT" reproduirait
            // l'action déjà réussie et afficherait un rejet trompeur (revue
            // sécurité Phase 9.8).
            disabled={pendingAction !== null || saleQuery.isFetching}
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
            disabled={pendingAction !== null || saleQuery.isFetching}
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

function LineRow({ line }: { line: SaleLine }) {
  return (
    <View style={styles.lineRow}>
      <View style={styles.lineMain}>
        <Text style={styles.lineTitle}>
          {line.productCode} — {line.productName}
        </Text>
        <Text style={styles.lineSubtitle}>
          {line.quantity} × {formatFCFA(line.unitPriceExcludingTax)}
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
  customerName: {
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
