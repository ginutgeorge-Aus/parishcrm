"use server"

// Volunteer roster writes (#622, part of #306). Roles, services and slots are
// staff-only (canManageRoster). Assign / unassign / suggest are open to staff
// and to a group leader login for roles tied to their group
// (canEditRosterRole). Rules come from src/lib/roster.ts. Every mutation
// writes its audit row with logAuditTx in the same transaction.
// Double-booking is blocked by RosterAssignment @@unique([serviceId, personId]);
// over-filling a slot by a FOR UPDATE lock on the slot row while counting.

import { revalidatePath } from "next/cache"
import type { Session } from "next-auth"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { logAuditTx } from "@/lib/audit"
import { utcYmd, sundaysBetween } from "@/lib/dates"
import { assertNotDemo } from "@/lib/demoMode"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@/lib/generated/prisma/client"
import { canEditOrOrganise, canManageRoster } from "@/lib/roleGuard"
import { canEditRosterRole } from "@/lib/rosterAccess"
import {
  DEFAULT_SUNDAY_TITLE, MAX_SUNDAYS_PER_RUN, ROSTER_CONFLICT_MESSAGES, RosterRoleSchema, RosterServiceSchema,
  SlotNeededSchema, SundayRangeSchema, findConflict, isSundayYMD, openPlaces, serviceTimes, suggestAssignees,
  type RosterSuggestion, type UnavailableRange,
} from "@/lib/roster"
import { isP2002, isP2003, isValidPgId } from "@/lib/validation"
import type { ActionResultWithSuccess } from "./types"

const UNAUTHORIZED = "Unauthorized"
const ROLE_GONE = "Roster role not found"
const SERVICE_GONE = "Service not found"
const SLOT_GONE = "Slot not found"
const ASSIGNMENT_GONE = "Assignment not found"
const GROUP_GONE = "Group not found"
const DUPLICATE_ROLE = "A roster role with this name already exists (it may be archived)"
const DUPLICATE_SERVICE = "A Sunday service already starts at that time"

type Guard = { error: string } | { session: Session | null }

/** Demo block + staff roster role. Module-private ("use server" exports must be async actions). */
async function manager(): Promise<Guard> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!canManageRoster(session?.user?.role)) return { error: UNAUTHORIZED }
  return { session }
}

/**
 * Demo block and coarse role check (DB-free) for the assignment actions; the
 * per-group check runs once the slot's role is known (see {@link slotEditor}).
 */
async function assignerSession(): Promise<Guard> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!canEditOrOrganise(session?.user?.role)) return { error: UNAUTHORIZED }
  return { session }
}

/** May this session edit the roster for a role drawn from `groupId`? */
async function mayEditGroupRole(session: Session | null, groupId: number): Promise<boolean> {
  return canEditRosterRole(actorId(session), groupId, session?.user?.role)
}

/** The slot plus what the assignment actions need: its role's group and its service's day. */
async function loadSlot(slotId: number) {
  return prisma.rosterSlot.findUnique({
    where: { id: slotId },
    select: {
      id: true,
      serviceId: true,
      roleId: true,
      role: { select: { groupId: true, archivedAt: true } },
      service: { select: { date: true } },
    },
  })
}

type LoadedSlot = NonNullable<Awaited<ReturnType<typeof loadSlot>>>

/** Guard + load for slot-scoped assignment actions: valid id, slot exists, caller may edit its role. */
async function slotEditor(slotId: number): Promise<{ error: string } | { session: Session | null; slot: LoadedSlot }> {
  const g = await assignerSession()
  if ("error" in g) return g
  if (!isValidPgId(slotId)) return { error: "Invalid slot" }
  const slot = await loadSlot(slotId)
  if (!slot) return { error: SLOT_GONE }
  if (!(await mayEditGroupRole(g.session, slot.role.groupId))) return { error: UNAUTHORIZED }
  return { session: g.session, slot }
}

/** Revalidate the roster pages (built in #623 / #630). */
function revalidateRoster(serviceId?: number) {
  revalidatePath("/roster")
  if (serviceId) revalidatePath(`/roster/${serviceId}`)
  revalidatePath("/my-groups")
}

