import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { safeDecrypt } from "@/lib/crypto"
import { canViewAccounting, canViewPeople, canEdit, isAdmin } from "@/lib/roleGuard"
import { accountBalance } from "@/lib/reports/plHelpers"
import { MONTH_ABBR_TITLE, toCents, centsToNumber, fmtAUD as fmt, type Money } from "@/lib/formatting"
import { sydneyToday } from "@/lib/dates"
import { PERSON_FETCH_CAP } from "@/lib/constants"
import { getPaymentAccounts } from "@/lib/paymentAccounts"
import { upcomingBirthdays as computeUpcomingBirthdays } from "@/lib/birthdays"
import { upcomingAnniversaries as computeUpcomingAnniversaries, type AnniversaryFamily, type FamilyRoleLite } from "@/lib/anniversaries"
import { countPendingFamilyUpdates } from "@/lib/pendingUpdates"
import { BirthdayWidget } from "@/components/dashboard/BirthdayWidget"
import { AnniversaryWidget } from "@/components/dashboard/AnniversaryWidget"
import { MarriageAnniversaryWidget } from "@/components/dashboard/MarriageAnniversaryWidget"
import { WhatsNewFooter } from "@/components/dashboard/WhatsNewFooter"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default async function DashboardPage() {
  const session = await auth()
  if (!session) redirect("/login")
  const role = session?.user?.role

  // Sydney wall-clock date, not the server's UTC clock — between UTC midnight
  // and ~11am AEST the server date is a day behind, skewing "last 30 days",
  // upcoming-events, and birthday windows. sydneyToday() anchors at UTC
  // midnight (the app's date-only storage convention), so all the date math
  // below is correct in prod (UTC server).
  const today = sydneyToday()

  const in30Days = new Date(today)
  in30Days.setDate(today.getDate() + 30)

  const thirtyDaysAgo = new Date(today)
  thirtyDaysAgo.setDate(today.getDate() - 30)

  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const startOfNextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1)
  const sameMonthLastYear = new Date(today.getFullYear() - 1, today.getMonth(), 1)
  const endSameMonthLastYear = new Date(today.getFullYear() - 1, today.getMonth() + 1, 1)

  const thisMonth = today.getMonth()

  // Reports/dashboard show all accounts (incl. deactivated-with-history), not
  // just active ones — a deactivated account can still have a balance worth
  // showing until its history ages out.
  const accounts = canViewAccounting(role) ? await getPaymentAccounts({ activeOnly: false }) : []

  const openingBalances = canViewAccounting(role)
    ? await prisma.accountOpeningBalance.findMany()
    : []

  const obByAccountId = new Map(openingBalances.map((ob) => [ob.paymentAccountId, ob]))

  const [
    rawPeople,
    rawMarriageFamilies,
    familyCount,
    activeCount,
    recentFamilies,
    recentPeople,
    openPettyCash,
    upcomingEventCount,
    givingThisMonth,
    givingLastYear,
    accountAggs,
    personCount,
    pendingUpdates,
  ] = await Promise.all([
    prisma.person.findMany({
      where: { dateOfBirth: { not: null }, archivedAt: null },
      // Safety net: cap fetch + decryption cost so this query doesn't
      // grow unbounded with membership. The widget only shows a 7-day window;
      // the proper fix is a dobMonthDay DB-level filter (out of scope here).
      // KNOWN LIMITATION: past 500 people with a DOB the widget can miss
      // birthdays. orderBy id makes the truncated set deterministic (not an
      // arbitrary DB order) until the DB-level month filter lands.
      orderBy: { id: "asc" },
      take: PERSON_FETCH_CAP + 1, // one past the cap flags truncation
      select: {
        id: true,
        firstName: true,
        lastName: true,
        dateOfBirth: true,
        family: { select: { name: true } },
      },
    }),
    prisma.family.findMany({
      where: { marriageDate: { not: null }, archivedAt: null },
      // Safety net: cap fetch so this query doesn't grow unbounded with
      // the family count. The widget only shows the current month; a DB-level
      // month filter is the longer-term fix (out of scope here).
      // KNOWN LIMITATION: deterministic order so the truncated set isn't
      // an arbitrary DB selection.
      orderBy: { id: "asc" },
      take: PERSON_FETCH_CAP + 1, // one past the cap flags truncation
      select: {
        id: true,
        name: true,
        marriageDate: true,
        people: {
          where: { archivedAt: null, role: { in: ["HEAD", "SPOUSE"] } },
          select: { id: true, firstName: true, role: true, email: true, emailConsent: true },
        },
      },
    }),
    prisma.family.count({ where: { archivedAt: null } }),
    prisma.family.count({ where: { status: "ACTIVE", archivedAt: null } }),
    prisma.family.count({ where: { createdAt: { gte: thirtyDaysAgo }, archivedAt: null } }),
    prisma.person.count({ where: { createdAt: { gte: thirtyDaysAgo }, archivedAt: null } }),
    prisma.pettyCashSession.count({ where: { status: "OPEN" } }),
    // Recurring events (date: null) happen within any 30-day window by
    // definition, so they count as upcoming alongside dated events.
    prisma.event.count({ where: { isPublished: true, OR: [{ date: { gte: new Date(today.getFullYear(), today.getMonth(), today.getDate()), lte: in30Days } }, { kind: "recurring" }] } }),
    canViewAccounting(role)
      ? prisma.transaction.aggregate({
          where: { isGiving: true, type: "INCOME", date: { gte: startOfMonth, lt: startOfNextMonth } },
          _sum: { amount: true },
        })
      : Promise.resolve({ _sum: { amount: null } }),
    canViewAccounting(role)
      ? prisma.transaction.aggregate({
          where: { isGiving: true, type: "INCOME", date: { gte: sameMonthLastYear, lt: endSameMonthLastYear } },
          _sum: { amount: true },
        })
      : Promise.resolve({ _sum: { amount: null } }),

    // Per-account income/expense since its opening-balance asOfDate. One
    // account with no opening balance set yet contributes nulls (dashboard
    // renders "—" + a link to set it), rather than blocking the others.
    Promise.all(
      accounts.map(async (acct) => {
        const ob = obByAccountId.get(acct.id)
        if (!ob) return { accountId: acct.id, income: null as Money, expense: null as Money }
        const [incomeAgg, expenseAgg] = await Promise.all([
          prisma.transaction.aggregate({
            where: { paymentAccountId: acct.id, type: "INCOME", date: { gte: ob.asOfDate } },
            _sum: { amount: true },
          }),
          prisma.transaction.aggregate({
            where: { paymentAccountId: acct.id, type: "EXPENSE", date: { gte: ob.asOfDate } },
            _sum: { amount: true },
          }),
        ])
        return { accountId: acct.id, income: incomeAgg._sum.amount, expense: expenseAgg._sum.amount }
      })
    ),

    prisma.person.count({ where: { archivedAt: null } }),
    canEdit(role) ? countPendingFamilyUpdates() : Promise.resolve(0),
  ])

  // A hit cap renders a "may be incomplete" notice in the widget.
  const birthdaysTruncated = rawPeople.length > PERSON_FETCH_CAP
  const people = rawPeople.slice(0, PERSON_FETCH_CAP)
  const anniversariesTruncated = rawMarriageFamilies.length > PERSON_FETCH_CAP
  const marriageFamilies = rawMarriageFamilies.slice(0, PERSON_FETCH_CAP)

  // Reuse the shared birthday-window helper rather than re-deriving the
  // month/day wrap inline — 7-day window, anchored on the Sydney
  // `today`. email/emailConsent are required by the helper's input type but
  // unused by this display-only widget (the admin send flow in birthday.ts
  // carries the real consent values).
  const upcomingBirthdays = computeUpcomingBirthdays(
    people
      .filter((p) => p.dateOfBirth)
      .map((p) => {
        // safeDecrypt returns '[decryption error]' on a bad/rotated-away
        // ciphertext; new Date() of that is Invalid Date, which would poison
        // the whole window calc. Drop the record instead.
        const dateOfBirth = new Date(safeDecrypt(p.dateOfBirth!))
        if (isNaN(dateOfBirth.getTime())) return null
        return {
          id: p.id,
          firstName: p.firstName,
          lastName: p.lastName,
          family: p.family,
          dateOfBirth,
          email: null,
          emailConsent: false,
        }
      })
      .filter((p): p is NonNullable<typeof p> => p !== null),
    7,
    today,
  )

  // Same 7-day window pattern as upcomingBirthdays above, reusing the shared
  // upcomingAnniversaries helper rather than re-deriving the month/day wrap.
  const anniversaryFamilies: AnniversaryFamily[] = marriageFamilies
    .filter((f) => f.marriageDate)
    .map((f) => ({
      id: f.id,
      name: f.name,
      marriageDate: f.marriageDate as Date,
      people: f.people.map((p) => ({
        id: p.id,
        firstName: p.firstName,
        role: p.role as FamilyRoleLite,
        email: p.email ? safeDecrypt(p.email) : null,
        emailConsent: p.emailConsent,
      })),
    }))
  const upcomingAnniversaries = computeUpcomingAnniversaries(anniversaryFamilies, 7, today)

  const marriageAnniversaries = marriageFamilies
    .filter((f) => f.marriageDate && f.marriageDate.getMonth() === thisMonth)
    .sort((a, b) => a.marriageDate!.getDate() - b.marriageDate!.getDate())


  const fmtDate = (d: Date) => `${d.getDate()} ${MONTH_ABBR_TITLE[d.getMonth()]} ${d.getFullYear()}`

  const accountBalances = accounts.map((acct) => {
    const ob = obByAccountId.get(acct.id) ?? null
    const agg = accountAggs.find((a) => a.accountId === acct.id)
    const balance = ob && agg ? accountBalance(ob.amount, agg.income, agg.expense) : null
    return { label: acct.name, balance, ob }
  })

  const givingNow = centsToNumber(toCents(givingThisMonth._sum.amount ?? 0))
  const givingLastYearAmt = centsToNumber(toCents(givingLastYear._sum.amount ?? 0))

  const stats = [
    { label: "Total families", value: familyCount },
    { label: "Active families", value: activeCount },
    { label: "Total members", value: personCount },
    { label: "Added (30 days)", value: recentFamilies + recentPeople, sub: `${recentFamilies} families · ${recentPeople} people` },
  ]

  // Giving trend vs the same month last year — drives the arrow + colour.
  const givingDelta = givingNow - givingLastYearAmt
  const givingUp = givingDelta >= 0

  // "Needs attention" tiles, only the ones this role can act on. A non-zero
  // count makes the tile actionable (gold accent + link).
  const attention = [
    canEdit(role) && {
      label: "Family updates to review",
      value: pendingUpdates,
      href: "/families/updates",
      active: pendingUpdates > 0,
    },
    canViewAccounting(role) && {
      label: "Open petty cash sessions",
      value: openPettyCash,
      href: "/accounting/petty-cash",
      active: openPettyCash > 0,
    },
    {
      label: "Upcoming events (30d)",
      value: upcomingEventCount,
      href: "/events",
      active: false,
    },
  ].filter(Boolean) as { label: string; value: number; href: string; active: boolean }[]

  const sectionHeader = "text-xs font-semibold uppercase tracking-wide text-muted-foreground"

  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-semibold">
        Welcome back, {session?.user?.name?.split(" ")[0]}
      </h2>

      {/* Money — balances + giving */}
      {canViewAccounting(role) && (
        <section className="space-y-3">
          <h3 className={sectionHeader}>Money</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {accountBalances.map(({ label, balance, ob }) => (
              <Card key={label}>
                <CardHeader className="pb-1 pt-4 px-4">
                  <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {label}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  {balance !== null ? (
                    <>
                      <p className="text-3xl font-bold tabular">{fmt(balance)}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        as of {fmtDate(ob!.asOfDate)}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-3xl font-bold text-muted-foreground">—</p>
                      {isAdmin(role) && (
                        <Link
                          href="/accounting/settings"
                          className="text-xs text-primary hover:underline mt-1 block"
                        >
                          Set opening balance
                        </Link>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            ))}
            <Card>
              <CardHeader className="pb-1 pt-4 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Giving this month
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <p className="text-3xl font-bold tabular">{fmt(givingNow)}</p>
                <p className="mt-1 flex items-center gap-1 text-xs">
                  <span className={`tabular font-medium ${givingUp ? "text-income" : "text-expense"}`}>
                    {givingUp ? "▲" : "▼"} {fmt(Math.abs(givingDelta))}
                  </span>
                  <span className="text-muted-foreground">vs last year</span>
                </p>
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      {/* People — counts + birthdays / anniversaries */}
      {canViewPeople(role) && (
        <section className="space-y-3">
          <h3 className={sectionHeader}>People</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <MarriageAnniversaryWidget families={marriageAnniversaries} />
            <BirthdayWidget birthdays={upcomingBirthdays} truncated={birthdaysTruncated} />
            <AnniversaryWidget anniversaries={upcomingAnniversaries} truncated={anniversariesTruncated} />
          </div>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {stats.map((s) => (
              <Card key={s.label}>
                <CardHeader className="pb-1 pt-4 px-4">
                  <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {s.label}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <p className="text-2xl sm:text-3xl font-bold tabular">{s.value}</p>
                  {s.sub && <p className="text-xs text-muted-foreground mt-1">{s.sub}</p>}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Needs attention — the to-do tiles for this role */}
      {attention.length > 0 && (
        <section className="space-y-3">
          <h3 className={sectionHeader}>Needs attention</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {attention.map((a) => (
              <Link key={a.label} href={a.href} className="block overflow-hidden group">
                <Card
                  className={`transition-all duration-200 hover:scale-[1.02] hover:bg-accent motion-reduce:transition-none ${
                    a.active ? "border-gold ring-1 ring-gold/40" : ""
                  }`}
                >
                  <CardHeader className="pb-1 pt-4 px-4">
                    <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      {a.label}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <p className="text-3xl font-bold tabular text-foreground">
                      {a.value}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      <WhatsNewFooter />
    </div>
  )
}
