// Exact gross-up: the customer pays enough that after Stripe's percent + fixed
// cut the church nets `netCents`. Integer cents throughout (no float money).
// Single blended rate (domestic) — international cards under-recover; accepted.
export function grossUpTotal(
  netCents: number,
  pct: number, // e.g. 1.7
  fixedCents: number, // e.g. 30
): { totalCents: number; feeCents: number } {
  if (netCents <= 0) return { totalCents: 0, feeCents: 0 }
  const totalCents = Math.round((netCents + fixedCents) / (1 - pct / 100))
  return { totalCents, feeCents: totalCents - netCents }
}
