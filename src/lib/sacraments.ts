import { z } from "zod"
import { SacramentType } from "@/lib/generated/prisma/enums"
import { isRealCalendarDate } from "@/lib/validation"

// Sacramental register (#304, decisions in #605): pure helpers shared by the
// actions (src/lib/actions/sacrament.ts) and, later, the pages and certificate.

/** Register-number prefix per rite, e.g. BAPTISM -> `BAP` in `BAP-2026-014`. */
export const SACRAMENT_PREFIX: Record<SacramentType, string> = {
  BAPTISM: "BAP",
  CONFIRMATION: "CON",
  MARRIAGE: "MAR",
  FIRST_COMMUNION: "FHC",
}

/** Earliest rite year accepted: old paper registers can be transcribed. */
const MIN_SACRAMENT_YEAR = 1800

const MAX_PLACE_LEN = 200
const MAX_NAME_LEN = 200
const MAX_GODPARENTS_LEN = 500
const MAX_NOTES_LEN = 2000

/**
 * Format a register number: `<PREFIX>-<year>-<seq padded to 3>`, e.g. `BAP-2026-014`.
 * A year past 999 entries keeps every digit (`BAP-2026-1000`).
 * @param type the rite
 * @param year the rite date's calendar year
 * @param seq 1-based sequence within that rite and year
 */
export function formatRegisterNo(type: SacramentType, year: number, seq: number): string {
  return `${SACRAMENT_PREFIX[type]}-${year}-${String(seq).padStart(3, "0")}`
}

/** `YYYY-MM-DD` -> Date at UTC midnight (the app's date-only storage convention). */
export function ymdToUtcDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`)
}

/** Optional trimmed text: blank -> null, else capped at `max` characters. */
function optionalText(max: number, label: string) {
  return z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .optional()
    .transform((v) => v || null)
}

/**
 * Strict positive int4 id from a form string: digits only, so `1e3`, `0x10`
 * and `5.0` are rejected rather than coerced by Number().
 * @param s trimmed form value
 */
function parseFormId(s: string): number | null {
  if (!/^\d{1,10}$/.test(s)) return null
  const n = Number(s)
  return n > 0 && n <= 2147483647 ? n : null
}

/** Optional positive int4 id from a form string: blank -> null. */
const optionalId = z
  .string()
  .optional()
  .transform((v, ctx) => {
    const s = v?.trim()
    if (!s) return null
    const n = parseFormId(s)
    if (n === null) {
      ctx.addIssue({ code: "custom", message: "Invalid person." })
      return z.NEVER
    }
    return n
  })

/**
 * Editable fields of a register entry (create and update). The rite and the
 * person are chosen on create only; see SacramentCreateSchema.
 */
export const SacramentFieldsSchema = z.object({
  date: z
    .string()
    .trim()
    .refine((v) => isRealCalendarDate(v), "Enter a valid date."),
  place: z
    .string()
    .trim()
    .min(1, "Enter the place.")
    .max(MAX_PLACE_LEN, `Place must be ${MAX_PLACE_LEN} characters or fewer.`),
  ministerName: optionalText(MAX_NAME_LEN, "Minister"),
  spouseId: optionalId,
  spouseName: optionalText(MAX_NAME_LEN, "Spouse name"),
  godparents: optionalText(MAX_GODPARENTS_LEN, "Godparents"),
  notes: optionalText(MAX_NOTES_LEN, "Notes"),
})

/** Create form: the editable fields plus the rite and the CRM person who received it. */
export const SacramentCreateSchema = SacramentFieldsSchema.extend({
  type: z.enum(SacramentType, { error: "Choose a sacrament." }),
  personId: z
    .string()
    .trim()
    .transform((v, ctx) => {
      const n = parseFormId(v)
      if (n === null) {
        ctx.addIssue({ code: "custom", message: "Choose a person." })
        return z.NEVER
      }
      return n
    }),
})

export type SacramentFields = z.output<typeof SacramentFieldsSchema>

/**
 * Cross-field rules the schema cannot express. Returns an error message or null.
 * - The date is not in the future (church wall-clock today) and not before 1800.
 * - Spouse fields are for marriage only; a marriage names exactly one spouse,
 *   either a CRM member (spouseId) or a free-text name, never both.
 * - A CRM spouse is not the person themselves.
 * @param type the rite
 * @param personId the person who received it
 * @param f parsed editable fields
 * @param todayYmd Sydney today as `YYYY-MM-DD`
 */
export function checkSacramentRules(
  type: SacramentType,
  personId: number,
  f: SacramentFields,
  todayYmd: string,
): string | null {
  if (f.date > todayYmd) return "The date cannot be in the future."
  if (Number(f.date.slice(0, 4)) < MIN_SACRAMENT_YEAR) return `The date cannot be before ${MIN_SACRAMENT_YEAR}.`
  if (type === SacramentType.MARRIAGE) {
    if (f.spouseId === null && f.spouseName === null) return "Choose the spouse or enter their name."
    if (f.spouseId !== null && f.spouseName !== null) return "Choose the spouse or enter their name, not both."
    if (f.spouseId === personId) return "The spouse must be a different person."
  } else if (f.spouseId !== null || f.spouseName !== null) {
    return "A spouse can only be recorded for a marriage."
  }
  return null
}
