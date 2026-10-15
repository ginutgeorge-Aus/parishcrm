import { prisma } from "@/lib/prisma"
import { Prisma } from "@/lib/generated/prisma/client"
import { centsToNumber, toCents } from "@/lib/formatting"

export type EventRegistrationRollup = {
  /** All registrations, any status — same snapshot as the status counts. */
  total: number
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
 * the registrations table's Method column. Both reads share one RepeatableRead
 * snapshot so a concurrent payment change can't push card above total.
 */
export async function getEventRegistrationRollup(eventId: number): Promise<EventRegistrationRollup> {
  const [statusRollup, cardRollup] = await prisma.$transaction([
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
  ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
  /** The status rollup group for one payment status, if any registrations have it. */
  const row = (status: string) => statusRollup.find((r) => r.paymentStatus === status)
  // Sum in integer cents so card + transfer always equals revenue exactly.
  const revenueCents = toCents(row("PAID")?._sum.totalAmount)
  const cardCents = toCents(cardRollup._sum.totalAmount)
  // toCents yields NaN past the safe-integer range; never render a bogus figure.
  if (!Number.isSafeInteger(revenueCents) || !Number.isSafeInteger(cardCents)) {
    throw new Error(`event ${eventId} revenue rollup exceeds safe integer range`)
  }
  return {
    total: statusRollup.reduce((n, r) => n + r._count._all, 0),
    paid: row("PAID")?._count._all ?? 0,
    cancelled: row("CANCELLED")?._count._all ?? 0,
    revenue: centsToNumber(revenueCents),
    cardRevenue: centsToNumber(cardCents),
    transferRevenue: centsToNumber(revenueCents - cardCents),
  }
}
