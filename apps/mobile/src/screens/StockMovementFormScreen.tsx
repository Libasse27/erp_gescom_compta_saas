import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Controller, useForm, useWatch, type Control } from "react-hook-form";
import { createStockMovementSchema, type CreateStockMovementInput, type StockMovementTypeInput } from "@erp/validation";
import type { StockLevel } from "@erp/types";
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
import { useCreateStockMovement, useStockLevels } from "../lib/queries/use-stock";
import type { AppStackParamList } from "../navigation/types";
import type { z } from "zod";

type Props = NativeStackScreenProps<AppStackParamList, "StockMovementForm">;

// z.input (pas z.infer/output) : createStockMovementSchema n'a pas de
// .default(), mais le patron reste utilisé par cohérence avec les 3 modules
// précédents — .refine() ne change pas la forme d'entrée, seulement la
// validation.
type MovementFormValues = z.input<typeof createStockMovementSchema>;

const MOVEMENT_TYPES: StockMovementTypeInput[] = ["IN", "OUT", "ADJUSTMENT"];

const MOVEMENT_TYPE_LABELS: Record<StockMovementTypeInput, string> = {
  IN: "Entrée (réception)",
  OUT: "Sortie",
  ADJUSTMENT: "Correction d'inventaire (+/-)",
};

