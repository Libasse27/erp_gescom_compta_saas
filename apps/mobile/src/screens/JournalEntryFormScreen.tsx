import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Controller, useFieldArray, useForm, useWatch, type Control } from "react-hook-form";
import { createJournalEntrySchema, type CreateJournalEntryInput } from "@erp/validation";
import type { AccountWithBalance } from "@erp/types";
import { formatFCFA } from "@erp/utils";
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
import { useAccounts } from "../lib/queries/use-accounts";
import { useCreateJournalEntry } from "../lib/queries/use-journal-entries";
import type { AppStackParamList } from "../navigation/types";
import type { z } from "zod";

type Props = NativeStackScreenProps<AppStackParamList, "JournalEntryForm">;

// z.input (pas z.infer/output) : même patron que les modules précédents.
type JournalEntryFormValues = z.input<typeof createJournalEntrySchema>;

const EMPTY_VALUES: JournalEntryFormValues = {
  description: "",
  reference: undefined,
  lines: [
    { accountId: "", debitAmount: 0, creditAmount: 0 },
    { accountId: "", debitAmount: 0, creditAmount: 0 },
  ],
};

// Contrairement à SaleForm/PurchaseForm (une seule "colonne" par ligne), une
// ligne d'écriture a deux montants (débit/crédit) dont un seul doit être
// renseigné — voir createJournalEntrySchema, packages/validation. Le total
// affiché en bas est purement indicatif (UX, miroir de
// apps/web/src/components/journal-entry-form.tsx) : l'équilibre réel est
// revalidé côté serveur, jamais fait confiance côté client seul.
export function JournalEntryFormScreen({ navigation }: Props) {
  const createJournalEntry = useCreateJournalEntry();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<JournalEntryFormValues>({
    resolver: zodResolver(createJournalEntrySchema),
    defaultValues: EMPTY_VALUES,
  });

  const { fields, append, remove } = useFieldArray({ control, name: "lines" });
  const lines = useWatch({ control, name: "lines" });

  const totalDebit = lines?.reduce((sum, line) => sum + (line?.debitAmount ?? 0), 0) ?? 0;
  const totalCredit = lines?.reduce((sum, line) => sum + (line?.creditAmount ?? 0), 0) ?? 0;
  const balanced = totalDebit === totalCredit && totalDebit > 0;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await createJournalEntry(values as CreateJournalEntryInput);
      navigation.goBack();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Une erreur est survenue");
    }
  });

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Nouvelle écriture</Text>

      <Controller
        control={control}
        name="description"
        render={({ field, fieldState }) => (
          <View style={styles.field}>
            <Text style={styles.label}>Libellé</Text>
            <TextInput
              style={styles.input}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              placeholder="Vente au comptant"
            />
            {fieldState.error ? <Text style={styles.fieldError}>{fieldState.error.message}</Text> : null}
          </View>
        )}
      />

      <Controller
        control={control}
        name="reference"
        render={({ field, fieldState }) => (
          <View style={styles.field}>
            <Text style={styles.label}>Référence (optionnel)</Text>
            <TextInput
              style={styles.input}
              value={field.value ?? ""}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              placeholder="FACT-000123"
            />
            {fieldState.error ? <Text style={styles.fieldError}>{fieldState.error.message}</Text> : null}
          </View>
        )}
      />

      <Text style={styles.sectionLabel}>Lignes</Text>
      {fields.map((field, index) => (
        <View key={field.id} style={styles.lineRow}>
          <View style={styles.lineFields}>
            <AccountPickerField control={control} name={`lines.${index}.accountId`} />
            <View style={styles.lineFieldsInline}>
              <AmountField control={control} name={`lines.${index}.debitAmount`} label="Débit" />
              <AmountField control={control} name={`lines.${index}.creditAmount`} label="Crédit" />
            </View>
          </View>
          {fields.length > 2 ? (
            <Pressable onPress={() => remove(index)} hitSlop={8}>
              <Text style={styles.removeAction}>Retirer</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
      <Pressable style={styles.addLineButton} onPress={() => append({ accountId: "", debitAmount: 0, creditAmount: 0 })}>
        <Text style={styles.addLineButtonText}>+ Ajouter une ligne</Text>
      </Pressable>

      <Text style={[styles.totalsText, !balanced && styles.totalsTextUnbalanced]}>
        Total débit {formatFCFA(totalDebit)} — Total crédit {formatFCFA(totalCredit)}
        {!balanced ? " — écriture non équilibrée" : ""}
      </Text>

      {formError ? <Text style={styles.formError}>{formError}</Text> : null}

      <Pressable style={styles.button} onPress={onSubmit} disabled={isSubmitting || !balanced}>
        {isSubmitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Enregistrer l&apos;écriture</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

// Même patron Pressable+Modal+FlatList maison que ProductPickerField de
// SaleFormScreen.tsx, adapté aux comptes. Limité aux 100 premiers comptes,
// pas de recherche async côté serveur.
function AccountPickerField({
  control,
  name,
}: {
  control: Control<JournalEntryFormValues>;
  name: `lines.${number}.accountId`;
}) {
  const [modalVisible, setModalVisible] = useState(false);
  const [filter, setFilter] = useState("");
  const accountsQuery = useAccounts({ page: 1, pageSize: 100 });
  const accounts = accountsQuery.data?.items ?? [];
  const normalizedFilter = filter.trim().toLowerCase();
  const filteredAccounts = normalizedFilter
    ? accounts.filter((account) => `${account.code} ${account.label}`.toLowerCase().includes(normalizedFilter))
    : accounts;

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const selected = accounts.find((account) => account.id === field.value);
        return (
          <View style={styles.field}>
            <Text style={styles.label}>Compte</Text>
            <Pressable style={styles.input} onPress={() => setModalVisible(true)}>
              <Text style={selected ? styles.pickerValueText : styles.pickerPlaceholderText}>
                {selected ? `${selected.code} — ${selected.label}` : "Sélectionner un compte…"}
              </Text>
            </Pressable>
            {fieldState.error ? <Text style={styles.fieldError}>{fieldState.error.message}</Text> : null}

            <Modal visible={modalVisible} animationType="slide" onRequestClose={() => setModalVisible(false)}>
              <View style={styles.modalContainer}>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Filtrer par code ou libellé…"
                  value={filter}
                  onChangeText={setFilter}
                  autoFocus
                />
                <FlatList
                  data={filteredAccounts}
                  keyExtractor={(item) => item.id}
                  ListEmptyComponent={<Text style={styles.emptyText}>Aucun compte trouvé.</Text>}
                  renderItem={({ item }: { item: AccountWithBalance }) => (
                    <Pressable
                      style={styles.modalRow}
                      onPress={() => {
                        field.onChange(item.id);
                        setModalVisible(false);
                        setFilter("");
                      }}
                    >
                      <Text style={styles.modalRowText}>
                        {item.code} — {item.label}
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

// Montant entier ≥ 0 en FCFA — débit et crédit partagent ce composant, un
// seul des deux doit être renseigné par ligne (revalidé côté serveur).
function AmountField({
  control,
  name,
  label,
}: {
  control: Control<JournalEntryFormValues>;
  name: `lines.${number}.debitAmount` | `lines.${number}.creditAmount`;
  label: string;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <View style={styles.fieldNarrow}>
          <Text style={styles.label}>{label}</Text>
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
  totalsText: {
    fontSize: 14,
    color: "#555",
  },
  totalsTextUnbalanced: {
    color: "#b00020",
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
