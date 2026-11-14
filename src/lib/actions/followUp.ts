"use server"

// Pastoral follow-up tasks (#305, #613). Visibility (PO decision #611): ADMIN +
// PASTOR see and manage every task; an assignee (an editor: ADMIN | PASTOR | OFFICE_ADMIN)
// sees only tasks assigned to them and may change only their status. Every
// query and write merges followUpVisibilityWhere into its `where`, so a by-id
// call for a task the caller can't see matches no row and answers "Not found"
// (IDOR guard, no existence leak). title/notes are encrypted at rest; audit
// rows are written in the same transaction and carry ids/flags only.
// Notifications are in-app only (countMyDueFollowUps); no email in v1.

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { logAuditTx } from "@/lib/audit"
import { encrypt, safeDecrypt } from "@/lib/crypto"
import { DECRYPTION_ERROR_PLACEHOLDER as DECRYPTION_ERROR } from "@/lib/cryptoCore"
import { sydneyToday, sydneyTodayYMD } from "@/lib/dates"
import { FollowUpStatus } from "@/lib/generated/prisma/enums"
import type { Prisma } from "@/lib/generated/prisma/client"
import {
  PASTORAL_PATH,
  followUpVisibilityWhere,
  liveFollowUpTarget,
  type PastoralViewer,
} from "@/lib/pastoralAccess"
import { prisma } from "@/lib/prisma"
import { canBeFollowUpAssignee, canManageFollowUps } from "@/lib/roleGuard"
import { isValidPgId } from "@/lib/validation"
import { isValidYMD, utcDateToYmd, ymdToUtcDate } from "@/lib/venueUsage"
import type { ActionResultWithSuccess } from "./types"

const UNAUTHORIZED = "Unauthorized"
const NOT_FOUND = "Not found"
const TITLE_MAX = 200
const NOTES_MAX = 4000
/** Hard cap on one list read (DoS bound; the UI pages within it). */
const LIST_MAX = 500
const STATUSES = new Set<string>(Object.values(FollowUpStatus))

const pgId = z.number().int().positive().max(2147483647)

/** Fields shared by create and update. Strings are trimmed; blank optional fields become null. */
const TaskFields = z.object({
  title: z.string().trim().min(1, "Enter a title").max(TITLE_MAX, `Title must be ${TITLE_MAX} characters or fewer`),
  notes: z
    .string()
    .trim()
    .max(NOTES_MAX, `Notes must be ${NOTES_MAX} characters or fewer`)
    .nullish()
    .transform((v) => v || null),
  assigneeId: pgId.nullish().transform((v) => v ?? null),
  dueDate: z
    .string()
    .trim()
    .nullish()
    .transform((v) => v || null)
    .refine((v) => v === null || isValidYMD(v), "Enter a valid due date"),
})

/** Create input: the shared fields plus exactly one target (person OR family). */
const CreateSchema = TaskFields.extend({
  personId: pgId.nullish().transform((v) => v ?? null),
  familyId: pgId.nullish().transform((v) => v ?? null),
}).refine((v) => (v.personId === null) !== (v.familyId === null), "Choose a person or a family")

export type FollowUpTaskInput = z.input<typeof CreateSchema>
/**
 * Update input. Full replace: every key is required (null clears it), so a
 * caller that forgets a field can't silently unassign or undate a task.
 */
export type FollowUpTaskUpdate = { title: string; notes: string | null; assigneeId: number | null; dueDate: string | null }
const UPDATE_KEYS = ["title", "notes", "assigneeId", "dueDate"] as const

