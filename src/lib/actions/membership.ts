"use server"

import { revalidatePath } from "next/cache"
import { headers } from "next/headers"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { logger } from "@/lib/logger"
import { canEdit } from "@/lib/roleGuard"
import { actorId } from "@/lib/actor"
import { encrypt, safeDecrypt, hmacEmail, hmacMobile } from "@/lib/crypto"
import { verifyTurnstile } from "@/lib/turnstile"
import { dbRateLimit } from "@/lib/dbRateLimit"
import { sendMembershipNotificationEmail } from "@/lib/email"
import { renderMembershipPdf } from "@/lib/pdf/MembershipPdf"
import { logAudit } from "@/lib/audit"
import { encryptFamilyFields } from "@/lib/familyFields"
import { isP2002 } from "@/lib/validation"
import { Prisma } from "@/lib/generated/prisma/client"
import { membershipPayloadSchema, encryptPayload, readPayload, buildNotesBlock, deriveFamilyName, type MembershipPayload } from "@/lib/membership"
import { getChurchSettings } from "@/lib/churchSettings"
import { getMembershipSettings } from "@/lib/membershipSettings"
import { getLetterSettings } from "@/lib/letterSettings"
import type { Gender, FamilyRole } from "@/lib/generated/prisma/enums"
import type { ActionResultWithSuccess } from "./types"

const MAX_SIGNATURE_LEN = 300_000 // ~225 KB of base64

// Thrown inside the approval transaction when the atomic PENDING→APPROVED claim
// matches 0 rows (a concurrent review already won). Caught to return a clean
// message instead of retrying or surfacing a 500.
class AlreadyReviewedError extends Error {}

// Thrown inside the approval transaction when a merge targets a soft-archived
// family. Caught to return a clear message instead of the generic
// P2002 retry text. The match UI already filters archivedAt — this is the
// defense-in-depth guard for a directly-supplied familyId.
class ArchivedFamilyError extends Error {}

type FieldLabels = { homeAddress: string; arrivalDate: string }
type SubmitMembershipInput = { payload: unknown; signature: string; turnstileToken?: string; website?: string; renderedLabels?: FieldLabels }
// updatedLabels: the overseas-field labels changed since the form was
// rendered — the client swaps them in and keeps the applicant's typed data.
type SubmitMembershipResult = ActionResultWithSuccess | { error: string; updatedLabels: FieldLabels }

