import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Controller, useForm } from "react-hook-form";
import { createAccountSchema, type CreateAccountInput } from "@erp/validation";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useCreateAccount } from "../lib/queries/use-accounts";
import type { AppStackParamList } from "../navigation/types";
import type { z } from "zod";

type Props = NativeStackScreenProps<AppStackParamList, "AccountForm">;

// z.input (pas z.infer/output) : même patron que les modules précédents.
type AccountFormValues = z.input<typeof createAccountSchema>;

const EMPTY_VALUES: AccountFormValues = { code: "", label: "" };

// Création uniquement — pas de mode édition (voir use-accounts.ts : le code
// SYSCOHADA est immuable une fois créé côté API, et aucune UI, mobile ou
// web, n'expose la modification du label dans ce cycle).
export function AccountFormScreen({ navigation }: Props) {
  const createAccount = useCreateAccount();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<AccountFormValues>({
    resolver: zodResolver(createAccountSchema),
    defaultValues: EMPTY_VALUES,
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await createAccount(values as CreateAccountInput);
      navigation.goBack();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Une erreur est survenue");
    }
  });

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Nouveau compte</Text>

      <Controller
        control={control}
        name="code"
        render={({ field, fieldState }) => (
          <View style={styles.field}>
            <Text style={styles.label}>Code (SYSCOHADA)</Text>
            <TextInput
              style={styles.input}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              placeholder="601000"
              keyboardType="number-pad"
            />
            {fieldState.error ? <Text style={styles.fieldError}>{fieldState.error.message}</Text> : null}
          </View>
        )}
      />

      <Controller
        control={control}
        name="label"
        render={({ field, fieldState }) => (
          <View style={styles.field}>
            <Text style={styles.label}>Libellé</Text>
            <TextInput
              style={styles.input}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              placeholder="Achats de marchandises"
            />
            {fieldState.error ? <Text style={styles.fieldError}>{fieldState.error.message}</Text> : null}
          </View>
        )}
      />

      {formError ? <Text style={styles.formError}>{formError}</Text> : null}

      <Pressable style={styles.button} onPress={onSubmit} disabled={isSubmitting}>
        {isSubmitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Créer le compte</Text>}
      </Pressable>
    </ScrollView>
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
  fieldError: {
    color: "#b00020",
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
});
