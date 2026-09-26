"use server"

import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/lib/generated/prisma/client"
import { canEdit, isAdmin, canSeePastoralNotes } from "@/lib/roleGuard"
import { encrypt, hmacEmail, hmacMobile } from "@/lib/crypto"
import { logAudit } from "@/lib/audit"
import { parseOptimisticUpdatedAt, isP2034 } from "@/lib/validation"

const PersonSchema = z.object({
  firstName: z.string().min(1, "First name is required").max(100),
  lastName: z.string().min(1, "Last name is required").max(100),
  middleName: z.string().max(100).optional().transform((v) => v?.trim() || null),
  title: z.string().max(50).optional().transform((v) => v?.trim() || null),
  suffix: z.string().max(50).optional().transform((v) => v?.trim() || null),
  gender: z
    .enum(["MALE", "FEMALE", "OTHER"])
    .optional()
    .or(z.literal(""))
    .transform((v) => (v === "" || v === undefined ? null : v) as "MALE" | "FEMALE" | "OTHER" | null),
  dateOfBirth: z
    .string()
    .optional()
    .transform((v) => v?.trim() || null)
    // Stored as an encrypted string, but read paths do `new Date(...)` on it.
    // A malformed value becomes an Invalid Date that crashes the person/family
    // pages with a RangeError. Reject it at write instead of persisting
    // a landmine. `null` (no DOB) always passes.
    .refine((v) => v === null || !Number.isNaN(new Date(v).getTime()), "Invalid date of birth"),
  role: z.enum(["HEAD", "SPOUSE", "CHILD", "OTHER"]).default("OTHER"),
  classification: z.enum(["MEMBER", "VISITOR", "INACTIVE", "STUDENT"]).default("MEMBER"),
  email: z.string().email("Invalid email address").max(255).optional().or(z.literal("")).transform((v) => v || null),
  mobile: z.string().max(50).optional().transform((v) => v?.trim() || null),
  workPhone: z.string().max(50).optional().transform((v) => v?.trim() || null),
  homePhone: z.string().max(50).optional().transform((v) => v?.trim() || null),
  membershipDate: z
    .string()
    .optional()
    .transform((v) => (v ? new Date(v) : null))
    // Zod does not validate transform output — a malformed string yields an
    // Invalid Date that Postgres rejects with an unhandled 500. Reject it here.
    .refine((d) => d === null || !Number.isNaN(d.getTime()), "Invalid membership date"),
  baptismDate: z
    .string()
    .optional()
    .transform((v) => (v ? new Date(v) : null))
    .refine((d) => d === null || !Number.isNaN(d.getTime()), "Invalid baptism date"),
  // General notes share the 2000-char limit with Family.notes — both are brief
  // administrative annotations. pastoralNotes below is deliberately larger.
  notes: z.string().max(2000).optional().transform((v) => v?.trim() || null),
  // Stay optional (key may be absent) so the role-strip `delete` still type-checks,
  // but clear to null when submitted empty so a permitted role can blank the field.
  // 5000 (vs 2000 for general notes): pastoral records hold detailed care history,
  // not short admin notes — the larger cap is intentional, not an oversight.
  pastoralNotes: z.string().max(5000).optional().transform((v) => (v === undefined ? undefined : v.trim() || null)),
  emergencyContactName: z.string().max(100).optional().transform((v) => (v === undefined ? undefined : v.trim() || null)),
  emergencyContactPhone: z.string().max(50).optional().transform((v) => (v === undefined ? undefined : v.trim() || null)),
  emailConsent: z.string().optional().transform((v) => v === "on"),
  bankingName: z.string().max(100).optional().transform((v) => v?.trim() || null),
})

import type { ActionResult } from "./types"