// Contrairement à ClientFormScreen/SupplierFormScreen/ProductFormScreen, cet
// écran ne connaît qu'un mode : il n'existe aucune route de correction d'un
// mouvement existant (StockMovement est un grand livre append-only, voir
// stock.controller.ts côté API — pas de PATCH/DELETE). `productId` en
// paramètre de route ne fait que pré-remplir le sélecteur produit.
export function StockMovementFormScreen({ route, navigation }: Props) {
  const preselectedProductId = route.params?.productId;
  const createMovement = useCreateStockMovement();
  const [formError, setFormError] = useState<string | null>(null);
  // Signe porté par un état dédié (pas dérivé de field.value : field.value
  // peut valoir -0 avec une magnitude nulle, et -0 < 0 vaut false en JS, ce
  // qui ignorerait silencieusement l'appui sur "−" — revue sécurité
  // Phase 9.7). Possédé ici (pas dans QuantityField) pour pouvoir le
  // réinitialiser depuis le sélecteur de type ci-dessous, sans passer par un
  // effet (setState synchrone dans un effet = cascade de rendus inutile).
  const [sign, setSign] = useState<1 | -1>(1);

  const {
    control,
    handleSubmit,
    setValue,
    getValues,
    formState: { isSubmitting },
  } = useForm<MovementFormValues>({
    resolver: zodResolver(createStockMovementSchema),
    defaultValues: {
      productId: preselectedProductId ?? "",
      type: "IN",
      quantity: 0,
      note: undefined,
    },
  });

  const type = useWatch({ control, name: "type" });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await createMovement(values as CreateStockMovementInput);
      navigation.goBack();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Une erreur est survenue");
    }
  });

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Nouveau mouvement</Text>

      <ProductPickerField control={control} />

      <Controller
        control={control}
        name="type"
        render={({ field }) => (
          <View style={styles.field}>
            <Text style={styles.label}>Type de mouvement</Text>
            <View style={styles.typeToggle}>
              {MOVEMENT_TYPES.map((movementType) => (
                <Pressable
                  key={movementType}
                  style={[styles.typeChip, field.value === movementType && styles.typeChipActive]}
                  onPress={() => {
                    field.onChange(movementType);
                    // Redevenir IN/OUT après une correction négative : la
                    // magnitude reste, le signe négatif propre à ADJUSTMENT
                    // n'a pas de sens pour IN/OUT (schema.refine l'exige
                    // strictement positif).
                    if (movementType !== "ADJUSTMENT") {
                      setSign(1);
                      setValue("quantity", Math.abs(getValues("quantity")), { shouldValidate: false });
                    }
                  }}
                >
                  <Text style={[styles.typeChipText, field.value === movementType && styles.typeChipTextActive]}>
                    {MOVEMENT_TYPE_LABELS[movementType]}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
      />

      <QuantityField control={control} type={type} sign={sign} onSignChange={setSign} />

      <Controller
        control={control}
        name="note"
        render={({ field, fieldState }) => (
          <View style={styles.field}>
            <Text style={styles.label}>Note (optionnel)</Text>
            <TextInput
              style={styles.input}
              value={field.value ?? ""}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
            />
            {fieldState.error ? <Text style={styles.fieldError}>{fieldState.error.message}</Text> : null}
          </View>
        )}
      />

      {formError ? <Text style={styles.formError}>{formError}</Text> : null}

      <Pressable style={styles.button} onPress={onSubmit} disabled={isSubmitting}>
        {isSubmitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Enregistrer le mouvement</Text>}
      </Pressable>
    </ScrollView>
  );
}

// Pas de <select> natif ni de nouvelle dépendance (CLAUDE.md §3) : Pressable
// + Modal + FlatList maison. Source de données : les 100 premiers produits
// qui suivent le stock (même limitation documentée que
// apps/web/src/components/stock-movement-form.tsx — pas de recherche async
// côté serveur dans ce cycle), filtrés localement dans la modale.
function ProductPickerField({ control }: { control: Control<MovementFormValues> }) {
  const [modalVisible, setModalVisible] = useState(false);
  const [filter, setFilter] = useState("");
  const productsQuery = useStockLevels({ page: 1, pageSize: 100 });
  const products = productsQuery.data?.items ?? [];
  const normalizedFilter = filter.trim().toLowerCase();
  const filteredProducts = normalizedFilter
    ? products.filter((product) => `${product.code} ${product.name}`.toLowerCase().includes(normalizedFilter))
    : products;

  return (
    <Controller
      control={control}
      name="productId"
      render={({ field, fieldState }) => {
        const selected = products.find((product) => product.productId === field.value);
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
                  keyExtractor={(item) => item.productId}
                  ListEmptyComponent={<Text style={styles.emptyText}>Aucun produit trouvé.</Text>}
                  renderItem={({ item }: { item: StockLevel }) => (
                    <Pressable
                      style={styles.modalRow}
                      onPress={() => {
                        field.onChange(item.productId);
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

// Le clavier numérique mobile n'a pas de signe moins fiable sur toutes les
// plateformes (contrairement à <input type="number"> sur le web) : pour
// ADJUSTMENT, une paire de puces +/- bascule le signe, la magnitude reste
// saisie normalement. Pour IN/OUT, toujours positif (schema.refine),
// aucune puce affichée.
function QuantityField({
  control,
  type,
  sign,
  onSignChange,
}: {
  control: Control<MovementFormValues>;
  type: StockMovementTypeInput;
  sign: 1 | -1;
  onSignChange: (sign: 1 | -1) => void;
}) {
  return (
    <Controller
      control={control}
      name="quantity"
      render={({ field, fieldState }) => {
        const isAdjustment = type === "ADJUSTMENT";
        const magnitude = Math.abs(field.value ?? 0);

        return (
          <View style={styles.field}>
            <Text style={styles.label}>Quantité</Text>
            {isAdjustment ? (
              <View style={styles.signToggle}>
                <Pressable
                  style={[styles.signChip, sign === 1 && styles.signChipActive]}
                  onPress={() => {
                    onSignChange(1);
                    field.onChange(magnitude);
                  }}
                >
                  <Text style={[styles.signChipText, sign === 1 && styles.signChipTextActive]}>+</Text>
                </Pressable>
                <Pressable
                  style={[styles.signChip, sign === -1 && styles.signChipActive]}
                  onPress={() => {
                    onSignChange(-1);
                    field.onChange(-magnitude);
                  }}
                >
                  <Text style={[styles.signChipText, sign === -1 && styles.signChipTextActive]}>−</Text>
                </Pressable>
              </View>
            ) : null}
            <TextInput
              style={styles.input}
              value={magnitude === 0 ? "" : String(magnitude)}
              onChangeText={(text) => {
                const parsed = Math.abs(Number(text));
                // Une saisie non numérique (ex: "1.2.3") ne doit jamais
                // écrire NaN dans le formulaire — revue sécurité Phase 9.7 :
                // ignorée plutôt qu'affichée telle quelle.
                if (text !== "" && !Number.isFinite(parsed)) return;
                const parsedMagnitude = text === "" ? 0 : parsed;
                field.onChange(isAdjustment ? sign * parsedMagnitude : parsedMagnitude);
              }}
              onBlur={field.onBlur}
              keyboardType="numeric"
            />
            {fieldState.error ? <Text style={styles.fieldError}>{fieldState.error.message}</Text> : null}
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
  formError: {
    color: "#b00020",
    fontSize: 14,
    textAlign: "center",
  },
  typeToggle: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  typeChip: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  typeChipActive: {
    backgroundColor: "#1a5fb4",
    borderColor: "#1a5fb4",
  },
  typeChipText: {
    fontSize: 14,
    color: "#333",
  },
  typeChipTextActive: {
    color: "#fff",
  },
  signToggle: {
    flexDirection: "row",
    gap: 8,
  },
  signChip: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  signChipActive: {
    backgroundColor: "#1a5fb4",
    borderColor: "#1a5fb4",
  },
  signChipText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#333",
  },
  signChipTextActive: {
    color: "#fff",
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