/** A decrypted task as the UI sees it. Dates are `YYYY-MM-DD` (Sydney calendar days). */
export type FollowUpTaskView = {
  id: number
  title: string
  notes: string | null
  status: FollowUpStatus
  dueDate: string | null
  /** Open or in progress with a due date before today (Sydney). */
  overdue: boolean
  personId: number | null
  personName: string | null
  familyId: number | null
  familyName: string | null
  assigneeId: number | null
  assigneeName: string | null
  completedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

const VIEW_SELECT = {
  id: true,
  title: true,
  notes: true,
  status: true,
  dueDate: true,
  personId: true,
  familyId: true,
  assigneeId: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  person: { select: { firstName: true, lastName: true } },
  family: { select: { name: true } },
  assignee: { select: { name: true } },
} satisfies Prisma.FollowUpTaskSelect

type ViewRow = Prisma.FollowUpTaskGetPayload<{ select: typeof VIEW_SELECT }>

/**
 * The signed-in viewer, or null when there is no session or no visible task
 * scope (wrong role).
 */
async function currentViewer(): Promise<{ viewer: PastoralViewer; scope: { assigneeId?: number } } | null> {
  const session = await auth()
  const role = session?.user?.role
  // Role check first (DB-free, no id needed), so a wrong-role session never
  // reaches actorId.
  if (!session?.user || followUpVisibilityWhere({ id: 0, role }) === null) return null
  const viewer: PastoralViewer = { id: actorId(session), role }
  const scope = followUpVisibilityWhere(viewer)
  return scope ? { viewer, scope } : null
}

/**
 * Decrypt and shape one task row.
 * @param row selected task row
 * @param todayYMD Sydney today, for the overdue flag
 */
function toView(row: ViewRow, todayYMD: string): FollowUpTaskView {
  const due = row.dueDate ? utcDateToYmd(row.dueDate) : null
  const open = row.status === FollowUpStatus.OPEN || row.status === FollowUpStatus.IN_PROGRESS
  return {
    id: row.id,
    title: safeDecrypt(row.title),
    notes: row.notes ? safeDecrypt(row.notes) : null,
    status: row.status,
    dueDate: due,
    overdue: open && due !== null && due < todayYMD,
    personId: row.personId,
    personName: row.person ? `${row.person.firstName} ${row.person.lastName}` : null,
    familyId: row.familyId,
    familyName: row.family?.name ?? null,
    assigneeId: row.assigneeId,
    assigneeName: row.assignee?.name ?? null,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * Null when `assigneeId` is a live login allowed to hold a task, else an error.
 * @param assigneeId candidate assignee (null = unassigned, always fine)
 */
async function checkAssignee(assigneeId: number | null): Promise<string | null> {
  if (assigneeId === null) return null
  const user = await prisma.user.findUnique({ where: { id: assigneeId }, select: { role: true, archivedAt: true } })
  if (!user || user.archivedAt || !canBeFollowUpAssignee(user.role)) return "Choose a staff member with edit access."
  return null
}

/**
 * Revalidate the pastoral list and the target's profile page.
 * @param target the task's person or family
 */
function revalidateTask(target: { personId: number | null; familyId: number | null }): void {
  revalidatePath(PASTORAL_PATH)
  if (target.personId) revalidatePath(`/people/${target.personId}`)
  if (target.familyId) revalidatePath(`/families/${target.familyId}`)
}

/**
 * Create a follow-up task on one person or family. ADMIN | PASTOR only. The
 * assignee (optional) must be a live login with an editor role.
 * @param input title, notes, target (personId XOR familyId), assigneeId, dueDate (`YYYY-MM-DD`)
 * @returns the new task id, or `{ error }`
 */
export async function createFollowUpTask(input: FollowUpTaskInput): Promise<{ error: string } | { id: number }> {
  const session = await auth()
  if (!canManageFollowUps(session?.user?.role)) return { error: UNAUTHORIZED }
  const parsed = CreateSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const d = parsed.data

  if (d.personId !== null) {
    const p = await prisma.person.findUnique({ where: { id: d.personId }, select: { archivedAt: true } })
    if (!p || p.archivedAt) return { error: "Person not found" }
  } else if (d.familyId !== null) {
    const f = await prisma.family.findUnique({ where: { id: d.familyId }, select: { archivedAt: true } })
    if (!f || f.archivedAt) return { error: "Family not found" }
  }
  const assigneeError = await checkAssignee(d.assigneeId)
  if (assigneeError) return { error: assigneeError }

  const actor = actorId(session)
  const id = await prisma.$transaction(async (tx) => {
    const created = await tx.followUpTask.create({
      data: {
        title: encrypt(d.title),
        notes: d.notes ? encrypt(d.notes) : null,
        personId: d.personId,
        familyId: d.familyId,
        assigneeId: d.assigneeId,
        dueDate: d.dueDate ? ymdToUtcDate(d.dueDate) : null,
        createdById: actor,
      },
      select: { id: true },
    })
    await logAuditTx(tx, actor, "FOLLOW_UP_CREATED", "FollowUpTask", created.id, {
      personId: d.personId,
      familyId: d.familyId,
      assigneeId: d.assigneeId,
    })
    return created.id
  })
  revalidateTask(d)
  return { id }
}

/**
 * Edit a task's title, notes, assignee and due date. ADMIN | PASTOR only; the
 * target person/family is fixed at create. A stored value that can't be
 * decrypted is never overwritten by its own placeholder text.
 * @param id FollowUpTask.id
 * @param input title, notes, assigneeId, dueDate
 */
export async function updateFollowUpTask(id: number, input: FollowUpTaskUpdate): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!canManageFollowUps(session?.user?.role)) return { error: UNAUTHORIZED }
  if (!isValidPgId(id)) return { error: NOT_FOUND }
  if (typeof input !== "object" || input === null || !UPDATE_KEYS.every((k) => k in input)) {
    return { error: "Missing task fields" }
  }
  const parsed = TaskFields.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const d = parsed.data

  const existing = await prisma.followUpTask.findFirst({
    where: { id, ...liveFollowUpTarget() },
    select: { title: true, notes: true, assigneeId: true, dueDate: true, personId: true, familyId: true },
  })
  if (!existing) return { error: NOT_FOUND }
  const oldTitle = safeDecrypt(existing.title)
  const oldNotes = existing.notes ? safeDecrypt(existing.notes) : null
  if ((oldTitle === DECRYPTION_ERROR && d.title === DECRYPTION_ERROR) || (oldNotes === DECRYPTION_ERROR && d.notes === DECRYPTION_ERROR)) {
    return { error: "This task's stored text can't be read. Re-enter it, or ask an administrator to check the encryption keys." }
  }
  const assigneeChanged = existing.assigneeId !== d.assigneeId
  if (assigneeChanged) {
    const assigneeError = await checkAssignee(d.assigneeId)
    if (assigneeError) return { error: assigneeError }
  }
  const oldDue = existing.dueDate ? utcDateToYmd(existing.dueDate) : null
  const data: Prisma.FollowUpTaskUncheckedUpdateManyInput = {}
  if (oldTitle !== d.title) data.title = encrypt(d.title)
  if (oldNotes !== d.notes) data.notes = d.notes ? encrypt(d.notes) : null
  if (assigneeChanged) data.assigneeId = d.assigneeId
  if (oldDue !== d.dueDate) data.dueDate = d.dueDate ? ymdToUtcDate(d.dueDate) : null
  if (Object.keys(data).length === 0) return { success: "No changes" }

  const actor = actorId(session)
  const updated = await prisma.$transaction(async (tx) => {
    const r = await tx.followUpTask.updateMany({ where: { id, ...liveFollowUpTarget() }, data })
    if (r.count === 0) return false
    await logAuditTx(tx, actor, "FOLLOW_UP_UPDATED", "FollowUpTask", id, {
      fields: Object.keys(data),
      ...(assigneeChanged ? { assigneeFrom: existing.assigneeId, assigneeTo: d.assigneeId } : {}),
    })
    return true
  })
  if (!updated) return { error: NOT_FOUND }
  revalidateTask(existing)
  return { success: "Task saved" }
}

/**
 * Move a task to `status`. Managers, or the task's assignee. DONE stamps
 * completedAt/completedById; any other status clears them. The write re-checks
 * visibility, so a task reassigned after the read can't be changed by its old
 * assignee.
 * @param id FollowUpTask.id
 * @param status target status
 */
export async function setFollowUpStatus(id: number, status: FollowUpStatus): Promise<ActionResultWithSuccess> {
  const ctx = await currentViewer()
  if (!ctx) return { error: UNAUTHORIZED }
  if (!isValidPgId(id) || !STATUSES.has(status)) return { error: NOT_FOUND }
  const where: Prisma.FollowUpTaskWhereInput = { id, ...ctx.scope, ...liveFollowUpTarget() }
  const existing = await prisma.followUpTask.findFirst({
    where,
    select: { status: true, personId: true, familyId: true },
  })
  if (!existing) return { error: NOT_FOUND }
  if (existing.status === status) return { success: "No changes" }

  const done = status === FollowUpStatus.DONE
  const updated = await prisma.$transaction(async (tx) => {
    const r = await tx.followUpTask.updateMany({
      where: { ...where, status: existing.status },
      data: { status, completedAt: done ? new Date() : null, completedById: done ? ctx.viewer.id : null },
    })
    if (r.count === 0) return false
    await logAuditTx(tx, ctx.viewer.id, "FOLLOW_UP_STATUS_CHANGED", "FollowUpTask", id, {
      from: existing.status,
      to: status,
    })
    return true
  })
  if (!updated) return { error: "This task changed. Refresh and try again." }
  revalidateTask(existing)
  return { success: "Status updated" }
}

/**
 * Permanently delete a task. ADMIN | PASTOR only; the audit row keeps the
 * fact (ids only) once the task is gone.
 * @param id FollowUpTask.id
 */
export async function deleteFollowUpTask(id: number): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!canManageFollowUps(session?.user?.role)) return { error: UNAUTHORIZED }
  if (!isValidPgId(id)) return { error: NOT_FOUND }
  const actor = actorId(session)
  const target = await prisma.$transaction(async (tx) => {
    const row = await tx.followUpTask.findUnique({ where: { id }, select: { personId: true, familyId: true } })
    if (!row) return null
    const r = await tx.followUpTask.deleteMany({ where: { id } })
    if (r.count === 0) return null
    await logAuditTx(tx, actor, "FOLLOW_UP_DELETED", "FollowUpTask", id, row)
    return row
  })
  if (!target) return { error: NOT_FOUND }
  revalidateTask(target)
  return { success: "Task deleted" }
}

