import { z } from "zod"

// Default Zod object parsing DROPS unknown keys — this is the enforcement that
// disallowed fields (pastoralNotes, role, classification, bankingName, memberNo,
// status, monthlyDues, joinedDate) can never enter the payload, even if posted.
// The only family-editable dates are the member dateOfBirth and family marriageDate.
const str = (max: number) =>
  z.string().max(max).optional().transform((v) => v?.trim() || null).nullable()

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
// Shape-check plus a reconstruct-mismatch calendar check so impossible dates
// (2024-02-31, 2024-13-01, non-leap 2023-02-29) are rejected, not just malformed
// shapes — the regex alone accepts overflowed month/day values.
const isValidIsoDate = (v: string) => {
  if (!ISO_DATE_RE.test(v)) return false
  const [year, month, day] = v.split("-").map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
}
// Optional ISO date (YYYY-MM-DD, the native <input type="date"> format).
// Empty → null; a non-empty value must be a real calendar date so garbage never
// reaches the DB.
const isoDateStr = () =>
  z
    .string()
    .optional()
    .transform((v) => v?.trim() || null)
    .nullable()
    .refine((v) => v === null || isValidIsoDate(v), { message: "Invalid date" })

const MemberSchema = z.object({
  personId: z.number().int().positive().optional(),
  title: str(50),
  // Trim before min(1) so a whitespace-only name ("   ") is rejected rather than
  // stored, and surrounding whitespace is normalized away.
  firstName: z.string().trim().min(1).max(100),
  middleName: str(100),
  lastName: z.string().trim().min(1).max(100),
  suffix: str(50),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional().nullable(),
  // ISO-only (YYYY-MM-DD), like marriageDate below — a non-ISO string (e.g.
  // "01/02/1990") would be stored then parsed by a bare `new Date()` downstream,
  // silently producing a wrong/Invalid DOB and breaking birthday math.
  dateOfBirth: isoDateStr(),
  // Trim → empty becomes null; a non-empty value must be a valid email so junk
  // or a lookalike address can't be stored and silently break receipt sends.
  email: z
    .string()
    .max(255)
    .optional()
    .transform((v) => v?.trim() || null)
    .nullable()
    .refine((v) => v === null || z.string().email().safeParse(v).success, {
      message: "Invalid email address",
    }),
  mobile: str(50),
  workPhone: str(50),
  homePhone: str(50),
})

const FamilyContactSchema = z.object({
  address: str(500),
  suburb: str(100),
  state: str(50),
  postcode: str(20),
  homePhone: str(50),
  marriageDate: isoDateStr(),
})

export const FamilyUpdatePayloadSchema = z.object({
  family: FamilyContactSchema,
  members: z.array(MemberSchema).min(1).max(50),
})

export type FamilyUpdatePayload = z.infer<typeof FamilyUpdatePayloadSchema>
export type FamilyUpdateMember = z.infer<typeof MemberSchema>
