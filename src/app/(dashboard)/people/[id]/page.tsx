import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { prisma } from "@/lib/prisma"
import { canEdit, isAdmin, canSeePastoralNotes, canAccessAccounting, canViewPeople, canManageClearances, canViewClearanceStatus } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { safeDecrypt } from "@/lib/crypto"
import { sumCents, centsToNumber, fmtAUD } from "@/lib/formatting"
import { buildDisplayPerson, groupTransactionsByYear } from "@/lib/personDetailView"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { CLASSIFICATION_BADGE, CLASSIFICATION_LABELS, FAMILY_ROLE_LABELS } from "@/lib/personLabels"
import { DeletePersonButton } from "@/components/people/DeletePersonButton"
import { MinistryRoleBadges } from "@/components/people/MinistryRoleBadges"
import type { MinistryRole } from "@/lib/generated/prisma/enums"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { APP_LOCALE } from "@/lib/appConfig"
import { parseRouteId } from "@/lib/validation"
import { currentSchoolYear } from "@/lib/sundaySchool"
import { PersonClearances } from "@/components/people/PersonClearances"
import { buildClearanceCard, clearanceSelectFor, type ClearanceCardData } from "@/lib/clearanceView"
import { DEFAULT_WWCC_VERIFY_URL, getWwccVerifyUrl } from "@/lib/clearanceSettings"
import { sydneyToday } from "@/lib/dates"

function field(label: string, value: string | null | undefined) {
  return (
    <div>
      <span className="text-muted-foreground text-sm">{label}</span>
      <p className="mt-0.5">{value ?? "—"}</p>
    </div>
  )
}

// Header action buttons (edit / delete / export) — split out of the page
// component so the role-gated `&&` branches don't count against its
// cognitive complexity. Rendered unconditionally; visibility is decided here.
function PersonHeaderActions({
  userCanEdit,
  userIsAdmin,
  personId,
  familyId,
  fullName,
}: Readonly<{
  userCanEdit: boolean
  userIsAdmin: boolean
  personId: number
  familyId: number
  fullName: string
}>) {
  return (
    <div className="flex gap-2">
      {userCanEdit && (
        <Button variant="outline" size="sm" className="h-11 sm:h-7 any-pointer-coarse:h-11" asChild>
          <Link href={`/people/${personId}/edit`}>Edit</Link>
        </Button>
      )}
      {userIsAdmin && (
        <DeletePersonButton personId={personId} familyId={familyId} personName={fullName} />
      )}
      {userIsAdmin && (
        <Button variant="ghost" size="sm" className="h-11 sm:h-7 any-pointer-coarse:h-11" asChild>
          <a href={`/api/people/${personId}/export`} download={`member-${personId}.json`}>
            Export data
          </a>
        </Button>
      )}
    </div>
  )
}

/** The person's enrolment this school year (at most one — DB unique), flattened for display. */
function sundaySchoolOf(rows: { year: number; class: { id: number; name: string } }[] | undefined) {
  const e = rows?.[0]
  return e ? { id: e.class.id, name: e.class.name, year: e.year } : null
}

