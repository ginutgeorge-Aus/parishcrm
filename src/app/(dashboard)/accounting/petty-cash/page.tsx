import { redirect } from "next/navigation"
import Link from "next/link"
import { Suspense } from "react"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { PERSON_PICKER_CAP } from "@/lib/constants"
import { canAccessAccounting, canViewAccounting, isAdmin } from "@/lib/roleGuard"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { PettyCashFilters } from "@/components/petty-cash/PettyCashFilters"
import { DeleteSessionButton } from "@/components/petty-cash/DeleteSessionButton"
import { ensureWeeklySession } from "@/lib/actions/pettyCashSession"
import { calcRunningBalance, varianceLabel } from "@/lib/pettyCashLedger"
import { fmtAUD as fmt, sumCents, centsToNumber, sessionDateFromTitle } from "@/lib/formatting"
import { PettyCashSessionStatus } from "@/lib/generated/prisma/enums"
import { APP_LOCALE, APP_TIMEZONE } from "@/lib/appConfig"

type PettyCashSearchParams = { status?: string; from?: string; to?: string; custodian?: string }

function buildSessionWhere(sp: PettyCashSearchParams) {
  // Validate URL params before they reach Prisma — a crafted ?custodian=abc or
  // ?from=notadate would otherwise produce NaN / Invalid Date in the where
  // clause and either 500 or silently return wrong results.
  // Allowlist the status param before it reaches Prisma's enum cast — a crafted
  // ?status=FOO would otherwise throw PrismaClientValidationError → 500.
  const VALID_STATUSES = new Set<PettyCashSessionStatus>(["OPEN", "CLOSED"])
  const statusFilter =
    sp.status && VALID_STATUSES.has(sp.status as PettyCashSessionStatus)
      ? (sp.status as PettyCashSessionStatus)
      : undefined
  const custodianId = sp.custodian ? parseInt(sp.custodian, 10) : undefined
  const fromDate = sp.from ? new Date(sp.from) : undefined
  const toDate = sp.to ? new Date(sp.to + "T23:59:59.999") : undefined
  const fromValid = fromDate && !isNaN(fromDate.getTime())
  const toValid = toDate && !isNaN(toDate.getTime())

  const where = {
    ...(statusFilter && { status: statusFilter }),
    ...(custodianId !== undefined && !isNaN(custodianId) && { custodianId }),
    ...(fromValid || toValid
      ? {
          openedAt: {
            ...(fromValid && { gte: fromDate }),
            ...(toValid && { lte: toDate }),
          },
        }
      : {}),
  }
  return where
}

