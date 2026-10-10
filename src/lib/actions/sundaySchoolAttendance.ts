"use server"

// Sunday School roll (OSS-10): marking attendance and assigning roll markers.
// Marking = canMarkRoll (editors for any class, an assigned EVENT_ORGANISER for
// their classes); roll-marker assignment = canEdit.

import { revalidatePath } from "next/cache"
import type { Session } from "next-auth"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { logAudit } from "@/lib/audit"
import { sydneyTodayYMD } from "@/lib/dates"
import { assertNotDemo } from "@/lib/demoMode"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@/lib/generated/prisma/client"
import { UserRole, type AttendanceStatus } from "@/lib/generated/prisma/enums"
import { canEdit } from "@/lib/roleGuard"
import { canMarkRoll } from "@/lib/sundaySchoolAccess"
import { parseAttendanceStatus, parseRollDate, ymdToDbDate } from "@/lib/sundaySchoolRollView"
import { isP2002, isValidPgId } from "@/lib/validation"
import type { ActionResult, ActionResultWithSuccess } from "./types"

const ENTITY = "SundaySchoolClass"
const CLASS_GONE = "Class not found"
const NOT_IN_CLASS = "Child is not in this class"

type RollGuard = { error: string } | { actor: number; ymd: string }

/**
 * Shared guard for the two roll actions: demo block, signed in, valid id,
 * canMarkRoll, live class, and a real past-or-today date inside the class year.
 * Module-private ("use server" exports must be async actions).
 */
async function rollGuard(classId: number, ymd: string): Promise<RollGuard> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!session?.user) return { error: "Unauthorized" }
  if (!isValidPgId(classId)) return { error: "Invalid class" }
  const actor = actorId(session)
  if (!(await canMarkRoll(actor, classId, session.user.role))) return { error: "Unauthorized" }
  const cls = await prisma.sundaySchoolClass.findFirst({ where: { id: classId, archivedAt: null }, select: { year: true } })
  if (!cls) return { error: CLASS_GONE }
  // Blank would mean "today" on the page; an action must name its date.
  if (typeof ymd !== "string" || !ymd.trim()) return { error: "Invalid date" }
  const parsed = parseRollDate(ymd, cls.year, sydneyTodayYMD())
  if (!parsed.ok) return { error: parsed.error }
  return { actor, ymd: parsed.ymd }
}

/**
 * Run `fn` in a transaction holding FOR SHARE on the live class row, so a
 * concurrent archive waits until the marks commit, and `fn` is skipped if the
 * class was archived after the guard. Returns `{ live: false }` when it was.
 */
