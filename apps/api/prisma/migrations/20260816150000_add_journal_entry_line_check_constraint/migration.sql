-- Corrige ACC-01 (docs/audit/ACCOUNTING-AUDIT.md) : la partie double
-- ("une ligne porte soit un débit soit un crédit, jamais les deux, jamais
-- aucun", montants jamais négatifs) n'était vérifiée que par
-- createJournalEntrySchema (Zod, périphérie HTTP) puis, depuis ce correctif,
-- par JournalRepository.create (application, même transaction que
-- l'insertion). Dernier filet non contournable, même par un accès direct à
-- la base : un CHECK par ligne. La somme débit=crédit PAR ÉCRITURE (portant
-- sur plusieurs lignes) reste hors de portée d'un CHECK simple — nécessite
-- un trigger agrégé ou une contrainte différée, volontairement non traité
-- ici (voir ACC-01, solution point 3 : à concevoir séparément si le niveau
-- de garantie applicatif est jugé insuffisant).
ALTER TABLE "journal_entry_lines"
  ADD CONSTRAINT "journal_entry_lines_amounts_check"
  CHECK (
    "debit_amount" >= 0
    AND "credit_amount" >= 0
    AND ("debit_amount" > 0) <> ("credit_amount" > 0)
  );
