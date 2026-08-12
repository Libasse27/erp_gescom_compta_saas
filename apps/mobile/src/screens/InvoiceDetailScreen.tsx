import { useState } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { SalesInvoiceLine, SalesInvoiceStatus } from "@erp/types";
import { formatFCFA } from "@erp/utils";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useIsOnline } from "../lib/offline";
import { useInvoice, useMarkInvoicePaid, useVoidInvoice } from "../lib/queries/use-invoices";
import type { AppStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<AppStackParamList, "InvoiceDetail">;

const STATUS_LABELS: Record<SalesInvoiceStatus, string> = {
  ISSUED: "Émise",
  PAID: "Payée",
  VOID: "Annulée",
};

// Miroir de SaleDetailScreen.tsx/PurchaseDetailScreen.tsx (modules 5 et 6) :
// lecture seule + actions de cycle de vie. Marquer payée/Annuler ne sont
// possibles que sur une facture ISSUED (contrôlé côté serveur — les boutons
// ne sont qu'une commodité d'affichage). Affiche en plus legalMentions
// (texte libre généré côté serveur, jamais ressaisi).
export function InvoiceDetailScreen({ route }: Props) {
  const { invoiceId } = route.params;
  const invoiceQuery = useInvoice(invoiceId);
  const markInvoicePaid = useMarkInvoicePaid();
  const voidInvoice = useVoidInvoice();
  const isOnline = useIsOnline();
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"mark-paid" | "void" | null>(null);

  const runAction = async (action: "mark-paid" | "void", run: () => Promise<void>) => {
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

  const handleMarkPaid = () => runAction("mark-paid", () => markInvoicePaid(invoiceId));
  const handleVoid = () => runAction("void", () => voidInvoice(invoiceId));

  if (invoiceQuery.isLoading) {
    return <ActivityIndicator style={styles.loader} />;
  }

  if (invoiceQuery.isError || !invoiceQuery.data) {
    return <Text style={styles.errorText}>Impossible de charger cette facture.</Text>;
  }

  const invoice = invoiceQuery.data;

  return (
    <View style={styles.container}>
      {!isOnline ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Hors-ligne — les données affichées peuvent être obsolètes.</Text>
        </View>
      ) : null}

      <View style={styles.header}>
        <Text style={styles.invoiceNumber}>{invoice.number}</Text>
        <Text style={styles.customerName}>{invoice.customerName}</Text>
        <Text style={styles.statusText}>{STATUS_LABELS[invoice.status]}</Text>
        <Text style={styles.dateText}>{new Date(invoice.issuedAt).toLocaleDateString("fr-SN")}</Text>
      </View>

      {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}
      {actionInfo ? <Text style={styles.infoText}>{actionInfo}</Text> : null}

      <FlatList
        data={invoice.lines}
        keyExtractor={(line) => line.id}
        renderItem={({ item }) => <LineRow line={item} />}
        ListHeaderComponent={<Text style={styles.sectionLabel}>Lignes</Text>}
      />

      <View style={styles.totals}>
        <Text style={styles.totalRow}>Total HT : {formatFCFA(invoice.totalExcludingTax)}</Text>
        <Text style={styles.totalRow}>TVA : {formatFCFA(invoice.totalVat)}</Text>
        <Text style={styles.totalRowStrong}>Total TTC : {formatFCFA(invoice.totalIncludingTax)}</Text>
      </View>

      <View style={styles.legalMentions}>
        <Text style={styles.sectionLabel}>Mentions légales</Text>
        <Text style={styles.legalMentionsText}>{invoice.legalMentions}</Text>
      </View>

      {invoice.status === "ISSUED" ? (
        <View style={styles.actions}>
          <Pressable
            style={[styles.button, styles.markPaidButton]}
            onPress={handleMarkPaid}
            disabled={pendingAction !== null || invoiceQuery.isFetching}
          >
            {pendingAction === "mark-paid" ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Marquer payée</Text>
            )}
          </Pressable>
          <Pressable
            style={[styles.button, styles.voidButton]}
            onPress={handleVoid}
            disabled={pendingAction !== null || invoiceQuery.isFetching}
          >
            {pendingAction === "void" ? (
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

function LineRow({ line }: { line: SalesInvoiceLine }) {
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
  invoiceNumber: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1a5fb4",
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
  legalMentions: {
    borderTopWidth: 1,
    borderTopColor: "#ccc",
    paddingTop: 10,
    gap: 4,
  },
  legalMentionsText: {
    fontSize: 12,
    color: "#555",
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
  markPaidButton: {
    backgroundColor: "#1a7a3a",
  },
  voidButton: {
    backgroundColor: "#b00020",
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
