import { z } from "zod"
import { isRealCalendarDate, isValidPgId, MAX_YEAR, MIN_YEAR } from "@/lib/validation"

/**
 * Required Postgres integer id from a FormData string. Digits only and within int4, so
 * "abc", "1e1", "0x10", "0" and 2147483648 are rejected with `message` instead of
 * reaching Prisma as NaN or an overflow (AUD-3-19).
 * @param message error shown on any invalid value
 */
export function pgIdFormField(message: string) {
  return z
    .string({ error: message })
    .trim()
    .transform((v, ctx) => {
      const n = /^\d+$/.test(v) ? Number(v) : Number.NaN
      if (!isValidPgId(n)) {
        ctx.addIssue({ code: "custom", message })
        return z.NEVER
      }
      return n
    })
}

/**
 * Optional Postgres integer id from a FormData string. Missing or "" yields `empty`;
 * anything else must be a valid int4 id, otherwise `message` is reported.
 * @param message error shown on a non-empty invalid value
 * @param empty value returned when the field is absent or blank
 */
export function optionalPgIdFormField<E extends null | undefined>(message: string, empty: E) {
  return z
    .string()
    .optional()
    .transform((v, ctx): number | E => {
      const s = v?.trim()
      if (!s) return empty
      const n = /^\d+$/.test(s) ? Number(s) : Number.NaN
      if (!isValidPgId(n)) {
        ctx.addIssue({ code: "custom", message })
        return z.NEVER
      }
      return n
    })
}

/**
 * Required date form value: YYYY-MM-DD (optionally followed by an ISO time part) that is a
 * real calendar date within MIN_YEAR..MAX_YEAR, returned as a Date. Rejects free-form strings
 * `new Date()` would accept and years far outside the ledger's range.
 * @param message error shown on any invalid value
 */
export function dateOnlyFormField(message = "Invalid date") {
  return z
    .string({ error: message })
    .min(1, message)
    .refine(
      (v) =>
        isRealCalendarDate(v.slice(0, 10)) &&
        (v.length === 10 || (v[10] === "T" && !Number.isNaN(new Date(v).getTime()))) &&
        Number(v.slice(0, 4)) >= MIN_YEAR &&
        Number(v.slice(0, 4)) <= MAX_YEAR,
      message,
    )
    .transform((v) => new Date(v))
}
