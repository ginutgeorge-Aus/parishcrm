import { toCents } from "@/lib/formatting"

type PaymentFields = {
  paymentStatus: string
  totalAmount: Parameters<typeof toCents>[0]
}

/**
 * True when a registration genuinely owes money: status is PENDING and the
 * total is above zero. Free ($0) registrations are stored as PENDING (no
 * payment ever occurs) but owe nothing, so reminders and "unpaid" displays
 * must use this instead of a bare `paymentStatus === "PENDING"`.
 * A malformed total (NaN cents) is treated as owing, so a corrupt row stays
 * visible rather than silently looking free.
 */
export function owesPayment(r: PaymentFields): boolean {
  return r.paymentStatus === "PENDING" && !(toCents(r.totalAmount) <= 0)
}

/**
 * Badge label for a registration's payment status. A PENDING row with nothing
 * owed reads "No payment needed" rather than "Pending".
 */
export function paymentStatusLabel(r: PaymentFields): string {
  if (r.paymentStatus === "PENDING" && !owesPayment(r)) return "No payment needed"
  return r.paymentStatus.charAt(0) + r.paymentStatus.slice(1).toLowerCase()
}

const STATUS_COLOURS: Record<string, string> = {
  PAID: "bg-income/10 text-income",
  PENDING: "bg-gold/10 text-gold-foreground",
  CANCELLED: "bg-expense/10 text-expense",
}

/**
 * Badge colour classes for a registration's payment status. A PENDING row with
 * nothing owed gets a neutral colour instead of the amber "pending" one.
 */
export function paymentStatusColour(r: PaymentFields): string {
  if (r.paymentStatus === "PENDING" && !owesPayment(r)) return "bg-muted text-muted-foreground"
  return STATUS_COLOURS[r.paymentStatus] ?? ""
}
