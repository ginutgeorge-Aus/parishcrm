import { MembershipStatus } from "@/lib/generated/prisma/enums"
import { fmtAUD, formatDMY, parseISODate, toCents, centsToNumber, type Money } from "@/lib/formatting"

/** Humanized display label for a membership application's status. */
export const MEMBERSHIP_STATUS_LABELS: Record<MembershipStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
}

/** Display labels for stored sex values (including legacy free-text `M` / `F`). */
const SEX_LABELS: Record<string, string> = { MALE: "Male", FEMALE: "Female", OTHER: "Other", M: "Male", F: "Female" }

/** Display labels for stored marital status values. */
const MARITAL_LABELS: Record<string, string> = { MARRIED: "Married", UNMARRIED: "Unmarried" }

/**
 * Humanize a stored sex value (`FEMALE` -> `Female`). Unknown legacy free text
 * is returned unchanged.
 */
export function sexLabel(v: string | null | undefined): string | null {
  if (!v) return null
  return SEX_LABELS[v.trim().toUpperCase()] ?? v
}

/** Humanize a stored marital status (`MARRIED` -> `Married`); unknown values pass through. */
export function maritalLabel(v: string | null | undefined): string | null {
  if (!v) return null
  return MARITAL_LABELS[v] ?? v
}

/**
 * Format a payload date string: ISO `YYYY-MM-DD` becomes `DD/MM/YYYY` (AU);
 * anything else (free text, legacy values) is returned unchanged.
 */
export function formatPayloadDate(v: string | null | undefined): string | null {
  if (!v) return null
  const d = parseISODate(v)
  return d ? formatDMY(d) : v
}

/** Format a monthly subscription (Decimal, number or string) as currency, e.g. `$80.00`; null when unset. */
export function formatMonthlyDues(v: Money): string | null {
  if (v === null || v === undefined || v === "") return null
  return fmtAUD(centsToNumber(toCents(v)))
}
