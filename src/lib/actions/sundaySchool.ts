"use server"

// Sunday School (OSS-9) writes: classes, teachers, enrolment and the yearly
// rollover. View = canViewPeople (pages); every mutation here = canEdit.

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import type { Session } from "next-auth"
import type { z } from "zod"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { logAudit } from "@/lib/audit"
import { assertNotDemo } from "@/lib/demoMode"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@/lib/generated/prisma/client"
import { canEdit } from "@/lib/roleGuard"
import { isP2002, isP2034, isValidPgId, MIN_YEAR, MAX_YEAR } from "@/lib/validation"
import { ClassFormSchema, planRollover } from "@/lib/sundaySchool"
import type { ActionResult, ActionResultWithSuccess } from "./types"

const MAX_BATCH = 200
const PERSON_GONE = "Person not found"
const NOT_TEACHER = "Tag this person as a Sunday school teacher first"
const ENTITY = "SundaySchoolClass"
const DUPLICATE_CLASS = "A class with this name and location already exists for that year (it may be archived)"

type Guard = { error: string } | { session: Session | null }
type ClassGuard = { error: string } | { session: Session | null; cls: { id: number; year: number } }

/** Demo block + editor role. Module-private ("use server" exports must be async actions). */
async function editor(): Promise<Guard> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" }
  return { session }
}

/**
 * Shared guard for actions on an existing class: demo block, editor role, valid
 * id, live (non-archived) class. Returns the session + class year, or an error.
 */
async function editableClass(classId: number): Promise<ClassGuard> {
  const g = await editor()
  if ("error" in g) return g
  if (!isValidPgId(classId)) return { error: "Invalid class" }
  const cls = await prisma.sundaySchoolClass.findFirst({
    where: { id: classId, archivedAt: null },
    select: { id: true, year: true },
  })
  if (!cls) return { error: "Class not found" }
  return { session: g.session, cls }
}

/** Parse the class form; returns the data or the first validation message. */
function parseClassForm(formData: FormData): { error: string } | { data: z.output<typeof ClassFormSchema> } {
  const parsed = ClassFormSchema.safeParse({
    name: formData.get("name") ?? "",
    level: formData.get("level") ?? "",
    location: formData.get("location") ?? undefined,
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" }
  return { data: parsed.data }
}

/** "1 child" / "2 children". */
function children(n: number): string {
  return `${n} ${n === 1 ? "child" : "children"}`
}

/** Create a class in `year` (bound by the page); redirects to the new class. canEdit-gated. */
export async function createClass(year: number, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await editor()
  if ("error" in g) return { error: g.error }
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) return { error: "Invalid school year" }
  const form = parseClassForm(formData)
  if ("error" in form) return { error: form.error }

  let id: number
  try {
    // Same table lock as rolloverYear, so a create and a rollover run one after
    // the other instead of interleaving.
    id = await prisma.$transaction(async (tx) => {
      // nosemgrep: crm-no-raw-sql — table lock; Prisma has no locking API
      await tx.$executeRaw`LOCK TABLE "SundaySchoolClass" IN SHARE ROW EXCLUSIVE MODE`
      return (await tx.sundaySchoolClass.create({ data: { year, ...form.data }, select: { id: true } })).id
    })
  } catch (e) {
    if (isP2002(e)) return { error: DUPLICATE_CLASS }
    throw e
  }
  await logAudit(actorId(g.session), "SS_CLASS_CREATED", ENTITY, id, { year, ...form.data })
  revalidatePath("/sunday-school")
  redirect(`/sunday-school/${id}`)
}

/** Edit a class's name, level and location (year is fixed). Redirects to the class. canEdit-gated. */
export async function updateClass(id: number, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const g = await editableClass(id)
  if ("error" in g) return { error: g.error }
  const form = parseClassForm(formData)
  if ("error" in form) return { error: form.error }

  try {
    // Conditional write: a class archived since editableClass() is left untouched.
    const { count } = await prisma.sundaySchoolClass.updateMany({ where: { id, archivedAt: null }, data: form.data })
    if (count === 0) return { error: "Class not found" }
  } catch (e) {
    if (isP2002(e)) return { error: DUPLICATE_CLASS }
    throw e
  }
  await logAudit(actorId(g.session), "SS_CLASS_UPDATED", ENTITY, id, form.data)
  revalidatePath("/sunday-school")
  revalidatePath(`/sunday-school/${id}`)
  redirect(`/sunday-school/${id}`)
}

/** Archive (never delete) a class so enrolment/attendance history survives. canEdit-gated. */
export async function archiveClass(id: number): Promise<ActionResult> {
  const g = await editableClass(id)
  if ("error" in g) return { error: g.error }
  const { count } = await prisma.sundaySchoolClass.updateMany({ where: { id, archivedAt: null }, data: { archivedAt: new Date() } })
  // Archived by someone else since editableClass(): no row changed, no audit.
  if (count === 0) return { error: "Class not found" }
  await logAudit(actorId(g.session), "SS_CLASS_ARCHIVED", ENTITY, id)
  revalidatePath("/sunday-school")
  revalidatePath(`/sunday-school/${id}`)
}

/**
 * Run `fn` in a transaction holding FOR SHARE on the live class row, so a
 * concurrent archive (an UPDATE needing the row lock) waits until `fn` commits,
 * and `fn` is skipped if the class was archived after the caller's check.
 * Returns false when the class is no longer live.
 */
async function withLiveClass(classId: number, fn: (tx: Prisma.TransactionClient) => Promise<unknown>): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    // nosemgrep: crm-no-raw-sql — row/table lock; Prisma has no locking API
    const rows = await tx.$queryRaw<{ id: number }[]>`
      SELECT id FROM "SundaySchoolClass" WHERE id = ${classId} AND "archivedAt" IS NULL FOR SHARE`
    if (rows.length === 0) return false
    await fn(tx)
    return true
  })
}

