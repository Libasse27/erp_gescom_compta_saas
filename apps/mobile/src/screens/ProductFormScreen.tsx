import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Controller, useForm, type Control } from "react-hook-form";
import { createProductSchema, type CreateProductInput } from "@erp/validation";
import type { Product } from "@erp/types";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from "react-native";
import { useProduct, useSaveProduct } from "../lib/queries/use-products";
import type { AppStackParamList } from "../navigation/types";
import type { z } from "zod";

type Props = NativeStackScreenProps<AppStackParamList, "ProductForm">;

// z.input (pas z.infer/output) : createProductSchema a des .default() sur
// unit/vatRateBasisPoints/trackStock, ce qui les rend optionnels côté saisie
// mais requis côté résultat validé — même contrainte de typage que
// SupplierFormScreen (Phase 9.5). onSubmit reçoit les valeurs déjà résolues
// par le resolver (défauts appliqués), d'où le cast vers CreateProductInput.
type ProductFormValues = z.input<typeof createProductSchema>;

const EMPTY_VALUES: ProductFormValues = {
  code: "",
  name: "",
  description: undefined,
  unit: "pièce",
  category: undefined,
  barcode: undefined,
  sellingPriceExcludingTax: 0,
  vatRateBasisPoints: 1800,
  trackStock: true,
};

function toFormValues(product: Product): ProductFormValues {
  return {
    code: product.code,
    name: product.name,
    description: product.description ?? undefined,
    unit: product.unit,
    category: product.category ?? undefined,
    barcode: product.barcode ?? undefined,
    sellingPriceExcludingTax: product.sellingPriceExcludingTax,
    vatRateBasisPoints: product.vatRateBasisPoints,
    trackStock: product.trackStock,
  };
}

// Un seul écran pour créer ET éditer (route { productId? }) — même patron
// que ClientFormScreen/SupplierFormScreen.
export function ProductFormScreen({ route, navigation }: Props) {
  const productId = route.params?.productId;
  const productQuery = useProduct(productId);
  const saveProduct = useSaveProduct();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(createProductSchema),
    // "values" (pas "defaultValues") : le formulaire se resynchronise une
    // fois la fiche chargée en mode édition, même patron que le web.
    values: productQuery.data ? toFormValues(productQuery.data) : EMPTY_VALUES,
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await saveProduct({ productId, values: values as CreateProductInput });
      navigation.goBack();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Une erreur est survenue");
    }
  });

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{productId ? "Modifier le produit" : "Nouveau produit"}</Text>

      <FormTextField control={control} name="code" label="Code" autoCapitalize="characters" />
      <FormTextField control={control} name="name" label="Nom" />
      <FormNumberField control={control} name="sellingPriceExcludingTax" label="Prix de vente HT (FCFA)" />
      <FormNumberField control={control} name="vatRateBasisPoints" label="TVA (points de base, 1800 = 18 %)" />
      <FormTextField control={control} name="unit" label="Unité" />
      <FormTextField control={control} name="category" label="Catégorie" />
      <FormTextField control={control} name="barcode" label="Code-barres" keyboardType="numeric" />

      <Controller
        control={control}
        name="trackStock"
        render={({ field }) => (
          <View style={[styles.field, styles.switchRow]}>
            <Text style={styles.label}>Suivre le stock</Text>
            <Switch value={field.value ?? true} onValueChange={field.onChange} />
          </View>
        )}
      />

      <FormTextField control={control} name="description" label="Description" multiline />

      {formError ? <Text style={styles.formError}>{formError}</Text> : null}

      <Pressable style={styles.button} onPress={onSubmit} disabled={isSubmitting}>
        {isSubmitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>{productId ? "Enregistrer" : "Créer le produit"}</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

// -? efface l'optionnalité des propriétés (unit/description/... ont un ?) —
// sans ça, le type mappé reste partiel et l'union résultante inclut
// `undefined` en plus des clés, ce que TextInput#name refuse.
type StringFieldName = {
  [K in keyof ProductFormValues]-?: ProductFormValues[K] extends string | undefined ? K : never;
}[keyof ProductFormValues];

function FormTextField({
  control,
  name,
  label,
  keyboardType,
  autoCapitalize,
  multiline,
}: {
  control: Control<ProductFormValues>;
  name: StringFieldName;
  label: string;
  keyboardType?: TextInputProps["keyboardType"];
  autoCapitalize?: TextInputProps["autoCapitalize"];
  multiline?: boolean;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <View style={styles.field}>
          <Text style={styles.label}>{label}</Text>
          <TextInput
            style={[styles.input, multiline ? styles.inputMultiline : null]}
            value={(field.value as string | undefined) ?? ""}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            keyboardType={keyboardType}
            autoCapitalize={autoCapitalize}
            multiline={multiline}
          />
          {fieldState.error ? <Text style={styles.fieldError}>{fieldState.error.message}</Text> : null}
        </View>
      )}
    />
  );
}

type NumberFieldName = {
  [K in keyof ProductFormValues]-?: ProductFormValues[K] extends number | undefined ? K : never;
}[keyof ProductFormValues];

// Toujours un entier XOF/points de base côté schéma (z.number().int(),
// CLAUDE.md §7) — la saisie reste une string tant que l'utilisateur tape,
// convertie en number à chaque changement (pas de z.coerce côté validation,
// même contrainte que apps/web/src/components/product-form.tsx avec
// valueAsNumber).
function FormNumberField({
  control,
  name,
  label,
}: {
  control: Control<ProductFormValues>;
  name: NumberFieldName;
  label: string;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <View style={styles.field}>
          <Text style={styles.label}>{label}</Text>
          <TextInput
            style={styles.input}
            value={field.value === undefined ? "" : String(field.value)}
            onChangeText={(text) => field.onChange(text === "" ? undefined : Number(text))}
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
  },
  inputMultiline: {
    minHeight: 80,
    textAlignVertical: "top",
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
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
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
});
