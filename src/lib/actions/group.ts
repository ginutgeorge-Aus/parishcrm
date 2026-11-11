"use server"

// Groups & ministries (#303) writes. View = canViewGroups (pages). Group
// create/edit/archive/restore and leader-login assignment = canManageGroups.
// Membership changes = canManageGroupMembers: group managers on any group,
// EVENT_ORGANISER only on groups linked to their login (GroupLeaderAccess).
// Every mutation writes its audit row with logAuditTx inside the same
// transaction, so a change never commits without its history.

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import type { Session } from "next-auth"
import type { z } from "zod"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { logAuditTx } from "@/lib/audit"
import { assertNotDemo } from "@/lib/demoMode"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@/lib/generated/prisma/client"
import { UserRole } from "@/lib/generated/prisma/enums"
import { canEditOrOrganise, canManageGroups } from "@/lib/roleGuard"
import { canManageGroupMembers } from "@/lib/groupAccess"
import { isP2002, isValidPgId } from "@/lib/validation"
import { GroupFormSchema, MemberFieldsSchema, MIN_PERSON_SEARCH, PERSON_SEARCH_LIMIT } from "@/lib/groups"
import type { ActionResult } from "./types"

const ENTITY = "Group"
const UNAUTHORIZED = "Unauthorized"
const GROUP_GONE = "Group not found"
const PERSON_GONE = "Person not found"
const DUPLICATE_NAME = "A group with this name already exists (it may be archived)"

type Guard = { error: string } | { session: Session | null }

/** A person a group editor may add, as shown in the search results. */
export type GroupCandidate = { id: number; name: string; familyName: string }

/** Demo block + group-manager role. Module-private ("use server" exports must be async actions). */
async function manager(): Promise<Guard> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!canManageGroups(session?.user?.role)) return { error: UNAUTHORIZED }
  return { session }
}

/**
 * Demo block, coarse role check (DB-free), valid id, then the per-group check:
 * managers pass for any group, an organiser only for a group linked to them.
 */
async function memberEditor(groupId: number): Promise<Guard> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  const role = session?.user?.role
  if (!canEditOrOrganise(role)) return { error: UNAUTHORIZED }
  if (!isValidPgId(groupId)) return { error: "Invalid group" }
  if (!(await canManageGroupMembers(actorId(session), groupId, role))) return { error: UNAUTHORIZED }
  return { session }
}

/**
 * Take FOR SHARE on the live group row, so a concurrent archive (an UPDATE
 * needing the row lock) waits until this transaction commits. False when the
 * group is missing or archived.
 */
async function lockLiveGroup(tx: Prisma.TransactionClient, groupId: number): Promise<boolean> {
  // nosemgrep: crm-no-raw-sql — row lock; Prisma has no locking API
  const rows = await tx.$queryRaw<{ id: number }[]>`
    SELECT id FROM "Group" WHERE id = ${groupId} AND "archivedAt" IS NULL FOR SHARE`
  return rows.length > 0
}

