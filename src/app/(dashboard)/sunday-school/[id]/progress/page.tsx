import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"
import { canBrowseSundaySchool } from "@/lib/roleGuard"
import { formatPercent, skippedNote } from "@/lib/sundaySchoolStats"
import { loadClassStats } from "@/lib/sundaySchoolStatsLoad"
import { parseRouteId } from "@/lib/validation"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ProgressStats } from "@/components/sunday-school/ProgressStats"

/**
 * One class's progress: class attendance rate + exam average, then one row per
 * enrolled child linking to their detail. canBrowseSundaySchool to view; names
 * only (no /people links), so HEADMASTER and VIEWER see the same page.
 */
export default async function ClassProgressPage(props: Readonly<{ params: Promise<{ id: string }> }>) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (!canBrowseSundaySchool(session.user.role)) redirect("/")
  const id = parseRouteId((await props.params).id)
  if (id === null) notFound()
  const [row] = await loadClassStats({ id })
  if (!row) notFound()
  const c = row.stats
  const meta = [`Level ${c.level}`, c.location, String(row.year)].filter(Boolean).join(" · ")

  return (
    <div className="space-y-4 xl:max-w-4xl">
      <div>
        <p className="text-sm text-muted-foreground mb-1">
          <Link href={`/sunday-school/progress?year=${row.year}`} className="hover:underline">Progress</Link>
          {" / "}
          <Link href={`/sunday-school/${c.id}`} className="hover:underline">{c.name}</Link>
        </p>
        <h2 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
          {c.name} progress
          {row.archived && <Badge variant="secondary">Archived</Badge>}
        </h2>
        <p className="text-sm text-muted-foreground">{meta}</p>
      </div>

      <Card>
        <CardContent>
          <ProgressStats attendance={c.attendance} exams={c.exams} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Students ({c.enrolled})</CardTitle></CardHeader>
        <CardContent>
          {c.students.length === 0 ? (
            <p className="text-sm text-muted-foreground">No students enrolled.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th scope="col" className="py-2 pr-2 font-medium">Student</th>
                  <th scope="col" className="py-2 pr-2 text-right font-medium">Attendance</th>
                  <th scope="col" className="py-2 text-right font-medium">Exams</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {c.students.map((s) => (
                  <tr key={s.personId}>
                    <td className="py-2 pr-2">
                      <Link href={`/sunday-school/${c.id}/progress/${s.personId}`} className="inline-flex min-h-11 items-center font-medium text-foreground underline-offset-2 hover:underline sm:min-h-0">
                        {s.name}
                      </Link>
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">
                      {formatPercent(s.attendance.rate)}
                      <span className="block text-xs text-muted-foreground">{s.attendance.attended}/{s.attendance.marked}</span>
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatPercent(s.exams.averagePercent)}
                      <span className="block text-xs text-muted-foreground">{s.exams.results} {s.exams.results === 1 ? "result" : "results"}</span>
                      {s.exams.skipped > 0 && <span className="block text-xs text-warning">{skippedNote(s.exams)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
