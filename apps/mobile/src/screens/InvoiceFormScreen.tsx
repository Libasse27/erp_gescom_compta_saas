import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Controller, useForm, type Control } from "react-hook-form";
import { createSalesInvoiceSchema, type CreateSalesInvoiceInput } from "@erp/validation";
import { formatFCFA } from "@erp/utils";
import { ActivityIndicator, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSales, type SaleListItem } from "../lib/queries/use-sales";
import { useCreateInvoice } from "../lib/queries/use-invoices";
import type { AppStackParamList } from "../navigation/types";
import type { z } from "zod";

type Props = NativeStackScreenProps<AppStackParamList, "InvoiceForm">;

// z.input (pas z.infer/output) : même patron que les modules précédents.
type InvoiceFormValues = z.input<typeof createSalesInvoiceSchema>;

const EMPTY_VALUES: InvoiceFormValues = { saleId: "" };

// Contrairement à SaleFormScreen/PurchaseFormScreen : pas de lignes à
// saisir, une facture transforme une vente CONFIRMED déjà existante (voir
// createSalesInvoiceSchema, packages/validation) — ne liste que les ventes
// confirmées ; une vente déjà facturée renvoie un 409 affiché comme erreur
// de formulaire (pas de filtre "non facturée" côté API dans ce cycle, même
// limitation documentée que apps/web/src/components/invoice-form.tsx).
export function InvoiceFormScreen({ navigation }: Props) {
  const createInvoice = useCreateInvoice();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<InvoiceFormValues>({
    resolver: zodResolver(createSalesInvoiceSchema),
    defaultValues: EMPTY_VALUES,
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await createInvoice(values as CreateSalesInvoiceInput);
      navigation.goBack();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Une erreur est survenue");
    }
  });

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Nouvelle facture</Text>

      <SalePickerField control={control} />

      {formError ? <Text style={styles.formError}>{formError}</Text> : null}

      <Pressable style={styles.button} onPress={onSubmit} disabled={isSubmitting}>
        {isSubmitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Émettre la facture</Text>}
      </Pressable>
    </ScrollView>
  );
}

// Même patron Pressable+Modal+FlatList maison que CustomerPickerField de
// SaleFormScreen.tsx, limité aux 100 premières ventes confirmées, pas de
// recherche async côté serveur.
function SalePickerField({ control }: { control: Control<InvoiceFormValues> }) {
  const [modalVisible, setModalVisible] = useState(false);
  const [filter, setFilter] = useState("");
  const confirmedSalesQuery = useSales({ page: 1, pageSize: 100, status: "CONFIRMED" });
  const confirmedSales = confirmedSalesQuery.data?.items ?? [];
  const normalizedFilter = filter.trim().toLowerCase();
  const filteredSales = normalizedFilter
    ? confirmedSales.filter((sale) => sale.customerName.toLowerCase().includes(normalizedFilter))
    : confirmedSales;

  return (
    <Controller
      control={control}
      name="saleId"
      render={({ field, fieldState }) => {
        const selected = confirmedSales.find((sale) => sale.id === field.value);
        return (
          <View style={styles.field}>
            <Text style={styles.label}>Vente confirmée à facturer</Text>
            <Pressable style={styles.input} onPress={() => setModalVisible(true)}>
              <Text style={selected ? styles.pickerValueText : styles.pickerPlaceholderText}>
                {selected
                  ? `${selected.customerName} — ${formatFCFA(selected.totalIncludingTax)}`
                  : "Sélectionner une vente…"}
              </Text>
            </Pressable>
            {fieldState.error ? <Text style={styles.fieldError}>{fieldState.error.message}</Text> : null}
            {confirmedSales.length === 0 && !confirmedSalesQuery.isLoading ? (
              <Text style={styles.hintText}>Aucune vente confirmée en attente de facturation.</Text>
            ) : null}

            <Modal visible={modalVisible} animationType="slide" onRequestClose={() => setModalVisible(false)}>
              <View style={styles.modalContainer}>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Filtrer par client…"
                  value={filter}
                  onChangeText={setFilter}
                  autoFocus
                />
                <FlatList
                  data={filteredSales}
                  keyExtractor={(item) => item.id}
                  ListEmptyComponent={<Text style={styles.emptyText}>Aucune vente confirmée trouvée.</Text>}
                  renderItem={({ item }: { item: SaleListItem }) => (
                    <Pressable
                      style={styles.modalRow}
                      onPress={() => {
                        field.onChange(item.id);
                        setModalVisible(false);
                        setFilter("");
                      }}
                    >
                      <Text style={styles.modalRowText}>
                        {item.customerName} — {new Date(item.saleDate).toLocaleDateString("fr-SN")} —{" "}
                        {formatFCFA(item.totalIncludingTax)}
                      </Text>
                    </Pressable>
                  )}
                />
                <Pressable style={styles.button} onPress={() => setModalVisible(false)}>
                  <Text style={styles.buttonText}>Fermer</Text>
                </Pressable>
              </View>
            </Modal>
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
    gap: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 4,
  },
  field: {
    gap: 4,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    justifyContent: "center",
  },
  pickerValueText: {
    fontSize: 16,
    color: "#000",
  },
  pickerPlaceholderText: {
    fontSize: 16,
    color: "#999",
  },
  fieldError: {
    color: "#b00020",
    fontSize: 13,
  },
  hintText: {
    color: "#555",
    fontSize: 13,
  },
  formError: {
    color: "#b00020",
    fontSize: 14,
    textAlign: "center",
  },
  button: {
    backgroundColor: "#1a5fb4",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 8,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  modalContainer: {
    flex: 1,
    padding: 16,
    paddingTop: 48,
    gap: 12,
  },
  searchInput: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  modalRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  modalRowText: {
    fontSize: 16,
  },
  emptyText: {
    color: "#555",
    fontSize: 14,
    textAlign: "center",
    marginVertical: 12,
  },
});