/** Filters for {@link listFollowUpTasks}. All optional; omitted = no filter. */
export type FollowUpListFilter = {
  /** Only these statuses. */
  statuses?: FollowUpStatus[]
  /** Only tasks on this person. */
  personId?: number
  /** Only tasks on this family. */
  familyId?: number
  /** Only tasks assigned to the caller (managers' "my tasks" view). */
  mine?: boolean
}

/**
 * Tasks visible to the caller (managers: all; assignees: their own), on live
 * people/families, ordered by due date (undated last) then newest. Capped at
 * 500 rows.
 * @param filter optional status / target / mine filters
 */
export async function listFollowUpTasks(
  filter: FollowUpListFilter = {},
): Promise<{ error: string } | { tasks: FollowUpTaskView[] }> {
  const ctx = await currentViewer()
  if (!ctx) return { error: UNAUTHORIZED }
  const statuses = (filter.statuses ?? []).filter((s) => STATUSES.has(s))
  // Asked for statuses but none valid: match nothing, never widen to "all".
  if (filter.statuses && filter.statuses.length > 0 && statuses.length === 0) return { tasks: [] }
  if (filter.personId !== undefined && !isValidPgId(filter.personId)) return { tasks: [] }
  if (filter.familyId !== undefined && !isValidPgId(filter.familyId)) return { tasks: [] }
  const where: Prisma.FollowUpTaskWhereInput = {
    ...liveFollowUpTarget(),
    ...(statuses.length > 0 ? { status: { in: statuses } } : {}),
    ...(filter.personId !== undefined ? { personId: filter.personId } : {}),
    ...(filter.familyId !== undefined ? { familyId: filter.familyId } : {}),
    ...(filter.mine ? { assigneeId: ctx.viewer.id } : {}),
    // Last, so the visibility scope always wins over a caller-supplied filter.
    ...ctx.scope,
  }
  const rows = await prisma.followUpTask.findMany({
    where,
    select: VIEW_SELECT,
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take: LIST_MAX,
  })
  const today = sydneyTodayYMD()
  return { tasks: rows.map((r) => toView(r, today)) }
}

