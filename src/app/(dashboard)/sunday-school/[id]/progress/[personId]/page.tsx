import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { canBrowseSundaySchool } from "@/lib/roleGuard"
import { ATTENDANCE_LABELS } from "@/lib/sundaySchoolRollView"
import { formatLongDate } from "@/lib/formatting"
import { beforeEnrolment, formatPercent, summariseAttendance, summariseExams } from "@/lib/sundaySchoolStats"
import { parseRouteId } from "@/lib/validation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ProgressStats } from "@/components/sunday-school/ProgressStats"

type Props = { params: Promise<{ id: string; personId: string }> }

/**
 * One child's progress in one class: every roll and every live exam with their
 * score. Unmarked rolls and unscored exams dated before the child's enrolment
 * day are left out (they predate the child); any mark or score is always shown
 * and counted, matching the class and grade figures. The child must be
 * enrolled in this class (else 404),
 * so the route can't be used to read any person's name. Names only, no
 * contact data or /people links. canBrowseSundaySchool to view.
 */
export default async function StudentProgressPage(props: Readonly<Props>) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (!canBrowseSundaySchool(session.user.role)) redirect("/")
  const params = await props.params
  const classId = parseRouteId(params.id)
  const personId = parseRouteId(params.personId)
  if (classId === null || personId === null) notFound()

  const enrolment = await prisma.sundaySchoolEnrolment.findFirst({
    where: { classId, personId, person: { archivedAt: null } },
    select: {
      enrolledAt: true,
      person: { select: { firstName: true, lastName: true } },
      class: { select: { name: true, year: true } },
    },
  })
  if (!enrolment) notFound()
  const [sessions, exams] = await Promise.all([
    prisma.sundaySchoolSession.findMany({
      where: { classId },
      orderBy: { date: "desc" },
      select: { id: true, date: true, attendance: { where: { personId }, select: { status: true } } },
    }),
    prisma.sundaySchoolExam.findMany({
      where: { classId, archivedAt: null },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      select: { id: true, name: true, date: true, totalMarks: true, results: { where: { personId }, select: { score: true } } },
    }),
  ])

  const { enrolledAt } = enrolment
  const rolls = sessions
    .map((s) => ({ id: s.id, date: s.date, status: s.attendance[0]?.status ?? null }))
    .filter((r) => r.status !== null || !beforeEnrolment(r.date, enrolledAt))
  const marks = exams
    .map((e) => {
      const total = e.totalMarks.toString()
      const score = e.results[0]?.score.toString() ?? null
      const percent = score === null ? null : summariseExams([{ score, totalMarks: total }]).averagePercent
      return { id: e.id, name: e.name, date: e.date, total, score, percent }
    })
    .filter((m) => m.score !== null || !beforeEnrolment(m.date, enrolledAt))
  const attendance = summariseAttendance(rolls.map((r) => r.status))
  const examSummary = summariseExams(marks.flatMap((m) => (m.score === null ? [] : [{ score: m.score, totalMarks: m.total }])))
  const name = `${enrolment.person.firstName} ${enrolment.person.lastName}`

  return (
    <div className="space-y-4 xl:max-w-4xl">
      <div>
        <p className="text-sm text-muted-foreground mb-1">
          <Link href={`/sunday-school/${classId}/progress`} className="hover:underline">{enrolment.class.name} progress</Link>
          {` / ${name}`}
        </p>
        <h2 className="text-2xl font-semibold text-foreground">{name}</h2>
        <p className="text-sm text-muted-foreground">{enrolment.class.name} · {enrolment.class.year}</p>
      </div>

      <Card>
        <CardContent>
          <ProgressStats attendance={attendance} exams={examSummary} />
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Exams</CardTitle></CardHeader>
          <CardContent>
            {marks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No exams yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {marks.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                    <span>
                      <span className="font-medium text-foreground">{m.name}</span>
                      <span className="block text-xs text-muted-foreground">{formatLongDate(m.date)}</span>
                    </span>
                    <span className="tabular-nums text-right">
                      {m.score === null ? (
                        <span className="text-muted-foreground">Not marked</span>
                      ) : (
                        <>
                          {m.score} / {m.total}
                          <span className="block text-xs text-muted-foreground">{formatPercent(m.percent)}</span>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Rolls</CardTitle></CardHeader>
          <CardContent>
            {rolls.length === 0 ? (
              <p className="text-sm text-muted-foreground">No rolls taken yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {rolls.map((r) => (
                  <li key={r.id} className="flex justify-between gap-2 py-2 text-sm">
                    <span className="text-foreground">{formatLongDate(r.date)}</span>
                    <span className={r.status === null ? "text-muted-foreground" : "text-foreground"}>
                      {r.status === null ? "Not marked" : ATTENDANCE_LABELS[r.status]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
