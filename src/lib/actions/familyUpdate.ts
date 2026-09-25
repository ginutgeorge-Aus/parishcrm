"use server"

import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { canEdit } from "@/lib/roleGuard"
import { encrypt, safeDecrypt, hmacEmail, hmacMobile } from "@/lib/crypto"
import { logAudit } from "@/lib/audit"
import { generateInviteToken, hashInviteToken } from "@/lib/familyUpdateToken"
import { FamilyUpdatePayloadSchema, type FamilyUpdateMember } from "@/lib/familyUpdatePayload"
import { encryptFamilyFields } from "@/lib/familyFields"
import { parseISODate } from "@/lib/formatting"
import { sendFamilyUpdateInviteEmail } from "@/lib/email"
import { verifyFormToken } from "@/lib/formToken"
import { rateLimit } from "@/lib/rateLimit"
import { headers } from "next/headers"
import type { Prisma } from "@/lib/generated/prisma/client"
import type { ActionResultWithSuccess } from "./types"

// Thrown inside the approval transaction when the atomic PENDING→APPROVED claim
// matches 0 rows (a concurrent approval already won). Caught to return a clean
// message instead of surfacing an unexpected 500.
class AlreadyReviewedError extends Error {}

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000

export async function sendFamilyUpdateInvite(
  familyId: number,
  email: string
): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" }

  const family = await prisma.family.findUnique({ where: { id: familyId }, select: { id: true, name: true } })
  if (!family) return { error: "Family not found" }

  const parsedEmail = z.string().email().max(255).safeParse(email.trim())
  if (!parsedEmail.success) return { error: "A valid email address is required" }

  // One unreviewed submission at a time: if a member already submitted an
  // update that's still PENDING, don't mint a second invite. Otherwise a second
  // submission (built from a different snapshot) can be approved out of order and
  // silently overwrite the newer one's PII with stale values. Review or reject the
  // outstanding submission first.
  const pending = await prisma.familyUpdateSubmission.findFirst({
    where: { familyId, status: "PENDING" }, select: { id: true },
  })
  if (pending)
    return { error: "This family already has a submitted update awaiting review. Review or reject it before sending another invite." }

  const rawToken = generateInviteToken()
  const tokenHash = hashInviteToken(rawToken)

  // Build the invite link off AUTH_URL and validate it BEFORE revoking the
  // existing invite — a misconfigured AUTH_URL would otherwise leave the family
  // with no live invite and mail an "undefined/..." link.
  let url: string
  try {
    url = new URL(`/family/update/${rawToken}`, process.env.AUTH_URL).toString()
  } catch {
    return { error: "Server misconfiguration: AUTH_URL is not set or invalid" }
  }

  // One live invite per family: supersede any outstanding SENT invites so an old
  // forwarded link can't coexist with the new one.
  await prisma.familyUpdateInvite.updateMany({
    where: { familyId, status: "SENT" }, data: { status: "REVOKED" },
  })

  await prisma.familyUpdateInvite.create({
    data: {
      familyId,
      tokenHash,
      email: encrypt(parsedEmail.data),
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      createdById: actorId(session),
    },
  })

  await sendFamilyUpdateInviteEmail(parsedEmail.data, url, family.name)

  await logAudit(actorId(session), "FAMILY_INVITE_SENT", "Family", familyId)
  revalidatePath(`/families/${familyId}`)
  return { success: "Invite sent" }
}

type SubmitInput = {
  token: string
  ip: string
  website?: string   // honeypot
  formToken?: string // signed timing token
  payload: unknown
}

class InviteNoLongerValid extends Error {}

