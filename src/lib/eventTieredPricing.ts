import { toCents } from "@/lib/formatting"

export interface TieredResult { ok: true; totalCents: number }
export interface TieredError  { ok: false; maxAttendees: number }

/**
 * Look up the total price for a registration of `attendeeCount` people in a
 * per-event tier table. `tiersDollars` is ordered — index 0 is the price for a
 * single attendee — and its length is the hard maximum group size.
 */
export function computeTieredTotal(
  tiersDollars: number[],
  attendeeCount: number,
): TieredResult | TieredError {
  if (attendeeCount <= 0) return { ok: true, totalCents: 0 }
  if (attendeeCount > tiersDollars.length) {
    return { ok: false, maxAttendees: tiersDollars.length }
  }
  return { ok: true, totalCents: toCents(tiersDollars[attendeeCount - 1]) }
}
