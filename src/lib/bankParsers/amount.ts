// src/lib/bankParsers/amount.ts

// Thousands separators must sit on 3-digit groups so "12,34" (a European
// decimal comma) is rejected rather than read as 1234.
const SIGNED_AMOUNT_RE = /^([+-]?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/

/**
 * Convert a signed bank amount string ("-312.40", "200", "+1,234.5") into the
 * positive 2-dp `amount` + INCOME/EXPENSE `type` that `ParsedRow` uses. String
 * arithmetic only — never parseFloat — so no binary-float rounding. Returns
 * null for malformed input or a zero amount (a zero line can't be posted).
 */
export function normaliseSignedAmount(raw: string): { amount: string; type: "INCOME" | "EXPENSE" } | null {
  const m = SIGNED_AMOUNT_RE.exec(raw.trim())
  if (!m) return null
  const [, sign, whole, frac = ""] = m
  const intPart = whole.replace(/,/g, "").replace(/^0+(?=\d)/, "")
  const amount = `${intPart}.${(frac + "00").slice(0, 2)}`
  if (/^0+\.00$/.test(amount)) return null
  return { amount, type: sign === "-" ? "EXPENSE" : "INCOME" }
}
