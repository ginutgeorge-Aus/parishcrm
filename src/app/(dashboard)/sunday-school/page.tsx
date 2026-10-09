import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { canEdit, canViewPeople } from "@/lib/roleGuard"
import { parseSchoolYear } from "@/lib/sundaySchool"
import { MIN_YEAR, MAX_YEAR } from "@/lib/validation"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { RolloverButton } from "@/components/sunday-school/RolloverButton"

type Props = { searchParams: Promise<{ year?: string }> }

/** Sunday School classes for one school year, grouped by location. canViewPeople to view; canEdit sees controls. */
export default async function SundaySchoolPage(props: Readonly<Props>) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (!canViewPeople(session.user.role)) redirect("/")
  const sp = await props.searchParams
  const year = parseSchoolYear(sp.year)
  const editor = canEdit(session.user.role)

  const classes = await prisma.sundaySchoolClass.findMany({
    where: { year, archivedAt: null },
    orderBy: [{ location: "asc" }, { level: "asc" }, { name: "asc" }],
    select: {
      id: true, name: true, level: true, location: true,
      teachers: { where: { person: { archivedAt: null } }, select: { person: { select: { firstName: true, lastName: true } } } },
      _count: { select: { enrolments: { where: { person: { archivedAt: null } } } } },
    },
  })
  // Rollover is one-time: only offered while next year is still empty.
  const canRollover = editor && classes.length > 0 && year < MAX_YEAR
    && (await prisma.sundaySchoolClass.count({ where: { year: year + 1, archivedAt: null } })) === 0

  const groups = new Map<string, typeof classes>()
  for (const c of classes) groups.set(c.location, [...(groups.get(c.location) ?? []), c])
  const showHeadings = groups.size > 1

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-semibold text-foreground">Sunday School</h2>
        <nav aria-label="School year" className="flex items-center gap-3 text-sm">
          {year > MIN_YEAR && (
            <Link href={`/sunday-school?year=${year - 1}`} className="text-muted-foreground underline hover:text-foreground min-h-11 inline-flex items-center sm:min-h-0">
              ← {year - 1}
            </Link>
          )}
          <span className="font-medium text-foreground" aria-current="page">{year}</span>
          {year < MAX_YEAR && (
            <Link href={`/sunday-school?year=${year + 1}`} className="text-muted-foreground underline hover:text-foreground min-h-11 inline-flex items-center sm:min-h-0">
              {year + 1} →
            </Link>
          )}
        </nav>
      </div>

      {editor && (
        <div className="flex flex-wrap items-start gap-3">
          <Button asChild>
            <Link href={`/sunday-school/new?year=${year}`}>New class</Link>
          </Button>
          {canRollover && <RolloverButton fromYear={year} classCount={classes.length} />}
        </div>
      )}

      {classes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No classes for {year} yet.
          {editor && (
            <>
              {" "}
              <Link href={`/sunday-school/new?year=${year}`} className="underline hover:text-foreground">Create the first class</Link>.
            </>
          )}
        </p>
      ) : (
        [...groups.entries()].map(([location, rows]) => (
          <section key={`loc:${location}`} className="space-y-2">
            {showHeadings && (
              <h3 className="text-sm font-semibold text-muted-foreground">{location || "No location"}</h3>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              {rows.map((c) => {
                const teachers = c.teachers.map((t) => `${t.person.firstName} ${t.person.lastName}`).join(", ")
                const n = c._count.enrolments
                return (
                  <Link key={c.id} href={`/sunday-school/${c.id}`} className="block rounded-xl focus-visible:outline-2 focus-visible:outline-ring">
                    <Card className="h-full transition-colors hover:bg-muted/50">
                      <CardContent className="space-y-1">
                        <p className="font-medium text-foreground">{c.name}</p>
                        <p className="text-sm text-muted-foreground">Level {c.level} · {n} {n === 1 ? "child" : "children"}</p>
                        <p className="text-sm text-muted-foreground">{teachers ? `Teachers: ${teachers}` : "No teacher yet"}</p>
                      </CardContent>
                    </Card>
                  </Link>
                )
              })}
            </div>
          </section>
        ))
      )}
    </div>
  )
}
