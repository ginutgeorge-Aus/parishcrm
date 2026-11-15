// Sunday School enrolment import: plan (validate + match against the DB) and
// apply. Matching follows the family/person importer: family by exact
// (live) name, person by (familyId, firstName, lastName) — the DB unique — here
// compared case-insensitively. Class: by name within the year (+ location when
// two share a name). Both functions run on the caller's transaction client.

import type { Prisma } from "@/lib/generated/prisma/client"
import { parseEnrolmentCsv, type EnrolCsvRow } from "@/lib/sundaySchoolCsv"

export type EnrolPlanStatus = "enrol" | "move" | "unchanged" | "error"

/** One previewed row. `message` is set for errors and moves. */
export type EnrolPlanRow = {
  row: number
  student: string
  familyName: string
  className: string
  status: EnrolPlanStatus
  message?: string
  personId?: number
  classId?: number
}

export type EnrolPlan = {
  rows: EnrolPlanRow[]
  /** Parse-level errors (row 0 / header / dropped duplicates). */
  parseErrors: Array<{ row: number; message: string }>
  /** Total blocking errors: parse errors plus unmatched rows. */
  errorCount: number
}

const low = (s: string) => s.toLowerCase()

/**
 * Parse `content` and match every row to a live person and a live class in
 * `year`. Nothing is written. A person already in the target class is
 * "unchanged" (makes re-import idempotent); one in another class this year is a
 * "move"; otherwise "enrol".
 * @param tx a transaction client (or prisma)
 * @param year school year the classes belong to
 * @param content raw CSV text
 */
export async function planEnrolmentImport(tx: Prisma.TransactionClient, year: number, content: string): Promise<EnrolPlan> {
  const parsed = parseEnrolmentCsv(content)
  const classes = await tx.sundaySchoolClass.findMany({
    where: { year, archivedAt: null },
    select: { id: true, name: true, location: true },
  })
  const families = parsed.rows.length === 0 ? [] : await tx.family.findMany({
    where: { archivedAt: null, name: { in: [...new Set(parsed.rows.map((r) => r.familyName))] } },
    select: { id: true, name: true, people: { where: { archivedAt: null }, select: { id: true, firstName: true, lastName: true } } },
  })
  const people = new Map<string, Array<{ id: number }>>()
  for (const f of families) {
    for (const m of f.people) {
      const k = [f.name, m.firstName, m.lastName].map(low).join("\u0000")
      people.set(k, [...(people.get(k) ?? []), { id: m.id }])
    }
  }
  const matched = parsed.rows.map((r) => matchRow(r, classes, people))
  const existing = await tx.sundaySchoolEnrolment.findMany({
    where: { year, personId: { in: matched.flatMap((m) => (m.personId ? [m.personId] : [])) } },
    select: { personId: true, classId: true },
  })
  const current = new Map(existing.map((e) => [e.personId, e.classId]))
  const rows = matched.map((m) => {
    if (m.status === "error" || m.personId === undefined || m.classId === undefined) return m
    const at = current.get(m.personId)
    if (at === m.classId) return { ...m, status: "unchanged" as const }
    return at === undefined ? m : { ...m, status: "move" as const, message: "Moves from another class this year" }
  })
  const bad = rows.filter((r) => r.status === "error").length
  return { rows, parseErrors: parsed.errors, errorCount: bad + parsed.errors.length }
}

/** Match one CSV row to a class and person; error rows carry a message. */
function matchRow(
  r: EnrolCsvRow,
  classes: Array<{ id: number; name: string; location: string }>,
  people: Map<string, Array<{ id: number }>>,
): EnrolPlanRow {
  const base = { row: r.row, student: `${r.firstName} ${r.lastName}`, familyName: r.familyName, className: r.className }
  const fail = (message: string): EnrolPlanRow => ({ ...base, status: "error", message })
  const p = people.get([r.familyName, r.firstName, r.lastName].map(low).join("\u0000")) ?? []
  if (p.length === 0) return fail("No matching person in that family")
  if (p.length > 1) return fail("More than one matching person")
  const named = classes.filter((c) => low(c.name) === low(r.className))
  const hits = r.location === undefined ? named : named.filter((c) => low(c.location) === low(r.location ?? ""))
  if (hits.length === 0) return fail("No matching class in this year")
  if (hits.length > 1) return fail("Several classes share this name — add a location column")
  return { ...base, status: "enrol", personId: p[0].id, classId: hits[0].id }
}

/**
 * Write the enrolments of a clean plan. Per class: people enrolled elsewhere
 * this year are re-pointed (enrolledAt restarts, as in enrolChildren), then
 * the rest are inserted; createMany skipDuplicates keeps a concurrent
 * re-import from creating duplicates. Caller holds the year/class/person locks.
 * @param tx the caller's transaction
 * @param year school year
 * @param plan a plan with no errors
 * @returns counts of new and moved enrolments
 */
export async function applyEnrolmentPlan(
  tx: Prisma.TransactionClient,
  year: number,
  plan: EnrolPlan,
): Promise<{ enrolled: number; moved: number; unchanged: number }> {
  const byClass = new Map<number, number[]>()
  let unchanged = 0
  for (const r of plan.rows) {
    if (r.status === "unchanged") { unchanged++; continue }
    if (r.classId === undefined || r.personId === undefined) continue
    byClass.set(r.classId, [...(byClass.get(r.classId) ?? []), r.personId])
  }
  let enrolled = 0
  let moved = 0
  for (const [classId, personIds] of [...byClass].sort((a, b) => a[0] - b[0])) {
    const m = await tx.sundaySchoolEnrolment.updateMany({
      where: { personId: { in: personIds }, year, classId: { not: classId } },
      data: { classId, enrolledAt: new Date() },
    })
    const c = await tx.sundaySchoolEnrolment.createMany({
      data: personIds.map((personId) => ({ classId, personId, year })),
      skipDuplicates: true,
    })
    moved += m.count
    enrolled += c.count
  }
  return { enrolled, moved, unchanged }
}
