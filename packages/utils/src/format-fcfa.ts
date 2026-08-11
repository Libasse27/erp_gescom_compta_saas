// Montants XOF stockés en entiers, jamais en flottant (CLAUDE.md §7).
// Source unique — évite la duplication déjà présente sur ~10 pages web
// (apps/web/src/app/app/{products,sales,purchases,...}/page.tsx) pour tout
// nouveau consommateur, mobile compris.
export function formatFCFA(amount: number): string {
  return `${amount.toLocaleString("fr-SN")} FCFA`;
}