// Encrypt-on-write for the Person PII fields, in place. Encrypts whichever PII
// keys are present and truthy — the pastoral-notes / emergency-contact keys are
// `delete`d before this runs when the role can't see them, so they're simply
// skipped. Shared by create + update so the field list can't drift.
function encryptPersonFields(data: {
  email?: string | null
  emailHash?: string | null
  dateOfBirth?: string | null
  mobile?: string | null
  mobileHash?: string | null
  workPhone?: string | null
  homePhone?: string | null
  notes?: string | null
  pastoralNotes?: string | null
  emergencyContactName?: string | null
  emergencyContactPhone?: string | null
}) {
  // Person.notes shares the same "brief administrative annotation"
  // shape as Family.notes, which IS encrypted (encryptFamilyFields) — this
  // was the odd one out, stored plaintext at rest.
  if (data.notes) data.notes = encrypt(data.notes)
  if (data.pastoralNotes) data.pastoralNotes = encrypt(data.pastoralNotes)
  if (data.emergencyContactName) data.emergencyContactName = encrypt(data.emergencyContactName)
  if (data.emergencyContactPhone) data.emergencyContactPhone = encrypt(data.emergencyContactPhone)
  // store the email blind index from the plaintext BEFORE encrypting, so
  // the person-export can match registrations on an indexed column. null clears
  // it when the email is removed.
  data.emailHash = data.email ? hmacEmail(data.email) : null
  if (data.email) data.email = encrypt(data.email)
  if (data.dateOfBirth) data.dateOfBirth = encrypt(data.dateOfBirth)
  // same before-encrypt blind-index pattern as email, for the
  // membership-application family-match lookup.
  data.mobileHash = data.mobile ? hmacMobile(data.mobile) : null
  if (data.mobile) data.mobile = encrypt(data.mobile)
  if (data.workPhone) data.workPhone = encrypt(data.workPhone)
  if (data.homePhone) data.homePhone = encrypt(data.homePhone)
}

export async function createPerson(
  familyId: number,
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" }

  // Validate the bound familyId — a stale/deleted id otherwise throws an
  // uncaught P2003 (raw 500) instead of a clean error. Archived
  // families are rejected too: a person created under one would be invisible
  // in every listing (they all filter on family archive state).
  const family = await prisma.family.findUnique({ where: { id: familyId }, select: { id: true, archivedAt: true } })
  if (!family || family.archivedAt) return { error: "Family not found" }

  const parsed = PersonSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const createData = { ...parsed.data }
  if (!canSeePastoralNotes(session?.user?.role)) {
    delete createData.pastoralNotes
    delete createData.emergencyContactName
    delete createData.emergencyContactPhone
  }
  encryptPersonFields(createData)
  // @@unique([familyId, firstName, lastName]) — a same-name person in this family
  // otherwise throws an unhandled P2002 (generic 500). Return a clean form error,
  // mirroring family.ts's unique-constraint handling.
  let person
  try {
    person = await prisma.person.create({ data: { ...createData, familyId, consentUpdatedAt: new Date() } })
  } catch (e: unknown) {
    if (typeof e === "object" && e !== null && "code" in e && (e as { code?: unknown }).code === "P2002") {
      return { error: "A person with this name already exists in this family" }
    }
    throw e
  }
  await logAudit(actorId(session), "PERSON_CREATED", "Person", person.id, { familyId })
  revalidatePath(`/families/${familyId}`)
  redirect(`/families/${familyId}`)
}

