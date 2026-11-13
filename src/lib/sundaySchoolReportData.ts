// Sunday School reports (OSS-13): load one school year's classes, enrolled
// children, roll marks and exam results for buildReport (sundaySchoolReport.ts).
import { prisma } from "@/lib/prisma"
import type { ReportInput } from "@/lib/sundaySchoolReport"

/**
 * Load report data for a school year. Active (non-archived) classes only,
 * narrowed to `classId` when given; children are current enrolments of
 * non-archived people; exams exclude archived ones. Names only, no contact
 * details, so nothing here is decrypted.
 * @param year school year
 * @param classId one class, or null for every class in the year
 */
export async function loadReportInput(year: number, classId: number | null): Promise<ReportInput> {
  const classes = await prisma.sundaySchoolClass.findMany({
    where: { year, archivedAt: null, ...(classId === null ? {} : { id: classId }) },
    select: { id: true, name: true, level: true, location: true },
  })
  if (classes.length === 0) return { year, classes, children: [], marks: [], exams: [], results: [] }
  const classIds = { in: classes.map((c) => c.id) }

  const [enrolments, attendance, exams] = await Promise.all([
    prisma.sundaySchoolEnrolment.findMany({
      where: { classId: classIds, year, person: { archivedAt: null } },
      select: { classId: true, person: { select: { id: true, firstName: true, lastName: true, family: { select: { name: true } } } } },
    }),
    prisma.sundaySchoolAttendance.findMany({
      where: { session: { classId: classIds } },
      select: { personId: true, status: true, session: { select: { classId: true } } },
    }),
    prisma.sundaySchoolExam.findMany({
      where: { classId: classIds, year, archivedAt: null },
      select: { id: true, classId: true, name: true, date: true, totalMarks: true },
    }),
  ])
  const results = exams.length === 0
    ? []
    : await prisma.sundaySchoolExamResult.findMany({
      where: { examId: { in: exams.map((e) => e.id) } },
      select: { examId: true, personId: true, score: true },
    })

  return {
    year,
    classes,
    children: enrolments.map((e) => ({
      personId: e.person.id,
      firstName: e.person.firstName,
      lastName: e.person.lastName,
      familyName: e.person.family.name,
      classId: e.classId,
    })),
    marks: attendance.map((a) => ({ personId: a.personId, classId: a.session.classId, status: a.status })),
    exams: exams.map((e) => ({ ...e, totalMarks: e.totalMarks.toString() })),
    results: results.map((r) => ({ examId: r.examId, personId: r.personId, score: r.score.toString() })),
  }
}