// Basic/Contact/Church/Pastoral info cards — split out so the notes/pastoral
// conditionals don't count against the page component's cognitive complexity.
function PersonInfoCards({
  person,
  displayPerson,
  dob,
  showPastoralNotes,
  clearanceCard,
  sundaySchool,
}: Readonly<{
  person: { gender: string | null; membershipDate: Date | null; baptismDate: Date | null; ministryRoles: MinistryRole[] }
  displayPerson: {
    email: string | null
    mobile: string | null
    workPhone: string | null
    homePhone: string | null
    notes: string | null
    pastoralNotes: string | null
    emergencyContactName: string | null
    emergencyContactPhone: string | null
  }
  dob: string | null
  showPastoralNotes: boolean
  clearanceCard: ClearanceCardData | null
  // This school year's class, if the person is enrolled in a live one.
  sundaySchool: { id: number; name: string; year: number } | null
}>) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Basic</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          {field("Date of birth", dob)}
          {field("Gender", person.gender)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Contact</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          {field("Email", displayPerson.email)}
          {field("Mobile", displayPerson.mobile)}
          {field("Work phone", displayPerson.workPhone)}
          {field("Home phone", displayPerson.homePhone)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Church</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          {field("Membership date", person.membershipDate?.toLocaleDateString(APP_LOCALE) ?? null)}
          {field("Baptism date", person.baptismDate?.toLocaleDateString(APP_LOCALE) ?? null)}
          {person.ministryRoles.length > 0 && (
            <div className="col-span-2">
              <span className="text-muted-foreground text-sm">Ministry roles</span>
              <div className="mt-1">
                <MinistryRoleBadges roles={person.ministryRoles} />
              </div>
            </div>
          )}
          {sundaySchool && (
            <div className="col-span-2">
              <span className="text-muted-foreground text-sm">Sunday School</span>
              <p>
                <Link href={`/sunday-school/${sundaySchool.id}`} className="hover:underline">{sundaySchool.name}</Link>
                {` (${sundaySchool.year})`}
              </p>
            </div>
          )}
          {displayPerson.notes && (
            <div className="col-span-2">
              {field("Notes", displayPerson.notes)}
            </div>
          )}
        </CardContent>
      </Card>

      {showPastoralNotes && (
        <Card>
          <CardHeader><CardTitle className="text-base">Pastoral</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            {field("Emergency contact", displayPerson.emergencyContactName)}
            {field("Emergency phone", displayPerson.emergencyContactPhone)}
            {displayPerson.pastoralNotes && (
              <div className="col-span-2">
                {field("Pastoral notes", displayPerson.pastoralNotes)}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {clearanceCard && (
        <Card className="md:col-span-2">
          <CardHeader><CardTitle className="text-base">Safeguarding</CardTitle></CardHeader>
          <CardContent>
            <PersonClearances {...clearanceCard} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}

type GivingTxn = { id: number; date: Date; description: string; amount: { toString(): string } }

// Giving-history card — split out so the year-ternary/table-map nesting
// doesn't count against the page component's cognitive complexity.
function GivingHistoryCard({
  givingYears,
  givingByYear,
}: Readonly<{
  givingYears: number[]
  givingByYear: Record<number, GivingTxn[]>
}>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Giving History</CardTitle>
      </CardHeader>
      <CardContent>
        {givingYears.length === 0 ? (
          <p className="text-sm text-muted-foreground">No giving recorded for this person.</p>
        ) : (
          <div className="space-y-6">
            {givingYears.map((year) => {
              const yearTxns = givingByYear[year]
              const total = centsToNumber(sumCents(yearTxns.map((t) => t.amount)))
              return (
                <div key={year}>
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-medium text-sm">{year}</span>
                    <span className="text-sm text-muted-foreground">
                      Total: {fmtAUD(total)}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {yearTxns.map((t) => (
                          <TableRow key={t.id}>
                            <TableCell className="text-sm">
                              {t.date.toLocaleDateString(APP_LOCALE, {
                                day: "2-digit",
                                month: "2-digit",
                              })}
                            </TableCell>
                            <TableCell className="text-sm">
                              <Link
                                href={`/accounting/transactions/${t.id}/edit`}
                                className="hover:underline"
                              >
                                {t.description}
                              </Link>
                            </TableCell>
                            <TableCell className="text-right text-sm text-income tabular">
                              {fmtAUD(Number(t.amount))}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default async function PersonDetailPage(props: Readonly<{ params: Promise<{ id: string }> }>) {
  const params = await props.params;
  const session = await auth()
  if (!canViewPeople(session?.user?.role)) redirect("/") // AUDITOR is accounting-only

  const id = parseRouteId(params.id)
  if (id === null) notFound()

  const person = await prisma.person.findUnique({
    where: { id },
    include: {
      family: { select: { id: true, name: true } },
      sundaySchoolEnrolments: {
        where: { year: currentSchoolYear(), class: { archivedAt: null } },
        select: { year: true, class: { select: { id: true, name: true } } },
      },
    },
  })
  // Archived persons are hidden from all listings and only ever archived via
  // their family; block direct-URL access so their decrypted PII stays hidden.
  if (!person || person.archivedAt) notFound()

  const showPastoralNotes = canSeePastoralNotes(session?.user?.role)
  // Decrypt pastoral/emergency PII only when the role may see it — decrypt
  // after the gate, not before it (data-model "gate all reads").
  const displayPerson = buildDisplayPerson(person, showPastoralNotes)

  const userCanEdit = canEdit(session?.user?.role)
  const userIsAdmin = isAdmin(session?.user?.role)
  if (showPastoralNotes && person.pastoralNotes) {
    const userId = actorId(session)
    void logAudit(userId, "VIEW_PASTORAL_NOTES", "Person", person.id)
  }
  const userCanSeeGiving = canAccessAccounting(session?.user?.role)
  // Safeguarding card. Gate BEFORE querying/decrypting: AUDITOR/EVENT_ORGANISER
  // get nothing; VIEWER gets status badges only (buildClearanceCard strips the
  // rest). Never select the `document` blob here.
  const role = session?.user?.role
  const canManage = canManageClearances(role)
  // Independent reads run together: clearances, the verify-portal URL (managers
  // only), and giving history (accounting roles only).
  const [clearanceRows, wwccVerifyUrl, givingTransactions] = await Promise.all([
    canViewClearanceStatus(role)
      ? prisma.personClearance.findMany({
          where: { personId: person.id },
          select: clearanceSelectFor(role),
        })
      : Promise.resolve([]),
    canManage ? getWwccVerifyUrl() : Promise.resolve(DEFAULT_WWCC_VERIFY_URL),
    userCanSeeGiving
      ? prisma.transaction.findMany({
          where: { personId: person.id, isGiving: true },
          orderBy: { date: "desc" },
          // KNOWN SCALING BOUND: shows the 2000 most recent giving rows. A decades-
          // active weekly donor could exceed this; reducing the cap is deliberately
          // avoided because the per-FY giving totals on this page must stay correct
          // (truncation would understate them). Move to year-scoped lazy loading
          // before that ceiling is realistic.
          take: 2000,
          select: { id: true, date: true, description: true, amount: true },
        })
      : Promise.resolve([]),
  ])
  const clearanceCard = buildClearanceCard({
    role: session?.user?.role,
    personId: person.id,
    rows: clearanceRows,
    today: sydneyToday(),
    wwccVerifyUrl,
    ministryRoleCount: person.ministryRoles.length,
  })
  const decryptedGivingTransactions = givingTransactions.map((t) => ({
    ...t,
    description: safeDecrypt(t.description),
  }))

  // t.date is a UTC-midnight calendar anchor (see src/lib/reports/plHelpers.ts) —
  // groupTransactionsByYear uses the UTC getter so negative-UTC-offset servers
  // don't shift the bucket back a year (gemini-nightly).
  const givingByYear = groupTransactionsByYear(decryptedGivingTransactions)
  const givingYears = Object.keys(givingByYear).map(Number).sort((a, b) => b - a)

  const fullName = [person.title, person.firstName, person.middleName, person.lastName, person.suffix]
    .filter(Boolean)
    .join(" ")

  const dob = displayPerson.dateOfBirth
    ? displayPerson.dateOfBirth.toLocaleDateString(APP_LOCALE)
    : null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground mb-1">
            <Link href="/families" className="hover:underline">Families</Link>
            {" / "}
            <Link href={`/families/${person.family.id}`} className="hover:underline">
              {person.family.name}
            </Link>
            {" / "}
            {fullName}
          </p>
          <h2 className="text-2xl font-semibold text-foreground">{fullName}</h2>
          <div className="flex gap-2 mt-1">
            <Badge variant="outline">{FAMILY_ROLE_LABELS[person.role]}</Badge>
            <Badge {...CLASSIFICATION_BADGE[person.classification]}>{CLASSIFICATION_LABELS[person.classification]}</Badge>
          </div>
        </div>
        <PersonHeaderActions
          userCanEdit={userCanEdit}
          userIsAdmin={userIsAdmin}
          personId={person.id}
          familyId={person.family.id}
          fullName={fullName}
        />
      </div>

      <PersonInfoCards
        person={person}
        displayPerson={displayPerson}
        dob={dob}
        showPastoralNotes={showPastoralNotes}
        clearanceCard={clearanceCard}
        sundaySchool={sundaySchoolOf(person.sundaySchoolEnrolments)}
      />

      {userCanSeeGiving && (
        <GivingHistoryCard givingYears={givingYears} givingByYear={givingByYear} />
      )}
    </div>
  )
}
