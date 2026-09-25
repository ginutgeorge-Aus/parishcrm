import { z } from "zod"
import { encrypt, decrypt } from "@/lib/crypto"
import { isRealCalendarDate } from "@/lib/validation"

// Public, unauthenticated endpoint — every free-text string needs a .max() bound
// so an oversized field can't drive a ~10MB encrypt + PDF-layout pass (security.md
// requires .max() on all Zod strings on public/action surfaces).
const person = z.object({
  name: z.string().trim().min(1).max(200),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).nullable(),
  dateOfBirth: z.string().max(30).nullable(),
  email: z.string().trim().email().max(255),
  mobile: z.string().max(50).nullable(),
  address: z.string().trim().min(1).max(500),
  suburb: z.string().trim().min(1).max(200),
  state: z.string().trim().min(1).max(100),
  postcode: z.string().trim().min(1).max(20),
  qualificationProfession: z.string().max(500).nullable(),
  motherParish: z.string().max(200).nullable(),
  addressInIndia: z.string().max(500).nullable(),
  dateOfArrivalNsw: z.string().max(50).nullable(),
  maritalStatus: z.enum(["MARRIED", "UNMARRIED"]).nullable(),
  transferCertFurnished: z.boolean().nullable(),
})

const row = z.object({ name: z.string().trim().min(1).max(200), sex: z.string().max(20).nullable(), dateOfBirth: z.string().max(30).nullable() })

export const membershipPayloadSchema = z.object({
  personal: person,
  spouse: z
    .object({ name: z.string().trim().min(1).max(200), dateOfBirth: z.string().max(30).nullable(),
      // dateOfMarriage is converted with `new Date()` before storage; a malformed
      // string yields an Invalid Date that Prisma rejects with an unhandled 500.
      // Reject it here so a direct API caller gets a clean validation error.
      // Strict YYYY-MM-DD calendar check: a rollover like 2025-02-31 is finite
      // but new Date() silently shifts it to March.
      dateOfMarriage: z.string().max(50).nullable().refine((v) => v === null || isRealCalendarDate(v), "Invalid marriage date"),
      parish: z.string().max(200).nullable(), working: z.boolean().nullable(), email: z.string().trim().email().max(255).nullable() })
    .nullable(),
  children: z.array(row.extend({ occupation: z.string().max(200).nullable(), phoneEmail: z.string().max(255).nullable() })).max(4),
  dependents: z.array(row.extend({ relationship: z.string().max(200).nullable(), phoneEmail: z.string().max(255).nullable() })).max(4),
  relativesInAustralia: z.array(z.object({ name: z.string().trim().min(1).max(200), place: z.string().max(200).nullable(), relationship: z.string().max(200).nullable(), phoneEmail: z.string().max(255).nullable() })).max(3),
  // Bounded like family.ts's MAX_MONTHLY_DUES_DOLLARS — an unbounded number
  // (e.g. 1e20) passes Zod, then overflows the Decimal(10,2) column at write
  // and throws inside an un-try/catched create(), crashing the public submit
  // action with a raw 500 instead of a clean validation error.
  // Floor is the configurable membershipMinDues, enforced in
  // submitMembershipApplication — not here, because readPayload re-validates
  // stored payloads with this schema and must stay lenient.
  subscription: z.object({ monthlyAmount: z.number().min(0).max(100_000).finite() }),
  // declaration.date is converted with `new Date()` before storage (signedDate);
  // guard the Invalid-Date crash the same way, matching family.ts's joinedDate
  // refine.
  declaration: z.object({ place: z.string().max(200).nullable(), date: z.string().max(50).nullable().refine((v) => v === null || isRealCalendarDate(v), "Invalid date") }),
  // Overseas-field labels the applicant actually saw, stamped server-side by
  // submitMembershipApplication (client value ignored) so a later settings
  // change doesn't relabel old answers. Absent on pre- payloads.
  fieldLabels: z.object({ homeAddress: z.string().max(80).nullable(), arrivalDate: z.string().max(80).nullable() }).optional(),
})

export type MembershipPayload = z.infer<typeof membershipPayloadSchema>

export function encryptPayload(p: MembershipPayload): string {
  return encrypt(JSON.stringify(p))
}

export function readPayload(encrypted: string): MembershipPayload {
  // Re-validate against the schema rather than a bare `as` cast: a
  // malformed or legacy stored payload throws a clean ZodError at the boundary
  // instead of a downstream TypeError deep in the approval transaction.
  return membershipPayloadSchema.parse(JSON.parse(decrypt(encrypted)))
}

export function deriveFamilyName(p: MembershipPayload): string {
  const parts = p.personal.name.trim().split(/\s+/)
  return parts.length > 1 ? parts[parts.length - 1] : p.personal.name.trim()
}

// Configured labels for the optional overseas-address / arrival-date fields
// (stored as addressInIndia / dateOfArrivalNsw for payload compatibility).
// Blank = field hidden on the public form.
export type OverseasLabels = { homeAddressLabel: string; arrivalDateLabel: string }

// Label to show an answer under: the one stamped on the submission, else the
// current setting (pre- payloads were all collected under the one
// hardcoded label, now a configurable setting), else a generic label.
export function overseasFieldLabels(p: MembershipPayload, s: OverseasLabels): { homeAddress: string; arrivalDate: string } {
  return {
    homeAddress: p.fieldLabels?.homeAddress || s.homeAddressLabel || "Home-country address",
    arrivalDate: p.fieldLabels?.arrivalDate || s.arrivalDateLabel || "Date of arrival",
  }
}

export function buildNotesBlock(p: MembershipPayload, labels: OverseasLabels): string {
  const L: string[] = ["--- Membership form (intake) ---"]
  const pe = p.personal
  const ol = overseasFieldLabels(p, labels)
  if (pe.qualificationProfession) L.push(`Qualification/Profession: ${pe.qualificationProfession}`)
  if (pe.addressInIndia) L.push(`${ol.homeAddress}: ${pe.addressInIndia}`)
  if (pe.dateOfArrivalNsw) L.push(`${ol.arrivalDate}: ${pe.dateOfArrivalNsw}`)
  if (pe.transferCertFurnished != null) L.push(`Transfer certificate/NOC furnished: ${pe.transferCertFurnished ? "Yes" : "No"}`)
  if (p.spouse?.parish) L.push(`Spouse's church: ${p.spouse.parish}`)
  if (p.relativesInAustralia.length) {
    L.push("Relatives in Australia:")
    for (const r of p.relativesInAustralia) L.push(`  - ${r.name}${r.place ? `, ${r.place}` : ""}${r.relationship ? ` (${r.relationship})` : ""}${r.phoneEmail ? ` — ${r.phoneEmail}` : ""}`)
  }
  return L.join("\n")
}

// Office-use signature line on the membership PDF + print page. Uses the
// configured welcome-letter signer title (e.g. "Vicar"); generic fallback.
export function officeSignatureLabel(title: string): string {
  return `Signature of the ${title.trim() || "Minister"}`
}
