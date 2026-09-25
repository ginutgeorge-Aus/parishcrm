// Pure family-fee-waiver math — no DB, no Next imports. Shared by the
// server-side registration pricing path (validateAndPriceRegistration) and the
// public success page so the two can never disagree on what was waived.
//
// Rule: once the total quantity across COUNTED ticket types exceeds `threshold`,
// the surplus units are free. Free units are taken from the CHEAPEST counted
// ticket type(s) first (favours the family). Non-counted types (e.g. Visitor)
// are excluded from both the count and the discount.

export interface WaiverLine {
  unitPriceCents: number
  quantity: number
  countsTowardWaiver: boolean
}

export interface WaiverResult {
  freeCount: number
  discountCents: number
}

export function computeFamilyWaiver(
  lines: WaiverLine[],
  opts: { enabled: boolean; threshold: number },
): WaiverResult {
  if (!opts.enabled) return { freeCount: 0, discountCents: 0 }

  const counted = lines.filter((l) => l.countsTowardWaiver)
  const countedQty = counted.reduce((s, l) => s + l.quantity, 0)
  const threshold = Math.max(0, opts.threshold)
  const freeCount = Math.max(0, countedQty - threshold)
  if (freeCount === 0) return { freeCount: 0, discountCents: 0 }

  // Cheapest counted units freed first.
  const sorted = [...counted].sort((a, b) => a.unitPriceCents - b.unitPriceCents)
  let remaining = freeCount
  let discountCents = 0
  for (const l of sorted) {
    if (remaining <= 0) break
    const freed = Math.min(remaining, l.quantity)
    discountCents += freed * l.unitPriceCents
    remaining -= freed
  }
  return { freeCount, discountCents }
}
