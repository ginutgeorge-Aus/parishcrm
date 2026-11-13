import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { canBrowseSundaySchool } from "@/lib/roleGuard"
import { parseSchoolYear } from "@/lib/sundaySchool"
import { gradeStats } from "@/lib/sundaySchoolStats"
import { loadClassStats } from "@/lib/sundaySchoolStatsLoad"
import { MIN_YEAR, MAX_YEAR } from "@/lib/validation"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { ProgressStats } from "@/components/sunday-school/ProgressStats"

type Props = { searchParams: Promise<{ year?: string }> }

/**
 * Sunday School progress for one school year: attendance rate and exam
 * average per grade (class level) and per class, each class linking to its
 * per-child view. Archived classes are included (badged) so grade totals match
 * the class pages. canBrowseSundaySchool to view; read-only.
 */
export default async function SundaySchoolProgressPage(props: Readonly<Props>) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (!canBrowseSundaySchool(session.user.role)) redirect("/")
  const year = parseSchoolYear((await props.searchParams).year)
  const rows = await loadClassStats({ year })
  const grades = gradeStats(rows.map((r) => r.stats))

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground mb-1">
          <Link href={`/sunday-school?year=${year}`} className="hover:underline">Sunday School</Link>
          {" / Progress"}
        </p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-2xl font-semibold text-foreground">Progress</h2>
          <nav aria-label="School year" className="flex items-center gap-3 text-sm">
            {year > MIN_YEAR && (
              <Link href={`/sunday-school/progress?year=${year - 1}`} className="text-muted-foreground underline hover:text-foreground min-h-11 inline-flex items-center sm:min-h-0">
                ← {year - 1}
              </Link>
            )}
            <span className="font-medium text-foreground" aria-current="page">{year}</span>
            {year < MAX_YEAR && (
              <Link href={`/sunday-school/progress?year=${year + 1}`} className="text-muted-foreground underline hover:text-foreground min-h-11 inline-flex items-center sm:min-h-0">
                {year + 1} →
              </Link>
            )}
          </nav>
        </div>
        <p className="text-sm text-muted-foreground">
          Attendance = present or late, out of rolls marked. Exams = average score as a percent of each exam&apos;s total.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No classes for {year}.</p>
      ) : (
        <>
          <section className="space-y-2">
            <h3 className="text-lg font-semibold text-foreground">By grade</h3>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {grades.map((g) => (
                <Card key={g.level}>
                  <CardContent className="space-y-1">
                    <p className="font-medium text-foreground">Level {g.level}</p>
                    <p className="text-sm text-muted-foreground">
                      {g.classCount} {g.classCount === 1 ? "class" : "classes"} · {g.enrolled} {g.enrolled === 1 ? "child" : "children"}
                    </p>
                    <ProgressStats attendance={g.attendance} exams={g.exams} />
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-lg font-semibold text-foreground">By class</h3>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {rows.map(({ stats: c, archived }) => (
                <Link key={c.id} href={`/sunday-school/${c.id}/progress`} className="block rounded-xl focus-visible:outline-2 focus-visible:outline-ring">
                  <Card className="h-full transition-colors hover:bg-muted/50">
                    <CardContent className="space-y-1">
                      <p className="flex items-center gap-2 font-medium text-foreground">
                        {c.name}
                        {archived && <Badge variant="secondary">Archived</Badge>}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {[`Level ${c.level}`, c.location].filter(Boolean).join(" · ")} · {c.enrolled} {c.enrolled === 1 ? "child" : "children"}
                      </p>
                      <ProgressStats attendance={c.attendance} exams={c.exams} />
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