/**
 * Assign a teacher. Only live People tagged SUNDAY_SCHOOL_TEACHER qualify, so
 * every teacher is on the clearance compliance list. Duplicate = success.
 */
export async function addTeacher(classId: number, personId: number): Promise<ActionResult> {
  const g = await editableClass(classId)
  if ("error" in g) return { error: g.error }
  if (!isValidPgId(personId)) return { error: "Invalid person" }
  const person = await prisma.person.findFirst({
    where: { id: personId, archivedAt: null, ministryRoles: { has: "SUNDAY_SCHOOL_TEACHER" } },
    select: { id: true },
  })
  if (!person) return { error: NOT_TEACHER }

  try {
    const live = await withLiveClass(classId, async (tx) => {
      // Re-check the tag under FOR SHARE: an untag (UPDATE on Person) waits for
      // this insert, or the insert is refused if the untag committed first.
      // nosemgrep: crm-no-raw-sql — row/table lock; Prisma has no locking API
      const ok = await tx.$queryRaw<{ id: number }[]>`
        SELECT id FROM "Person" WHERE id = ${personId} AND "archivedAt" IS NULL
          AND 'SUNDAY_SCHOOL_TEACHER' = ANY("ministryRoles") FOR SHARE`
      if (ok.length === 0) throw new Error(NOT_TEACHER)
      await tx.sundaySchoolTeacher.create({ data: { classId, personId } })
    })
    if (!live) return { error: "Class not found" }
  } catch (e) {
    if (e instanceof Error && e.message === NOT_TEACHER) return { error: NOT_TEACHER }
    // Already assigned (unique classId_personId) — idempotent.
    if (!isP2002(e)) throw e
  }
  await logAudit(actorId(g.session), "SS_TEACHER_ADDED", ENTITY, classId, { personId })
  revalidatePath(`/sunday-school/${classId}`)
  revalidatePath("/sunday-school")
}

/** Remove a teacher from a class (missing link = success). canEdit-gated. */
export async function removeTeacher(classId: number, personId: number): Promise<ActionResult> {
  const g = await editableClass(classId)
  if ("error" in g) return { error: g.error }
  if (!isValidPgId(personId)) return { error: "Invalid person" }
  if (!(await withLiveClass(classId, (tx) => tx.sundaySchoolTeacher.deleteMany({ where: { classId, personId } })))) {
    return { error: "Class not found" }
  }
  await logAudit(actorId(g.session), "SS_TEACHER_REMOVED", ENTITY, classId, { personId })
  revalidatePath(`/sunday-school/${classId}`)
  revalidatePath("/sunday-school")
}

/**
 * Enrol (or move) children into a class. One class per child per year is a DB
 * unique (personId, year), so an upsert moves a child already enrolled
 * elsewhere this year. canEdit-gated; ids deduped and capped.
 */
