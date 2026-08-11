import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Controller, useFieldArray, useForm, type Control } from "react-hook-form";
import { createSaleSchema, type CreateSaleInput } from "@erp/validation";
import type { Customer, Product } from "@erp/types";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useCustomers } from "../lib/queries/use-customers";
import { useProducts } from "../lib/queries/use-products";
import { useCreateSale } from "../lib/queries/use-sales";
import type { AppStackParamList } from "../navigation/types";
import type { z } from "zod";

type Props = NativeStackScreenProps<AppStackParamList, "SaleForm">;

// z.input (pas z.infer/output) : même patron que les 4 modules précédents.
type SaleFormValues = z.input<typeof createSaleSchema>;

const EMPTY_VALUES: SaleFormValues = {
  customerId: "",
  notes: undefined,
  lines: [{ productId: "", quantity: 1 }],
};

// Contrairement à ClientFormScreen/SupplierFormScreen/ProductFormScreen, cet
// écran ne connaît qu'un mode : création uniquement. Aucune route ne permet
// de modifier les lignes d'une vente existante (SaleLine est figée à la
// création — voir sales.controller.ts côté API, pas de PATCH). Le prix et la
// TVA ne sont jamais saisis ici : le serveur les résout depuis Product au
// moment de la création (createSaleSchema n'accepte que
// productId/quantity par ligne).
export function SaleFormScreen({ navigation }: Props) {
  const createSale = useCreateSale();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<SaleFormValues>({
    resolver: zodResolver(createSaleSchema),
    defaultValues: EMPTY_VALUES,
  });

  const { fields, append, remove } = useFieldArray({ control, name: "lines" });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await createSale(values as CreateSaleInput);
      navigation.goBack();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Une erreur est survenue");
    }
  });

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Nouvelle vente</Text>

      <CustomerPickerField control={control} />

      <Text style={styles.sectionLabel}>Lignes</Text>
      {fields.map((field, index) => (
        <View key={field.id} style={styles.lineRow}>
          <View style={styles.lineFields}>
            <ProductPickerField control={control} name={`lines.${index}.productId`} />
            <QuantityField control={control} name={`lines.${index}.quantity`} />
          </View>
          {fields.length > 1 ? (
            <Pressable onPress={() => remove(index)} hitSlop={8}>
              <Text style={styles.removeAction}>Retirer</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
      <Pressable style={styles.addLineButton} onPress={() => append({ productId: "", quantity: 1 })}>
        <Text style={styles.addLineButtonText}>+ Ajouter une ligne</Text>
      </Pressable>

      <Controller
        control={control}
        name="notes"
        render={({ field, fieldState }) => (
          <View style={styles.field}>
            <Text style={styles.label}>Notes (optionnel)</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={field.value ?? ""}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              multiline
            />
            {fieldState.error ? <Text style={styles.fieldError}>{fieldState.error.message}</Text> : null}
          </View>
        )}
      />

      {formError ? <Text style={styles.formError}>{formError}</Text> : null}

      <Pressable style={styles.button} onPress={onSubmit} disabled={isSubmitting}>
        {isSubmitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Créer la vente (brouillon)</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

// Pas de <select> natif ni de nouvelle dépendance (CLAUDE.md §3) : même
// patron Pressable+Modal+FlatList maison que ProductPickerField de
// StockMovementFormScreen.tsx (Phase 9.7), adapté aux clients. Limité aux 100
// premiers clients actifs, pas de recherche async côté serveur — même
// limitation documentée que le web (apps/web/src/components/sale-form.tsx).
function CustomerPickerField({ control }: { control: Control<SaleFormValues> }) {
  const [modalVisible, setModalVisible] = useState(false);
  const [filter, setFilter] = useState("");
  const customersQuery = useCustomers({ page: 1, pageSize: 100, isActive: true });
  const customers = customersQuery.data?.items ?? [];
  const normalizedFilter = filter.trim().toLowerCase();
  const filteredCustomers = normalizedFilter
    ? customers.filter((customer) => customer.name.toLowerCase().includes(normalizedFilter))
    : customers;

  return (
    <Controller
      control={control}
      name="customerId"
      render={({ field, fieldState }) => {
        const selected = customers.find((customer) => customer.id === field.value);
        return (
          <View style={styles.field}>
            <Text style={styles.label}>Client</Text>
            <Pressable style={styles.input} onPress={() => setModalVisible(true)}>
              <Text style={selected ? styles.pickerValueText : styles.pickerPlaceholderText}>
                {selected ? selected.name : "Sélectionner un client…"}
              </Text>
            </Pressable>
            {fieldState.error ? <Text style={styles.fieldError}>{fieldState.error.message}</Text> : null}

            <Modal visible={modalVisible} animationType="slide" onRequestClose={() => setModalVisible(false)}>
              <View style={styles.modalContainer}>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Filtrer par nom…"
                  value={filter}
                  onChangeText={setFilter}
                  autoFocus
                />
                <FlatList
                  data={filteredCustomers}
                  keyExtractor={(item) => item.id}
                  ListEmptyComponent={<Text style={styles.emptyText}>Aucun client trouvé.</Text>}
                  renderItem={({ item }: { item: Customer }) => (
                    <Pressable
                      style={styles.modalRow}
                      onPress={() => {
                        field.onChange(item.id);
                        setModalVisible(false);
                        setFilter("");
                      }}
                    >
                      <Text style={styles.modalRowText}>{item.name}</Text>
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

// Sourcé sur useProducts (pas useStockLevels comme Stock) : une ligne de
// vente référence Product, et les produits trackStock=false — vendables —
// n'apparaissent pas forcément dans GET /stock.
function ProductPickerField({ control, name }: { control: Control<SaleFormValues>; name: `lines.${number}.productId` }) {
  const [modalVisible, setModalVisible] = useState(false);
  const [filter, setFilter] = useState("");
  const productsQuery = useProducts({ page: 1, pageSize: 100, isActive: true });
  const products = productsQuery.data?.items ?? [];
  const normalizedFilter = filter.trim().toLowerCase();
  const filteredProducts = normalizedFilter
    ? products.filter((product) => `${product.code} ${product.name}`.toLowerCase().includes(normalizedFilter))
    : products;

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const selected = products.find((product) => product.id === field.value);
        return (
          <View style={styles.field}>
            <Text style={styles.label}>Produit</Text>
            <Pressable style={styles.input} onPress={() => setModalVisible(true)}>
              <Text style={selected ? styles.pickerValueText : styles.pickerPlaceholderText}>
                {selected ? `${selected.code} — ${selected.name}` : "Sélectionner un produit…"}
              </Text>
            </Pressable>
            {fieldState.error ? <Text style={styles.fieldError}>{fieldState.error.message}</Text> : null}

            <Modal visible={modalVisible} animationType="slide" onRequestClose={() => setModalVisible(false)}>
              <View style={styles.modalContainer}>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Filtrer par code ou nom…"
                  value={filter}
                  onChangeText={setFilter}
                  autoFocus
                />
                <FlatList
                  data={filteredProducts}
                  keyExtractor={(item) => item.id}
                  ListEmptyComponent={<Text style={styles.emptyText}>Aucun produit trouvé.</Text>}
                  renderItem={({ item }: { item: Product }) => (
                    <Pressable
                      style={styles.modalRow}
                      onPress={() => {
                        field.onChange(item.id);
                        setModalVisible(false);
                        setFilter("");
                      }}
                    >
                      <Text style={styles.modalRowText}>
                        {item.code} — {item.name}
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

// Quantité toujours ≥ 1, entière — pas de signe à gérer (contrairement à
// Stock ADJUSTMENT), plus simple.
function QuantityField({ control, name }: { control: Control<SaleFormValues>; name: `lines.${number}.quantity` }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <View style={styles.field}>
          <Text style={styles.label}>Quantité</Text>
          <TextInput
            style={styles.input}
            value={field.value === undefined || field.value === 0 ? "" : String(field.value)}
            onChangeText={(text) => {
              const parsed = Number(text);
              if (text !== "" && !Number.isFinite(parsed)) return;
              field.onChange(text === "" ? 0 : Math.abs(Math.trunc(parsed)));
            }}
            onBlur={field.onBlur}
            keyboardType="numeric"
          />
          {fieldState.error ? <Text style={styles.fieldError}>{fieldState.error.message}</Text> : null}
        </View>
      )}
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
  sectionLabel: {
    fontSize: 15,
    fontWeight: "700",
    marginTop: 4,
  },
  field: {
    gap: 4,
    flex: 1,
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
  inputMultiline: {
    minHeight: 80,
    textAlignVertical: "top",
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
  formError: {
    color: "#b00020",
    fontSize: 14,
    textAlign: "center",
  },
  lineRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 8,
    padding: 10,
  },
  lineFields: {
    flex: 1,
    gap: 8,
  },
  removeAction: {
    color: "#b00020",
    fontWeight: "600",
    paddingBottom: 10,
  },
  addLineButton: {
    borderWidth: 1,
    borderColor: "#1a5fb4",
    borderStyle: "dashed",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  addLineButtonText: {
    color: "#1a5fb4",
    fontWeight: "600",
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