async function withLiveClass<T>(
  classId: number,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<{ live: false } | { live: true; value: T }> {
  return prisma.$transaction(async (tx) => {
    // nosemgrep: crm-no-raw-sql — row lock; Prisma has no locking API
    const rows = await tx.$queryRaw<{ id: number }[]>`
      SELECT id FROM "SundaySchoolClass" WHERE id = ${classId} AND "archivedAt" IS NULL FOR SHARE`
    if (rows.length === 0) return { live: false as const }
    return { live: true as const, value: await fn(tx) }
    // May queue behind a rollover's enrolment writes (itself up to 60s).
  }, { timeout: 90_000 })
}

/**
 * Live children enrolled in the class (optionally just `personIds`), with
 * FOR SHARE on both the enrolment and Person rows: a concurrent move, unenrol
 * or archive waits for the marks, or the marks see it already committed.
 */
async function lockEnrolled(tx: Prisma.TransactionClient, classId: number, personIds?: number[]): Promise<number[]> {
  // nosemgrep: crm-no-raw-sql — row lock; Prisma has no locking API
  const rows = personIds
    ? await tx.$queryRaw<{ personId: number }[]>`
        SELECT e."personId" FROM "SundaySchoolEnrolment" e JOIN "Person" p ON p.id = e."personId"
        WHERE e."classId" = ${classId} AND e."personId" = ANY(${personIds}) AND p."archivedAt" IS NULL FOR SHARE`
    : await tx.$queryRaw<{ personId: number }[]>`
        SELECT e."personId" FROM "SundaySchoolEnrolment" e JOIN "Person" p ON p.id = e."personId"
        WHERE e."classId" = ${classId} AND p."archivedAt" IS NULL FOR SHARE`
  return rows.map((r) => r.personId)
}

/**
 * Get-or-create the (class, date) session inside the caller's transaction.
 * createMany + skipDuplicates is INSERT … ON CONFLICT DO NOTHING, so a
 * concurrent first mark never raises P2002 (which would abort the transaction).
 */
async function ensureSession(tx: Prisma.TransactionClient, classId: number, date: Date): Promise<number> {
  await tx.sundaySchoolSession.createMany({ data: [{ classId, date }], skipDuplicates: true })
  const s = await tx.sundaySchoolSession.findUniqueOrThrow({ where: { classId_date: { classId, date } }, select: { id: true } })
  return s.id
}

/** Refresh every page that shows this class's roll. */
function revalidateRoll(classId: number): void {
  revalidatePath(`/sunday-school/${classId}/roll`)
  revalidatePath(`/my-classes/${classId}/roll`)
  revalidatePath(`/sunday-school/${classId}`)
}

/**
 * Mark one child Present / Late / Absent for a class + date, or clear the mark
 * (`status` null). The child must be enrolled in this class now, or already
 * marked in this session (correcting history after a move). canMarkRoll-gated.
 */
export async function setAttendance(
  classId: number,
  ymd: string,
  personId: number,
  status: AttendanceStatus | null,
): Promise<ActionResult> {
  const g = await rollGuard(classId, ymd)
  if ("error" in g) return { error: g.error }
  if (!isValidPgId(personId)) return { error: "Invalid person" }
  const next = parseAttendanceStatus(status)
  if (next === undefined) return { error: "Invalid status" }
  const date = ymdToDbDate(g.ymd)

  try {
    const r = await withLiveClass(classId, async (tx) => {
      const enrolled = (await lockEnrolled(tx, classId, [personId])).length > 0
      const session = await tx.sundaySchoolSession.findUnique({ where: { classId_date: { classId, date } }, select: { id: true } })
      if (!enrolled) {
        const prior = session
          ? await tx.sundaySchoolAttendance.findUnique({ where: { sessionId_personId: { sessionId: session.id, personId } }, select: { id: true } })
          : null
        if (!prior) throw new Error(NOT_IN_CLASS)
      }
      if (next === null) {
        // Don't create a session just to clear a mark.
        if (session) await tx.sundaySchoolAttendance.deleteMany({ where: { sessionId: session.id, personId } })
        return
      }
      const sessionId = session?.id ?? (await ensureSession(tx, classId, date))
      await tx.sundaySchoolAttendance.upsert({
        where: { sessionId_personId: { sessionId, personId } },
        create: { sessionId, personId, status: next, markedById: g.actor },
        update: { status: next, markedById: g.actor },
      })
    })
    if (!r.live) return { error: CLASS_GONE }
  } catch (e) {
    if (e instanceof Error && e.message === NOT_IN_CLASS) return { error: NOT_IN_CLASS }
    throw e
  }
  await logAudit(g.actor, "SS_ATTENDANCE_MARKED", ENTITY, classId, { date: g.ymd, personId, status: next })
  revalidateRoll(classId)
}

/**
 * Mark every enrolled child with no mark yet as Present for a class + date.
 * Existing marks (incl. Absent/Late) are left alone. An empty class creates
 * no session. canMarkRoll-gated.
 */
export async function markUnmarkedPresent(classId: number, ymd: string): Promise<ActionResultWithSuccess> {
  const g = await rollGuard(classId, ymd)
  if ("error" in g) return { error: g.error }
  const date = ymdToDbDate(g.ymd)

  const r = await withLiveClass(classId, async (tx) => {
    const ids = await lockEnrolled(tx, classId)
    if (ids.length === 0) return 0
    const sessionId = await ensureSession(tx, classId, date)
    const { count } = await tx.sundaySchoolAttendance.createMany({
      data: ids.map((personId) => ({ sessionId, personId, status: "PRESENT" as const, markedById: g.actor })),
      skipDuplicates: true,
    })
    return count
  })
  if (!r.live) return { error: CLASS_GONE }
  await logAudit(g.actor, "SS_ATTENDANCE_BULK_PRESENT", ENTITY, classId, { date: g.ymd, count: r.value })
  revalidateRoll(classId)
  return { success: `Marked ${r.value} present` }
}

type EditorGuard = { error: string } | { session: Session | null }

/** Demo block, editor role, valid ids, live class — for roll-marker assignment. */
async function markerGuard(classId: number, userId: number): Promise<EditorGuard> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(classId) || !isValidPgId(userId)) return { error: "Invalid input" }
  const cls = await prisma.sundaySchoolClass.findFirst({ where: { id: classId, archivedAt: null }, select: { id: true } })
  if (!cls) return { error: CLASS_GONE }
  return { session }
}

/**
 * Let a live EVENT_ORGANISER login take this class's roll. canEdit-gated.
 * Duplicate = success (unique classId_userId).
 */
export async function addRollMarker(classId: number, userId: number): Promise<ActionResult> {
  const g = await markerGuard(classId, userId)
  if ("error" in g) return { error: g.error }
  // findFirst so an archived (soft-deleted) user can't be assigned by id.
  const user = await prisma.user.findFirst({ where: { id: userId, archivedAt: null }, select: { role: true } })
  if (!user) return { error: "User not found" }
  if (user.role !== UserRole.EVENT_ORGANISER) return { error: "User is not an event organiser" }

  try {
    await prisma.sundaySchoolRollMarker.create({ data: { classId, userId } })
  } catch (e) {
    if (!isP2002(e)) throw e
  }
  await logAudit(actorId(g.session), "SS_ROLL_MARKER_ADDED", ENTITY, classId, { targetUserId: userId })
  revalidatePath(`/sunday-school/${classId}`)
  revalidatePath("/my-classes")
}

/** Remove a roll marker from a class (missing link = success). canEdit-gated. */
export async function removeRollMarker(classId: number, userId: number): Promise<ActionResult> {
  const g = await markerGuard(classId, userId)
  if ("error" in g) return { error: g.error }
  await prisma.sundaySchoolRollMarker.deleteMany({ where: { classId, userId } })
  await logAudit(actorId(g.session), "SS_ROLL_MARKER_REMOVED", ENTITY, classId, { targetUserId: userId })
  revalidatePath(`/sunday-school/${classId}`)
  revalidatePath("/my-classes")
}