export default async function PettyCashPage(
  props: {
    searchParams: Promise<PettyCashSearchParams>
  }
) {
  const searchParams = await props.searchParams;
  const session = await auth()
  if (!canViewAccounting(session?.user?.role)) redirect("/")

  // Lazy weekly auto-open (no-op for non-editors). Run before listing so a
  // freshly-created session appears in the same render.
  const ensured = await ensureWeeklySession()

  const where = buildSessionWhere(searchParams)

  const [sessions, people] = await Promise.all([
    prisma.pettyCashSession.findMany({
      where,
      orderBy: { openedAt: "desc" },
      // Cap the number of sessions, not their child rows — children feed each
      // session's running-balance totals and must stay complete.
      take: 500,
      include: {
        custodian: { select: { firstName: true, lastName: true } },
        receipts: { select: { amount: true } },
        expenses: { select: { amount: true } },
        transfers: { select: { amount: true } },
      },
    }),
    prisma.person.findMany({
      where: { archivedAt: null },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      select: { id: true, firstName: true, lastName: true },
      take: PERSON_PICKER_CAP,
    }),
  ])

  // Sort by session (Sunday) date, newest first — the title encodes the date,
  // whereas openedAt is creation time (backfilled sessions all share one
  // instant, so an openedAt sort would scramble them). Unparseable titles fall
  // back to openedAt.
  const sessionsWithBalance = sessions
    .map((s) => ({
      ...s,
      balance: calcRunningBalance(s.openingBalance, s.receipts, s.expenses, s.transfers),
    }))
    .sort((a, b) => {
      const da = (sessionDateFromTitle(a.title) ?? a.openedAt).getTime()
      const db = (sessionDateFromTitle(b.title) ?? b.openedAt).getTime()
      return db - da
    })

  const totalInHand = centsToNumber(
    sumCents(
      sessionsWithBalance.filter((s) => s.status === "OPEN").map((s) => s.balance),
    ),
  )

  const userCanEdit = canAccessAccounting(session?.user?.role)
  const userIsAdmin = isAdmin(session?.user?.role)

  return (
    <div className="space-y-4">
      {userCanEdit &&
        (ensured.status === "skipped-no-custodian" || ensured.status === "skipped-missing-custodian") && (
          <div className="rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
            {ensured.status === "skipped-no-custodian"
              ? "No default petty cash custodian is set — weekly sessions won’t open automatically."
              : "The configured default custodian no longer exists — weekly sessions won’t open automatically."}{" "}
            <Link href="/accounting/settings" className="font-medium underline">
              Configure it in Settings
            </Link>
            .
          </div>
        )}
      <div className="flex flex-wrap items-center justify-between gap-y-2">
        <h2 className="text-2xl font-semibold text-foreground">Petty Cash</h2>
        {userCanEdit && (
          <div className="flex flex-wrap gap-2">
            {userIsAdmin && (
              <Button asChild size="sm" variant="outline">
                <Link href="/accounting/petty-cash/service-types">Service types</Link>
              </Button>
            )}
            {userIsAdmin && (
              <Button asChild size="sm" variant="outline">
                <Link href="/accounting/petty-cash/import">Import CSV</Link>
              </Button>
            )}
            <Button asChild size="sm">
              <Link href="/accounting/petty-cash/sessions/new">Open session</Link>
            </Button>
          </div>
        )}
      </div>

      <div className="rounded-lg border bg-card p-4 w-fit">
        <p className="text-xs text-muted-foreground">Total cash in hand (open sessions)</p>
        <p className="text-2xl font-semibold">{fmt(totalInHand)}</p>
      </div>

      <Suspense>
        <PettyCashFilters people={people} />
      </Suspense>

      {/* Mobile: card per session (avoids sideways table scroll) */}
      <ul className="space-y-2 md:hidden">
        {sessionsWithBalance.length === 0 && (
          <li className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
            No sessions found
          </li>
        )}
        {sessionsWithBalance.map((s) => (
          <li key={s.id} className="rounded-lg border bg-card p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">{s.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {s.custodian.firstName} {s.custodian.lastName} · opened{" "}
                  {s.openedAt.toLocaleDateString(APP_LOCALE, { timeZone: APP_TIMEZONE })}
                </p>
              </div>
              <span className="shrink-0 tabular font-semibold whitespace-nowrap">{fmt(s.balance)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2">
              <span className="flex items-center gap-2">
                <Badge variant={s.status === "OPEN" ? "default" : "outline"}>{s.status}</Badge>
                {s.status === "CLOSED" &&
                  s.closingVariance !== null &&
                  Number(s.closingVariance) !== 0 && (
                    <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">
                      {varianceLabel(Number(s.closingVariance))}
                    </span>
                  )}
              </span>
              <span className="flex items-center gap-1">
                <Button variant="ghost" size="sm" asChild className="h-11 sm:h-8 any-pointer-coarse:h-11">
                  <Link href={`/accounting/petty-cash/sessions/${s.id}`}>View</Link>
                </Button>
                {userIsAdmin && s.status === "OPEN" && <DeleteSessionButton id={s.id} />}
              </span>
            </div>
          </li>
        ))}
      </ul>

      {/* Desktop: table. Bank Import review table (BankReviewTable) stays scroll-only
          by design — its per-row comboboxes + split sub-rows don't reflow to cards
          cleanly (cf. dense P&L/trial-balance grids). */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th scope="col" className="pb-2 font-medium">Title</th>
              <th scope="col" className="pb-2 font-medium">Custodian</th>
              <th scope="col" className="pb-2 font-medium">Opened</th>
              <th scope="col" className="pb-2 font-medium">Status</th>
              <th scope="col" className="pb-2 font-medium text-right">Balance</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody>
            {sessionsWithBalance.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-muted-foreground">
                  No sessions found
                </td>
              </tr>
            )}
            {sessionsWithBalance.map((s) => (
              <tr key={s.id} className="border-b last:border-0 hover:bg-muted/30">
                <td className="py-2 pr-4">{s.title}</td>
                <td className="py-2 pr-4">
                  {s.custodian.firstName} {s.custodian.lastName}
                </td>
                <td className="py-2 pr-4 whitespace-nowrap">
                  {s.openedAt.toLocaleDateString(APP_LOCALE, { timeZone: APP_TIMEZONE })}
                </td>
                <td className="py-2 pr-4">
                  <Badge variant={s.status === "OPEN" ? "default" : "outline"}>
                    {s.status}
                  </Badge>
                  {s.status === "CLOSED" &&
                    s.closingVariance !== null &&
                    Number(s.closingVariance) !== 0 && (
                      <span className="ml-2 rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">
                        {varianceLabel(Number(s.closingVariance))}
                      </span>
                    )}
                </td>
                <td className="py-2 pr-4 text-right tabular font-medium">
                  {fmt(s.balance)}
                </td>
                <td className="py-2">
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/accounting/petty-cash/sessions/${s.id}`}>View</Link>
                  </Button>
                  {userIsAdmin && s.status === "OPEN" && <DeleteSessionButton id={s.id} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
