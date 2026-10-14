import { prisma } from "@/lib/prisma"
import { centsToNumber, toCents } from "@/lib/formatting"

export type EventRegistrationRollup = {
  paid: number
  cancelled: number
  /** Paid revenue in dollars, then split by payment method. */
  revenue: number
  cardRevenue: number
  transferRevenue: number
}

/**
 * Headline registration stats for one event, rolled up in the DB over ALL
 * registrations (not a capped list) so they stay exact past the table cap.
 * Card = Stripe bookings (carry a PaymentIntent `paymentRef`); everything else
 * paid — bank transfer or manually marked paid — counts as transfer, matching
 * the registrations table and CSV export.
 */
export async function getEventRegistrationRollup(eventId: number): Promise<EventRegistrationRollup> {
  const [statusRollup, cardRollup] = await Promise.all([
    prisma.registration.groupBy({
      by: ["paymentStatus"],
      where: { eventId },
      _count: { _all: true },
      _sum: { totalAmount: true },
    }),
    prisma.registration.aggregate({
      where: { eventId, paymentStatus: "PAID", paymentRef: { not: null } },
      _sum: { totalAmount: true },
    }),
  ])
  const row = (status: string) => statusRollup.find((r) => r.paymentStatus === status)
  // Sum in integer cents so card + transfer always equals revenue exactly.
  const revenueCents = toCents(row("PAID")?._sum.totalAmount)
  const cardCents = toCents(cardRollup._sum.totalAmount)
  return {
    paid: row("PAID")?._count._all ?? 0,
    cancelled: row("CANCELLED")?._count._all ?? 0,
    revenue: centsToNumber(revenueCents),
    cardRevenue: centsToNumber(cardCents),
    transferRevenue: centsToNumber(revenueCents - cardCents),
  }
}
