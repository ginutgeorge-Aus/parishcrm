import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { prisma } from "@/lib/prisma"
import { canEdit, isAdmin, canSeePastoralNotes, canAccessAccounting, canViewPeople } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { safeDecrypt } from "@/lib/crypto"
import { sumCents, centsToNumber, fmtAUD } from "@/lib/formatting"
import { buildDisplayPerson, groupTransactionsByYear } from "@/lib/personDetailView"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { CLASSIFICATION_BADGE, CLASSIFICATION_LABELS, FAMILY_ROLE_LABELS } from "@/lib/personLabels"
import { DeletePersonButton } from "@/components/people/DeletePersonButton"
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

// Basic/Contact/Church/Pastoral info cards — split out so the notes/pastoral
// conditionals don't count against the page component's cognitive complexity.
function PersonInfoCards({
  person,
  displayPerson,
  dob,
  showPastoralNotes,
}: Readonly<{
  person: { gender: string | null; membershipDate: Date | null; baptismDate: Date | null }
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

export default async function PersonDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth()
  if (!canViewPeople(session?.user?.role)) redirect("/") // AUDITOR is accounting-only

  const id = parseRouteId(params.id)
  if (id === null) notFound()

  const person = await prisma.person.findUnique({
    where: { id },
    include: { family: { select: { id: true, name: true } } },
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
  const givingTransactions = userCanSeeGiving
    ? await prisma.transaction.findMany({
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
    : []

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
      />

      {userCanSeeGiving && (
        <GivingHistoryCard givingYears={givingYears} givingByYear={givingByYear} />
      )}
    </div>
  )
}
