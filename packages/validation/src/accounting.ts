import { z } from "zod";

// Module 8 de la Phase 8 (Comptabilité). code : convention SYSCOHADA
// (numérique, le premier chiffre porte la classe — voir schema.prisma,
// model Account) — 1 à 8 chiffres, jamais de lettres ni de séparateurs.
export const createAccountSchema = z.object({
  code: z.string().regex(/^[1-8][0-9]{0,7}$/, "Le code doit être numérique (1 à 8 chiffres), premier chiffre 1-8"),
  label: z.string().trim().min(1),
});
export type CreateAccountInput = z.infer<typeof createAccountSchema>;

// code immuable une fois créé (référencé par les écritures) : seul label
// est modifiable, contrairement à updateProductSchema qui autorise tout.
export const updateAccountSchema = z.object({
  label: z.string().trim().min(1),
});
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;

export const listAccountsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).optional(),
});
export type ListAccountsQuery = z.infer<typeof listAccountsQuerySchema>;

// Une ligne d'écriture porte le débit OU le crédit, jamais les deux, jamais
// aucun des deux (refine ci-dessous) — montants en XOF entiers (CLAUDE.md §7).
export const createJournalEntryLineInputSchema = z
  .object({
    accountId: z.string().uuid(),
    label: z.string().trim().min(1).optional(),
    debitAmount: z.number().int().min(0).default(0),
    creditAmount: z.number().int().min(0).default(0),
  })
  .refine((line) => (line.debitAmount > 0) !== (line.creditAmount > 0), {
    message: "Une ligne doit porter soit un débit, soit un crédit, jamais les deux ni aucun des deux",
  });
export type CreateJournalEntryLineInput = z.infer<typeof createJournalEntryLineInputSchema>;

// Partie double : au moins 2 lignes, total débit = total crédit > 0.
// Vérifié ici (400 avant d'atteindre le repository), pas en contrainte SQL —
// même choix que la garde stock négatif de StockRepository, une règle
// métier applicative.
export const createJournalEntrySchema = z
  .object({
    entryDate: z.coerce.date().optional(),
    reference: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1),
    lines: z.array(createJournalEntryLineInputSchema).min(2),
  })
  .refine(
    (entry) => {
      const totalDebit = entry.lines.reduce((sum, line) => sum + line.debitAmount, 0);
      const totalCredit = entry.lines.reduce((sum, line) => sum + line.creditAmount, 0);
      return totalDebit === totalCredit && totalDebit > 0;
    },
    { message: "Le total des débits doit être égal au total des crédits (écriture équilibrée)", path: ["lines"] },
  );
export type CreateJournalEntryInput = z.infer<typeof createJournalEntrySchema>;

export const listJournalEntriesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).optional(),
  accountId: z.string().uuid().optional(),
});
export type ListJournalEntriesQuery = z.infer<typeof listJournalEntriesQuerySchema>;
