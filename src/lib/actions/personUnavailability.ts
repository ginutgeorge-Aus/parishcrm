"use server"

// Member unavailability (#624, part of #306). Staff (canManageRoster) record
// the dates a person cannot serve; a group leader login may do it only for a
// person in a group they lead (canEditPersonUnavailability). Not self-service.
// The roster conflict rule (src/lib/roster.ts) reads these rows, so adding a
// range that covers an existing assignment returns a warning naming the
// services, rather than silently leaving the person rostered. Every mutation
// writes its audit row in the same transaction.

import { revalidatePath } from "next/cache"
import type { Session } from "next-auth"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { logAuditTx } from "@/lib/audit"
import { sydneyToday, utcYmd } from "@/lib/dates"
import { assertNotDemo } from "@/lib/demoMode"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@/lib/generated/prisma/client"
import { canEditOrOrganise } from "@/lib/roleGuard"
import { canEditPersonUnavailability } from "@/lib/rosterAccess"
import { UnavailabilitySchema, isUnavailableOn } from "@/lib/roster"
import { isValidPgId } from "@/lib/validation"
import type { ActionResultWithSuccess } from "./types"

const UNAUTHORIZED = "Unauthorized"
const PERSON_GONE = "Person not found"
/** Most unavailability rows per person: a defensive cap so a person page stays bounded. */
const MAX_ROWS_PER_PERSON = 100
/** Most conflicting services named in the warning text. */
const MAX_WARNED = 5

type Guard = { error: string } | { session: Session | null }

/** Demo block and coarse role check (DB-free): runs before any lookup so a VIEWER learns nothing about which ids exist. */
async function roleSession(): Promise<Guard> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!canEditOrOrganise(session?.user?.role)) return { error: UNAUTHORIZED }
  return { session }
}

/** Coarse role check, valid id, then the per-person check. */
async function editorFor(personId: number): Promise<Guard> {
  const g = await roleSession()
  if ("error" in g) return g
  if (!isValidPgId(personId)) return { error: "Invalid person" }
  if (!(await canEditPersonUnavailability(actorId(g.session), personId, g.session?.user?.role))) return { error: UNAUTHORIZED }
  return g
}

/** Row lock on the person so concurrent adds for one person count and insert one at a time. */
async function lockPerson(tx: Prisma.TransactionClient, personId: number): Promise<boolean> {
  // nosemgrep: crm-no-raw-sql — row lock; Prisma has no locking API
  const rows = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM "Person" WHERE id = ${personId} FOR UPDATE`
  return rows.length > 0
}

/**
 * Record a date range a person cannot serve (`from`, `to` form fields,
 * inclusive Sydney dates). When the person is already rostered on a covered
 * day (and has not declined), the range is still saved and the success text
 * warns which services to move them off.
 * @param personId the person
 * @param _prev previous action state (useActionState)
 * @param formData `from` and `to` as `YYYY-MM-DD`
 */
export async function addPersonUnavailability(
  personId: number,
  _prev: ActionResultWithSuccess,
  formData: FormData,
): Promise<ActionResultWithSuccess> {
  const g = await editorFor(personId)
  if ("error" in g) return { error: g.error }
  const parsed = UnavailabilitySchema.safeParse({ from: formData.get("from") ?? "", to: formData.get("to") || formData.get("from") || "" })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" }
  const { from, to } = parsed.data
  const startDate = new Date(`${from}T00:00:00.000Z`)
  const endDate = new Date(`${to}T00:00:00.000Z`)

  const clashes = await prisma.rosterAssignment.findMany({
    where: { personId, status: { not: "DECLINED" }, slot: { service: { date: { gte: startDate, lte: endDate } } } },
    select: { slot: { select: { service: { select: { title: true, date: true } } } } },
    orderBy: { slot: { service: { date: "asc" } } },
  })
  // Count (only ranges still current, so old ones never block new ones) and create under one lock.
  const result = await prisma.$transaction(async (tx): Promise<{ error: string } | { ok: true }> => {
    if (!(await lockPerson(tx, personId))) return { error: PERSON_GONE }
    const current = await tx.personUnavailability.count({ where: { personId, endDate: { gte: sydneyToday() } } })
    if (current >= MAX_ROWS_PER_PERSON) {
      return { error: `At most ${MAX_ROWS_PER_PERSON} current unavailable ranges per person; remove some first` }
    }
    const row = await tx.personUnavailability.create({ data: { personId, startDate, endDate }, select: { id: true } })
    await logAuditTx(tx, actorId(g.session), "ROSTER_UNAVAILABLE_ADDED", "PersonUnavailability", row.id, { personId, from, to })
    return { ok: true }
  })
  if ("error" in result) return result
  revalidatePath(`/people/${personId}`)
  revalidatePath("/roster")

  const range = [{ startYMD: from, endYMD: to }]
  const hit = clashes
    .map((c) => ({ title: c.slot.service.title, ymd: utcYmd(c.slot.service.date) }))
    .filter((c) => isUnavailableOn(range, c.ymd))
  if (hit.length === 0) return { success: "Unavailable dates saved" }
  const named = hit.slice(0, MAX_WARNED).map((c) => `${c.title} on ${c.ymd}`).join("; ")
  const more = hit.length > MAX_WARNED ? ` and ${hit.length - MAX_WARNED} more` : ""
  return { success: `Saved. Warning: already rostered at ${named}${more}. Remove them from the roster if they cannot serve` }
}

/**
 * Remove one unavailable range. The caller must be allowed to edit the
 * owning person (checked against the row's person, not a client-sent id).
 * @param id the PersonUnavailability id
 */
export async function removePersonUnavailability(id: number): Promise<ActionResultWithSuccess> {
  const role = await roleSession()
  if ("error" in role) return role
  if (!isValidPgId(id)) return { error: "Invalid entry" }
  const row = await prisma.personUnavailability.findUnique({ where: { id }, select: { personId: true, startDate: true, endDate: true } })
  if (!row) return { error: "Entry not found" }
  const g = await editorFor(row.personId)
  if ("error" in g) return { error: g.error }
  const count = await prisma.$transaction(async (tx) => {
    const r = await tx.personUnavailability.deleteMany({ where: { id } })
    if (r.count > 0) {
      await logAuditTx(tx, actorId(g.session), "ROSTER_UNAVAILABLE_REMOVED", "PersonUnavailability", id, {
        personId: row.personId, from: utcYmd(row.startDate), to: utcYmd(row.endDate),
      })
    }
    return r.count
  })
  if (count === 0) return { error: "Entry not found" }
  revalidatePath(`/people/${row.personId}`)
  revalidatePath("/roster")
  return { success: "Unavailable dates removed" }
}
