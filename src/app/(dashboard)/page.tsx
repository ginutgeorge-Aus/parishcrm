import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { safeDecrypt } from "@/lib/crypto"
import { canViewAccounting, canAccessAccounting, canViewPeople, canEdit, isAdmin } from "@/lib/roleGuard"
import { accountBalance } from "@/lib/reports/plHelpers"
import { MONTH_ABBR_TITLE, toCents, centsToNumber, fmtAUD as fmt, safeDobDate, type Money } from "@/lib/formatting"
import { sydneyToday, sydneyStartOfDayUTC, sydneyEndOfDayUTC, endOfDayUTC } from "@/lib/dates"
import { PERSON_FETCH_CAP } from "@/lib/constants"
import { getPaymentAccounts } from "@/lib/paymentAccounts"
import { upcomingBirthdays as computeUpcomingBirthdays } from "@/lib/birthdays"
import { upcomingAnniversaries as computeUpcomingAnniversaries, type AnniversaryFamily, type FamilyRoleLite } from "@/lib/anniversaries"
import { countPendingFamilyUpdates, countPendingMemberships } from "@/lib/pendingUpdates"
import { BirthdayWidget } from "@/components/dashboard/BirthdayWidget"
import { AnniversaryWidget } from "@/components/dashboard/AnniversaryWidget"
import { MarriageAnniversaryWidget } from "@/components/dashboard/MarriageAnniversaryWidget"
import { WhatsNewFooter } from "@/components/dashboard/WhatsNewFooter"
import { NeedsAttention } from "@/components/dashboard/NeedsAttention"
import { BalanceTile } from "@/components/accounting/BalanceTile"
import { buildAttentionItems, canHaveAttentionItems, toUnreconciledRows } from "@/lib/dashboardAttention"

/**
 * Authenticated home page. Leads with a role-aware "Needs attention" list,
 * then a slim stats strip, the money snapshot (accounting roles) and the
 * people/celebration widgets. All queries run in one parallel batch.
 */
