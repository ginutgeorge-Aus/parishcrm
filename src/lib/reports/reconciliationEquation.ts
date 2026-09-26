import { centsToNumber } from "@/lib/formatting"

// Compute the whole book-vs-bank equation in integer cents so the verdict is
// exact — no float drift, no 0.005 tolerance workaround.
export function computeReconciliationEquation(input: {
  openingCents: number | null
  clearedInCents: number
  clearedOutCents: number
  statementClosingCents: number | null
  outstandingDepositsCents: number
  outstandingPaymentsCents: number
}): {
  calculatedCents: number | null
  adjustedCents: number | null
  differenceCents: number | null
} {
  const calculatedCents =
    input.openingCents !== null ? input.openingCents + input.clearedInCents - input.clearedOutCents : null
  const adjustedCents =
    input.statementClosingCents !== null
      ? input.statementClosingCents + input.outstandingDepositsCents - input.outstandingPaymentsCents
      : null
  const differenceCents =
    calculatedCents !== null && adjustedCents !== null ? calculatedCents - adjustedCents : null
  return { calculatedCents, adjustedCents, differenceCents }
}

// Display values are derived back to dollars from the same integer cents;
// null (no anchor yet) stays null rather than becoming NaN/0.
export function centsToNumberOrNull(cents: number | null): number | null {
  return cents !== null ? centsToNumber(cents) : null
}