/** Parse the group form; returns the data or the first validation message. */
function parseGroupForm(formData: FormData): { error: string } | { data: z.output<typeof GroupFormSchema> } {
  const parsed = GroupFormSchema.safeParse({
    name: formData.get("name") ?? "",
    category: formData.get("category") ?? "",
    description: formData.get("description") ?? undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" }
  return { data: parsed.data }
}

/** Revalidate every page that shows this group's membership. */
function revalidateGroup(groupId: number, personId?: number) {
  revalidatePath("/groups")
  revalidatePath(`/groups/${groupId}`)
  revalidatePath("/my-groups")
  revalidatePath(`/my-groups/${groupId}`)
  if (personId) revalidatePath(`/people/${personId}`)
}

/** Create a group, then go to it. canManageGroups-gated. */
export async function createGroup(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await manager()
  if ("error" in g) return { error: g.error }
  const form = parseGroupForm(formData)
  if ("error" in form) return { error: form.error }

  let id: number
  try {
    id = await prisma.$transaction(async (tx) => {
      const row = await tx.group.create({ data: form.data, select: { id: true } })
      await logAuditTx(tx, actorId(g.session), "GROUP_CREATED", ENTITY, row.id, { category: form.data.category })
      return row.id
    })
  } catch (e) {
    if (isP2002(e)) return { error: DUPLICATE_NAME }
    throw e
  }
  revalidatePath("/groups")
  redirect(`/groups/${id}`)
}

/** Edit a live group's name, category and description. canManageGroups-gated. */
export async function updateGroup(id: number, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await manager()
  if ("error" in g) return { error: g.error }
  if (!isValidPgId(id)) return { error: "Invalid group" }
  const form = parseGroupForm(formData)
  if ("error" in form) return { error: form.error }

  try {
    const count = await prisma.$transaction(async (tx) => {
      const r = await tx.group.updateMany({ where: { id, archivedAt: null }, data: form.data })
      if (r.count > 0) await logAuditTx(tx, actorId(g.session), "GROUP_UPDATED", ENTITY, id, { category: form.data.category })
      return r.count
    })
    if (count === 0) return { error: GROUP_GONE }
  } catch (e) {
    if (isP2002(e)) return { error: DUPLICATE_NAME }
    throw e
  }
  revalidateGroup(id)
  redirect(`/groups/${id}`)
}

/**
 * Archive (or restore) a group. Archived groups drop out of the list and the
 * organiser portal but keep their members. canManageGroups-gated.
 */
async function setArchived(id: number, archive: boolean): Promise<ActionResult> {
  const g = await manager()
  if ("error" in g) return { error: g.error }
  if (!isValidPgId(id)) return { error: "Invalid group" }
  const count = await prisma.$transaction(async (tx) => {
    const r = await tx.group.updateMany({
      where: { id, archivedAt: archive ? null : { not: null } },
      data: { archivedAt: archive ? new Date() : null },
    })
    if (r.count > 0) await logAuditTx(tx, actorId(g.session), archive ? "GROUP_ARCHIVED" : "GROUP_RESTORED", ENTITY, id)
    return r.count
  })
  // Already archived/restored by someone else: no row changed, no audit.
  if (count === 0) return { error: GROUP_GONE }
  revalidateGroup(id)
}

/** Archive a live group. canManageGroups-gated. */
export async function archiveGroup(id: number): Promise<ActionResult> {
  return setArchived(id, true)
}

/** Restore an archived group. canManageGroups-gated. */
export async function restoreGroup(id: number): Promise<ActionResult> {
  return setArchived(id, false)
}

/**
 * Search live people by name to add to a group (not already members). Names
 * and family name only, never contact details, so a linked organiser sees no
 * more than they need. Gated like the membership actions.
 */
export async function searchGroupCandidates(groupId: number, query: string): Promise<{ error: string } | { people: GroupCandidate[] }> {
  const g = await memberEditor(groupId)
  if ("error" in g) return { error: g.error }
  const q = typeof query === "string" ? query.trim().slice(0, 100) : ""
  if (q.length < MIN_PERSON_SEARCH) return { people: [] }
  const terms = q.split(/\s+/).slice(0, 3)
  const people = await prisma.person.findMany({
    where: {
      archivedAt: null,
      groupMemberships: { none: { groupId } },
      AND: terms.map((t) => ({
        OR: [
          { firstName: { contains: t, mode: "insensitive" as const } },
          { lastName: { contains: t, mode: "insensitive" as const } },
        ],
      })),
    },
    select: { id: true, firstName: true, lastName: true, family: { select: { name: true } } },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: PERSON_SEARCH_LIMIT,
  })
  return { people: people.map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}`, familyName: p.family.name })) }
}

/** Add a live person to a live group as a MEMBER. Already a member = success. */
export async function addGroupMember(groupId: number, personId: number): Promise<ActionResult> {
  const g = await memberEditor(groupId)
  if ("error" in g) return { error: g.error }
  if (!isValidPgId(personId)) return { error: "Invalid person" }

  const result = await prisma.$transaction(async (tx) => {
    if (!(await lockLiveGroup(tx, groupId))) return GROUP_GONE
    // FOR SHARE on the person too: an archive (UPDATE on Person) waits for this
    // insert, or the insert is refused if the archive committed first.
    // nosemgrep: crm-no-raw-sql — row lock; Prisma has no locking API
    const person = await tx.$queryRaw<{ id: number }[]>`
      SELECT id FROM "Person" WHERE id = ${personId} AND "archivedAt" IS NULL FOR SHARE`
    if (person.length === 0) return PERSON_GONE
    // skipDuplicates (ON CONFLICT DO NOTHING) avoids a P2002 aborting the tx.
    const { count } = await tx.groupMember.createMany({ data: [{ groupId, personId }], skipDuplicates: true })
    if (count > 0) await logAuditTx(tx, actorId(g.session), "GROUP_MEMBER_ADDED", ENTITY, groupId, { personId })
    return null
  })
  if (result) return { error: result }
  revalidateGroup(groupId, personId)
}

/** Change a member's role (LEADER | MEMBER) and free-text title. */
export async function updateGroupMember(groupId: number, personId: number, role: string, title: string): Promise<ActionResult> {
  const g = await memberEditor(groupId)
  if ("error" in g) return { error: g.error }
  if (!isValidPgId(personId)) return { error: "Invalid person" }
  const parsed = MemberFieldsSchema.safeParse({ role, title: title ?? "" })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" }

  const result = await prisma.$transaction(async (tx) => {
    if (!(await lockLiveGroup(tx, groupId))) return GROUP_GONE
    const { count } = await tx.groupMember.updateMany({ where: { groupId, personId }, data: parsed.data })
    if (count === 0) return "Not a member of this group"
    await logAuditTx(tx, actorId(g.session), "GROUP_MEMBER_UPDATED", ENTITY, groupId, { personId, role: parsed.data.role })
    return null
  })
  if (result) return { error: result }
  revalidateGroup(groupId, personId)
}

/** Remove a person from a group (not a member = success, no audit). */
export async function removeGroupMember(groupId: number, personId: number): Promise<ActionResult> {
  const g = await memberEditor(groupId)
  if ("error" in g) return { error: g.error }
  if (!isValidPgId(personId)) return { error: "Invalid person" }

  const result = await prisma.$transaction(async (tx) => {
    if (!(await lockLiveGroup(tx, groupId))) return GROUP_GONE
    const { count } = await tx.groupMember.deleteMany({ where: { groupId, personId } })
    if (count > 0) await logAuditTx(tx, actorId(g.session), "GROUP_MEMBER_REMOVED", ENTITY, groupId, { personId })
    return null
  })
  if (result) return { error: result }
  revalidateGroup(groupId, personId)
}

/**
 * Let a live EVENT_ORGANISER login manage this group's membership from
 * /my-groups. canManageGroups-gated. Already linked = success.
 */
export async function addGroupLeaderAccess(groupId: number, userId: number): Promise<ActionResult> {
  const g = await manager()
  if ("error" in g) return { error: g.error }
  if (!isValidPgId(groupId) || !isValidPgId(userId)) return { error: "Invalid input" }
  // findFirst so an archived (soft-deleted) user can't be linked by id.
  const user = await prisma.user.findFirst({ where: { id: userId, archivedAt: null }, select: { role: true } })
  if (!user) return { error: "User not found" }
  if (user.role !== UserRole.EVENT_ORGANISER) return { error: "User is not an event organiser" }

  const result = await prisma.$transaction(async (tx) => {
    if (!(await lockLiveGroup(tx, groupId))) return GROUP_GONE
    const { count } = await tx.groupLeaderAccess.createMany({ data: [{ groupId, userId }], skipDuplicates: true })
    if (count > 0) await logAuditTx(tx, actorId(g.session), "GROUP_LEADER_ACCESS_ADDED", ENTITY, groupId, { targetUserId: userId })
    return null
  })
  if (result) return { error: result }
  revalidateGroup(groupId)
}

/** Remove a leader login's access to a group (missing link = success). canManageGroups-gated. */
export async function removeGroupLeaderAccess(groupId: number, userId: number): Promise<ActionResult> {
  const g = await manager()
  if ("error" in g) return { error: g.error }
  if (!isValidPgId(groupId) || !isValidPgId(userId)) return { error: "Invalid input" }
  // Allowed on an archived group too, so access can always be withdrawn.
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.groupLeaderAccess.deleteMany({ where: { groupId, userId } })
    if (count > 0) await logAuditTx(tx, actorId(g.session), "GROUP_LEADER_ACCESS_REMOVED", ENTITY, groupId, { targetUserId: userId })
  })
  revalidateGroup(groupId)
}
