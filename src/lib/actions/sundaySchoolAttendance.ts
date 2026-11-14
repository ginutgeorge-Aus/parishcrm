"use server"

// Sunday School roll (OSS-10): marking attendance and assigning roll markers.
// Marking = canMarkRoll (editors + HEADMASTER for any class, an assigned TEACHER
// or EVENT_ORGANISER for their classes); roll-marker assignment =
// canManageSundaySchool.

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
import { canManageSundaySchool, canMarkSomeSundaySchool } from "@/lib/roleGuard"
import { canMarkRoll } from "@/lib/sundaySchoolAccess"
import { CLASS_GONE, lockEnrolled, withLiveClass } from "@/lib/sundaySchoolYearLock"
import { parseAttendanceStatus, parseRollDate, ymdToDbDate } from "@/lib/sundaySchoolRollView"
import { isValidPgId } from "@/lib/validation"
import { verifyBadge } from "@/lib/sundaySchoolBadge"
import type { ActionResult, ActionResultWithSuccess } from "./types"
import { featureGuard } from "@/lib/featureFlags"

const ENTITY = "SundaySchoolClass"
const NOT_IN_CLASS = "Child is not in this class"
const KEEP_HISTORY = "This child has left the class, so their mark can be changed but not cleared"

type RollGuard = { error: string } | { actor: number; ymd: string }

/**
 * Shared guard for the two roll actions: demo block, feature check, signed in, valid id,
 * canMarkRoll, live class, and a real past-or-today date inside the class year.
 * Module-private ("use server" exports must be async actions).
 */
async function rollGuard(classId: number, ymd: string): Promise<RollGuard> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!session?.user || !canMarkSomeSundaySchool(session.user.role)) return { error: "Unauthorized" }
  const off = await featureGuard("sundaySchool")
  if (off) return off
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
 * marked in this session (correcting history after a move; such a mark can be
 * changed but not cleared). canMarkRoll-gated.
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
        // Correcting history for a child since moved out: the Person must still
        // be live (FOR SHARE, so an archive waits), and the existing mark is the
        // only link to this roll, so it can be changed but never cleared.
        // nosemgrep: crm-no-raw-sql — row lock; Prisma has no locking API
        const live = await tx.$queryRaw<{ id: number }[]>`
          SELECT id FROM "Person" WHERE id = ${personId} AND "archivedAt" IS NULL FOR SHARE`
        const prior = session && live.length > 0
          ? await tx.sundaySchoolAttendance.findUnique({ where: { sessionId_personId: { sessionId: session.id, personId } }, select: { id: true } })
          : null
        if (!prior) throw new Error(NOT_IN_CLASS)
        if (next === null) throw new Error(KEEP_HISTORY)
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
    if (!r.live) return { error: r.error }
  } catch (e) {
    if (e instanceof Error && (e.message === NOT_IN_CLASS || e.message === KEEP_HISTORY)) return { error: e.message }
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
  if (!r.live) return { error: r.error }
  await logAudit(g.actor, "SS_ATTENDANCE_BULK_PRESENT", ENTITY, classId, { date: g.ymd, count: r.value })
  revalidateRoll(classId)
  return { success: `Marked ${r.value} present` }
}

export type ScanResult = { error: string } | { name: string; outcome: "marked" | "already"; status: AttendanceStatus }

/**
 * Badge-scan check-in: verify the signed QR payload, require the child to be
 * enrolled in THIS class now, and mark them Present for the date via
 * setAttendance (same guard, year lock and audit as a manual mark). A child
 * already Present or Late is left as is ("already"): a scan never downgrades
 * Late or rewrites a mark. Absent or unmarked becomes Present, as a manual
 * re-mark would. canMarkRoll-gated.
 * @param classId the class being scanned into
 * @param ymd the roll date (YYYY-MM-DD)
 * @param payload raw decoded QR text
 */
