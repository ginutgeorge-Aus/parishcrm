import { centsToNumber, toCents, type Money } from "@/lib/formatting"

/** One row of `registration.groupBy({ by: ["eventId"], _sum: { totalAmount } })`. */
export type EventRevenueRow = { eventId: number; _sum: { totalAmount: Money } }
/** One row of `registrationItem.groupBy({ by: ["ticketTypeId"], _sum: { quantity } })`. */
export type TicketSoldRow = { ticketTypeId: number; _sum: { quantity: number | null } }

export type EventStats = { ticketsSold: number; revenue: number }

/**
 * Roll DB aggregate rows up into per-event `{ ticketsSold, revenue }`.
 *
 * Replaces the old approach of loading every `registration` + `registrationItem`
 * row into the events list page and summing in JS — the DB now does the
 * aggregation, this only stitches the two grouped result sets back together.
 *
 * Pure: `ttToEvent` maps ticketTypeId → eventId (built from the fetched events);
 * `revenueRows` are PAID-only registration totals; `soldRows` are per-ticketType
 * quantities. Revenue Decimal is summed by Postgres and converted to a number
 * once here, so it never picks up IEEE-754 drift.
 */
export function rollupEventStats(
  ttToEvent: Map<number, number>,
  revenueRows: EventRevenueRow[],
  soldRows: TicketSoldRow[],
): Map<number, EventStats> {
  const stats = new Map<number, EventStats>()
  const get = (eventId: number): EventStats => {
    let s = stats.get(eventId)
    if (!s) {
      s = { ticketsSold: 0, revenue: 0 }
      stats.set(eventId, s)
    }
    return s
  }

  for (const r of revenueRows) {
    get(r.eventId).revenue = centsToNumber(toCents(r._sum.totalAmount))
  }
  for (const r of soldRows) {
    const eventId = ttToEvent.get(r.ticketTypeId)
    if (eventId != null) get(eventId).ticketsSold += r._sum.quantity ?? 0
  }

  return stats
}
