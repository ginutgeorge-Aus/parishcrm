/**
 * Card vs bank-transfer classification for event registrations — one rule for
 * the table, the detail export and the revenue rollup. Card registrations are
 * created by the Stripe webhook with a PaymentIntent id in `paymentRef`;
 * bank-transfer, cash and manually marked-paid bookings have none.
 */

export type PaymentMethod = "Card" | "Bank transfer"

/** Display label for a registration's payment method. */
export function paymentMethodOf(paymentRef: string | null): PaymentMethod {
  return paymentRef ? "Card" : "Bank transfer"
}

/**
 * Prisma `where` fragment matching card registrations. `gt: ""` excludes both
 * NULL and the empty string, so it agrees with {@link paymentMethodOf}'s truthiness.
 */
export const CARD_PAYMENT_WHERE = { paymentRef: { gt: "" } } as const