export async function enrolChildren(classId: number, personIds: number[]): Promise<ActionResultWithSuccess> {
  const g = await editableClass(classId)
  if ("error" in g) return { error: g.error }
  if (!Array.isArray(personIds)) return { error: "Invalid person" }
  const ids = [...new Set(personIds)]
  if (ids.length === 0) return { error: "Pick at least one child" }
  if (ids.length > MAX_BATCH) return { error: "Too many people at once" }
  if (!ids.every(isValidPgId)) return { error: "Invalid person" }

  const found = await prisma.person.findMany({ where: { id: { in: ids }, archivedAt: null }, select: { id: true } })
  if (found.length !== ids.length) return { error: PERSON_GONE }

  const year = g.cls.year
  const existing = await prisma.sundaySchoolEnrolment.findMany({
    where: { personId: { in: ids }, year },
    select: { personId: true, classId: true, class: { select: { archivedAt: true } } },
  })
  // Only a live class counts as a "move"; a row left in an archived class is
  // simply re-pointed (one enrolment per child per year).
  const movedFrom = existing.filter((e) => e.classId !== classId && !e.class.archivedAt)
  try {
    // FOR SHARE on the class row blocks a concurrent archive (its UPDATE needs
    // the row lock) until the enrolments commit, and fails if it already has.
    const live = await prisma.$transaction(async (tx) => {
      // nosemgrep: crm-no-raw-sql — row/table lock; Prisma has no locking API
      const rows = await tx.$queryRaw<{ id: number }[]>`
        SELECT id FROM "SundaySchoolClass" WHERE id = ${classId} AND "archivedAt" IS NULL FOR SHARE`
      if (rows.length === 0) return false
      // Same for the people: an archive (UPDATE on Person) waits for these
      // enrolments, or they're refused if it already committed.
      // nosemgrep: crm-no-raw-sql — row/table lock; Prisma has no locking API
      const people = await tx.$queryRaw<{ id: number }[]>`
        SELECT id FROM "Person" WHERE id = ANY(${ids}) AND "archivedAt" IS NULL FOR SHARE`
      if (people.length !== ids.length) throw new Error(PERSON_GONE)
      for (const personId of ids) {
        await tx.sundaySchoolEnrolment.upsert({
          where: { personId_year: { personId, year } },
          create: { classId, personId, year },
          update: { classId },
        })
      }
      return true
      // Up to MAX_BATCH sequential upserts — Prisma's 5s default is too tight.
    }, { timeout: 30_000 })
    if (!live) return { error: "Class not found" }
  } catch (e) {
    if (e instanceof Error && e.message === PERSON_GONE) return { error: PERSON_GONE }
    // Two editors enrolling the same child at once: both upserts take the insert path.
    if (isP2002(e)) return { error: "Someone else just changed these enrolments — try again" }
    throw e
  }
  await logAudit(actorId(g.session), "SS_ENROLLED", ENTITY, classId, { personIds: ids, moved: movedFrom.length })
  revalidatePath(`/sunday-school/${classId}`)
  for (const m of new Set(movedFrom.map((e) => e.classId))) revalidatePath(`/sunday-school/${m}`)
  revalidatePath("/sunday-school")
  const movedNote = movedFrom.length ? ` (${movedFrom.length} moved from another class)` : ""
  return { success: `Enrolled ${ids.length}${movedNote}` }
}

/** Remove a child from a class (missing enrolment = success). canEdit-gated. */
export async function unenrolChild(classId: number, personId: number): Promise<ActionResult> {
  const g = await editableClass(classId)
  if ("error" in g) return { error: g.error }
  if (!isValidPgId(personId)) return { error: "Invalid person" }
  if (!(await withLiveClass(classId, (tx) => tx.sundaySchoolEnrolment.deleteMany({ where: { classId, personId } })))) {
    return { error: "Class not found" }
  }
  await logAudit(actorId(g.session), "SS_UNENROLLED", ENTITY, classId, { personId })
  revalidatePath(`/sunday-school/${classId}`)
  revalidatePath("/sunday-school")
}

/**
 * Roll `fromYear` over to the next year in one transaction: copy every live
 * class and its teachers, then move each child up one level at the same
 * location (see planRollover). One-time: refused once next year has any class,
 * archived or not (archived classes still occupy the year). Inside the
 * transaction the class, teacher and enrolment tables are locked first, so
 * in-flight class/teacher/enrolment writes finish before the source is read
 * and new ones wait until the copy commits.
 */
