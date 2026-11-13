import { prisma } from "@/lib/prisma"
import type { Prisma } from "@/lib/generated/prisma/client"
import { classStats, type ClassStats } from "@/lib/sundaySchoolStats"

/** One loaded class: its stats plus the year/archived flags pages need for headers. */
export type LoadedClassStats = { year: number; archived: boolean; stats: ClassStats }

/**
 * Load attendance + exam stats for the matching classes. Counts enrolled,
 * non-archived children and non-archived exams only; children are ordered by
 * last then first name. Callers gate access (canBrowseSundaySchool) first.
 * @param where which classes, e.g. `{ year, archivedAt: null }` or `{ id }`
 */
export async function loadClassStats(where: Prisma.SundaySchoolClassWhereInput): Promise<LoadedClassStats[]> {
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
      sessions: { select: { attendance: { select: { personId: true, status: true } } } },
      exams: {
        where: { archivedAt: null },
        select: { totalMarks: true, results: { select: { personId: true, score: true } } },
      },
    },
  })
  return rows.map((c) => ({
    year: c.year,
    archived: c.archivedAt !== null,
    stats: classStats({
      id: c.id,
      name: c.name,
      level: c.level,
      location: c.location,
      students: c.enrolments.map(({ person: p }) => ({ personId: p.id, name: `${p.firstName} ${p.lastName}` })),
      attendance: c.sessions.flatMap((s) => s.attendance),
      exams: c.exams.map((e) => ({
        totalMarks: e.totalMarks.toString(),
        results: e.results.map((r) => ({ personId: r.personId, score: r.score.toString() })),
      })),
    }),
  }))
}
