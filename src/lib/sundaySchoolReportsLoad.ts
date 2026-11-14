import { prisma } from "@/lib/prisma"
import type { ReportInput } from "@/lib/sundaySchoolReports"

/**
 * A class's school year, or null when the class does not exist.
 * @param classId the class
 */
export async function classYear(classId: number): Promise<number | null> {
  const row = await prisma.sundaySchoolClass.findUnique({ where: { id: classId }, select: { year: true } })
  return row?.year ?? null
}

/**
 * Load one class's rolls, live exams and enrolled children for a date range
 * (inclusive `@db.Date` bounds). Children are enrolled, non-archived, ordered by
 * last then first name (same as the progress pages). Callers gate access first.
 * @param classId the class
 * @param from range start (UTC midnight)
 * @param to range end (UTC midnight)
 * @returns the report input, or null when the class does not exist
 */
export async function loadReportInput(classId: number, from: Date, to: Date): Promise<ReportInput | null> {
  const cls = await prisma.sundaySchoolClass.findUnique({
    where: { id: classId },
    select: {
      name: true,
      enrolments: {
        where: { person: { archivedAt: null } },
        orderBy: [{ person: { lastName: "asc" } }, { person: { firstName: "asc" } }],
        select: { enrolledAt: true, person: { select: { id: true, firstName: true, lastName: true } } },
      },
      sessions: {
        where: { date: { gte: from, lte: to } },
        orderBy: { date: "asc" },
        select: { date: true, attendance: { select: { personId: true, status: true } } },
      },
      exams: {
        where: { archivedAt: null, date: { gte: from, lte: to } },
        orderBy: [{ date: "asc" }, { id: "asc" }],
        select: { id: true, name: true, date: true, totalMarks: true, results: { select: { personId: true, score: true } } },
      },
    },
  })
  if (!cls) return null
  return {
    className: cls.name,
    students: cls.enrolments.map((e) => ({ personId: e.person.id, name: `${e.person.firstName} ${e.person.lastName}`, enrolledAt: e.enrolledAt })),
    sessions: cls.sessions.map((s) => ({ date: s.date, marks: s.attendance })),
    exams: cls.exams.map((e) => ({
      id: e.id, name: e.name, date: e.date, totalMarks: e.totalMarks.toString(),
      results: e.results.map((r) => ({ personId: r.personId, score: r.score.toString() })),
    })),
  }
}
