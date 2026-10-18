"use server"

import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { canEdit, isAdmin } from "@/lib/roleGuard"
import { toCents } from "@/lib/formatting"
import { encryptFamilyFields } from "@/lib/familyFields"
import { logAudit, logAuditManyTx, logAuditTx } from "@/lib/audit"
import { MONEY_DECIMAL_RE, parseOptimisticUpdatedAt } from "@/lib/validation"
import { retentionFloor } from "@/lib/retention"
import { isFeatureOn } from "@/lib/featureFlags"

// Upper bound on monthly subscription dues — sanity cap, not a business rule.
const MAX_MONTHLY_DUES_DOLLARS = 100_000

const FamilySchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  // Optional — non-member families have no member number. Blank → null.
  memberNo: z.string().max(50).optional().transform((v) => v?.trim() || null),
  address: z.string().max(500).optional().transform((v) => v?.trim() || null),
  suburb: z.string().max(100).optional().transform((v) => v?.trim() || null),
  state: z.string().max(50).optional().transform((v) => v?.trim() || null),
  postcode: z.string().max(20).optional().transform((v) => v?.trim() || null),
  homePhone: z.string().max(50).optional().transform((v) => v?.trim() || null),
  status: z.enum(["ACTIVE", "INACTIVE", "VISITOR"]).default("ACTIVE"),
  joinedDate: z
    .string()
    .optional()
    .transform((v) => (v ? new Date(v) : null))
    // Zod does not validate transform output — a malformed string yields an
    // Invalid Date that Postgres rejects with an unhandled 500. Reject it here.
    .refine((d) => d === null || !Number.isNaN(d.getTime()), "Invalid joined date"),
  marriageDate: z
    .string()
    .optional()
    .transform((v) => (v ? new Date(v) : null))
    .refine((d) => d === null || !Number.isNaN(d.getTime()), "Invalid marriage date"),
  // Expected monthly subscription dues (custom per family). Blank → null (no obligation).
  monthlyDues: z
    .string()
    .optional()
    // Keep as a validated string and pass it straight to the Decimal(10,2)
    // column — never parseFloat into a JS number before storage.
    .transform((v) => v?.trim() || null)
    .refine(
      (v) => v === null || (MONEY_DECIMAL_RE.test(v) && toCents(v) <= MAX_MONTHLY_DUES_DOLLARS * 100),
      "Monthly dues must be a positive amount"
    ),
  notes: z.string().max(2000).optional().transform((v) => v?.trim() || null),
})

import type { ActionResult } from "./types"

// Encrypt-on-write for the Family PII fields, in place. Empty/whitespace-only
// values are already normalised to null by the schema, so the truthy guards skip
// them — an empty string is never written as plaintext PII (AUDIT-021).
// Shared by create + update so the field list can't drift between them.
// Definition lives in lib/familyFields.ts so approveFamilyUpdate can reuse it
// without importing a non-async symbol from this "use server" module.

/** Create a family from the new-family form. While Subscription dues is off, no dues are written. */
export async function createFamily(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" }

  const parsed = FamilySchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const createData = { ...parsed.data }
  // The dues field is hidden while Subscription dues is off: write no dues
  // (no auto-fill). Checked server-side too, so a stale form can't set dues
  // after the feature is off. A submitted amount is FamilySchema-validated
  // (MONEY_DECIMAL_RE + cap) above.
  if (!formData.has("monthlyDues") || !(await isFeatureOn("dues"))) createData.monthlyDues = null
  encryptFamilyFields(createData)

  let newId: number
  try {
    const family = await prisma.family.create({ data: createData })
    newId = family.id
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : ""
    if (msg.includes("Unique constraint") && msg.includes("memberNo"))
      return { error: "Member number already in use" }
    if (msg.includes("Unique constraint"))
      return { error: "A family with this name already exists" }
    throw e
  }

  await logAudit(
    actorId(session),
    "FAMILY_CREATED",
    "Family",
    newId,
    { monthlyDues: createData.monthlyDues }
  )

  revalidatePath("/families")
  redirect(`/families/${newId}`)
}

