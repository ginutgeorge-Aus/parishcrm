"use server"

// Sunday School exams: create/edit/archive an exam for a class, and enter a
// child's score. Gated by canMarkExam (editors + HEADMASTER any class; an
// assigned TEACHER / EVENT_ORGANISER their own classes). Every write runs under
// the live-class lock, so a rolled-over (locked) year refuses changes.

import { revalidatePath } from "next/cache"
import type { Session } from "next-auth"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { logAudit } from "@/lib/audit"
import { assertNotDemo } from "@/lib/demoMode"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@/lib/generated/prisma/client"
import type { UserRole } from "@/lib/generated/prisma/enums"
import { canManageSundaySchool, isEventOrganiser, isTeacher } from "@/lib/roleGuard"
import { canMarkExam } from "@/lib/sundaySchoolAccess"
import { lockLiveClass, YEAR_LOCKED } from "@/lib/sundaySchoolYearLock"
import { ExamFormSchema, isDateInYear, parseScore } from "@/lib/sundaySchoolExam"
import { ymdToDbDate } from "@/lib/sundaySchoolRollView"
import { isValidPgId } from "@/lib/validation"
import type { ActionResult } from "./types"
import { featureGuard } from "@/lib/featureFlags"

const ENTITY = "SundaySchoolExam"
const CLASS_GONE = "Class not found"
const EXAM_GONE = "Exam not found"
const NOT_IN_CLASS = "Child is not in this class"

type ExamGuard = { error: string } | { actor: number; classId: number; year: number }

/**
 * Coarse role pre-check: could this role mark exams for ANY class? Per-class
 * assignment is checked by canMarkExam.
 * @param role the caller's role
 */
function canMarkSomeExam(role: UserRole | undefined): boolean {
  return canManageSundaySchool(role) || isTeacher(role) || isEventOrganiser(role)
}

type Preamble = { error: string } | { session: Session & { user: NonNullable<Session["user"]> } }

/**
 * Demo block, signed in, coarse role, feature check: runs before any DB read.
 * Module-private ("use server" exports must be async actions).
 */
async function examPreamble(): Promise<Preamble> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!session?.user || !canMarkSomeExam(session.user.role)) return { error: "Unauthorized" }
  const off = await featureGuard("sundaySchool")
  if (off) return off
  return { session: { ...session, user: session.user } }
}

/**
 * Per-class checks once the preamble passed: valid class id, canMarkExam for
 * that class, live class. Returns the actor and class year.
 * @param session the authenticated session
 * @param classId the class to act on
 */
async function classChecks(session: Session & { user: NonNullable<Session["user"]> }, classId: number): Promise<ExamGuard> {
  if (!isValidPgId(classId)) return { error: "Invalid class" }
  const actor = actorId(session)
  if (!(await canMarkExam(actor, classId, session.user.role))) return { error: "Unauthorized" }
  const cls = await prisma.sundaySchoolClass.findFirst({ where: { id: classId, archivedAt: null }, select: { id: true, year: true } })
  if (!cls) return { error: CLASS_GONE }
  return { actor, classId: cls.id, year: cls.year }
}

/**
 * Shared guard: preamble (demo, auth, role, feature), then the class checks.
 * @param classId the class to act on
 */
async function examClassGuard(classId: number): Promise<ExamGuard> {
  const pre = await examPreamble()
  if ("error" in pre) return pre
  return classChecks(pre.session, classId)
}

/**
 * Resolve a live exam by id and run the class checks on its class. The
 * preamble runs first so no exam lookup happens before authz or the feature
 * check. Unknown/archived exams give "Exam not found".
 * @param examId the exam to act on
 */
async function examGuard(examId: number): Promise<(ExamGuard & { totalMarks?: string }) | { error: string }> {
  const pre = await examPreamble()
  if ("error" in pre) return pre
  if (!isValidPgId(examId)) return { error: "Invalid exam" }
  const exam = await prisma.sundaySchoolExam.findFirst({
    where: { id: examId, archivedAt: null },
    select: { classId: true, totalMarks: true },
  })
  if (!exam) return { error: EXAM_GONE }
  const g = await classChecks(pre.session, exam.classId)
  if ("error" in g) return g
  return { ...g, totalMarks: exam.totalMarks.toString() }
}

/**
 * Run `fn` in a transaction holding FOR SHARE on the live class row, so an
 * archive waits and a locked year (rollover) is refused. Returns
 * `{ live: false, error }` when skipped.
 */
