import { MONEY_DECIMAL_RE } from "@/lib/validation"

// Hard cap on tier rows — matches the ticket-type loop guard; unbounded rows
// become unbounded JSON growth on one request.
const MAX_TIERS = 20

// Read repeated `tier.<i>.price` form fields into an ordered dollar array.
// Row i = the total price for a registration of (i+1) attendees; the array
// length is the hard max group size. Trailing blank rows are skipped, but a
// blank row *between* filled rows is rejected — silently dropping it would shift
// every later tier down one index and mis-price by head count (/ class).
export function parseTiers(formData: FormData): { error: string } | { tiers: number[] } {
  const tiers: number[] = []
  let i = 0
  let sawBlank = false
  while (formData.has(`tier.${i}.price`)) {
    if (i >= MAX_TIERS) return { error: `Too many pricing tiers (max ${MAX_TIERS})` }
    const raw = ((formData.get(`tier.${i}.price`) as string | null) ?? "").trim()
    if (!raw) {
      sawBlank = true
      i++
      continue
    }
    if (sawBlank) return { error: `Tier ${i + 1} follows a blank tier — remove blank rows between prices` }
    if (!MONEY_DECIMAL_RE.test(raw)) return { error: `Invalid price for tier ${i + 1}` }
    const price = Number(raw)
    // Tier i = price for (i+1) attendees — a lower price for more attendees
    // than fewer is never intentional and would undercharge larger families
    // relative to smaller ones for the same event.
    if (tiers.length > 0 && price < tiers[tiers.length - 1]) {
      return { error: `Tier ${i + 1} ($${raw}) is less than tier ${i} — prices must not decrease` }
    }
    tiers.push(price)
    i++
  }
  return { tiers }
}
