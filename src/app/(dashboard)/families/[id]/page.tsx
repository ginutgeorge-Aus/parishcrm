import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { canEdit, isAdmin, canViewAccounting, canAccessAccounting, canViewPeople } from "@/lib/roleGuard"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { PersonCard } from "@/components/people/PersonCard"
import { PersonMobileList } from "@/components/people/PersonMobileList"
import { ArchiveFamilyButton } from "@/components/families/ArchiveFamilyButton"
import { PrintButton } from "@/components/ui/PrintButton"
import { InviteFamilyButton } from "@/components/family-update/InviteFamilyButton"
import { safeDecrypt } from "@/lib/crypto"
import { fmtAUD, safeDobDate, sumCents, centsToNumber } from "@/lib/formatting"
import { getFamilyLastUpdate } from "@/lib/actions/familyActivity"
import { APP_LOCALE, APP_TIMEZONE } from "@/lib/appConfig"

export default async function FamilyDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth()
  if (!session) redirect("/login") // explicit guard before any DB query
  if (!canViewPeople(session?.user?.role)) redirect("/") // AUDITOR is accounting-only

  const id = Number.parseInt(params.id, 10)
  if (Number.isNaN(id) || id <= 0 || id > 2147483647) notFound()

  const family = await prisma.family.findUnique({
    where: { id },
    include: {
      // select only the columns PersonCard renders — never the encrypted
      // pastoralNotes/emergencyContact/notes/bankingName/hash columns.
      people: {
        where: { archivedAt: null }, // hide individually-archived members
        orderBy: [{ role: "asc" }, { firstName: "asc" }],
        select: {
          id: true, firstName: true, lastName: true, role: true,
          classification: true, dateOfBirth: true, email: true, mobile: true,
        },
      },
    },
  })
  // Archived families live only at /families/archived (ADMIN); block direct-URL
  // access so archived PII can't be loaded by any canViewPeople role.
  if (!family || family.archivedAt) notFound()

  const displayFamily = {
    ...family,
    address: family.address ? safeDecrypt(family.address) : null,
    suburb: family.suburb ? safeDecrypt(family.suburb) : null,
    state: family.state ? safeDecrypt(family.state) : null,
    postcode: family.postcode ? safeDecrypt(family.postcode) : null,
    homePhone: family.homePhone ? safeDecrypt(family.homePhone) : null,
    notes: family.notes ? safeDecrypt(family.notes) : null,
    people: family.people.map((p) => ({
      ...p,
      email: p.email ? safeDecrypt(p.email) : null,
      mobile: p.mobile ? safeDecrypt(p.mobile) : null,
      dateOfBirth: p.dateOfBirth ? safeDobDate(safeDecrypt(p.dateOfBirth)) : null,
    })),
  }

  const userCanEdit = canEdit(session?.user?.role)
  const userIsAdmin = isAdmin(session?.user?.role)
  // Editors-only audit line: when/by-whom the family or a member last changed.
  const lastUpdate = userCanEdit ? await getFamilyLastUpdate(family.id) : null
  // Giving is a read view — gate on read access (ADMIN|PASTOR|AUDITOR|OFFICE_ADMIN),
  // matching the standalone /families/[id]/giving page. Gating on canAccessAccounting
  // (mutation rights) wrongly hid the card from OFFICE_ADMIN/AUDITOR.
  const userCanSeeGiving = canViewAccounting(session?.user?.role)
  // The transaction edit route requires mutation rights — read-only accounting
  // roles see the description as plain text, not a link that bounces them.
  const userCanEditGiving = canAccessAccounting(session?.user?.role)
  const givingTransactions = userCanSeeGiving
    ? (await prisma.transaction.findMany({
        where: { familyId: family.id, isGiving: true },
        orderBy: { date: "desc" },
        select: { id: true, date: true, description: true, amount: true },
        take: 2000, // bound the per-family giving history scan
      })).map((t) => ({ ...t, description: safeDecrypt(t.description) }))
    : []

  const givingByYear = givingTransactions.reduce<
    Record<number, typeof givingTransactions>
  >((acc, t) => {
    // t.date is a UTC-midnight calendar anchor (see src/lib/reports/plHelpers.ts) —
    // use the UTC getter so negative-UTC-offset servers don't shift the bucket
    // back a year (gemini-nightly).
    const year = t.date.getUTCFullYear()
    if (!acc[year]) acc[year] = []
    acc[year].push(t)
    return acc
  }, {})
  const givingYears = Object.keys(givingByYear).map(Number).sort((a, b) => b - a)

  const pendingUpdate = userCanEdit
    ? await prisma.familyUpdateSubmission.findFirst({
        where: { familyId: family.id, status: "PENDING" },
        select: { id: true },
      })
    : null
  const primaryEmail = displayFamily.people.find((p) => p.email)?.email || ""

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground mb-1">
            <Link href="/families" className="hover:underline">Families</Link> / {family.name}
          </p>
          <h2 className="text-2xl font-semibold text-foreground">{family.name}</h2>
          {lastUpdate && (
            <p className="text-sm text-muted-foreground mt-1">
              Last updated{" "}
              {lastUpdate.at.toLocaleString(APP_LOCALE, {
                day: "numeric", month: "short", year: "numeric",
                hour: "numeric", minute: "2-digit", timeZone: APP_TIMEZONE,
              })}
              {lastUpdate.kind === "self-update"
                ? ` ${lastUpdate.actorLabel}`
                : lastUpdate.kind === "admin"
                  ? ` by ${lastUpdate.actorLabel}`
                  : ""}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <PrintButton />
          {userCanEdit && (
            <Button variant="outline" size="sm" className="h-11 sm:h-7 any-pointer-coarse:h-11" asChild>
              <Link href={`/families/${family.id}/edit`}>Edit</Link>
            </Button>
          )}
          {userCanEdit && (
            <InviteFamilyButton familyId={family.id} defaultEmail={primaryEmail} />
          )}
          {userIsAdmin && (
            <ArchiveFamilyButton familyId={family.id} memberCount={displayFamily.people.length} />
          )}
        </div>
      </div>

      {pendingUpdate && (
        <div className="rounded-md bg-warning/10 border border-warning/40 px-4 py-3 text-sm text-warning print:hidden">
          This family submitted updates awaiting review.{" "}
          <Link href={`/families/updates/${pendingUpdate.id}`} className="underline font-medium">Review now</Link>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Family info</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">Address</span>
            <p>{[displayFamily.address, displayFamily.suburb, displayFamily.state, displayFamily.postcode].filter(Boolean).join(", ") || "—"}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Phone</span>
            <p>{displayFamily.homePhone ?? "—"}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Status</span>
            <div className="mt-1"><Badge>{family.status}</Badge></div>
          </div>
          <div>
            <span className="text-muted-foreground">Joined</span>
            <p>
              {family.joinedDate
                ? family.joinedDate.toLocaleDateString(APP_LOCALE)
                : "—"}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">Marriage date</span>
            <p>
              {family.marriageDate
                ? family.marriageDate.toLocaleDateString(APP_LOCALE)
                : "—"}
            </p>
          </div>
          {family.memberNo && (
            <div>
              <span className="text-muted-foreground">Member No</span>
              <p>{family.memberNo}</p>
            </div>
          )}
          {displayFamily.notes && (
            <div className="sm:col-span-2">
              <span className="text-muted-foreground">Notes</span>
              <p className="mt-1 whitespace-pre-wrap">{displayFamily.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-foreground">Members ({displayFamily.people.length})</h3>
          {userCanEdit && (
            <Button size="sm" asChild className="print:hidden">
              <Link href={`/families/${family.id}/people/new`}>Add member</Link>
            </Button>
          )}
        </div>

        <div className="hidden md:block overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Classification</TableHead>
              <TableHead>DOB</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Mobile</TableHead>
              <TableHead className="w-20"><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayFamily.people.map((person) => (
              <PersonCard key={person.id} person={person} />
            ))}
            {displayFamily.people.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8 text-sm">
                  No members yet
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        </div>
        <PersonMobileList people={displayFamily.people} />
      </div>
      {userCanSeeGiving && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Giving History</CardTitle>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/families/${family.id}/giving`}>View Full History →</Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {givingYears.length === 0 ? (
              <p className="text-sm text-muted-foreground">No giving recorded for this family.</p>
            ) : (
              <div className="space-y-6">
                {givingYears.map((year) => {
                  const yearTxns = givingByYear[year]
                  // Sum in integer cents, matching person/[id] and giving/page —
                  // float addition of Decimal amounts risks precision drift.
                  const total = centsToNumber(sumCents(yearTxns.map((t) => t.amount)))
                  return (
                    <div key={year}>
                      <div className="flex justify-between items-center mb-2">
                        <span className="font-medium text-sm">{year}</span>
                        <span className="text-sm text-muted-foreground">
                          Total: {fmtAUD(total)}
                        </span>
                      </div>
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
                                {userCanEditGiving ? (
                                  <Link
                                    href={`/accounting/transactions/${t.id}/edit`}
                                    className="hover:underline"
                                  >
                                    {t.description}
                                  </Link>
                                ) : (
                                  t.description
                                )}
                              </TableCell>
                              <TableCell className="text-right text-sm text-income font-mono">
                                {fmtAUD(Number(t.amount))}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