export async function scanBadge(classId: number, ymd: string, payload: string): Promise<ScanResult> {
  const g = await rollGuard(classId, ymd)
  if ("error" in g) return { error: g.error }
  if (typeof payload !== "string" || payload.length > 200) return { error: "Invalid badge" }
  const personId = verifyBadge(payload)
  if (personId === null) return { error: "Invalid badge" }
  const enrolment = await prisma.sundaySchoolEnrolment.findFirst({
    where: { classId, personId, person: { archivedAt: null } },
    select: { person: { select: { firstName: true, lastName: true } } },
  })
  if (!enrolment) return { error: "Not in this class" }
  const name = `${enrolment.person.firstName} ${enrolment.person.lastName}`.trim()
  const existing = await prisma.sundaySchoolAttendance.findFirst({
    where: { personId, session: { classId, date: ymdToDbDate(g.ymd) } },
    select: { status: true },
  })
  if (existing && existing.status !== "ABSENT") return { name, outcome: "already", status: existing.status }
  const r = await setAttendance(classId, g.ymd, personId, "PRESENT")
  if (r) return { error: r.error }
  return { name, outcome: "marked", status: "PRESENT" }
}

type EditorGuard ={ error: string } | { session: Session | null }

/**
 * Demo block, feature check, manager role (canManageSundaySchool), valid ids,
 * live class — for roll-marker assignment.
 */
async function markerGuard(classId: number, userId: number): Promise<EditorGuard> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!canManageSundaySchool(session?.user?.role)) return { error: "Unauthorized" }
  const off = await featureGuard("sundaySchool")
  if (off) return off
  if (!isValidPgId(classId) || !isValidPgId(userId)) return { error: "Invalid input" }
  const cls = await prisma.sundaySchoolClass.findFirst({ where: { id: classId, archivedAt: null }, select: { id: true } })
  if (!cls) return { error: CLASS_GONE }
  return { session }
}

/**
 * Let a live TEACHER (or legacy EVENT_ORGANISER) login take this class's roll.
 * canManageSundaySchool-gated. Duplicate = success (unique classId_userId).
 */
export async function addRollMarker(classId: number, userId: number): Promise<ActionResult> {
  const g = await markerGuard(classId, userId)
  if ("error" in g) return { error: g.error }
  // findFirst so an archived (soft-deleted) user can't be assigned by id.
  const user = await prisma.user.findFirst({ where: { id: userId, archivedAt: null }, select: { role: true } })
  if (!user) return { error: "User not found" }
  if (user.role !== UserRole.TEACHER && user.role !== UserRole.EVENT_ORGANISER) {
    return { error: "User is not a teacher or event organiser" }
  }

  // Under the class lock, so an archive can't commit between the guard and the write.
  const r = await withLiveClass(classId, async (tx) => {
    // Already assigned = success. createMany + skipDuplicates avoids a P2002
    // that would abort the transaction.
    await tx.sundaySchoolRollMarker.createMany({ data: [{ classId, userId }], skipDuplicates: true })
  })
  if (!r.live) return { error: r.error }
  await logAudit(actorId(g.session), "SS_ROLL_MARKER_ADDED", ENTITY, classId, { targetUserId: userId })
  revalidatePath(`/sunday-school/${classId}`)
  revalidatePath("/my-classes")
}

/** Remove a roll marker from a class (missing link = success). canManageSundaySchool-gated. */
export async function removeRollMarker(classId: number, userId: number): Promise<ActionResult> {
  const g = await markerGuard(classId, userId)
  if ("error" in g) return { error: g.error }
  const r = await withLiveClass(classId, (tx) => tx.sundaySchoolRollMarker.deleteMany({ where: { classId, userId } }))
  if (!r.live) return { error: r.error }
  await logAudit(actorId(g.session), "SS_ROLL_MARKER_REMOVED", ENTITY, classId, { targetUserId: userId })
  revalidatePath(`/sunday-school/${classId}`)
  revalidatePath("/my-classes")
}