export default async function DashboardPage() {
  const session = await auth()
  if (!session) redirect("/login")
  const role = session?.user?.role

  // Sydney wall-clock date, not the server's UTC clock — between UTC midnight
  // and ~11am AEST the server date is a day behind, skewing "last 30 days",
  // upcoming-events, and birthday windows. sydneyToday() anchors at UTC
  // midnight (the app's date-only storage convention), so all the date math
  // below uses Date.UTC + getUTC* — never local-time constructors/getters,
  // which shift by the process TZ on any non-UTC host.
  const today = sydneyToday()
  const year = today.getUTCFullYear()
  const thisMonth = today.getUTCMonth()
  const day = today.getUTCDate()

  const in30Days = new Date(Date.UTC(year, thisMonth, day + 30))
  const thirtyDaysAgo = new Date(Date.UTC(year, thisMonth, day - 30))
  // createdAt and Event.date are real instants (not date-only), so bound them
  // by the true UTC instants of Sydney midnight / end-of-day, not the
  // UTC-midnight date anchors above.
  const ymd = (d: Date) => d.toISOString().slice(0, 10)
  const createdSince = sydneyStartOfDayUTC(ymd(thirtyDaysAgo))
  const eventsFrom = sydneyStartOfDayUTC(ymd(today))
  const eventsTo = sydneyEndOfDayUTC(ymd(in30Days))

  const startOfMonth = new Date(Date.UTC(year, thisMonth, 1))
  const startOfNextMonth = new Date(Date.UTC(year, thisMonth + 1, 1))
  const sameMonthLastYear = new Date(Date.UTC(year - 1, thisMonth, 1))
  const endSameMonthLastYear = new Date(Date.UTC(year - 1, thisMonth + 1, 1))

  // Reports/dashboard show all accounts (incl. deactivated-with-history), not
  // just active ones — a deactivated account can still have a balance worth
  // showing until its history ages out.
  const [accounts, openingBalances] = canViewAccounting(role)
    ? await Promise.all([getPaymentAccounts({ activeOnly: false }), prisma.accountOpeningBalance.findMany()])
    : [[], []]

  const obByAccountId = new Map(openingBalances.map((ob) => [ob.paymentAccountId, ob]))
  const balancedAccounts = accounts.filter((acct) => obByAccountId.has(acct.id))

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
    accountSums,
    personCount,
    pendingUpdates,
    pendingMemberships,
    unreconciledGroups,
  ] = await Promise.all([
    // People queries (incl. the DOB fetch + decrypt) only for roles that see
    // the people side — AUDITOR never renders them.
    canViewPeople(role) ? prisma.person.findMany({
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
    }) : Promise.resolve([]),
    canViewPeople(role) ? prisma.family.findMany({
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
    }) : Promise.resolve([]),
    canViewPeople(role) ? prisma.family.count({ where: { archivedAt: null } }) : Promise.resolve(0),
    canViewPeople(role) ? prisma.family.count({ where: { status: "ACTIVE", archivedAt: null } }) : Promise.resolve(0),
    canViewPeople(role) ? prisma.family.count({ where: { createdAt: { gte: createdSince }, archivedAt: null } }) : Promise.resolve(0),
    canViewPeople(role) ? prisma.person.count({ where: { createdAt: { gte: createdSince }, archivedAt: null } }) : Promise.resolve(0),
    // Only feeds the "Needs attention" row, which is ADMIN/PASTOR-only.
    canAccessAccounting(role) ? prisma.pettyCashSession.count({ where: { status: "OPEN" } }) : Promise.resolve(0),
    // Recurring events (date: null) happen within any 30-day window by
    // definition, so they count as upcoming alongside dated events.
    prisma.event.count({ where: { isPublished: true, OR: [{ date: { gte: eventsFrom, lte: eventsTo } }, { kind: "recurring" }] } }),
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

    // Per-account income/expense since its opening-balance asOfDate, in one
    // groupBy (each account has its own asOfDate, hence the OR). An account
    // with no opening balance set yet is left out and renders "—" + a link to
    // set it, rather than blocking the others.
    balancedAccounts.length > 0
      ? prisma.transaction.groupBy({
          by: ["paymentAccountId", "type"],
          where: {
            type: { in: ["INCOME", "EXPENSE"] },
            OR: balancedAccounts.map((acct) => ({
              paymentAccountId: acct.id,
              date: { gte: obByAccountId.get(acct.id)!.asOfDate },
            })),
          },
          _sum: { amount: true },
        })
      : Promise.resolve([]),

    canViewPeople(role) ? prisma.person.count({ where: { archivedAt: null } }) : Promise.resolve(0),
    canEdit(role) ? countPendingFamilyUpdates() : Promise.resolve(0),
    // React-cached: shared with the layout's Sidebar badge.
    canEdit(role) ? countPendingMemberships() : Promise.resolve(0),
    // Unreconciled transactions per BANK account. CASH accounts are excluded:
    // their rows mirror petty-cash activity and are never reconciled, so
    // counting them would leave the row permanently uncleared. Deactivated
    // bank accounts stay in (the Reconciliation page lists them). Up to the
    // end of today (its default `to`), no opening-balance requirement. _min
    // date seeds the deep link's `from`.
    canAccessAccounting(role)
      ? prisma.transaction.groupBy({
          by: ["paymentAccountId"],
          where: { reconciled: false, paymentAccountRel: { kind: "BANK" }, date: { lte: endOfDayUTC(today) } },
          _count: true,
          _min: { date: true },
        })
      : Promise.resolve([]),
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
        // ciphertext; safeDobDate turns that (and impossible dates) into null,
        // matching /people/birthdays, so the window calc isn't poisoned.
        const dateOfBirth = safeDobDate(safeDecrypt(p.dateOfBirth as string))
        if (dateOfBirth === null) return null
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
    .filter((f) => f.marriageDate?.getUTCMonth() === thisMonth)
    .sort((a, b) => a.marriageDate!.getUTCDate() - b.marriageDate!.getUTCDate())


  // asOfDate is a UTC-midnight calendar date — read it with UTC getters.
  const fmtDate = (d: Date) => `${d.getUTCDate()} ${MONTH_ABBR_TITLE[d.getUTCMonth()]} ${d.getUTCFullYear()}`

  const accountBalances = accounts.map((acct) => {
    const ob = obByAccountId.get(acct.id) ?? null
    /** Sum of this account's transactions of `type` since its opening balance, or null if none. */
    const sumOf = (type: string): Money =>
      accountSums.find((g) => g.paymentAccountId === acct.id && g.type === type)?._sum.amount ?? null
    const balance = ob ? accountBalance(ob.amount, sumOf("INCOME"), sumOf("EXPENSE")) : null
    return { id: acct.id, label: acct.name, balance, ob }
  })

  const givingNow = centsToNumber(toCents(givingThisMonth._sum.amount ?? 0))
  const givingLastYearAmt = centsToNumber(toCents(givingLastYear._sum.amount ?? 0))

  // One slim inline strip of headline numbers. Member counts only for roles
  // that can view people; upcoming events for everyone.
  const stats: { label: string; value: number; sub?: string; href?: string }[] = [
    ...(canViewPeople(role)
      ? [
          { label: "Families", value: familyCount, sub: `${activeCount} active` },
          { label: "Members", value: personCount },
          {
            label: "Added (30 days)",
            value: recentFamilies + recentPeople,
            sub: `${recentFamilies} families · ${recentPeople} people`,
          },
        ]
      : []),
    { label: "Upcoming events (30 days)", value: upcomingEventCount, href: "/events" },
  ]

  // Giving trend vs the same month last year — drives the arrow + colour. A
  // zero delta (e.g. a fresh install) is neutral, not a green "up".
  const givingDelta = givingNow - givingLastYearAmt
  let givingTrend: { arrow: string; srLabel: string; className: string } | null = null
  if (givingDelta > 0) givingTrend = { arrow: "▲", srLabel: "Up", className: "text-income" }
  else if (givingDelta < 0) givingTrend = { arrow: "▼", srLabel: "Down", className: "text-expense" }

  // Role-aware "Needs attention" rows — zero counts and items this role can't
  // act on are dropped inside buildAttentionItems.
  const attention = buildAttentionItems(role, {
    pendingFamilyUpdates: pendingUpdates,
    pendingMemberships,
    unreconciled: toUnreconciledRows(unreconciledGroups),
    openPettyCash,
    upcomingBirthdays: upcomingBirthdays.length,
    birthdaysTruncated,
  })

  const sectionHeading = "text-lg font-semibold"

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">
          Welcome back, {session?.user?.name?.split(" ")[0]}
        </h1>
        <dl aria-label="At a glance" className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {stats.map((s) => (
            <div key={s.label} className="flex items-baseline gap-1.5">
              <dt className="text-muted-foreground">
                {s.href ? (
                  <Link href={s.href} className="inline-flex min-h-11 items-center hover:underline sm:min-h-0">
                    {s.label}
                  </Link>
                ) : (
                  s.label
                )}
              </dt>
              <dd className="font-semibold tabular">
                {s.value}
                {s.sub && <span className="ml-1 font-normal text-muted-foreground">({s.sub})</span>}
              </dd>
            </div>
          ))}
        </dl>
      </header>

      {canHaveAttentionItems(role) && <NeedsAttention items={attention} />}

      {/* Money — one primary figure (giving) + per-account balances */}
      {canViewAccounting(role) && (
        <section aria-labelledby="money-heading" className="space-y-3">
          <h2 id="money-heading" className={sectionHeading}>Money</h2>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <div className="rounded-lg border bg-card px-4 py-4">
              <p className="text-sm text-muted-foreground">Giving this month</p>
              <p className="mt-1 text-3xl font-bold tabular sm:text-4xl">{fmt(givingNow)}</p>
              <p className="mt-1 flex flex-wrap items-center gap-1 text-xs">
                {givingTrend ? (
                  <span className={`tabular font-medium ${givingTrend.className}`}>
                    <span aria-hidden="true">{givingTrend.arrow}</span>
                    <span className="sr-only">{givingTrend.srLabel}</span> {fmt(Math.abs(givingDelta))}
                  </span>
                ) : (
                  <span className="font-medium text-muted-foreground">No change</span>
                )}
                <span className="text-muted-foreground">vs last year</span>
              </p>
            </div>
            {accountBalances.length > 0 && (
              <ul aria-label="Account balances" className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                {accountBalances.map(({ id, label, balance, ob }) => (
                  <li key={id}>
                    <BalanceTile label={label} balance={balance}>
                      {ob ? (
                        <p className="mt-1 text-xs text-muted-foreground">as of {fmtDate(ob.asOfDate)}</p>
                      ) : (
                        isAdmin(role) && (
                          <Link
                            href="/accounting/settings"
                            className="mt-1 inline-flex min-h-11 items-center text-xs text-primary hover:underline sm:min-h-0"
                          >
                            Set opening balance
                          </Link>
                        )
                      )}
                    </BalanceTile>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {/* People — birthdays / anniversaries */}
      {canViewPeople(role) && (
        <section aria-labelledby="people-heading" className="space-y-3">
          <h2 id="people-heading" className={sectionHeading}>People</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <MarriageAnniversaryWidget families={marriageAnniversaries} />
            <BirthdayWidget birthdays={upcomingBirthdays} truncated={birthdaysTruncated} />
            <AnniversaryWidget anniversaries={upcomingAnniversaries} truncated={anniversariesTruncated} />
          </div>
        </section>
      )}

      <WhatsNewFooter />
    </div>
  )
}