/** Unavailable ranges covering `date` for these people, keyed by person. */
async function unavailabilityOn(
  db: Prisma.TransactionClient | typeof prisma,
  personIds: number[],
  date: Date,
): Promise<Map<number, UnavailableRange[]>> {
  const rows = personIds.length === 0 ? [] : await db.personUnavailability.findMany({
    where: { personId: { in: personIds }, startDate: { lte: date }, endDate: { gte: date } },
    select: { personId: true, startDate: true, endDate: true },
  })
  const out = new Map<number, UnavailableRange[]>()
  for (const r of rows) {
    const list = out.get(r.personId) ?? []
    list.push({ startYMD: utcYmd(r.startDate), endYMD: utcYmd(r.endDate) })
    out.set(r.personId, list)
  }
  return out
}

// ─── Roles (staff) ────────────────────────────────────────────────────────

/** Create a roster role tied to a live group. canManageRoster-gated. */
export async function createRosterRole(_prev: ActionResultWithSuccess, formData: FormData): Promise<ActionResultWithSuccess> {
  const g = await manager()
  if ("error" in g) return { error: g.error }
  const parsed = RosterRoleSchema.safeParse({
    name: formData.get("name") ?? "",
    groupId: formData.get("groupId") ?? "",
    defaultCount: formData.get("defaultCount") || undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" }
  const group = await prisma.group.findFirst({ where: { id: parsed.data.groupId, archivedAt: null }, select: { id: true } })
  if (!group) return { error: GROUP_GONE }
  try {
    await prisma.$transaction(async (tx) => {
      const row = await tx.rosterRole.create({ data: parsed.data, select: { id: true } })
      await logAuditTx(tx, actorId(g.session), "ROSTER_ROLE_CREATED", "RosterRole", row.id, { groupId: parsed.data.groupId })
    })
  } catch (e) {
    if (isP2002(e)) return { error: DUPLICATE_ROLE }
    throw e
  }
  revalidateRoster()
  return { success: "Roster role created" }
}

/**
 * Archive (or restore) a roster role. An archived role gets no new slots or
 * assignments; past ones stay. canManageRoster-gated.
 */
async function setRoleArchived(id: number, archive: boolean): Promise<ActionResultWithSuccess> {
  const g = await manager()
  if ("error" in g) return { error: g.error }
  if (!isValidPgId(id)) return { error: "Invalid role" }
  const count = await prisma.$transaction(async (tx) => {
    const r = await tx.rosterRole.updateMany({
      where: { id, archivedAt: archive ? null : { not: null } },
      data: { archivedAt: archive ? new Date() : null },
    })
    if (r.count > 0) await logAuditTx(tx, actorId(g.session), archive ? "ROSTER_ROLE_ARCHIVED" : "ROSTER_ROLE_RESTORED", "RosterRole", id)
    return r.count
  })
  if (count === 0) return { error: ROLE_GONE }
  revalidateRoster()
  return { success: archive ? "Roster role archived" : "Roster role restored" }
}

/** Archive a live roster role. canManageRoster-gated. */
export async function archiveRosterRole(id: number): Promise<ActionResultWithSuccess> {
  return setRoleArchived(id, true)
}

/** Restore an archived roster role. canManageRoster-gated. */
export async function restoreRosterRole(id: number): Promise<ActionResultWithSuccess> {
  return setRoleArchived(id, false)
}

// ─── Services (staff) ─────────────────────────────────────────────────────

/** Slot rows for every live role (whose group is live too) at its default head count. */
async function defaultSlots(tx: Prisma.TransactionClient): Promise<{ roleId: number; needed: number }[]> {
  const roles = await tx.rosterRole.findMany({
    where: { archivedAt: null, group: { archivedAt: null } },
    select: { id: true, defaultCount: true },
  })
  return roles.map((r) => ({ roleId: r.id, needed: r.defaultCount }))
}

/**
 * Create one service (a Sunday or an ad-hoc one-off) with a slot for every
 * live role at its default head count. A SUNDAY service must fall on a
 * Sunday. canManageRoster-gated.
 */
export async function createRosterService(_prev: ActionResultWithSuccess, formData: FormData): Promise<ActionResultWithSuccess> {
  const g = await manager()
  if ("error" in g) return { error: g.error }
  const parsed = RosterServiceSchema.safeParse({
    kind: formData.get("kind") ?? "",
    title: formData.get("title") ?? "",
    date: formData.get("date") ?? "",
    startTime: formData.get("startTime") ?? "",
    endTime: formData.get("endTime") ?? "",
    location: formData.get("location") ?? undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" }
  const { kind, title, date, startTime, endTime, location } = parsed.data
  if (kind === "SUNDAY" && !isSundayYMD(date)) return { error: "A Sunday service must fall on a Sunday" }
  const times = serviceTimes(date, startTime, endTime)
  if ("error" in times) return { error: times.error }

  let id: number
  try {
    id = await prisma.$transaction(async (tx) => {
      const slots = await defaultSlots(tx)
      const row = await tx.rosterService.create({
        data: { kind, title, location, ...times, weeklyKey: kind === "SUNDAY" ? times.startsAt : null, slots: { create: slots } },
        select: { id: true },
      })
      await logAuditTx(tx, actorId(g.session), "ROSTER_SERVICE_CREATED", "RosterService", row.id, { kind, date, slots: slots.length })
      return row.id
    })
  } catch (e) {
    if (isP2002(e)) return { error: DUPLICATE_SERVICE }
    throw e
  }
  revalidateRoster(id)
  return { success: "Service created" }
}

/**
 * Create the weekly Sunday services from `from` to `to` (at most
 * MAX_SUNDAYS_PER_RUN), each with default slots. Sundays that already have a
 * SUNDAY service at that start time are skipped, so re-running is safe.
 * canManageRoster-gated.
 */
export async function generateSundayServices(_prev: ActionResultWithSuccess, formData: FormData): Promise<ActionResultWithSuccess> {
  const g = await manager()
  if ("error" in g) return { error: g.error }
  const parsed = SundayRangeSchema.safeParse({
    from: formData.get("from") ?? "",
    to: formData.get("to") ?? "",
    title: formData.get("title") ?? undefined,
    startTime: formData.get("startTime") ?? "",
    endTime: formData.get("endTime") ?? "",
    location: formData.get("location") ?? undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" }
  const { from, to, startTime, endTime, location } = parsed.data
  const title = parsed.data.title || DEFAULT_SUNDAY_TITLE
  if (to < from) return { error: "The end date must be on or after the start date" }
  // Cap the span before enumerating, so a huge range never builds a huge list.
  const spanDays = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
  if (spanDays >= (MAX_SUNDAYS_PER_RUN + 1) * 7) return { error: `Create at most ${MAX_SUNDAYS_PER_RUN} Sundays at a time` }
  // sundaysBetween starts at the Sunday on/before `from`; keep only Sundays in range.
  const sundays = sundaysBetween(from, to).filter((d) => d >= from)
  if (sundays.length === 0) return { error: "There is no Sunday in that range" }
  if (sundays.length > MAX_SUNDAYS_PER_RUN) return { error: `Create at most ${MAX_SUNDAYS_PER_RUN} Sundays at a time` }
  const planned: { ymd: string; date: Date; startsAt: Date; endsAt: Date }[] = []
  for (const ymd of sundays) {
    const times = serviceTimes(ymd, startTime, endTime)
    if ("error" in times) return { error: times.error }
    planned.push({ ymd, ...times })
  }

  // Two batched inserts, not one per Sunday, so a half-year stays well inside
  // the interactive-transaction timeout. skipDuplicates on the weeklyKey
  // unique skips existing Sundays, including ones a concurrent run just made.
  const created = await prisma.$transaction(async (tx) => {
    const rows = await tx.rosterService.createManyAndReturn({
      data: planned.map((p) => ({
        kind: "SUNDAY" as const, title, location, date: p.date, startsAt: p.startsAt, endsAt: p.endsAt, weeklyKey: p.startsAt,
      })),
      skipDuplicates: true,
      select: { id: true },
    })
    if (rows.length === 0) return 0
    const slots = await defaultSlots(tx)
    if (slots.length > 0) {
      await tx.rosterSlot.createMany({ data: rows.flatMap((r) => slots.map((s) => ({ serviceId: r.id, ...s }))) })
    }
    await logAuditTx(tx, actorId(g.session), "ROSTER_SUNDAYS_GENERATED", "RosterService", undefined, {
      from, to, created: rows.length, skipped: planned.length - rows.length,
    })
    return rows.length
  })
  revalidateRoster()
  return { success: created === 0 ? "Those Sundays already exist" : `Created ${created} Sunday service${created === 1 ? "" : "s"}` }
}

/**
 * Delete a service with its slots and assignments (a cancelled one-off, or a
 * mistake). canManageRoster-gated; the audit row records how many
 * assignments went with it.
 */
export async function deleteRosterService(id: number): Promise<ActionResultWithSuccess> {
  const g = await manager()
  if ("error" in g) return { error: g.error }
  if (!isValidPgId(id)) return { error: "Invalid service" }
  const deleted = await prisma.$transaction(async (tx) => {
    const assignments = await tx.rosterAssignment.count({ where: { serviceId: id } })
    const r = await tx.rosterService.deleteMany({ where: { id } })
    if (r.count > 0) await logAuditTx(tx, actorId(g.session), "ROSTER_SERVICE_DELETED", "RosterService", id, { assignments })
    return r.count
  })
  if (deleted === 0) return { error: SERVICE_GONE }
  revalidateRoster(id)
  return { success: "Service deleted" }
}

// ─── Slots (staff) ────────────────────────────────────────────────────────

/** Add a slot for a live role to a service. canManageRoster-gated. */
export async function addRosterSlot(serviceId: number, roleId: number, needed: number): Promise<ActionResultWithSuccess> {
  const g = await manager()
  if ("error" in g) return { error: g.error }
  if (!isValidPgId(serviceId) || !isValidPgId(roleId)) return { error: "Invalid slot" }
  const n = SlotNeededSchema.safeParse(needed)
  if (!n.success) return { error: n.error.issues[0]?.message ?? "Invalid input" }
  const [service, role] = await Promise.all([
    prisma.rosterService.findUnique({ where: { id: serviceId }, select: { id: true } }),
    prisma.rosterRole.findFirst({ where: { id: roleId, archivedAt: null }, select: { id: true } }),
  ])
  if (!service) return { error: SERVICE_GONE }
  if (!role) return { error: ROLE_GONE }
  try {
    await prisma.$transaction(async (tx) => {
      const row = await tx.rosterSlot.create({ data: { serviceId, roleId, needed: n.data }, select: { id: true } })
      await logAuditTx(tx, actorId(g.session), "ROSTER_SLOT_ADDED", "RosterSlot", row.id, { serviceId, roleId, needed: n.data })
    })
  } catch (e) {
    if (isP2002(e)) return { error: "This service already has that role" }
    throw e
  }
  revalidateRoster(serviceId)
  return { success: "Slot added" }
}

/**
 * Change how many people a slot needs. Refused below the number already
 * holding a place (remove people first). canManageRoster-gated.
 */
export async function updateRosterSlotNeeded(slotId: number, needed: number): Promise<ActionResultWithSuccess> {
  const g = await manager()
  if ("error" in g) return { error: g.error }
  if (!isValidPgId(slotId)) return { error: "Invalid slot" }
  const n = SlotNeededSchema.safeParse(needed)
  if (!n.success) return { error: n.error.issues[0]?.message ?? "Invalid input" }
  const result = await prisma.$transaction(async (tx): Promise<{ error: string } | { serviceId: number }> => {
    if (!(await lockSlot(tx, slotId))) return { error: SLOT_GONE }
    const slot = await tx.rosterSlot.findUnique({ where: { id: slotId }, select: { serviceId: true, assignments: { select: { status: true } } } })
    if (!slot) return { error: SLOT_GONE }
    const held = slot.assignments.filter((a) => a.status !== "DECLINED").length
    if (n.data < held) return { error: `${held} people are already rostered; remove some first` }
    await tx.rosterSlot.update({ where: { id: slotId }, data: { needed: n.data } })
    await logAuditTx(tx, actorId(g.session), "ROSTER_SLOT_UPDATED", "RosterSlot", slotId, { needed: n.data })
    return { serviceId: slot.serviceId }
  })
  if ("error" in result) return result
  revalidateRoster(result.serviceId)
  return { success: "Slot updated" }
}

/**
 * Remove an empty slot from a service. Refused while anyone is rostered in it,
 * so a confirmation is never lost by accident. canManageRoster-gated.
 */
export async function removeRosterSlot(slotId: number): Promise<ActionResultWithSuccess> {
  const g = await manager()
  if ("error" in g) return { error: g.error }
  if (!isValidPgId(slotId)) return { error: "Invalid slot" }
  const result = await prisma.$transaction(async (tx): Promise<{ error: string } | { serviceId: number }> => {
    if (!(await lockSlot(tx, slotId))) return { error: SLOT_GONE }
    const slot = await tx.rosterSlot.findUnique({ where: { id: slotId }, select: { serviceId: true, roleId: true, _count: { select: { assignments: true } } } })
    if (!slot) return { error: SLOT_GONE }
    if (slot._count.assignments > 0) return { error: "Remove the people rostered in this slot first" }
    await tx.rosterSlot.delete({ where: { id: slotId } })
    await logAuditTx(tx, actorId(g.session), "ROSTER_SLOT_REMOVED", "RosterSlot", slotId, { serviceId: slot.serviceId, roleId: slot.roleId })
    return { serviceId: slot.serviceId }
  })
  if ("error" in result) return result
  revalidateRoster(result.serviceId)
  return { success: "Slot removed" }
}

// ─── Assignments (staff + group leaders) ──────────────────────────────────

/**
 * Take FOR UPDATE on the slot row so concurrent assigns and head-count edits
 * on the same slot run one at a time. Returns the slot's current `needed`
 * (read under the lock), or null when the slot is gone.
 */
async function lockSlot(tx: Prisma.TransactionClient, slotId: number): Promise<{ needed: number } | null> {
  // nosemgrep: crm-no-raw-sql — row lock; Prisma has no locking API
  const rows = await tx.$queryRaw<{ needed: number }[]>`
    SELECT needed FROM "RosterSlot" WHERE id = ${slotId} FOR UPDATE`
  return rows[0] ?? null
}

/**
 * Suggest people for a slot: live members of the role's group with no
 * conflict, least recently served in this role first. Names only, never
 * contact details. Staff, or a leader of the role's group.
 */
export async function suggestRosterAssignees(slotId: number): Promise<{ error: string } | { suggestions: RosterSuggestion[] }> {
  const g = await slotEditor(slotId)
  if ("error" in g) return { error: g.error }
  const { slot } = g
  if (slot.role.archivedAt) return { error: ROLE_GONE }
  const members = await prisma.groupMember.findMany({
    where: { groupId: slot.role.groupId, group: { archivedAt: null }, person: { archivedAt: null } },
    select: { person: { select: { id: true, firstName: true, lastName: true } } },
  })
  const candidates = members.map((m) => ({ personId: m.person.id, firstName: m.person.firstName, lastName: m.person.lastName }))
  const ids = candidates.map((c) => c.personId)
  const [assigned, unavailability, history] = await Promise.all([
    prisma.rosterAssignment.findMany({ where: { serviceId: slot.serviceId }, select: { personId: true } }),
    unavailabilityOn(prisma, ids, slot.service.date),
    // Latest earlier service each person held a place at in this role.
    ids.length === 0 ? Promise.resolve([]) : prisma.rosterAssignment.findMany({
      where: {
        personId: { in: ids },
        status: { not: "DECLINED" },
        slot: { roleId: slot.roleId, service: { date: { lt: slot.service.date } } },
      },
      select: { personId: true, slot: { select: { service: { select: { date: true } } } } },
      orderBy: { slot: { service: { date: "desc" } } },
      distinct: ["personId"],
    }),
  ])
  const lastServed = new Map(history.map((h) => [h.personId, utcYmd(h.slot.service.date)]))
  const suggestions = suggestAssignees(candidates, lastServed, {
    serviceYMD: utcYmd(slot.service.date),
    assignedPersonIds: new Set(assigned.map((a) => a.personId)),
    unavailability,
  })
  return { suggestions }
}

/**
 * Roster a person into a slot as PENDING. The person must be a live member of
 * the role's (live) group, available that day, not already at the service,
 * and the slot must have an open place. Staff, or a leader of the role's group.
 */
export async function assignToRosterSlot(slotId: number, personId: number): Promise<ActionResultWithSuccess> {
  const g = await slotEditor(slotId)
  if ("error" in g) return { error: g.error }
  if (!isValidPgId(personId)) return { error: "Invalid person" }
  const { slot } = g
  if (slot.role.archivedAt) return { error: ROLE_GONE }
  const userId = actorId(g.session)

  try {
    const result = await prisma.$transaction(async (tx): Promise<{ error: string } | { ok: true }> => {
      const locked = await lockSlot(tx, slotId)
      if (!locked) return { error: SLOT_GONE }
      const member = await tx.groupMember.findFirst({
        where: { groupId: slot.role.groupId, personId, group: { archivedAt: null }, person: { archivedAt: null } },
        select: { id: true },
      })
      if (!member) return { error: "This person is not a member of the role's group" }
      const [atService, inSlot, unavailability] = await Promise.all([
        tx.rosterAssignment.findFirst({ where: { serviceId: slot.serviceId, personId }, select: { status: true } }),
        tx.rosterAssignment.findMany({ where: { slotId }, select: { status: true } }),
        unavailabilityOn(tx, [personId], slot.service.date),
      ])
      const conflict = findConflict(personId, {
        serviceYMD: utcYmd(slot.service.date),
        assignedPersonIds: new Set(atService ? [personId] : []),
        unavailability,
      })
      if (atService?.status === "DECLINED") return { error: "This person declined this service; remove their declined entry first" }
      if (conflict) return { error: ROSTER_CONFLICT_MESSAGES[conflict] }
      if (openPlaces(locked.needed, inSlot.map((a) => a.status)) === 0) return { error: "This slot is already full" }
      const row = await tx.rosterAssignment.create({
        data: { slotId, serviceId: slot.serviceId, personId, assignedById: userId },
        select: { id: true },
      })
      await logAuditTx(tx, userId, "ROSTER_ASSIGNED", "RosterAssignment", row.id, { slotId, serviceId: slot.serviceId, personId })
      return { ok: true }
    })
    if ("error" in result) return result
  } catch (e) {
    // A concurrent assign put the same person at this service first.
    if (isP2002(e)) return { error: ROSTER_CONFLICT_MESSAGES.ALREADY_ASSIGNED }
    // The service (and so the slot) was deleted between the lock and the insert.
    if (isP2003(e)) return { error: SLOT_GONE }
    throw e
  }
  revalidateRoster(slot.serviceId)
  return { success: "Person rostered" }
}

/** Remove a person from a slot (any status). Staff, or a leader of the role's group. */
export async function unassignRosterAssignment(assignmentId: number): Promise<ActionResultWithSuccess> {
  const g = await assignerSession()
  if ("error" in g) return { error: g.error }
  if (!isValidPgId(assignmentId)) return { error: "Invalid assignment" }
  const row = await prisma.rosterAssignment.findUnique({
    where: { id: assignmentId },
    select: { serviceId: true, slotId: true, personId: true, status: true, slot: { select: { role: { select: { groupId: true } } } } },
  })
  if (!row) return { error: ASSIGNMENT_GONE }
  if (!(await mayEditGroupRole(g.session, row.slot.role.groupId))) return { error: UNAUTHORIZED }
  const deleted = await prisma.$transaction(async (tx) => {
    const r = await tx.rosterAssignment.deleteMany({ where: { id: assignmentId } })
    if (r.count > 0) {
      await logAuditTx(tx, actorId(g.session), "ROSTER_UNASSIGNED", "RosterAssignment", assignmentId, {
        slotId: row.slotId, serviceId: row.serviceId, personId: row.personId, status: row.status,
      })
    }
    return r.count
  })
  if (deleted === 0) return { error: ASSIGNMENT_GONE }
  revalidateRoster(row.serviceId)
  return { success: "Person removed from the roster" }
}