async function withLiveClass<T>(
  classId: number,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<{ live: false; error: string } | { live: true; value: T }> {
  return prisma.$transaction(async (tx) => {
    const state = await lockLiveClass(tx, classId)
    if (state === "gone") return { live: false as const, error: CLASS_GONE }
    if (state === "locked") return { live: false as const, error: YEAR_LOCKED }
    return { live: true as const, value: await fn(tx) }
  }, { timeout: 90_000 })
}

/** Parse the exam form against the class year; returns data or the first message. */
function parseExamForm(formData: FormData, year: number): { error: string } | { data: { name: string; date: Date; totalMarks: string } } {
  const parsed = ExamFormSchema.safeParse({
    name: formData.get("name") ?? "",
    date: formData.get("date") ?? "",
    totalMarks: formData.get("totalMarks") ?? "",
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" }
  if (!isDateInYear(parsed.data.date, year)) return { error: `Exam date must be a valid date in ${year}` }
  return { data: { name: parsed.data.name, date: ymdToDbDate(parsed.data.date), totalMarks: parsed.data.totalMarks } }
}

/** Refresh every page that lists a class's exams. */
function revalidateExams(classId: number): void {
  revalidatePath(`/sunday-school/${classId}/exams`)
  revalidatePath(`/my-classes/${classId}/exams`)
}

/** Create an exam (name, date in the class year, total marks) for a class. canMarkExam-gated. */
export async function createExam(classId: number, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await examClassGuard(classId)
  if ("error" in g) return { error: g.error }
  const form = parseExamForm(formData, g.year)
  if ("error" in form) return { error: form.error }

  const r = await withLiveClass(g.classId, (tx) =>
    tx.sundaySchoolExam.create({ data: { classId: g.classId, year: g.year, ...form.data }, select: { id: true } }),
  )
  if (!r.live) return { error: r.error }
  await logAudit(g.actor, "SS_EXAM_CREATED", ENTITY, r.value.id, { classId: g.classId, name: form.data.name, totalMarks: form.data.totalMarks })
  revalidateExams(g.classId)
}

/**
 * Edit an exam's name, date and total marks. Refused when the new total is
 * below an already-entered score. canMarkExam-gated.
 */
export async function updateExam(id: number, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await examGuard(id)
  if ("error" in g) return { error: g.error }
  const form = parseExamForm(formData, g.year)
  if ("error" in form) return { error: form.error }

  const r = await withLiveClass(g.classId, async (tx) => {
    const over = await tx.sundaySchoolExamResult.count({ where: { examId: id, score: { gt: form.data.totalMarks } } })
    if (over > 0) return "over" as const
    const { count } = await tx.sundaySchoolExam.updateMany({ where: { id, archivedAt: null }, data: form.data })
    return count === 0 ? ("gone" as const) : ("ok" as const)
  })
  if (!r.live) return { error: r.error }
  if (r.value === "over") return { error: "Total marks is below a score already entered" }
  if (r.value === "gone") return { error: EXAM_GONE }
  await logAudit(g.actor, "SS_EXAM_UPDATED", ENTITY, id, { classId: g.classId, name: form.data.name, totalMarks: form.data.totalMarks })
  revalidateExams(g.classId)
}

/** Archive (never delete) an exam so its results survive. canMarkExam-gated. */
export async function archiveExam(id: number): Promise<ActionResult> {
  const g = await examGuard(id)
  if ("error" in g) return { error: g.error }
  const r = await withLiveClass(g.classId, async (tx) => {
    const { count } = await tx.sundaySchoolExam.updateMany({ where: { id, archivedAt: null }, data: { archivedAt: new Date() } })
    return count
  })
  if (!r.live) return { error: r.error }
  if (r.value === 0) return { error: EXAM_GONE }
  await logAudit(g.actor, "SS_EXAM_ARCHIVED", ENTITY, id, { classId: g.classId })
  revalidateExams(g.classId)
}

/**
 * Set one child's score for an exam; `raw` blank clears it (row deleted, "0" is
 * a real mark). Score is 0..total, 2 dp max. The child must be enrolled (live)
 * in the exam's class; clearing an existing mark is always allowed.
 * markedById = the caller. canMarkExam-gated.
 */
export async function setExamScore(examId: number, personId: number, raw: string): Promise<ActionResult> {
  const g = await examGuard(examId)
  if ("error" in g) return { error: g.error }
  if (!isValidPgId(personId)) return { error: "Invalid person" }
  const score = parseScore(raw, g.totalMarks ?? "0")
  if (!score.ok) return { error: score.error }

  try {
    const r = await withLiveClass(g.classId, async (tx) => {
      // Exam may have been archived since the guard.
      const exam = await tx.sundaySchoolExam.findFirst({ where: { id: examId, archivedAt: null }, select: { id: true } })
      if (!exam) throw new Error(EXAM_GONE)
      if (score.value === null) {
        await tx.sundaySchoolExamResult.deleteMany({ where: { examId, personId } })
        return
      }
      // FOR SHARE on enrolment + Person: a concurrent move/unenrol/archive waits.
      // nosemgrep: crm-no-raw-sql — row lock; Prisma has no locking API
      const enrolled = await tx.$queryRaw<{ personId: number }[]>`
        SELECT e."personId" FROM "SundaySchoolEnrolment" e JOIN "Person" p ON p.id = e."personId"
        WHERE e."classId" = ${g.classId} AND e."personId" = ${personId} AND p."archivedAt" IS NULL FOR SHARE`
      if (enrolled.length === 0) throw new Error(NOT_IN_CLASS)
      await tx.sundaySchoolExamResult.upsert({
        where: { examId_personId: { examId, personId } },
        create: { examId, personId, score: score.value, markedById: g.actor },
        update: { score: score.value, markedById: g.actor },
      })
    })
    if (!r.live) return { error: r.error }
  } catch (e) {
    if (e instanceof Error && (e.message === EXAM_GONE || e.message === NOT_IN_CLASS)) return { error: e.message }
    throw e
  }
  await logAudit(g.actor, "SS_EXAM_SCORE_SET", ENTITY, examId, { personId, cleared: score.value === null })
  revalidateExams(g.classId)
}
