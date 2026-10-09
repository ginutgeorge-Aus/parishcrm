import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { canEdit, canViewPeople } from "@/lib/roleGuard"
import { parseRouteId } from "@/lib/validation"
import { clearanceStatus } from "@/lib/clearanceStatus"
import { sydneyToday } from "@/lib/dates"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { TeachersPanel } from "@/components/sunday-school/TeachersPanel"
import { EnrolPanel } from "@/components/sunday-school/EnrolPanel"

const CANDIDATE_CAP = 2000
const byName = [{ lastName: "asc" as const }, { firstName: "asc" as const }]

/** Class detail: teachers (with WWCC status) and enrolled children. canViewPeople to view; canEdit manages. */
export default async function ClassPage(props: Readonly<{ params: Promise<{ id: string }> }>) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (!canViewPeople(session.user.role)) redirect("/")
  const id = parseRouteId((await props.params).id)
  if (id === null) notFound()

  const cls = await prisma.sundaySchoolClass.findUnique({
    where: { id },
    select: {
      id: true, year: true, name: true, level: true, location: true, archivedAt: true,
      teachers: {
        // Untagged teachers are hidden: addTeacher and rollover reject them too.
        where: { person: { archivedAt: null, ministryRoles: { has: "SUNDAY_SCHOOL_TEACHER" } } },
        orderBy: { person: { lastName: "asc" } },
        select: { person: { select: {
          id: true, firstName: true, lastName: true,
          clearances: { where: { type: "WWCC" }, select: { verifiedAt: true, expiresAt: true } },
        } } },
      },
      enrolments: {
        where: { person: { archivedAt: null } },
        orderBy: [{ person: { lastName: "asc" } }, { person: { firstName: "asc" } }],
        select: { person: { select: { id: true, firstName: true, lastName: true, family: { select: { name: true } } } } },
      },
    },
  })
  if (!cls) notFound()

  const editor = canEdit(session.user.role) && !cls.archivedAt
  const [teacherCandidates, enrolCandidates] = editor
    ? await Promise.all([
      prisma.person.findMany({
        where: { archivedAt: null, ministryRoles: { has: "SUNDAY_SCHOOL_TEACHER" }, sundaySchoolTeaching: { none: { classId: id } } },
        select: { id: true, firstName: true, lastName: true },
        orderBy: byName,
      }),
      prisma.person.findMany({
        where: { archivedAt: null, sundaySchoolEnrolments: { none: { classId: id } } },
        select: {
          id: true, firstName: true, lastName: true, role: true, family: { select: { name: true } },
          sundaySchoolEnrolments: { where: { year: cls.year, class: { archivedAt: null } }, select: { class: { select: { name: true } } } },
        },
        orderBy: byName,
        take: CANDIDATE_CAP,
      }),
    ])
    : [[], []]

  const today = sydneyToday()
  const teachers = cls.teachers.map(({ person: p }) => ({
    id: p.id, name: `${p.firstName} ${p.lastName}`, wwcc: clearanceStatus(p.clearances[0] ?? null, today),
  }))
  const enrolled = cls.enrolments.map(({ person: p }) => ({ id: p.id, name: `${p.firstName} ${p.lastName}`, familyName: p.family.name }))
  const candidates = enrolCandidates.map((p) => ({
    id: p.id, name: `${p.firstName} ${p.lastName}`, familyName: p.family.name, isChild: p.role === "CHILD",
    currentClass: p.sundaySchoolEnrolments[0]?.class.name ?? null,
  }))
  const meta = [`Level ${cls.level}`, cls.location, String(cls.year)].filter(Boolean).join(" · ")

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground mb-1">
          <Link href={`/sunday-school?year=${cls.year}`} className="hover:underline">Sunday School</Link>
          {` / ${cls.name}`}
        </p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
            {cls.name}
            {cls.archivedAt && <Badge variant="secondary">Archived</Badge>}
          </h2>
          {editor && (
            <Button variant="outline" asChild>
              <Link href={`/sunday-school/${cls.id}/edit`}>Edit</Link>
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{meta}</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Teachers</CardTitle></CardHeader>
        <CardContent>
          <TeachersPanel
            classId={cls.id}
            teachers={teachers}
            candidates={teacherCandidates.map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}` }))}
            readOnly={!editor}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Children ({enrolled.length})</CardTitle></CardHeader>
        <CardContent>
          <EnrolPanel classId={cls.id} enrolled={enrolled} candidates={candidates} readOnly={!editor} />
        </CardContent>
      </Card>
    </div>
  )
}
