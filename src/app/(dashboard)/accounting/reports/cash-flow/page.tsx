import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { prisma } from "@/lib/prisma"
import { canViewAccounting } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { YearSelector } from "@/components/accounting/YearSelector"
import { PrintButton } from "@/components/ui/PrintButton"
import { Button } from "@/components/ui/button"
import { groupByAccountGroup, type AccountGroup } from "@/lib/reports/accountGrouping"
import { currentFYYear, fyDateRange } from "@/lib/fiscalYear"
import { toCents, centsToNumber, fmtAUD as fmt } from "@/lib/formatting"
import { TransactionType } from "@/lib/generated/prisma/enums"
import { getPaymentAccounts, type PaymentAccountLite } from "@/lib/paymentAccounts"

type Props = { searchParams: Promise<{ year?: string }> }

type Row = {
  id: number
  type: string
  group: { id: number; name: string; sortOrder: number } | null
}

export default async function CashFlowPage(props: Props) {
  const session = await auth()
  if (!canViewAccounting(session?.user?.role)) redirect("/")

  void logAudit(actorId(session), "VIEW_FINANCIAL_REPORT", "CashFlow", undefined, { report: "cash-flow" })

  const sp = await props.searchParams
  const fyNow = currentFYYear()
  const parsedYear = Number.parseInt(sp.year ?? String(fyNow), 10)
  const year = parsedYear >= 2000 && parsedYear <= fyNow + 10 ? parsedYear : fyNow
  const { start: fyStart, end: fyEnd } = fyDateRange(year)

  // Section 1 — operating activities by account group
  const [accounts, totals] = await Promise.all([
    prisma.account.findMany({
      where: {
        // Exclude the internal-transfer clearing account: its
        // internal petty-cash↔bank legs are not operating cash flow, and the
        // type-grouped `_sum.amount` here would otherwise inflate Total Cash
        // Out the same way it inflated P&L Total Expenses. See xferAccount.ts.
        code: { not: "XFER" },
        OR: [{ isActive: true }, { transactions: { some: { date: { gte: fyStart, lt: fyEnd } } } }],
      },
      orderBy: [{ group: { sortOrder: "asc" } }, { code: "asc" }],
      include: { group: { select: { id: true, name: true, sortOrder: true } } },
    }),
    prisma.transaction.groupBy({
      by: ["accountId"],
      where: { date: { gte: fyStart, lt: fyEnd } },
      _sum: { amount: true },
    }),
  ])
  const totalMap = new Map<number, number>(totals.map((g) => [g.accountId, toCents(g._sum.amount)]))
  const totalFor = (id: number) => totalMap.get(id) ?? 0

  const incomeGroups = groupByAccountGroup(accounts.filter((a) => a.type === "INCOME") as Row[])
  const expenseGroups = groupByAccountGroup(accounts.filter((a) => a.type === "EXPENSE") as Row[])
  const groupTotal = (g: AccountGroup<Row>) => g.accounts.reduce((s, a) => s + totalFor(a.id), 0)

  const cashIn = incomeGroups.reduce((s, g) => s + groupTotal(g), 0)
  const cashOut = expenseGroups.reduce((s, g) => s + groupTotal(g), 0)
  const netMovement = cashIn - cashOut

  // Section 2 — cash position per payment account. Reports show all accounts
  // (incl. deactivated-with-history), not just active ones.
  const paymentAccounts = await getPaymentAccounts({ activeOnly: false })
  const obs = await Promise.all(
    paymentAccounts.map((acct) => prisma.accountOpeningBalance.findUnique({ where: { paymentAccountId: acct.id } })),
  )

  function movement(accountId: number, gte: Date, lt: Date) {
    return Promise.all([
      prisma.transaction.aggregate({ where: { paymentAccountId: accountId, type: TransactionType.INCOME, date: { gte, lt } }, _sum: { amount: true } }),
      prisma.transaction.aggregate({ where: { paymentAccountId: accountId, type: TransactionType.EXPENSE, date: { gte, lt } }, _sum: { amount: true } }),
    ])
  }

  type Position = {
    account: PaymentAccountLite
    ob: { amount: { toString(): string }; asOfDate: Date } | null
    opening: number | null
    inCents: number
    outCents: number
    closing: number | null
  }

  const positions: Position[] = await Promise.all(
    paymentAccounts.map(async (account, i): Promise<Position> => {
      const ob = obs[i]
      if (!ob) return { account, ob: null, opening: null, inCents: 0, outCents: 0, closing: null }
      // Opening balance anchored after this FY → account has no position this FY.
      if (ob.asOfDate >= fyEnd) {
        return { account, ob, opening: null, inCents: 0, outCents: 0, closing: null }
      }
      // Movement window: when the opening balance is anchored mid-FY, aggregate
      // only from the anchor forward. Transactions dated [fyStart, asOfDate) are
      // already baked into ob.amount, so counting them again would double them
      // and make the closing cash position disagree with the balance sheet.
      const movementStart = ob.asOfDate > fyStart ? ob.asOfDate : fyStart
      const [fyIn, fyOut] = await movement(account.id, movementStart, fyEnd)
      const inCents = toCents(fyIn._sum.amount ?? 0)
      const outCents = toCents(fyOut._sum.amount ?? 0)
      // Opening = the anchor value (mid-FY anchor, already current as of asOfDate),
      // or the anchor + net movement from its anchor to FY start (anchor ≤ FY start).
      let openingCents: number
      if (ob.asOfDate > fyStart) {
        openingCents = toCents(ob.amount)
      } else {
        const [preIn, preOut] = await movement(account.id, ob.asOfDate, fyStart)
        openingCents = toCents(ob.amount) + toCents(preIn._sum.amount ?? 0) - toCents(preOut._sum.amount ?? 0)
      }
      return { account, ob, opening: openingCents, inCents, outCents, closing: openingCents + inCents - outCents }
    }),
  )

  // p.closing is already an integer-cents value — sum the integers directly.
  // Passing it through sumCents/toCents would re-scale each by 100.
  const totalClosing = positions.reduce((sum, p) => sum + (p.closing ?? 0), 0)
  const hasClosing = positions.some((p) => p.closing !== null)
  const missingOb = positions.filter((p) => !p.ob)

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-6 print:hidden">
        <h2 className="text-2xl font-semibold text-foreground">Cash Flow — FY {year}–{year + 1}</h2>
        <div className="flex items-center gap-3">
          <YearSelector currentYear={year} />
          <Button asChild variant="outline" size="sm">
            <Link href={`/api/accounting/reports/cash-flow/export-csv?year=${year}`}>Export CSV</Link>
          </Button>
          <PrintButton />
        </div>
      </div>
      <h2 className="hidden print:block text-xl font-semibold mb-4">Cash Flow — FY {year}–{year + 1}</h2>

      {/* Section 1: Operating activities */}
      <div className="overflow-x-auto">
      <table className="w-full text-sm mb-8">
        <tbody>
          <tr><td colSpan={2} className="pt-2 pb-1 font-bold uppercase text-xs text-muted-foreground tracking-wide">Operating — Cash In</td></tr>
          {incomeGroups.map((g) => (
            <tr key={`in-${g.groupName}`} className="border-b border-border">
              <td className="py-1.5 pr-3 pl-4">{g.groupName}</td>
              <td className="py-1.5 text-right tabular text-income">{fmt(centsToNumber(groupTotal(g)))}</td>
            </tr>
          ))}
          <tr className="border-b border-border font-medium">
            <td className="py-1.5 pr-3">Total cash in</td>
            <td className="py-1.5 text-right tabular">{fmt(centsToNumber(cashIn))}</td>
          </tr>

          <tr><td colSpan={2} className="pt-4 pb-1 font-bold uppercase text-xs text-muted-foreground tracking-wide">Operating — Cash Out</td></tr>
          {expenseGroups.map((g) => (
            <tr key={`out-${g.groupName}`} className="border-b border-border">
              <td className="py-1.5 pr-3 pl-4">{g.groupName}</td>
              <td className="py-1.5 text-right tabular text-expense">{fmt(centsToNumber(groupTotal(g)))}</td>
            </tr>
          ))}
          <tr className="border-b border-border font-medium">
            <td className="py-1.5 pr-3">Total cash out</td>
            <td className="py-1.5 text-right tabular">{fmt(centsToNumber(cashOut))}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border font-bold">
            <td className="py-2 pr-3">Net cash movement</td>
            <td className={`py-2 text-right tabular ${netMovement >= 0 ? "text-income" : "text-expense"}`}>{fmt(centsToNumber(netMovement))}</td>
          </tr>
        </tfoot>
      </table>
      </div>

      {/* Section 2: Cash position per account */}
      <h3 className="text-lg font-semibold text-foreground mb-2">Cash position by account</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-table text-sm">
          <thead>
            <tr className="border-b-2 border-border">
              <th className="text-left py-2 pr-3 font-semibold text-muted-foreground">Account</th>
              <th className="text-right py-2 pr-3 font-semibold text-muted-foreground">Opening</th>
              <th className="text-right py-2 pr-3 font-semibold text-muted-foreground">+ In</th>
              <th className="text-right py-2 pr-3 font-semibold text-muted-foreground">− Out</th>
              <th className="text-right py-2 font-semibold text-muted-foreground">Closing</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => (
              <tr key={p.account.id} className="border-b border-border">
                <td className="py-2 pr-3 font-medium">{p.account.name}</td>
                <td className="py-2 pr-3 text-right tabular">{p.opening !== null ? fmt(centsToNumber(p.opening)) : "—"}</td>
                <td className="py-2 pr-3 text-right tabular text-income">{p.ob ? fmt(centsToNumber(p.inCents)) : "—"}</td>
                <td className="py-2 pr-3 text-right tabular text-expense">{p.ob ? fmt(centsToNumber(p.outCents)) : "—"}</td>
                <td className="py-2 text-right tabular font-semibold">{p.closing !== null ? fmt(centsToNumber(p.closing)) : "—"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-bold">
              <td colSpan={4} className="py-2 pr-3">Total closing cash</td>
              <td className="py-2 text-right tabular">{hasClosing ? fmt(centsToNumber(totalClosing)) : "—"}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Section 1&apos;s net cash movement is book-wide — every transaction this financial year. The
        movement here is scoped to each payment account and starts at that account&apos;s movement window,
        so transactions with no payment account or an opening balance anchored mid-year mean the two need
        not agree. Opening is each account&apos;s position at the start of its movement window — 1 Jul {year},
        or the account&apos;s opening-balance anchor date if that falls later in the year.
      </p>

      {missingOb.length > 0 && (
        <div className="mt-4 space-y-2">
          {missingOb.map((p) => (
            <div key={p.account.id} className="p-3 bg-warning/10 border border-warning/40 rounded text-sm text-warning">
              ⚠ {p.account.name} has no opening balance set.{" "}
              <Link href="/accounting/settings" className="underline font-medium">Set one in Accounting Settings →</Link>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
