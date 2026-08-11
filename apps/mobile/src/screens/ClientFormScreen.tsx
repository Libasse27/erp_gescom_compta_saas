import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Controller, useForm, type Control } from "react-hook-form";
import { createCustomerSchema, type CreateCustomerInput } from "@erp/validation";
import { CUSTOMER_TYPES, type Customer } from "@erp/types";
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
import { useCustomer, useSaveCustomer } from "../lib/queries/use-customers";
import type { AppStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<AppStackParamList, "ClientForm">;

// z.input (pas z.infer/output) : createCustomerSchema a des .default() sur
// type/country, ce qui les rend optionnels côté saisie mais requis côté
// résultat validé — même contrainte de typage que
// apps/web/src/components/customer-form.tsx (zodResolver exige la forme
// d'entrée). onSubmit ci-dessous reçoit en réalité les valeurs déjà résolues
// par le resolver (défauts appliqués), d'où le cast vers CreateCustomerInput.
type CustomerFormValues = z.input<typeof createCustomerSchema>;

const CUSTOMER_TYPE_LABELS: Record<(typeof CUSTOMER_TYPES)[number], string> = {
  COMPANY: "Entreprise",
  INDIVIDUAL: "Particulier",
};

const EMPTY_VALUES: CustomerFormValues = {
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

function toFormValues(customer: Customer): CustomerFormValues {
  return {
    type: customer.type,
    name: customer.name,
    email: customer.email ?? undefined,
    phone: customer.phone ?? undefined,
    address: customer.address ?? undefined,
    city: customer.city ?? undefined,
    country: customer.country,
    ninea: customer.ninea ?? undefined,
    rccm: customer.rccm ?? undefined,
    notes: customer.notes ?? undefined,
  };
}

// Un seul écran pour créer ET éditer (route { customerId? }) — écran de pile
// dédié plutôt qu'un formulaire intégré à la liste comme sur le web : patron
// idiomatique React Navigation, déjà celui retenu pour Login/MfaVerify
// (Phase 9.2).
export function ClientFormScreen({ route, navigation }: Props) {
  const customerId = route.params?.customerId;
  const customerQuery = useCustomer(customerId);
  const saveCustomer = useSaveCustomer();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<CustomerFormValues>({
    resolver: zodResolver(createCustomerSchema),
    // "values" (pas "defaultValues") : le formulaire se resynchronise une
    // fois la fiche chargée en mode édition, même patron que le web.
    values: customerQuery.data ? toFormValues(customerQuery.data) : EMPTY_VALUES,
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await saveCustomer({ customerId, values: values as CreateCustomerInput });
      navigation.goBack();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Une erreur est survenue");
    }
  });

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{customerId ? "Modifier le client" : "Nouveau client"}</Text>

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
                    {CUSTOMER_TYPE_LABELS[type]}
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
          <Text style={styles.buttonText}>{customerId ? "Enregistrer" : "Créer le client"}</Text>
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
  control: Control<CustomerFormValues>;
  name: Exclude<keyof CustomerFormValues, "type">;
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