/** Update a family from the edit form, with an optimistic-concurrency check. Keeps stored dues while Subscription dues is off. */
export async function updateFamily(
  id: number,
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" }

  const existing = await prisma.family.findUnique({ where: { id }, select: { id: true, archivedAt: true } })
  if (!existing) return { error: "Not found" }
  // A soft-archived family is frozen — the UI never offers its edit form, but
  // updateFamily is a directly-callable "use server" action, so block a direct
  // call from mutating an archived family (defense-in-depth, same guard as
  // approveMembershipApplication's archived-merge check). Return the
  // not-found shape so archived state isn't leaked to the caller.
  if (existing.archivedAt) return { error: "Not found" }

  const parsed = FamilySchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const updateData: Partial<typeof parsed.data> = { ...parsed.data }
  // The dues field is hidden while Subscription dues is off: keep the stored
  // value. Checked server-side too, so a stale form can't overwrite it.
  if (!formData.has("monthlyDues") || !(await isFeatureOn("dues"))) delete updateData.monthlyDues
  encryptFamilyFields(updateData)

  // Optimistic concurrency: see transaction.ts::updateTransaction.
  const seenAt = parseOptimisticUpdatedAt(formData)
  let result
  try {
    result = await prisma.family.updateMany({
      where: seenAt ? { id, updatedAt: seenAt } : { id },
      data: updateData,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : ""
    if (msg.includes("Unique constraint") && msg.includes("memberNo"))
      return { error: "Member number already in use" }
    if (msg.includes("Unique constraint"))
      return { error: "A family with this name already exists" }
    throw e
  }
  if (result.count === 0) {
    return {
      error: "This family was changed by someone else since you opened it. Reload the page and reapply your edit.",
    }
  }

  await logAudit(
    actorId(session),
    "FAMILY_UPDATED",
    "Family",
    id,
    { monthlyDues: updateData.monthlyDues }
  )

  revalidatePath("/families")
  revalidatePath(`/families/${id}`)
  redirect(`/families/${id}`)
}

/**
 * Permanently delete a family (ADMIN only), allowed only for a family archived
 * past the retention floor with no linked transactions or active members.
 * Member clearances cascade with it and are each audited as CLEARANCE_REMOVED,
 * in the same transaction as the delete.
 * @param id Family.id
 */
export async function deleteFamily(id: number): Promise<ActionResult> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }

  const target = await prisma.family.findUnique({ where: { id }, select: { id: true } })
  if (!target) return { error: "Not found" }

  const actor = actorId(session)
  const blocked = await prisma.$transaction(async (tx): Promise<{ error: string } | null> => {
    // Lock the family, then its members in id order (archiveFamily's order, so
    // the two can't deadlock), before any check. Each racing write then either
    // committed first — and the checks below see it — or waits until we
    // commit: an unarchive (UPDATE Family/Person), a new linked transaction
    // (its FK takes KEY SHARE on the family row), or a new clearance
    // (upsertClearance takes FOR SHARE on the person row).
    // nosemgrep: crm-no-raw-sql — row lock; Prisma has no locking API
    const locked = await tx.$queryRaw<{ archivedAt: Date | null }[]>`
      SELECT "archivedAt" FROM "Family" WHERE id = ${id} FOR UPDATE`
    if (locked.length === 0) return { error: "Not found" }
    // nosemgrep: crm-no-raw-sql — row lock; Prisma has no locking API
    await tx.$queryRaw`SELECT id FROM "Person" WHERE "familyId" = ${id} ORDER BY id FOR UPDATE`

    // Transaction.familyId is SetNull on delete — deleting a family with giving
    // history would silently orphan those rows and break annual statements.
    // Block and steer to archive instead, mirroring deleteAccount.
    const txCount = await tx.transaction.count({ where: { familyId: id } })
    if (txCount > 0) {
      return { error: `Cannot delete — ${txCount} transaction(s) linked to this family. Archive it instead.` }
    }

    // Person.familyId is onDelete: Cascade — deleting a family with members would
    // silently and permanently destroy every person record. Block and steer
    // to archive, which soft-archives the family and its members together —
    // EXCEPT once the family has sat archived past the 7-year ATO retention floor
    //: the archived-families page then offers permanent deletion, and it
    // must actually work rather than always failing on the members it archived
    // alongside the family. Still block if any member is somehow not archived.
    //
    // The retention floor applies regardless of member count: a family still holds
    // its own encrypted PII (address/suburb/state/postcode/homePhone/notes), so a
    // zero-member family must also be archived and past the floor before hard
    // delete. Previously this guard was nested under `memberCount > 0`, letting a
    // same-day archive+delete of a memberless family destroy PII early.
    const archivedAt = locked[0].archivedAt
    const pastRetention = archivedAt !== null && archivedAt < retentionFloor()
    const memberCount = await tx.person.count({ where: { familyId: id } })
    if (!pastRetention) {
      if (memberCount > 0) {
        return { error: `Cannot delete — ${memberCount} member(s) in this family. Archive it instead.` }
      }
      return { error: "Cannot delete — a family can only be permanently deleted 7 years after it was archived. Archive it instead." }
    }
    // Past the floor: still block if any member somehow remains active (the archive
    // step should have archived them alongside the family).
    const activeMemberCount = await tx.person.count({ where: { familyId: id, archivedAt: null } })
    if (activeMemberCount > 0) {
      return { error: `Cannot delete — ${activeMemberCount} active member(s) in this family. Archive it instead.` }
    }

    // Clearances cascade with the members (family -> person -> clearance), so
    // capture them under the member locks and audit each as CLEARANCE_REMOVED
    // in this transaction — a failed audit write rolls the delete back.
    const removedClearances = await tx.personClearance.findMany({
      where: { person: { familyId: id } },
      select: { id: true, type: true, personId: true },
    })
    await tx.family.delete({ where: { id } })
    await logAuditTx(tx, actor, "FAMILY_DELETED", "Family", id)
    await logAuditManyTx(
      tx,
      removedClearances.map((c) => ({
        userId: actor,
        action: "CLEARANCE_REMOVED",
        resourceType: "Person",
        resourceId: c.personId,
        metadata: { type: c.type, clearanceId: c.id, cascade: true },
      })),
    )
    return null
  })
  if (blocked) return blocked
  revalidatePath("/families")
  redirect("/families")
}