export async function rolloverYear(fromYear: number): Promise<ActionResultWithSuccess> {
  const g = await editor()
  if ("error" in g) return { error: g.error }
  if (!Number.isInteger(fromYear) || fromYear < MIN_YEAR || fromYear >= MAX_YEAR) return { error: "Invalid school year" }
  const toYear = fromYear + 1

  const ALREADY_ROLLED = `${toYear} already has classes — roll over is one-time`
  if ((await prisma.sundaySchoolClass.count({ where: { year: toYear } })) > 0) return { error: ALREADY_ROLLED }
  const NO_SOURCE = `No classes in ${fromYear} to roll over`
  let newIds: Map<number, number>
  let plan: ReturnType<typeof planRollover> = { classes: [], placements: [], unplaced: [] }
  let placed = 0
  try {
    newIds = await prisma.$transaction(async (tx) => {
      // SHARE ROW EXCLUSIVE blocks every insert/update/delete on these tables
      // (and other rollovers) but not plain reads. At READ COMMITTED each later
      // statement sees everything committed before the lock was granted, so the
      // toYear check and the source read below can't miss a concurrent write.
      // nosemgrep: crm-no-raw-sql — row/table lock; Prisma has no locking API
      await tx.$executeRaw`LOCK TABLE "SundaySchoolClass", "SundaySchoolTeacher", "SundaySchoolEnrolment" IN SHARE ROW EXCLUSIVE MODE`
      // Authoritative one-time guard.
      if ((await tx.sundaySchoolClass.count({ where: { year: toYear } })) > 0) throw new Error(ALREADY_ROLLED)
      const source = await tx.sundaySchoolClass.findMany({
        where: { year: fromYear, archivedAt: null },
        orderBy: [{ location: "asc" }, { level: "asc" }, { name: "asc" }],
        select: {
          id: true, name: true, level: true, location: true,
          // Same rule as addTeacher: only people still tagged as teachers carry over.
          teachers: {
            where: { person: { archivedAt: null, ministryRoles: { has: "SUNDAY_SCHOOL_TEACHER" } } },
            select: { personId: true },
          },
          enrolments: { where: { person: { archivedAt: null } }, select: { personId: true } },
        },
      })
      if (source.length === 0) throw new Error(NO_SOURCE)

      plan = planRollover(source.map((c) => ({
        id: c.id, name: c.name, level: c.level, location: c.location,
        teacherPersonIds: c.teachers.map((t) => t.personId),
        childPersonIds: c.enrolments.map((e) => e.personId),
      })))
      // One insert; rows are matched back by (name, location) — unique within a
      // year — so correctness never depends on createManyAndReturn's row order.
      const created = await tx.sundaySchoolClass.createManyAndReturn({
        data: plan.classes.map((c) => ({ year: toYear, name: c.name, level: c.level, location: c.location })),
        select: { id: true, name: true, location: true },
      })
      const key = (name: string, location: string) => `${name}\u0000${location}`
      const idByKey = new Map(created.map((r) => [key(r.name, r.location), r.id]))
      const map = new Map(plan.classes.map((c) => [c.sourceId, idByKey.get(key(c.name, c.location))!]))
      const teachers = plan.classes.flatMap((c) =>
        c.teacherPersonIds.map((personId) => ({ classId: map.get(c.sourceId)!, personId })))
      if (teachers.length) await tx.sundaySchoolTeacher.createMany({ data: teachers, skipDuplicates: true })
      const enrolments = plan.placements.map((p) => ({ classId: map.get(p.targetSourceId)!, personId: p.personId, year: toYear }))
      // skipDuplicates: a child already enrolled in toYear keeps that place, so
      // report the rows actually written, not the plan.
      if (enrolments.length) placed = (await tx.sundaySchoolEnrolment.createMany({ data: enrolments, skipDuplicates: true })).count
      return map
      // LOCK TABLE may wait out an in-flight enrol batch (30s timeout) first.
    }, { isolationLevel: "ReadCommitted", timeout: 60_000 })
  } catch (e) {
    if (e instanceof Error && (e.message === ALREADY_ROLLED || e.message === NO_SOURCE)) return { error: e.message }
    // Deadlock/serialization failure (P2034): a concurrent write collided with the lock.
    if (isP2034(e)) {
      return { error: `${toYear} was changed by someone else during roll over — try again` }
    }
    // A concurrent rollover, or an archived toYear class with the same name and location.
    if (isP2002(e)) return { error: `${toYear} already has a class with the same name and location (it may be archived) — rename or remove it first` }
    throw e
  }

  // Planned moves skipped by skipDuplicates (child already enrolled in toYear)
  // are not placed by us either — count them as needing a hand.
  const needPlacing = plan.unplaced.length + (plan.placements.length - placed)
  const firstId = Math.min(...newIds.values())
  await logAudit(actorId(g.session), "SS_ROLLOVER", ENTITY, firstId, {
    fromYear, classes: plan.classes.length, placed, unplaced: needPlacing,
  })
  revalidatePath("/sunday-school")
  return {
    success: `Created ${plan.classes.length} classes for ${toYear}; moved ${children(placed)}; ${needPlacing} need placing by hand`,
  }
}
