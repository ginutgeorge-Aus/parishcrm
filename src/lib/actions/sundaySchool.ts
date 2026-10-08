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
import { canEdit } from "@/lib/roleGuard"
import { isP2002, isValidPgId, MIN_YEAR, MAX_YEAR } from "@/lib/validation"
import { ClassFormSchema, planRollover } from "@/lib/sundaySchool"
import type { ActionResult, ActionResultWithSuccess } from "./types"

const MAX_BATCH = 200
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
    const created = await prisma.sundaySchoolClass.create({ data: { year, ...form.data }, select: { id: true } })
    id = created.id
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
    await prisma.sundaySchoolClass.update({ where: { id }, data: form.data })
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
  await prisma.sundaySchoolClass.updateMany({ where: { id, archivedAt: null }, data: { archivedAt: new Date() } })
  await logAudit(actorId(g.session), "SS_CLASS_ARCHIVED", ENTITY, id)
  revalidatePath("/sunday-school")
  revalidatePath(`/sunday-school/${id}`)
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
  if (!person) return { error: "Tag this person as a Sunday school teacher first" }

  try {
    await prisma.sundaySchoolTeacher.create({ data: { classId, personId } })
  } catch (e) {
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
  await prisma.sundaySchoolTeacher.deleteMany({ where: { classId, personId } })
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
  if (found.length !== ids.length) return { error: "Person not found" }

  const year = g.cls.year
  const existing = await prisma.sundaySchoolEnrolment.findMany({
    where: { personId: { in: ids }, year },
    select: { personId: true, classId: true, class: { select: { archivedAt: true } } },
  })
  // Only a live class counts as a "move"; a row left in an archived class is
  // simply re-pointed (one enrolment per child per year).
  const movedFrom = existing.filter((e) => e.classId !== classId && !e.class.archivedAt)
  try {
    await prisma.$transaction(
      ids.map((personId) =>
        prisma.sundaySchoolEnrolment.upsert({
          where: { personId_year: { personId, year } },
          create: { classId, personId, year },
          update: { classId },
        }),
      ),
    )
  } catch (e) {
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
  await prisma.sundaySchoolEnrolment.deleteMany({ where: { classId, personId } })
  await logAudit(actorId(g.session), "SS_UNENROLLED", ENTITY, classId, { personId })
  revalidatePath(`/sunday-school/${classId}`)
  revalidatePath("/sunday-school")
}

/**
 * Roll `fromYear` over to the next year in one transaction: copy every live
 * class and its teachers, then move each child up one level at the same
 * location (see planRollover). One-time: refused once next year has classes.
 */
export async function rolloverYear(fromYear: number): Promise<ActionResultWithSuccess> {
  const g = await editor()
  if ("error" in g) return { error: g.error }
  if (!Number.isInteger(fromYear) || fromYear < MIN_YEAR || fromYear >= MAX_YEAR) return { error: "Invalid school year" }
  const toYear = fromYear + 1

  if ((await prisma.sundaySchoolClass.count({ where: { year: toYear, archivedAt: null } })) > 0) {
    return { error: `${toYear} already has classes — roll over is one-time` }
  }
  const source = await prisma.sundaySchoolClass.findMany({
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
  if (source.length === 0) return { error: `No classes in ${fromYear} to roll over` }

  const plan = planRollover(source.map((c) => ({
    id: c.id, name: c.name, level: c.level, location: c.location,
    teacherPersonIds: c.teachers.map((t) => t.personId),
    childPersonIds: c.enrolments.map((e) => e.personId),
  })))

  let newIds: Map<number, number>
  let placed = 0
  try {
    newIds = await prisma.$transaction(async (tx) => {
      const map = new Map<number, number>()
      for (const c of plan.classes) {
        const created = await tx.sundaySchoolClass.create({
          data: { year: toYear, name: c.name, level: c.level, location: c.location },
          select: { id: true },
        })
        map.set(c.sourceId, created.id)
      }
      const teachers = plan.classes.flatMap((c) =>
        c.teacherPersonIds.map((personId) => ({ classId: map.get(c.sourceId)!, personId })))
      if (teachers.length) await tx.sundaySchoolTeacher.createMany({ data: teachers, skipDuplicates: true })
      const enrolments = plan.placements.map((p) => ({ classId: map.get(p.targetSourceId)!, personId: p.personId, year: toYear }))
      // skipDuplicates: a child already enrolled in toYear keeps that place, so
      // report the rows actually written, not the plan.
      if (enrolments.length) placed = (await tx.sundaySchoolEnrolment.createMany({ data: enrolments, skipDuplicates: true })).count
      return map
    })
  } catch (e) {
    // A concurrent rollover, or an archived toYear class with the same name and location.
    if (isP2002(e)) return { error: `${toYear} already has a class with the same name and location (it may be archived) — rename or remove it first` }
    throw e
  }

  const firstId = newIds.values().next().value as number
  await logAudit(actorId(g.session), "SS_ROLLOVER", ENTITY, firstId, {
    fromYear, classes: plan.classes.length, placed, unplaced: plan.unplaced.length,
  })
  revalidatePath("/sunday-school")
  return {
    success: `Created ${plan.classes.length} classes for ${toYear}; moved ${children(placed)}; ${plan.unplaced.length} need placing by hand`,
  }
}
