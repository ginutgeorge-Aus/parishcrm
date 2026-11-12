import Link from "next/link"
import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { lockedYears } from "@/lib/sundaySchoolYearLock"
import { Badge } from "@/components/ui/badge"
import { ExamPanel } from "@/components/sunday-school/ExamPanel"
import { ExamMarksForm } from "@/components/sunday-school/ExamMarksForm"

/**
 * Server-rendered exam list shared by the staff (`/sunday-school/[id]/exams`)
 * and teacher (`/my-classes/[id]/exams`) pages. Callers gate access and decide
 * `canMark`. Child names only, no contact data. Archived class or locked year
 * is read-only.
 */
export async function renderExamList({
  classId, canMark, hrefBase, backHref, backLabel,
}: Readonly<{ classId: number; canMark: boolean; hrefBase: string; backHref: string; backLabel: string }>) {
  const cls = await prisma.sundaySchoolClass.findUnique({
    where: { id: classId },
    select: {
      name: true, year: true, archivedAt: true,
      enrolments: { where: { person: { archivedAt: null } }, select: { personId: true } },
      exams: {
        where: { archivedAt: null },
        orderBy: [{ date: "desc" }, { id: "desc" }],
        select: {
          id: true, name: true, date: true, totalMarks: true,
          // "N of M marked": only children still enrolled (and not archived),
          // matching enrolledCount — a moved-out child's old mark isn't counted.
          _count: { select: { results: { where: { person: { archivedAt: null, sundaySchoolEnrolments: { some: { classId } } } } } } },
        },
      },
    },
  })
  if (!cls) notFound()
  const locked = (await lockedYears([cls.year])).has(cls.year)
  const exams = cls.exams.map(e => ({
    id: e.id, name: e.name, date: e.date.toISOString().slice(0, 10), totalMarks: e.totalMarks.toString(), marked: e._count.results,
  }))

  return (
    <div className="mx-auto max-w-2xl">
      <Link href={backHref} className="mb-1 inline-block text-xs text-muted-foreground hover:text-foreground">← {backLabel}</Link>
      <h1 className="mb-4 flex items-center gap-2 text-2xl font-bold text-foreground">
        Exams · {cls.name}
        {cls.archivedAt && <Badge variant="secondary">Archived</Badge>}
        {locked && <Badge variant="secondary">Locked</Badge>}
      </h1>
      <ExamPanel
        classId={classId}
        year={cls.year}
        exams={exams}
        enrolledCount={cls.enrolments.length}
        hrefBase={hrefBase}
        readOnly={!canMark || locked || cls.archivedAt !== null}
      />
    </div>
  )
}

/**
 * Server-rendered marks page for one exam. The exam must belong to `classId`
 * (a mismatched or archived exam 404s). Callers gate access and decide `canMark`.
 */
export async function renderExamMarks({
  classId, examId, canMark, backHref, backLabel,
}: Readonly<{ classId: number; examId: number; canMark: boolean; backHref: string; backLabel: string }>) {
  const exam = await prisma.sundaySchoolExam.findFirst({
    where: { id: examId, classId, archivedAt: null },
    select: {
      name: true, date: true, totalMarks: true, year: true,
      class: { select: { name: true, archivedAt: true } },
      results: { select: { personId: true, score: true } },
    },
  })
  if (!exam) notFound()
  const [locked, enrolments] = await Promise.all([
    lockedYears([exam.year]).then(s => s.has(exam.year)),
    prisma.sundaySchoolEnrolment.findMany({
      where: { classId, person: { archivedAt: null } },
      orderBy: [{ person: { lastName: "asc" } }, { person: { firstName: "asc" } }],
      select: { person: { select: { id: true, firstName: true, lastName: true } } },
    }),
  ])
  const scores = new Map(exam.results.map(r => [r.personId, r.score.toString()]))
  const rows = enrolments.map(({ person: p }) => ({ personId: p.id, name: `${p.firstName} ${p.lastName}`, score: scores.get(p.id) ?? null }))
  const totalMarks = exam.totalMarks.toString()

  return (
    <div className="mx-auto max-w-2xl">
      <Link href={backHref} className="mb-1 inline-block text-xs text-muted-foreground hover:text-foreground">← {backLabel}</Link>
      <h1 className="mb-1 flex items-center gap-2 text-2xl font-bold text-foreground">
        {exam.name}
        {locked && <Badge variant="secondary">Locked</Badge>}
      </h1>
      <p className="mb-4 text-sm text-muted-foreground">{exam.class.name} · out of {totalMarks}</p>
      <ExamMarksForm
        examId={examId}
        totalMarks={totalMarks}
        rows={rows}
        readOnly={!canMark || locked || exam.class.archivedAt !== null}
      />
    </div>
  )
}