export async function submitMembershipApplication(input: SubmitMembershipInput): Promise<SubmitMembershipResult> {
  // Honeypot — silent bots fill hidden field.
  if (input.website && input.website.trim().length > 0) return { error: "Submission failed" }

  if (!input.signature || !input.signature.startsWith("data:image/")) return { error: "Signature is required" }
  if (input.signature.length > MAX_SIGNATURE_LEN) return { error: "Signature image too large" }

  const parsed = membershipPayloadSchema.safeParse(input.payload)
  if (!parsed.success) return { error: "Please check the form — some required fields are missing or invalid." }

  // Server-read floor — the client-side check is UX only.
  const membershipSettings = await getMembershipSettings()
  const { minDues } = membershipSettings
  if (minDues != null && parsed.data.subscription.monthlyAmount < minDues) {
    return { error: `Monthly subscription must be at least $${minDues}.` }
  }

  // Stale-label guard: an admin changed a label after this form was
  // rendered, so the label we'd stamp differs from the one the applicant saw.
  // Checked before Turnstile so the single-use token isn't burned. Absent
  // renderedLabels (a pre-deploy cached bundle) skips the check.
  const currentLabels: FieldLabels = { homeAddress: membershipSettings.homeAddressLabel || "", arrivalDate: membershipSettings.arrivalDateLabel || "" }
  const shown = input.renderedLabels
  if (shown && (shown.homeAddress !== currentLabels.homeAddress || shown.arrivalDate !== currentLabels.arrivalDate)) {
    return { error: "This form was updated while you were filling it in. Please check your answers and submit again.", updatedLabels: currentLabels }
  }

  // Real client IP from the trusted reverse proxy (rightmost x-forwarded-for) —
  // a client cannot set its own, so we never trust input.ip for throttling.
  const xff = (await headers()).get("x-forwarded-for")
  const ip = xff?.split(",").at(-1)?.trim() || undefined

  const ok = await verifyTurnstile(input.turnstileToken, ip)
  if (!ok) return { error: "Verification failed. Please try again." }

  // Two independent windows: per-IP (blocks a single host flooding many
  // emails) and per-email (blocks resubmitting the same identity).
  const email = parsed.data.personal.email.toLowerCase()
  if (!(await dbRateLimit(`membership:ip:${ip ?? "unknown"}`, 10, 60 * 60 * 1000))) return { error: "Too many submissions. Please try again later." }
  if (!(await dbRateLimit(`membership:email:${email}`, 3, 60 * 60 * 1000))) return { error: "Too many submissions. Please try again later." }

  const p: MembershipPayload = {
    ...parsed.data,
    fieldLabels: {
      homeAddress: membershipSettings.homeAddressLabel || null,
      arrivalDate: membershipSettings.arrivalDateLabel || null,
    },
  }
  await prisma.membershipApplication.create({
    data: {
      payload: encryptPayload(p),
      signature: encrypt(input.signature),
      applicantName: p.personal.name.trim(),
      email: encrypt(p.personal.email),
      emailHash: hmacEmail(p.personal.email),
      mobile: p.personal.mobile ? encrypt(p.personal.mobile) : null,
      mobileHash: p.personal.mobile ? hmacMobile(p.personal.mobile) : null,
      placeSigned: p.declaration.place ?? null,
      signedDate: p.declaration.date ? new Date(p.declaration.date) : null,
      monthlyDues: p.subscription.monthlyAmount.toString(),
    },
  })

  // Fire-and-forget — never block or fail the submission on PDF/email error.
  // Renders the completed application to a PDF and attaches it to the secretary
  // notification. A PDF failure still sends the (link-only) email.
  void (async () => {
    const [{ name: churchName, address: churchAddress }, { signerTitle }] = await Promise.all([getChurchSettings(), getLetterSettings()])
    const { parishFields, homeAddressLabel, arrivalDateLabel } = membershipSettings
    const pdf = await renderMembershipPdf({ payload: p, signature: input.signature, churchName, churchAddress, parishFields, signerTitle, homeAddressLabel, arrivalDateLabel }).catch(
      () => undefined
    )
    await sendMembershipNotificationEmail(p.personal.name.trim(), pdf)
  })().catch(() => {})

  return { success: "Thank you — your membership form has been received. The parish office will be in touch." }
}

export type MatchCandidate = { familyId: number; familyName: string; reason: "email" | "mobile" | "surname" }

export async function findMembershipMatches(applicationId: number): Promise<MatchCandidate[]> {
  // Exported from a "use server" module → a directly-callable endpoint. Without
  // this gate any caller could enumerate families by guessing application ids
  // (IDOR). Staff-only, same guard as the review page that consumes it.
  const session = await auth()
  if (!canEdit(session?.user?.role)) return []

  const app = await prisma.membershipApplication.findUnique({
    where: { id: applicationId },
    select: { emailHash: true, mobileHash: true, applicantName: true },
  })
  if (!app) return []

  const out: MatchCandidate[] = []
  const seen = new Set<number>()
  const push = (familyId: number, familyName: string, reason: MatchCandidate["reason"]) => {
    if (seen.has(familyId)) return
    seen.add(familyId)
    out.push({ familyId, familyName, reason })
  }
  const sel = { familyId: true, family: { select: { name: true } } } as const

  if (app.emailHash) {
    for (const p of await prisma.person.findMany({ where: { emailHash: app.emailHash, archivedAt: null }, select: sel }))
      push(p.familyId, p.family.name, "email")
  }
  if (app.mobileHash) {
    for (const p of await prisma.person.findMany({ where: { mobileHash: app.mobileHash, archivedAt: null }, select: sel }))
      push(p.familyId, p.family.name, "mobile")
  }
  const surname = app.applicantName.trim().split(/\s+/).pop() ?? ""
  if (surname) {
    for (const p of await prisma.person.findMany({ where: { lastName: { equals: surname, mode: "insensitive" }, archivedAt: null }, select: sel, take: 10 }))
      push(p.familyId, p.family.name, "surname")
  }
  return out.slice(0, 10)
}

type PersonSeed = {
  firstName: string
  lastName: string
  role: FamilyRole
  gender: Gender | null
  dateOfBirth: string | null
  email: string | null
  mobile: string | null
  homePhone: string | null
  profession: string | null
  motherParish: string | null
  maritalStatus: string | null
}

// Split a free-text "First Middle Last" into first + last. Single-token names
// repeat the token as the last name so the (familyId, firstName, lastName)
// unique key still has a value.
function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/)
  const firstName = parts[0] ?? name.trim()
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : firstName
  return { firstName, lastName }
}

