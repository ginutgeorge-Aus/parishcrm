import { prisma } from "@/lib/prisma"
import { classStats, type ClassStats } from "@/lib/sundaySchoolStats"

/** One loaded class: its stats plus the year/archived flags pages need for headers. */
export type LoadedClassStats = { year: number; archived: boolean; stats: ClassStats }

/**
 * Load attendance + exam stats for the matching classes. Counts enrolled,
 * non-archived children and non-archived exams only; children are ordered by
 * last then first name. Attendance is counted in the DB in one grouped query
 * (per child and status, each child only on their own class's rolls), so no
 * per-mark rows reach Node. Callers gate access (canBrowseSundaySchool) first.
 * @param where one school year or one class (archived classes included). Limited
 *   to these so each child is enrolled in at most one loaded class (enrolment is
 *   unique per person per year) and the grouped counts map back to one class.
 * @param opts `students: false` drops the per-child rows (class totals only), for pages that don't show them
 */
export async function loadClassStats(
  where: { year: number } | { id: number },
  opts: { students?: boolean } = {},
): Promise<LoadedClassStats[]> {
  const rows = await prisma.sundaySchoolClass.findMany({
    where,
    orderBy: [{ level: "asc" }, { location: "asc" }, { name: "asc" }],
    select: {
      id: true, name: true, level: true, location: true, year: true, archivedAt: true,
      enrolments: {
        where: { person: { archivedAt: null } },
        orderBy: [{ person: { lastName: "asc" } }, { person: { firstName: "asc" } }],
        select: { person: { select: { id: true, firstName: true, lastName: true } } },
      },
      exams: {
        where: { archivedAt: null },
        select: { totalMarks: true, results: { select: { personId: true, score: true } } },
      },
    },
  })
  // One grouped count for all classes: at most (enrolled children x 3 statuses)
  // rows. Each OR branch pairs a class with only its own enrolled children.
  const branches = rows
    .filter((c) => c.enrolments.length > 0)
    .map((c) => ({ session: { classId: c.id }, personId: { in: c.enrolments.map((e) => e.person.id) } }))
  const grouped = branches.length === 0 ? [] : await prisma.sundaySchoolAttendance.groupBy({
    by: ["personId", "status"],
    where: { OR: branches },
    _count: { _all: true },
  })
  const counts = new Map<number, { personId: number; status: (typeof grouped)[number]["status"]; count: number }[]>()
  for (const g of grouped) {
    counts.set(g.personId, [...(counts.get(g.personId) ?? []), { personId: g.personId, status: g.status, count: g._count._all }])
  }
  const keepStudents = opts.students ?? true
  return rows.map((c) => {
    const stats = classStats({
      id: c.id,
      name: c.name,
      level: c.level,
      location: c.location,
      students: c.enrolments.map(({ person: p }) => ({ personId: p.id, name: `${p.firstName} ${p.lastName}` })),
      attendance: c.enrolments.flatMap((e) => counts.get(e.person.id) ?? []),
      exams: c.exams.map((e) => ({
        totalMarks: e.totalMarks.toString(),
        results: e.results.map((r) => ({ personId: r.personId, score: r.score.toString() })),
      })),
    })
    return { year: c.year, archived: c.archivedAt !== null, stats: keepStudents ? stats : { ...stats, students: [] } }
  })
}