export async function archiveFamily(id: number): Promise<ActionResult> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }

  const family = await prisma.family.findUnique({ where: { id }, select: { id: true } })
  if (!family) return { error: "Not found" }

  // Family + members archive together or not at all — a partial failure
  // must never leave an archived family with still-active members.
  const now = new Date()
  // Members are locked in id order first: bulk WWCC verify takes Person
  // locks in the same order, so the two can't deadlock.
  await prisma.$transaction([
    prisma.family.update({ where: { id }, data: { archivedAt: now } }),
    // nosemgrep: crm-no-raw-sql — row lock; Prisma has no locking API
    prisma.$queryRaw`SELECT id FROM "Person" WHERE "familyId" = ${id} ORDER BY id FOR UPDATE`,
    prisma.person.updateMany({ where: { familyId: id }, data: { archivedAt: now } }),
  ])
  await logAudit(actorId(session), "FAMILY_ARCHIVED", "Family", id)
  revalidatePath("/families")
  // parity with updateFamily, which revalidates both the list and the
  // detail page — a tab open on /families/[id] otherwise keeps showing
  // pre-archive state until an unrelated mutation revalidates it.
  revalidatePath(`/families/${id}`)
  redirect("/families")
}

export async function unarchiveFamily(id: number): Promise<ActionResult> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }

  const family = await prisma.family.findUnique({ where: { id }, select: { id: true } })
  if (!family) return { error: "Not found" }

  // Atomic with members — same rationale as archiveFamily.
  await prisma.$transaction([
    prisma.family.update({ where: { id }, data: { archivedAt: null } }),
    prisma.person.updateMany({ where: { familyId: id }, data: { archivedAt: null } }),
  ])
  await logAudit(actorId(session), "FAMILY_UNARCHIVED", "Family", id)
  revalidatePath("/families")
  revalidatePath("/families/archived")
  // same parity gap as archiveFamily above.
  revalidatePath(`/families/${id}`)
}

export type MergePreview = {
  source: { id: number; name: string; memberNo: string | null }
  target: { id: number; name: string; memberNo: string | null }
  peopleCount: number
  transactionCount: number
  conflicts: string[]
}

const ARCHIVED_MERGE_ERROR = "Archived families can't be merged — unarchive first."

class ArchivedDuringMerge extends Error {}