function toGender(s: string | null): Gender | null {
  if (!s) return null
  const v = s.toUpperCase()
  if (v === "MALE" || v === "M") return "MALE"
  if (v === "FEMALE" || v === "F") return "FEMALE"
  return "OTHER"
}

// Every person the form describes, in register order: applicant (HEAD), spouse,
// children, dependents. Values are plaintext here; encryption happens on write.
function personSeeds(p: MembershipPayload): PersonSeed[] {
  const seeds: PersonSeed[] = []
  seeds.push({
    ...splitName(p.personal.name), role: "HEAD", gender: p.personal.gender, dateOfBirth: p.personal.dateOfBirth,
    email: p.personal.email, mobile: p.personal.mobile, homePhone: null,
    profession: p.personal.qualificationProfession, motherParish: p.personal.motherParish, maritalStatus: p.personal.maritalStatus,
  })
  if (p.spouse) {
    seeds.push({
      ...splitName(p.spouse.name), role: "SPOUSE", gender: null, dateOfBirth: p.spouse.dateOfBirth,
      email: p.spouse.email, mobile: null, homePhone: null,
      profession: null, motherParish: p.spouse.parish, maritalStatus: null,
    })
  }
  for (const c of p.children) seeds.push({ ...splitName(c.name), role: "CHILD", gender: toGender(c.sex), dateOfBirth: c.dateOfBirth, email: null, mobile: null, homePhone: null, profession: c.occupation ?? null, motherParish: null, maritalStatus: null })
  for (const d of p.dependents) seeds.push({ ...splitName(d.name), role: "OTHER", gender: toGender(d.sex), dateOfBirth: d.dateOfBirth, email: null, mobile: null, homePhone: null, profession: null, motherParish: null, maritalStatus: null })
  return seeds
}

// Build a Person create payload, encrypting the at-rest fields (email + blind
// index, dateOfBirth, mobile, homePhone) exactly as person.ts does. profession /
// motherParish / maritalStatus are low-sensitivity and stored plaintext.
function personCreateData(familyId: number, s: PersonSeed) {
  const data: Record<string, unknown> = {
    familyId, firstName: s.firstName, lastName: s.lastName, role: s.role, classification: "MEMBER",
  }
  if (s.gender) data.gender = s.gender
  if (s.dateOfBirth) data.dateOfBirth = encrypt(s.dateOfBirth)
  if (s.email) { data.email = encrypt(s.email); data.emailHash = hmacEmail(s.email) }
  // mobileHash blind index: every mobile write path must set it or
  // findMembershipMatches can never equality-match this person by mobile —
  // same contract as emailHash above.
  if (s.mobile) { data.mobile = encrypt(s.mobile); data.mobileHash = hmacMobile(s.mobile) }
  if (s.homePhone) data.homePhone = encrypt(s.homePhone)
  if (s.profession) data.profession = s.profession
  if (s.motherParish) data.motherParish = s.motherParish
  if (s.maritalStatus) data.maritalStatus = s.maritalStatus
  return data
}

// Family.name is unique. On "create new" a same-surname family may already
// exist (common at a church) — disambiguate with the head's first name, then a
// counter, so approval never dies on a unique-constraint violation.
async function uniqueFamilyName(tx: { family: { findFirst: (a: unknown) => Promise<{ id: number } | null> } }, base: string, headFirstName: string): Promise<string> {
  const candidates = [base, `${headFirstName} ${base}`]
  for (const name of candidates) {
    if (!(await tx.family.findFirst({ where: { name } }))) return name
  }
  let n = 2
   
  while (true) {
    const name = `${base} (${n})`
    if (!(await tx.family.findFirst({ where: { name } }))) return name
    n++
  }
}

const FAMILY_FILL_FIELDS = ["address", "suburb", "state", "postcode"] as const

type MergeableFamily = {
  address: string | null
  suburb: string | null
  state: string | null
  postcode: string | null
  marriageDate: Date | null
  monthlyDues: Prisma.Decimal | null
  notes: string | null
}