/**
 * One task by id, or "Not found" when it doesn't exist, its target is archived,
 * or the caller may not see it (no existence leak).
 * @param id FollowUpTask.id
 */
export async function getFollowUpTask(id: number): Promise<{ error: string } | { task: FollowUpTaskView }> {
  const ctx = await currentViewer()
  if (!ctx) return { error: UNAUTHORIZED }
  if (!isValidPgId(id)) return { error: NOT_FOUND }
  const row = await prisma.followUpTask.findFirst({
    where: { id, ...liveFollowUpTarget(), ...ctx.scope },
    select: VIEW_SELECT,
  })
  if (!row) return { error: NOT_FOUND }
  return { task: toView(row, sydneyTodayYMD()) }
}

/**
 * In-app notification count: the caller's own open/in-progress tasks due today
 * or earlier (Sydney). 0 for roles that can't hold tasks.
 */
export async function countMyDueFollowUps(): Promise<number> {
  const ctx = await currentViewer()
  if (!ctx) return 0
  return prisma.followUpTask.count({
    where: {
      ...liveFollowUpTarget(),
      assigneeId: ctx.viewer.id,
      status: { in: [FollowUpStatus.OPEN, FollowUpStatus.IN_PROGRESS] },
      dueDate: { lte: sydneyToday() },
    },
  })
}
