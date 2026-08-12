import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Controller, useFieldArray, useForm, type Control } from "react-hook-form";
import { createPurchaseSchema, type CreatePurchaseInput } from "@erp/validation";
import type { Product, Supplier } from "@erp/types";
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
import { useProducts } from "../lib/queries/use-products";
import { useCreatePurchase } from "../lib/queries/use-purchases";
import { useSuppliers } from "../lib/queries/use-suppliers";
import type { AppStackParamList } from "../navigation/types";
import type { z } from "zod";

type Props = NativeStackScreenProps<AppStackParamList, "PurchaseForm">;

// z.input (pas z.infer/output) : même patron que les modules précédents.
type PurchaseFormValues = z.input<typeof createPurchaseSchema>;

const EMPTY_VALUES: PurchaseFormValues = {
  supplierId: "",
  notes: undefined,
  lines: [{ productId: "", quantity: 1, unitCostExcludingTax: 0 }],
};

// Miroir de SaleFormScreen.tsx (module 5) : création uniquement, aucune
// route ne permet de modifier les lignes d'un achat existant. Différence
// avec Sale : unitCostExcludingTax est saisi ici (coût négocié auprès du
// fournisseur), pas résolu depuis un prix catalogue — voir
// createPurchaseSchema, packages/validation. La TVA reste résolue côté
// serveur depuis Product, comme pour une vente.
export function PurchaseFormScreen({ navigation }: Props) {
  const createPurchase = useCreatePurchase();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<PurchaseFormValues>({
    resolver: zodResolver(createPurchaseSchema),
    defaultValues: EMPTY_VALUES,
  });

  const { fields, append, remove } = useFieldArray({ control, name: "lines" });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await createPurchase(values as CreatePurchaseInput);
      navigation.goBack();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Une erreur est survenue");
    }
  });

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Nouvel achat</Text>

      <SupplierPickerField control={control} />

      <Text style={styles.sectionLabel}>Lignes</Text>
      {fields.map((field, index) => (
        <View key={field.id} style={styles.lineRow}>
          <View style={styles.lineFields}>
            <ProductPickerField control={control} name={`lines.${index}.productId`} />
            <View style={styles.lineFieldsInline}>
              <QuantityField control={control} name={`lines.${index}.quantity`} />
              <UnitCostField control={control} name={`lines.${index}.unitCostExcludingTax`} />
            </View>
          </View>
          {fields.length > 1 ? (
            <Pressable onPress={() => remove(index)} hitSlop={8}>
              <Text style={styles.removeAction}>Retirer</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
      <Pressable
        style={styles.addLineButton}
        onPress={() => append({ productId: "", quantity: 1, unitCostExcludingTax: 0 })}
      >
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
          <Text style={styles.buttonText}>Créer l&apos;achat (brouillon)</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

// Même patron Pressable+Modal+FlatList maison que CustomerPickerField de
// SaleFormScreen.tsx, adapté aux fournisseurs. Limité aux 100 premiers
// fournisseurs actifs, pas de recherche async côté serveur.
function SupplierPickerField({ control }: { control: Control<PurchaseFormValues> }) {
  const [modalVisible, setModalVisible] = useState(false);
  const [filter, setFilter] = useState("");
  const suppliersQuery = useSuppliers({ page: 1, pageSize: 100, isActive: true });
  const suppliers = suppliersQuery.data?.items ?? [];
  const normalizedFilter = filter.trim().toLowerCase();
  const filteredSuppliers = normalizedFilter
    ? suppliers.filter((supplier) => supplier.name.toLowerCase().includes(normalizedFilter))
    : suppliers;

  return (
    <Controller
      control={control}
      name="supplierId"
      render={({ field, fieldState }) => {
        const selected = suppliers.find((supplier) => supplier.id === field.value);
        return (
          <View style={styles.field}>
            <Text style={styles.label}>Fournisseur</Text>
            <Pressable style={styles.input} onPress={() => setModalVisible(true)}>
              <Text style={selected ? styles.pickerValueText : styles.pickerPlaceholderText}>
                {selected ? selected.name : "Sélectionner un fournisseur…"}
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
                  data={filteredSuppliers}
                  keyExtractor={(item) => item.id}
                  ListEmptyComponent={<Text style={styles.emptyText}>Aucun fournisseur trouvé.</Text>}
                  renderItem={({ item }: { item: Supplier }) => (
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

function ProductPickerField({
  control,
  name,
}: {
  control: Control<PurchaseFormValues>;
  name: `lines.${number}.productId`;
}) {
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

// Quantité toujours ≥ 1, entière — identique à QuantityField de
// SaleFormScreen.tsx.
function QuantityField({ control, name }: { control: Control<PurchaseFormValues>; name: `lines.${number}.quantity` }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <View style={styles.fieldNarrow}>
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

// Coût unitaire HT en FCFA (entier, ≥ 0) — saisi par l'utilisateur,
// contrairement au prix de vente qui est résolu côté serveur pour Sale.
function UnitCostField({
  control,
  name,
}: {
  control: Control<PurchaseFormValues>;
  name: `lines.${number}.unitCostExcludingTax`;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <View style={styles.fieldNarrow}>
          <Text style={styles.label}>Coût unitaire HT</Text>
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
  fieldNarrow: {
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
  lineFieldsInline: {
    flexDirection: "row",
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