export async function submitFamilyUpdate(input: SubmitInput): Promise<ActionResultWithSuccess> {
  // Honeypot: a real user never fills the hidden "website" field. Generic error.
  if (input.website && input.website.trim().length > 0) return { error: "Submission failed" }

  // Rightmost x-forwarded-for is appended by the trusted reverse proxy (not spoofable);
  // fall back to the explicit input.ip (used in tests) then "unknown".
  const hdrIp = (await headers()).get("x-forwarded-for")?.split(",").at(-1)?.trim()
  const ip = hdrIp || input.ip || "unknown"

  // 5 submits / IP / 10 min — generous for a human, throttles scripted abuse.
  if (!rateLimit(`familyUpdate:${ip}`, 5, 10 * 60_000)) return { error: "Too many requests" }

  // Timing trap: reject missing/forged/too-fast/stale tokens.
  if (verifyFormToken(input.formToken, Date.now()) !== "ok") {
    return { error: "Your session expired. Please refresh and try again." }
  }

  const invite = await prisma.familyUpdateInvite.findUnique({
    where: { tokenHash: hashInviteToken(input.token) },
    include: { family: { select: { archivedAt: true } } },
  })
  // Token not found or expired — these don't race (expiry is immutable once set).
  if (!invite || invite.expiresAt < new Date()) {
    return { error: "This link is no longer valid." }
  }
  // a stale invite for a family archived (soft-deleted) after the
  // invite was sent must not be accepted — same generic message as an
  // expired/revoked link so a public caller can't distinguish the reason.
  if (invite.family?.archivedAt) {
    return { error: "This link is no longer valid." }
  }

  const parsed = FamilyUpdatePayloadSchema.safeParse(input.payload)
  if (!parsed.success) return { error: "Please check the form — some required fields are missing." }

  // Status check moved inside the transaction — concurrent requests with the
  // same token both pass a pre-check, but only the first atomically flips
  // status from SENT→SUBMITTED. Second request gets count=0 → error.
  let submitted: boolean
  try {
    submitted = await prisma.$transaction(async (tx) => {
      const updated = await tx.familyUpdateInvite.updateMany({
        where: { id: invite.id, status: "SENT" },
        data: { status: "SUBMITTED", submittedAt: new Date() },
      })
      if (updated.count === 0) return false
      // a merge may have reparented this invite (and deleted its source
      // family) since the pre-check read. The claim above waits on any in-flight
      // merge's row lock, so this re-read sees the invite's current family.
      // Throw (not return) so the SENT→SUBMITTED claim rolls back.
      const current = await tx.familyUpdateInvite.findUnique({
        where: { id: invite.id },
        select: { familyId: true, family: { select: { archivedAt: true } } },
      })
      if (!current || current.family?.archivedAt) throw new InviteNoLongerValid()
      await tx.familyUpdateSubmission.create({
        data: {
          familyId: current.familyId,
          inviteId: invite.id,
          // Encrypt the PII-bearing payload at rest — stored as a JSON
          // string scalar; readers decrypt via readSubmissionPayload().
          payload: encrypt(JSON.stringify(parsed.data)),
          status: "PENDING",
        },
      })
      return true
    })
  } catch (e) {
    if (!(e instanceof InviteNoLongerValid)) throw e
    submitted = false
  }
  if (!submitted) return { error: "This link is no longer valid." }

  return { success: "submitted" }
}

// Encrypt-on-write for member PII (mirrors person.ts encryptPersonFields, scoped
// to the family-editable fields only). Mutates in place.
function encryptMemberFields(d: Record<string, unknown>) {
  // blind index from the plaintext email before it is encrypted; null
  // clears it when the email is removed.
  d.emailHash = d.email ? hmacEmail(d.email as string) : null
  // same before-encrypt blind-index pattern for mobile.
  d.mobileHash = d.mobile ? hmacMobile(d.mobile as string) : null
  for (const k of ["email", "dateOfBirth", "mobile", "workPhone", "homePhone"]) {
    if (d[k]) d[k] = encrypt(d[k] as string)
  }
}

// Map an allowlisted member to a Prisma person payload — disallowed fields are
// already absent (schema dropped them), but we build the object explicitly so
// nothing extra can slip through even if the schema changes.
function memberToPersonData(m: FamilyUpdateMember) {
  const d: Record<string, unknown> = {
    title: m.title ?? null, firstName: m.firstName, middleName: m.middleName ?? null,
    lastName: m.lastName, suffix: m.suffix ?? null, gender: m.gender ?? null,
    dateOfBirth: m.dateOfBirth ?? null, email: m.email ?? null, mobile: m.mobile ?? null,
    workPhone: m.workPhone ?? null, homePhone: m.homePhone ?? null,
  }
  encryptMemberFields(d)
  return d
}

