// Sunday School exams (pure helpers): score + exam-form validation.
// Amounts are Decimal(10,2) strings; comparison runs on integer hundredths
// (BigInt) so no float parsing is involved.

import { z } from "zod"
import { MONEY_DECIMAL_RE } from "@/lib/validation"

/** Largest allowed total marks / score (Decimal(10,2) holds far more; this keeps forms sane). */
const MAX_DIGITS = 6

const NAME_MAX = 80

/** Result of parseScore: the normalised decimal string, a clear request, or an error. */
export type ScoreParse =
  | { ok: true; value: string }
  | { ok: true; clear: true; value: null }
  | { ok: false; error: string }

/**
 * A validated decimal string ("12", "12.5", "12.50") as integer hundredths.
 * Caller must have matched MONEY_DECIMAL_RE.
 */
function toHundredths(s: string): bigint {
  const [whole, frac = ""] = s.split(".")
  return BigInt(whole) * BigInt(100) + BigInt(frac.padEnd(2, "0"))
}

/**
 * Validate a typed score against the exam total. Blank (after trim) means
 * "clear the mark". Otherwise: plain non-negative decimal, at most 2 dp,
 * 0 <= score <= total. "0" is a real mark.
 * @param raw the typed score
 * @param totalMarks the exam's total as a decimal string
 */
export function parseScore(raw: string, totalMarks: string): ScoreParse {
  const s = typeof raw === "string" ? raw.trim() : ""
  if (s === "") return { ok: true, clear: true, value: null }
  if (!MONEY_DECIMAL_RE.test(s)) return { ok: false, error: "Score must be a number with at most 2 decimal places, 0 or more" }
  const whole = s.split(".")[0]
  if (whole.length > MAX_DIGITS) return { ok: false, error: "Score is too large" }
  if (toHundredths(s) > toHundredths(totalMarks)) return { ok: false, error: `Score cannot be more than the total (${totalMarks})` }
  return { ok: true, value: s }
}

/** Zod schema for the exam create/edit form (date is checked against the class year by the action). */
export const ExamFormSchema = z.object({
  name: z.string().trim().min(1, "Exam name is required").max(NAME_MAX, "Exam name is too long"),
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date"),
  totalMarks: z
    .string()
    .trim()
    .regex(MONEY_DECIMAL_RE, "Total marks must be a number with at most 2 decimal places")
    .refine((s) => s.split(".")[0].length <= MAX_DIGITS, "Total marks is too large")
    .refine((s) => toHundredths(s) > BigInt(0), "Total marks must be more than 0"),
})

/**
 * True when `ymd` is a real calendar date (rejects 2026-02-31) in `year`.
 * @param ymd YYYY-MM-DD string
 * @param year the class's school year
 */
export function isDateInYear(ymd: string, year: number): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return false
  const d = new Date(`${ymd}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== ymd) return false
  return d.getUTCFullYear() === year
}
