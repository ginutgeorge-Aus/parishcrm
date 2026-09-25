import { fmtAUD, toCents, type Money } from "@/lib/formatting"

/**
 * Computed fraud/risk flags for a transaction. Pure, derived from
 * fields already on `Transaction` — no persisted state, no schema change.
 * Consumed by the transaction list + detail pages to render warning badges.
 */

/** A transaction is "large" at or above this amount — parish default. */
export const LARGE_AMOUNT_THRESHOLD_CENTS = 500_000 // $5,000.00

/** Backdated when more than this many days pass between the transaction
 * date and when it was actually entered (createdAt). */
export const BACKDATED_DAYS_THRESHOLD = 30

/**
 * Sensitive-change tolerance: Prisma's `@updatedAt` can drift a few seconds
 * from `createdAt` on the initial insert (driver/timing quirks), so a small
 * grace window avoids flagging every just-created transaction as "edited
 * after posting". Anything beyond this is a real post-creation edit.
 */
export const SENSITIVE_CHANGE_TOLERANCE_MS = 5 * 60 * 1000 // 5 minutes

const MS_PER_DAY = 24 * 60 * 60 * 1000

type RiskFlagType = "LARGE_AMOUNT" | "BACKDATED" | "SENSITIVE_CHANGE"

export type RiskFlag = {
  type: RiskFlagType
  label: string
  description: string
}

export type RiskFlaggable = {
  amount: Money
  date: Date
  createdAt: Date
  updatedAt: Date
}

function isLargeAmount(amount: Money): boolean {
  return Math.abs(toCents(amount)) >= LARGE_AMOUNT_THRESHOLD_CENTS
}

function isBackdated(date: Date, createdAt: Date): boolean {
  const diffDays = (createdAt.getTime() - date.getTime()) / MS_PER_DAY
  return diffDays > BACKDATED_DAYS_THRESHOLD
}

function isSensitiveChange(createdAt: Date, updatedAt: Date): boolean {
  return updatedAt.getTime() - createdAt.getTime() > SENSITIVE_CHANGE_TOLERANCE_MS
}

/**
 * Returns the risk flags that apply to a transaction, in a stable order
 * (large-amount, backdated, sensitive-change). Empty array = no flags.
 */
export function computeRiskFlags(tx: RiskFlaggable): RiskFlag[] {
  const flags: RiskFlag[] = []

  if (isLargeAmount(tx.amount)) {
    flags.push({
      type: "LARGE_AMOUNT",
      label: "Large amount",
      description: `Amount is ${fmtAUD(LARGE_AMOUNT_THRESHOLD_CENTS / 100)} or more`,
    })
  }

  if (isBackdated(tx.date, tx.createdAt)) {
    flags.push({
      type: "BACKDATED",
      label: "Backdated",
      description: `Entered more than ${BACKDATED_DAYS_THRESHOLD} days after the transaction date`,
    })
  }

  if (isSensitiveChange(tx.createdAt, tx.updatedAt)) {
    flags.push({
      type: "SENSITIVE_CHANGE",
      label: "Edited after posting",
      description: "This transaction was changed after it was originally created",
    })
  }

  return flags
}

/** Convenience predicate for callers that only need to know whether any flag fired. */
export function hasRiskFlags(tx: RiskFlaggable): boolean {
  return computeRiskFlags(tx).length > 0
}