export async function approveFamilyUpdate(submissionId: number): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" }

  const submission = await prisma.familyUpdateSubmission.findUnique({
    where: { id: submissionId },
    include: { family: { select: { archivedAt: true } } },
  })
  if (!submission) return { error: "Submission not found" }
  if (submission.status !== "PENDING") return { error: "This submission has already been reviewed." }
  // defense in depth — the family could have been archived after the
  // submission was created but before an admin reviewed it. Approving would
  // resurrect PII into a soft-deleted family, so block it here too.
  if (submission.family?.archivedAt) {
    return { error: "This family has been archived and can no longer be updated." }
  }

  // Payload is encrypted at rest; decode before validating. Legacy rows
  // stored a plaintext JSON object — fall through to it when not an enc string.
  let raw: unknown = submission.payload
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(safeDecrypt(raw))
    } catch {
      return { error: "This submission is malformed and cannot be applied." }
    }
  }
  // Re-validate the stored payload through the allowlist — it is untrusted user
  // input even now (defence in depth; the trust boundary is re-applied at apply).
  const parsed = FamilyUpdatePayloadSchema.safeParse(raw)
  if (!parsed.success) return { error: "This submission is malformed and cannot be applied." }

  const famContact = parsed.data.family
  // Reuse family.ts's encryptFamilyFields so the encrypted-field list
  // stays in one place — mutates famData in place, encrypting truthy fields.
  const famData: {
    address: string | null; suburb: string | null; state: string | null
    postcode: string | null; homePhone: string | null
    marriageDate: Date | null
  } = {
    address: famContact.address ?? null, suburb: famContact.suburb ?? null,
    state: famContact.state ?? null, postcode: famContact.postcode ?? null,
    homePhone: famContact.homePhone ?? null,
    marriageDate: null,
  }
  // Encrypts only the PII string fields in place; marriageDate is a DateTime
  // (like joinedDate) and stays plaintext — set it after, from the ISO string.
  encryptFamilyFields(famData)
  famData.marriageDate = parseISODate(famContact.marriageDate)

  try {
    await prisma.$transaction(async (tx) => {
      // Atomically claim PENDING→APPROVED before touching members. The status
      // check at line 178 is outside the transaction, so two concurrent
      // approvals could both pass it and each insert the members. The guarded
      // updateMany matches 0 rows for the loser, aborting it before any writes
      // — no duplicate members.
      const claimed = await tx.familyUpdateSubmission.updateMany({
        where: { id: submissionId, status: "PENDING" },
        data: { status: "APPROVED", reviewedById: actorId(session), reviewedAt: new Date() },
      })
      if (claimed.count === 0) throw new AlreadyReviewedError()
      await tx.family.update({ where: { id: submission.familyId }, data: famData })
      for (const m of parsed.data.members) {
        const data = memberToPersonData(m)
        if (m.personId) {
          // Ownership guard: only update a Person that belongs to this family AND
          // is still active. Without the archivedAt filter, a self-update payload
          // carrying an archived member's personId would silently overwrite that
          // soft-deleted record's PII. A non-match (archived / wrong family
          // / deleted) matches 0 rows → P2025 → the "no longer exist" path below.
          await tx.person.update({ where: { id: m.personId, familyId: submission.familyId, archivedAt: null }, data })
        } else {
          await tx.person.create({
            data: { ...data, familyId: submission.familyId, consentUpdatedAt: new Date() } as Prisma.PersonUncheckedCreateInput,
          })
        }
      }
    })
  } catch (e: unknown) {
    if (e instanceof AlreadyReviewedError) return { error: "This submission has already been reviewed." }
    const code = typeof e === "object" && e !== null && "code" in e ? (e as { code?: unknown }).code : undefined
    if (code === "P2002") {
      return { error: "A member with the same name already exists in this family. Resolve it before approving." }
    }
    // a referenced Person may have been deleted or moved to a different
    // family between submission and approval — the ownership-guarded
    // `person.update` above then matches 0 rows and Prisma throws P2025.
    if (code === "P2025") {
      return { error: "One or more people in this update no longer exist. Ask the family to resubmit." }
    }
    throw e
  }

  await logAudit(actorId(session), "FAMILY_UPDATE_APPROVED", "Family", submission.familyId, { submissionId })
  revalidatePath(`/families/${submission.familyId}`)
  revalidatePath("/families/updates")
  return { success: "Changes applied" }
}

export async function rejectFamilyUpdate(submissionId: number, note?: string): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" }

  const submission = await prisma.familyUpdateSubmission.findUnique({ where: { id: submissionId } })
  if (!submission) return { error: "Submission not found" }
  if (submission.status !== "PENDING") return { error: "This submission has already been reviewed." }

  // Atomically claim PENDING→REJECTED. The status check above is outside any
  // transaction, so a concurrent approveFamilyUpdate could flip PENDING→APPROVED
  // (applying the members) in the window before this write — an unconditional
  // update would then clobber it back to REJECTED. The guarded updateMany matches
  // 0 rows once someone else has moved it off PENDING, mirroring approve.
  const claimed = await prisma.$transaction(async (tx) => {
    const updated = await tx.familyUpdateSubmission.updateMany({
      where: { id: submissionId, status: "PENDING" },
      data: {
        status: "REJECTED",
        reviewNote: note?.trim().slice(0, 1000) || null,
        reviewedById: actorId(session),
        reviewedAt: new Date(),
      },
    })
    if (updated.count === 0) return 0
    // revoke the invite token in the same transaction. Without this,
    // the public link's invite row stays SENT forever — the invite's only
    // other status writers are re-invite supersede and first-submit, so a
    // rejected submission left the public page rendering "awaiting review"
    // indefinitely with no way to signal the outcome or issue a fresh link
    // under the same URL. REVOKED reuses the existing "link no longer valid"
    // branch the public page already handles.
    await tx.familyUpdateInvite.update({
      where: { id: submission.inviteId },
      data: { status: "REVOKED" },
    })
    return updated.count
  })
  if (claimed === 0) return { error: "This submission has already been reviewed." }

  await logAudit(actorId(session), "FAMILY_UPDATE_REJECTED", "Family", submission.familyId, { submissionId })
  // Revalidate the family detail page too (parity with approveFamilyUpdate) so
  // its pending-submission indicator clears immediately after a rejection.
  revalidatePath(`/families/${submission.familyId}`)
  revalidatePath("/families/updates")
  return { success: "Submission rejected" }
}