async function _previewMergeCore(
  sourceId: number,
  targetId: number
): Promise<MergePreview | { error: string }> {
  if (sourceId === targetId) return { error: "Source and target must be different families." }

  const select = { id: true, name: true, memberNo: true, archivedAt: true } as const
  const [sourceRow, targetRow] = await Promise.all([
    prisma.family.findUnique({ where: { id: sourceId }, select }),
    prisma.family.findUnique({ where: { id: targetId }, select }),
  ])
  if (!sourceRow || !targetRow) return { error: "Family not found." }
  // deleting an archived source would bypass the retention floor that
  // deleteFamily enforces, and merging into an archived target attaches active
  // people/giving to a soft-deleted family. Unarchive first.
  if (sourceRow.archivedAt || targetRow.archivedAt) return { error: ARCHIVED_MERGE_ERROR }
  const source = { id: sourceRow.id, name: sourceRow.name, memberNo: sourceRow.memberNo }
  const target = { id: targetRow.id, name: targetRow.name, memberNo: targetRow.memberNo }

  const [sourcePeople, targetPeople, transactionCount, pendingSubmissions] = await Promise.all([
    // Include archived people on BOTH sides: the merge moves every source Person
    // (archived or not) into the target, and Person(familyId,firstName,lastName)
    // is a plain (non-partial) unique that blocks a name collision against an
    // archived target member too. Filtering `archivedAt: null` here reported zero
    // conflicts for a merge that then failed on P2002 and got mislabeled as a
    // transient concurrency error, permanently stuck.
    prisma.person.findMany({ where: { familyId: sourceId }, select: { firstName: true, lastName: true } }),
    prisma.person.findMany({ where: { familyId: targetId }, select: { firstName: true, lastName: true } }),
    prisma.transaction.count({ where: { familyId: sourceId } }),
    // Deleting the source family cascade-deletes its FamilyUpdateInvite /
    // FamilyUpdateSubmission rows. Block the merge while a self-update awaits
    // review so it isn't silently lost — admin must approve/reject first.
    prisma.familyUpdateSubmission.count({ where: { familyId: sourceId, status: "PENDING" } }),
  ])

  const targetNames = new Set(targetPeople.map((p) => `${p.firstName} ${p.lastName}`))
  const conflicts = sourcePeople
    .filter((p) => targetNames.has(`${p.firstName} ${p.lastName}`))
    .map((p) => `${p.firstName} ${p.lastName}`)
  if (pendingSubmissions > 0) {
    conflicts.push(
      `${pendingSubmissions} pending self-update submission${pendingSubmissions === 1 ? "" : "s"} on the source family — review or reject before merging`
    )
  }

  return { source, target, peopleCount: sourcePeople.length, transactionCount, conflicts }
}

export async function previewMerge(
  sourceId: number,
  targetId: number
): Promise<MergePreview | { error: string }> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }
  return _previewMergeCore(sourceId, targetId)
}

export async function mergeFamilies(
  sourceId: number,
  targetId: number
): Promise<{ success?: true; error?: string; conflicts?: string[] }> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }
  if (sourceId === targetId) return { error: "Source and target must be different families." }

  const preview = await _previewMergeCore(sourceId, targetId)
  if ("error" in preview) return { error: preview.error }
  if (preview.conflicts.length > 0) return { conflicts: preview.conflicts }

  try {
    await prisma.$transaction(async (tx) => {
      // re-check archival inside the tx. The no-op UPDATE row-locks both
      // families, so a concurrent archiveFamily waits for this merge to commit
      // instead of racing it; count < 2 means one was archived after preview.
      const live = await tx.family.updateMany({
        where: { id: { in: [sourceId, targetId] }, archivedAt: null },
        data: { archivedAt: null },
      })
      if (live.count !== 2) throw new ArchivedDuringMerge()
      await tx.person.updateMany({ where: { familyId: sourceId }, data: { familyId: targetId } })
      await tx.transaction.updateMany({ where: { familyId: sourceId }, data: { familyId: targetId } })
      // MembershipApplication.linkedFamilyId is SetNull on delete — deleting the
      // source without relinking wouldn't fail the FK, but it would silently
      // orphan any membership application that pointed at it.
      await tx.membershipApplication.updateMany({ where: { linkedFamilyId: sourceId }, data: { linkedFamilyId: targetId } })
      // FamilyUpdateInvite + FamilyUpdateSubmission are onDelete: Cascade on
      // familyId — deleting the source would silently destroy any still-live
      // invite and the entire approved/rejected self-update audit trail. Reparent
      // them to the surviving family instead. Preview already blocks the
      // merge while a PENDING submission awaits review, so only settled
      // history is moved here.
      await tx.familyUpdateInvite.updateMany({ where: { familyId: sourceId }, data: { familyId: targetId } })
      await tx.familyUpdateSubmission.updateMany({ where: { familyId: sourceId }, data: { familyId: targetId } })
      await tx.family.delete({ where: { id: sourceId } })
    })
  } catch (e: unknown) {
    if (e instanceof ArchivedDuringMerge) return { error: ARCHIVED_MERGE_ERROR }
    if (typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002") {
      return { conflicts: ["Merge failed: a duplicate person name was added concurrently. Please re-run preview."] }
    }
    throw e
  }

  await logAudit(
    actorId(session),
    "FAMILY_MERGED",
    "Family",
    targetId,
    { sourceId, sourceName: preview.source.name }
  )

  revalidatePath("/families")
  // a tab open on either the source or target family detail page keeps
  // showing pre-merge members/giving until an unrelated mutation revalidates
  // it — revalidate both (source now 404s, which is fine — revalidatePath on
  // a since-deleted route is a no-op cache clear).
  revalidatePath(`/families/${targetId}`)
  revalidatePath(`/families/${sourceId}`)
  return { success: true }
}
