import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Controller, useForm, type Control } from "react-hook-form";
import { createSupplierSchema, type CreateSupplierInput } from "@erp/validation";
import { CUSTOMER_TYPES, type Supplier } from "@erp/types";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from "react-native";
import type { z } from "zod";
import { useSaveSupplier, useSupplier } from "../lib/queries/use-suppliers";
import type { AppStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<AppStackParamList, "SupplierForm">;

// z.input (pas z.infer/output) : createSupplierSchema a des .default() sur
// type/country, ce qui les rend optionnels côté saisie mais requis côté
// résultat validé — même contrainte de typage que
// apps/web/src/components/supplier-form.tsx (zodResolver exige la forme
// d'entrée). onSubmit ci-dessous reçoit en réalité les valeurs déjà résolues
// par le resolver (défauts appliqués), d'où le cast vers CreateSupplierInput.
type SupplierFormValues = z.input<typeof createSupplierSchema>;

const SUPPLIER_TYPE_LABELS: Record<(typeof CUSTOMER_TYPES)[number], string> = {
  COMPANY: "Entreprise",
  INDIVIDUAL: "Particulier",
};

const EMPTY_VALUES: SupplierFormValues = {
  type: "COMPANY",
  name: "",
  email: undefined,
  phone: undefined,
  address: undefined,
  city: undefined,
  country: "Sénégal",
  ninea: undefined,
  rccm: undefined,
  notes: undefined,
};

function toFormValues(supplier: Supplier): SupplierFormValues {
  return {
    type: supplier.type,
    name: supplier.name,
    email: supplier.email ?? undefined,
    phone: supplier.phone ?? undefined,
    address: supplier.address ?? undefined,
    city: supplier.city ?? undefined,
    country: supplier.country,
    ninea: supplier.ninea ?? undefined,
    rccm: supplier.rccm ?? undefined,
    notes: supplier.notes ?? undefined,
  };
}

// Un seul écran pour créer ET éditer (route { supplierId? }) — écran de pile
// dédié plutôt qu'un formulaire intégré à la liste comme sur le web : patron
// idiomatique React Navigation, déjà celui retenu pour Login/MfaVerify
// (Phase 9.2) et Clients (Phase 9.4).
export function SupplierFormScreen({ route, navigation }: Props) {
  const supplierId = route.params?.supplierId;
  const supplierQuery = useSupplier(supplierId);
  const saveSupplier = useSaveSupplier();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<SupplierFormValues>({
    resolver: zodResolver(createSupplierSchema),
    // "values" (pas "defaultValues") : le formulaire se resynchronise une
    // fois la fiche chargée en mode édition, même patron que le web.
    values: supplierQuery.data ? toFormValues(supplierQuery.data) : EMPTY_VALUES,
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await saveSupplier({ supplierId, values: values as CreateSupplierInput });
      navigation.goBack();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Une erreur est survenue");
    }
  });

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{supplierId ? "Modifier le fournisseur" : "Nouveau fournisseur"}</Text>

      <Controller
        control={control}
        name="type"
        render={({ field }) => (
          <View style={styles.field}>
            <Text style={styles.label}>Type</Text>
            <View style={styles.typeToggle}>
              {CUSTOMER_TYPES.map((type) => (
                <Pressable
                  key={type}
                  style={[styles.typeChip, field.value === type && styles.typeChipActive]}
                  onPress={() => field.onChange(type)}
                >
                  <Text style={[styles.typeChipText, field.value === type && styles.typeChipTextActive]}>
                    {SUPPLIER_TYPE_LABELS[type]}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
      />

      <FormTextField control={control} name="name" label="Nom" />
      <FormTextField control={control} name="email" label="Email" keyboardType="email-address" autoCapitalize="none" />
      <FormTextField control={control} name="phone" label="Téléphone" keyboardType="phone-pad" />
      <FormTextField control={control} name="address" label="Adresse" />
      <FormTextField control={control} name="city" label="Ville" />
      <FormTextField control={control} name="country" label="Pays" />
      <FormTextField control={control} name="ninea" label="NINEA" />
      <FormTextField control={control} name="rccm" label="RCCM" />
      <FormTextField control={control} name="notes" label="Notes" multiline />

      {formError ? <Text style={styles.formError}>{formError}</Text> : null}

      <Pressable style={styles.button} onPress={onSubmit} disabled={isSubmitting}>
        {isSubmitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>{supplierId ? "Enregistrer" : "Créer le fournisseur"}</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

function FormTextField({
  control,
  name,
  label,
  keyboardType,
  autoCapitalize,
  multiline,
}: {
  control: Control<SupplierFormValues>;
  name: Exclude<keyof SupplierFormValues, "type">;
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
            value={field.value ?? ""}
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
  typeToggle: {
    flexDirection: "row",
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