// Build the Family.update patch for a merge approval: fill only blank contact
// fields (never clobber existing data, encrypting the new values same as
// person.ts), carry over marriageDate/monthlyDues if still unset, and append
// the new notes to any existing (decrypted) note block.
function buildFamilyPatch(
  fam: MergeableFamily,
  p: MembershipPayload,
  marriageDate: Date | null,
  dues: Prisma.Decimal | null,
  notes: string,
): Record<string, unknown> {
  const fill: Record<string, string | null> = {}
  for (const field of FAMILY_FILL_FIELDS) {
    if (!fam[field] && p.personal[field]) fill[field] = p.personal[field]
  }
  encryptFamilyFields(fill as never)
  const patch: Record<string, unknown> = { ...fill }
  if (!fam.marriageDate && marriageDate) patch.marriageDate = marriageDate
  if (fam.monthlyDues == null && dues != null) patch.monthlyDues = dues
  // Family.notes is encrypted at rest. Decrypt the existing note before
  // concatenating, then re-encrypt the whole block — concatenating raw
  // ciphertext with the plaintext note (and storing it unencrypted) both
  // corrupts the existing note and leaks the new PII in cleartext.
  const existingNotes = fam.notes ? safeDecrypt(fam.notes) : ""
  patch.notes = encrypt(existingNotes ? `${existingNotes}\n\n${notes}` : notes)
  return patch
}

// Only ACTIVE members count as "already present" — an archived person with
// the same name must not suppress creating the new active member, which
// would leave the applicant with no active Person row.
async function insertMissingMembers(
  tx: Pick<Prisma.TransactionClient, "person">,
  familyId: number,
  seeds: PersonSeed[],
): Promise<void> {
  const existing = await tx.person.findMany({ where: { familyId, archivedAt: null }, select: { firstName: true, lastName: true } })
  const key = (f: string, l: string) => `${f.toLowerCase()}|${l.toLowerCase()}`
  const have = new Set(existing.map((e) => key(e.firstName, e.lastName)))
  const missing = seeds.filter((s) => !have.has(key(s.firstName, s.lastName)))
  if (missing.length)
    await tx.person.createMany({ data: missing.map((s) => personCreateData(familyId, s)) as never })
}

// Create a new family for a "create" approval, encrypting fields exactly as
// person.ts does, then batch-insert the seeded members.
async function createApprovedFamily(
  tx: Pick<Prisma.TransactionClient, "family" | "person">,
  p: MembershipPayload,
  seeds: PersonSeed[],
  marriageDate: Date | null,
  dues: Prisma.Decimal | null,
  notes: string,
): Promise<number> {
  const name = await uniqueFamilyName(tx as never, deriveFamilyName(p), seeds[0].firstName)
  const famData: Record<string, unknown> = {
    name, address: p.personal.address, suburb: p.personal.suburb, state: p.personal.state, postcode: p.personal.postcode,
    marriageDate, monthlyDues: dues, notes,
  }
  encryptFamilyFields(famData as never)
  const fam = await tx.family.create({ data: famData as never })
  // Batch the family-member inserts into one round trip. No mirror
  // row / generated-id dependency, so createMany is safe.
  await tx.person.createMany({ data: seeds.map((s) => personCreateData(fam.id, s)) as never })
  return fam.id
}

// Merge the applicant's household into an existing active family.
async function mergeApprovedFamily(
  tx: Pick<Prisma.TransactionClient, "family" | "person">,
  familyId: number,
  p: MembershipPayload,
  seeds: PersonSeed[],
  marriageDate: Date | null,
  dues: Prisma.Decimal | null,
  notes: string,
): Promise<void> {
  const fam = await tx.family.findUnique({ where: { id: familyId } })
  if (!fam) throw new Error("Target family not found")
  // Merging into a soft-archived family would attach active members to a
  // deleted family and mutate its contact info.
  if (fam.archivedAt) throw new ArchivedFamilyError()

  const patch = buildFamilyPatch(fam, p, marriageDate, dues, notes)
  await tx.family.update({ where: { id: familyId }, data: patch })
  await insertMissingMembers(tx, familyId, seeds)
}