export async function updatePerson(
  id: number,
  familyId: number,
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" }

  // Scope the update to the expected family, mirroring deletePerson.
  // The caller binds the person's family at page load; a mismatched id/familyId
  // pair means the bound args were tampered with, so reject rather than update.
  const existing = await prisma.person.findUnique({ where: { id }, select: { familyId: true, archivedAt: true } })
  if (!existing || existing.familyId !== familyId) return { error: "Not found" }
  // A soft-archived person is not editable — the edit UI is unreachable for
  // archived records, but a direct action call must be rejected too.
  if (existing.archivedAt) return { error: "Not found" }

  const parsed = PersonSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const updateData = { ...parsed.data }
  if (!canSeePastoralNotes(session?.user?.role)) {
    delete updateData.pastoralNotes
    delete updateData.emergencyContactName
    delete updateData.emergencyContactPhone
  }
  encryptPersonFields(updateData)

  // Optimistic concurrency: the edit form submits the row's last-seen
  // updatedAt. Guard the write on it so two editors saving the same person
  // can't silently clobber each other — a mismatch matches 0 rows and the
  // caller is told to reload. Same pattern as transaction.ts::updateTransaction.
  const seenAt = parseOptimisticUpdatedAt(formData)
  // Renaming this person to collide with a sibling violates
  // @@unique([familyId, firstName, lastName]) → P2002. Return a clean form error
  // instead of a generic 500, mirroring family.ts / createPerson above.
  let result
  try {
    result = await prisma.person.updateMany({
      where: seenAt ? { id, updatedAt: seenAt } : { id },
      data: { ...updateData, consentUpdatedAt: new Date() },
    })
  } catch (e: unknown) {
    if (typeof e === "object" && e !== null && "code" in e && (e as { code?: unknown }).code === "P2002") {
      return { error: "A person with this name already exists in this family" }
    }
    throw e
  }
  if (result.count === 0) {
    return {
      error: "This person was changed by someone else since you opened it. Reload the page and reapply your edit.",
    }
  }
  await logAudit(actorId(session), "PERSON_UPDATED", "Person", id, { familyId })
  revalidatePath(`/people/${id}`)
  // the family detail page also renders this person's name/dob/email/
  // mobile — createPerson and deletePerson both revalidate it, updatePerson
  // was the odd one out (stale data on back-nav/second tab until an unrelated
  // mutation revalidated it).
  revalidatePath(`/families/${familyId}`)
  redirect(`/people/${id}`)
}

export async function deletePerson(id: number, familyId: number): Promise<ActionResult> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }

  // IDOR guard: supplied familyId must scope the delete, not just
  // drive revalidate/redirect.
  const person = await prisma.person.findUnique({ where: { id }, select: { familyId: true } })
  if (!person || person.familyId !== familyId) return { error: "Person not found" }

  // Transaction.personId, PettyCashReceipt.personId, DgrReceipt.personId are
  // all SetNull on delete — deleting an active donor would silently sever the
  // donor link on tax-deductible DGR receipts and giving records.
  // Mirror deleteFamily's linked-record guard (family.ts) and steer to
  // archiving the family instead, which soft-archives this person too.
  //
  // Count + delete run in one Serializable transaction, mirroring
  // deleteAccountGroup / deleteFund: those FKs are SET NULL, so a
  // giving/receipt row inserted between a separate count and the delete would
  // slip through and be silently orphaned. Only Serializable closes that
  // window — it aborts one side (P2034) when a concurrent insert conflicts
  // with the read.
  const linkedMsg = (n: number) =>
    `Cannot delete — ${n} linked giving/receipt record(s) reference this person. Archive the family instead.`
  let linkedCount = 0
  try {
    linkedCount = await prisma.$transaction(
      async (tx) => {
        const [txCount, dgrCount, pettyCashCount] = await Promise.all([
          tx.transaction.count({ where: { personId: id } }),
          tx.dgrReceipt.count({ where: { personId: id } }),
          tx.pettyCashReceipt.count({ where: { personId: id } }),
        ])
        const total = txCount + dgrCount + pettyCashCount
        if (total > 0) return total
        await tx.person.delete({ where: { id } })
        return 0
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  } catch (e) {
    // P2034 = lost to a concurrent giving/receipt write referencing this
    // person. Surface the same "archive instead" message — the safe outcome, a
    // referencing row now exists (count unknown from the aborted read).
    if (isP2034(e)) return { error: linkedMsg(1) }
    throw e
  }
  if (linkedCount > 0) return { error: linkedMsg(linkedCount) }

  await logAudit(actorId(session), "PERSON_DELETED", "Person", id, { familyId })
  revalidatePath(`/families/${familyId}`)
  redirect(`/families/${familyId}`)
}
