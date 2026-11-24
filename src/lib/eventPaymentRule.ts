/** Error returned when a paid event would go (or stay) public with no way to pay. */
export const PAID_EVENT_NEEDS_PAYMENT_ERROR =
  "Add the BSB and account number, or turn on card payment, before publishing a paid event"

/** Card payment is switched on but Stripe is not configured, so only bank details can fix it. */
export const PAID_EVENT_STRIPE_MISSING_ERROR =
  "Card payments aren't set up on this server. Add the BSB and account number."

/** Pick the save/publish error: the card hint is wrong when card is on but Stripe is missing. */
export function paidEventPaymentError(onlinePaymentEnabled: boolean, stripeOk: boolean): string {
  return onlinePaymentEnabled && !stripeOk ? PAID_EVENT_STRIPE_MISSING_ERROR : PAID_EVENT_NEEDS_PAYMENT_ERROR
}

/** Shown when a registrant must pay by transfer but the event has no account details. */
export const OFFICE_WILL_SEND_PAYMENT_DETAILS = "The church office will send you payment details."

export type PaidEventPaymentInput = {
  /** Ticket prices as Decimal strings (never parsed to float). */
  ticketPrices: ReadonlyArray<string | { toString(): string }>
  /** Family tier prices in dollars; counted only when tiered pricing is on. */
  tierPrices?: ReadonlyArray<number>
  tieredPricingEnabled?: boolean
  onlinePaymentEnabled: boolean
  /** Whether Stripe is configured on this server. Card payment only works if true. */
  stripeConfigured: boolean
  bankBsb: string | null | undefined
  bankAccount: string | null | undefined
}

/** True when the bank-transfer instructions have both a BSB and an account number. */
export function hasBankDetails(bankBsb: string | null | undefined, bankAccount: string | null | undefined): boolean {
  return !!bankBsb?.trim() && !!bankAccount?.trim()
}

/**
 * Whether a paid event has no usable way to pay: any ticket price or family
 * tier above zero, card payment off (or Stripe not configured), and the BSB or
 * account number blank. Callers apply it only when the event is being
 * published (or is already published); drafts may stay incomplete.
 * Prices are Decimal strings and are tested for a non-zero digit, never parsed
 * to a float.
 */
export function paidEventLacksPaymentMethod(i: PaidEventPaymentInput): boolean {
  const ticketPaid = i.ticketPrices.some((p) => /[1-9]/.test(String(p)))
  const tierPaid = !!i.tieredPricingEnabled && (i.tierPrices ?? []).some((t) => t > 0)
  if (!ticketPaid && !tierPaid) return false
  if (i.onlinePaymentEnabled && i.stripeConfigured) return false
  return !hasBankDetails(i.bankBsb, i.bankAccount)
}
