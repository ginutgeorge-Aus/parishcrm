import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { UserRole } from "@/lib/generated/prisma/enums"
import { canBrowseSundaySchool, canManageSundaySchool, canViewClearanceStatus, canViewPeople } from "@/lib/roleGuard"
import { parseRouteId } from "@/lib/validation"
import { clearanceStatus } from "@/lib/clearanceStatus"
import { sydneyToday } from "@/lib/dates"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { TeachersPanel } from "@/components/sunday-school/TeachersPanel"
import { EnrolPanel } from "@/components/sunday-school/EnrolPanel"
import { RollMarkersPanel } from "@/components/sunday-school/RollMarkersPanel"
import { rollCounts } from "@/lib/sundaySchoolRollView"
import { lockedYears } from "@/lib/sundaySchoolYearLock"
import { ParentMessageHistory } from "@/components/sunday-school/parentMessageView"
import { loadSsMessageHistory } from "@/lib/sundaySchoolMessageHistory"

const CANDIDATE_CAP = 2000
const byName = [{ lastName: "asc" as const }, { firstName: "asc" as const }]

/**
 * Class detail: teachers (with WWCC status), enrolled children, recent rolls and
 * roll markers. canBrowseSundaySchool to view; canManageSundaySchool manages.
 */
export default async function ClassPage(props: Readonly<{ params: Promise<{ id: string }> }>) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (!canBrowseSundaySchool(session.user.role)) redirect("/")
  const id = parseRouteId((await props.params).id)
  if (id === null) notFound()

  // WWCC status is clearance data: HEADMASTER (and other roles without
  // canViewClearanceStatus) must not receive it, so the select takes none.
  const showWwcc = canViewClearanceStatus(session.user.role)
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
          clearances: { where: { type: "WWCC" }, take: showWwcc ? undefined : 0, select: { verifiedAt: true, expiresAt: true } },
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

  // A rolled-over year is closed: same read-only view as an archived class.
  const locked = (await lockedYears([cls.year])).has(cls.year)
  // Locked years stay viewable: managers still see roll-marker assignments, read-only.
  const markerViewer = canManageSundaySchool(session.user.role) && !cls.archivedAt
  const editor = markerViewer && !locked
  // HEADMASTER has no people access, so names are plain text, not /people links.
  const linkPeople = canViewPeople(session.user.role)
  // Children and everyone else are capped separately so a large adult roll can
  // never crowd children out of the picker (the usual "Children only" view).
  const enrolQuery = (role: { equals: "CHILD" } | { not: "CHILD" }) => prisma.person.findMany({
    where: { archivedAt: null, role, sundaySchoolEnrolments: { none: { classId: id } } },
    select: {
      id: true, firstName: true, lastName: true, role: true, family: { select: { name: true } },
      sundaySchoolEnrolments: { where: { year: cls.year, class: { archivedAt: null } }, select: { class: { select: { name: true } } } },
    },
    orderBy: byName,
    take: CANDIDATE_CAP,
  })
  const [teacherCandidates, childCandidates, otherCandidates] = editor
    ? await Promise.all([
      prisma.person.findMany({
        where: { archivedAt: null, ministryRoles: { has: "SUNDAY_SCHOOL_TEACHER" }, sundaySchoolTeaching: { none: { classId: id } } },
        select: { id: true, firstName: true, lastName: true },
        orderBy: byName,
      }),
      enrolQuery({ equals: "CHILD" }),
      // HEADMASTER has no people access: never send them adults' names.
      session.user.role === UserRole.HEADMASTER ? Promise.resolve([]) : enrolQuery({ not: "CHILD" }),
    ])
    : [[], [], []]
  const [rollMarkers, assignableMarkers, sessions] = await Promise.all([
    markerViewer
      ? prisma.sundaySchoolRollMarker.findMany({
        where: { classId: id, user: { archivedAt: null } },
        select: { user: { select: { id: true, name: true, email: true, role: true } } },
        orderBy: { user: { name: "asc" } },
      })
      : [],
    // Logins that can be made roll markers: TEACHER, plus legacy EVENT_ORGANISER.
    editor
      ? prisma.user.findMany({
        where: { role: { in: [UserRole.TEACHER, UserRole.EVENT_ORGANISER] }, archivedAt: null },
        select: { id: true, name: true, email: true },
        orderBy: { name: "asc" },
      })
      : [],
    prisma.sundaySchoolSession.findMany({
      where: { classId: id },
      orderBy: { date: "desc" },
      take: 10,
      select: { date: true, attendance: { select: { status: true } } },
    }),
  ])
  // Parent-email history (OSS-14): staff who can send see it; VIEWER does not.
  const showMessages = canManageSundaySchool(session.user.role)
  const parentMessages = showMessages ? await loadSsMessageHistory(id) : []
  const enrolCandidates = [...childCandidates, ...otherCandidates]
    .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName))

  const today = sydneyToday()
  const teachers = cls.teachers.map(({ person: p }) => ({
    id: p.id, name: `${p.firstName} ${p.lastName}`, wwcc: showWwcc ? clearanceStatus(p.clearances[0] ?? null, today) : null,
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
            {locked && <Badge variant="secondary">Locked</Badge>}
          </h2>
          <div className="flex flex-wrap gap-2">
            {!cls.archivedAt && (
              <Button asChild>
                <Link href={`/sunday-school/${cls.id}/roll`}>{editor ? "Take roll" : "View roll"}</Link>
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link href={`/sunday-school/${cls.id}/exams`}>Exams</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href={`/sunday-school/${cls.id}/progress`}>Progress</Link>
            </Button>
            {editor && (
              <Button variant="outline" asChild>
                <Link href={`/sunday-school/${cls.id}/message`}>Email parents</Link>
              </Button>
            )}
            {editor && (
              <Button variant="outline" asChild>
                <Link href={`/sunday-school/${cls.id}/edit`}>Edit</Link>
              </Button>
            )}
          </div>
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
            linkPeople={linkPeople}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Children ({enrolled.length})</CardTitle></CardHeader>
        <CardContent>
          <EnrolPanel classId={cls.id} enrolled={enrolled} candidates={candidates} readOnly={!editor} linkPeople={linkPeople} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recent rolls</CardTitle></CardHeader>
        <CardContent>
          {sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No rolls taken yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {sessions.map((s) => {
                const ymd = s.date.toISOString().slice(0, 10)
                const c = rollCounts(s.attendance)
                return (
                  <li key={ymd}>
                    <Link href={`/sunday-school/${cls.id}/roll?date=${ymd}`} className="flex flex-wrap justify-between gap-2 py-2 text-sm hover:underline">
                      <span className="font-medium text-foreground">{formatRollDate(s.date)}</span>
                      <span className="text-muted-foreground">{c.present} present · {c.late} late · {c.absent} absent</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {showMessages && (
        <Card>
          <CardHeader><CardTitle>Parent emails</CardTitle></CardHeader>
          <CardContent>
            <ParentMessageHistory messages={parentMessages} />
          </CardContent>
        </Card>
      )}

      {markerViewer && (
        <Card>
          <CardHeader><CardTitle>Roll markers</CardTitle></CardHeader>
          <CardContent>
            <RollMarkersPanel classId={cls.id} markers={rollMarkers.map(({ user: { role, ...u } }) => ({ ...u, active: role === UserRole.TEACHER || role === UserRole.EVENT_ORGANISER }))} assignable={assignableMarkers} readOnly={!editor} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}

/** "Sun 4 Oct 2026" for a `@db.Date` (UTC midnight), so read in UTC. */
function formatRollDate(d: Date): string {
  return d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
}
