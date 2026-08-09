const UNIT_MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

// Parseur minimal ("15m", "30d", ...) pour éviter une dépendance externe
// juste pour ça — les seuls appelants sont internes (env.*Ttl()).
export function parseDurationMs(value: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(value.trim());
  const amount = match?.[1];
  const unit = match?.[2];
  const msPerUnit = unit ? UNIT_MS[unit] : undefined;

  if (!amount || msPerUnit === undefined) {
    throw new Error(`Format de durée invalide : ${value}`);
  }
  return Number(amount) * msPerUnit;
}