// Runs inside prisma.$transaction: atomically claims the pending application,
// creates or merges the family + members, and links it back. Throws
// AlreadyReviewedError / ArchivedFamilyError to abort the transaction with a
// clean, caller-mapped error.
async function runApprovalTransaction(
  tx: Prisma.TransactionClient,
  id: number,
  reviewerId: number,
  opts: { mode: "create" } | { mode: "merge"; familyId: number },
  p: MembershipPayload,
  seeds: PersonSeed[],
  marriageDate: Date | null,
  dues: Prisma.Decimal | null,
  notes: string,
): Promise<number> {
  // Atomically claim PENDING→APPROVED before creating the family/members. The
  // status read in approveMembershipApplication is outside the transaction,
  // so two concurrent approvals could both pass it and each create a family +
  // members. The guarded updateMany matches 0 rows for the loser, which
  // aborts it before any writes. linkedFamilyId is set below once the family
  // id is known, in the same transaction.
  const claimed = await tx.membershipApplication.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "APPROVED", reviewedById: reviewerId, reviewedAt: new Date() },
  })
  if (claimed.count === 0) throw new AlreadyReviewedError()

  let familyId: number
  if (opts.mode === "create") {
    familyId = await createApprovedFamily(tx, p, seeds, marriageDate, dues, notes)
  } else {
    familyId = opts.familyId
    await mergeApprovedFamily(tx, familyId, p, seeds, marriageDate, dues, notes)
  }

  // Status/reviewer already set by the atomic claim above; link the family.
  await tx.membershipApplication.update({ where: { id }, data: { linkedFamilyId: familyId } })
  return familyId
}

// Maps a rejected approval transaction to a caller-facing result, or null to
// signal the retry-once-on-P2002 loop should try again.
function approvalErrorResult(e: unknown, attempt: number): ActionResultWithSuccess | null {
  if (e instanceof AlreadyReviewedError) return { error: "This application has already been reviewed." }
  if (e instanceof ArchivedFamilyError) return { error: "That family is archived — restore it before merging, or create a new family." }
  if (isP2002(e) && attempt === 0) return null
  logger.error("approveMembershipApplication failed", { message: e instanceof Error ? e.message : "unknown" })
  return { error: "Another approval just used the same family — please try again." }
}

export async function approveMembershipApplication(
  id: number,
  opts: { mode: "create" } | { mode: "merge"; familyId: number },
): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Not authorized" }

  const app = await prisma.membershipApplication.findUnique({ where: { id } })
  if (!app) return { error: "Application not found" }
  if (app.status === "APPROVED" && app.linkedFamilyId) return { success: "Already approved" }
  // A rejected (or otherwise non-pending) application must not be approvable —
  // approving it would overwrite the review state and create orphan records.
  if (app.status !== "PENDING") return { error: "This application has already been reviewed." }

  const p = readPayload(app.payload as string)
  const reviewerId = actorId(session)
  const notes = buildNotesBlock(p, await getMembershipSettings())
  const dues = app.monthlyDues ?? null
  const seeds = personSeeds(p)
  const marriageDate = p.spouse?.dateOfMarriage ? new Date(p.spouse.dateOfMarriage) : null

  // Two admins approving concurrently can both pass uniqueFamilyName's
  // check-then-act read before either commits, then race on Family.name's
  // unique constraint — retry once on P2002 (pattern from dgrReceipt.ts) rather
  // than surfacing an unhandled 500.
  let familyId: number
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      familyId = await prisma.$transaction((tx) =>
        runApprovalTransaction(tx, id, reviewerId, opts, p, seeds, marriageDate, dues, notes)
      )
      break
    } catch (e) {
      const result = approvalErrorResult(e, attempt)
      if (result) return result
    }
  }

  await logAudit(reviewerId, "MEMBERSHIP_APPROVED", "MembershipApplication", id, { mode: opts.mode, familyId: familyId! })
  revalidatePath("/memberships")
  revalidatePath("/families")
  return { success: "Application approved" }
}

export async function rejectMembershipApplication(id: number, note?: string): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Not authorized" }

  const app = await prisma.membershipApplication.findUnique({ where: { id } })
  if (!app) return { error: "Application not found" }
  // Only a pending application can be rejected — rejecting an already-approved
  // one would strand the family/members it created.
  if (app.status !== "PENDING") return { error: "This application has already been reviewed." }
  const reviewerId = actorId(session)

  // Trim + cap the caller-supplied note, matching the family-update review path
  //: whitespace-only → null, oversized → truncated to 1000 chars.
  const reviewNote = note?.trim().slice(0, 1000) || null
  // Guarded updateMany so a concurrent approve/reject can't overwrite each
  // other — matches 0 rows if the status already changed.
  const rejected = await prisma.membershipApplication.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "REJECTED", reviewNote, reviewedById: reviewerId, reviewedAt: new Date() },
  })
  if (rejected.count === 0) return { error: "This application has already been reviewed." }
  await logAudit(reviewerId, "MEMBERSHIP_REJECTED", "MembershipApplication", id, { note: reviewNote ?? "" })
  revalidatePath("/memberships")
  return { success: "Application rejected" }
}
