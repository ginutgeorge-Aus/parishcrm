import { Suspense } from "react"
import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { prisma } from "@/lib/prisma"
import { canViewAccounting } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { toFloat } from "@/lib/utils"
import { BalanceSheetDatePicker } from "@/components/accounting/BalanceSheetDatePicker"
import { PrintButton } from "@/components/ui/PrintButton"
import { Button } from "@/components/ui/button"
import { fmtAUD as fmt, formatDMY, toCents, centsToNumber, sumCents } from "@/lib/formatting"
import { TransactionType } from "@/lib/generated/prisma/enums"
import { sydneyToday, endOfDayUTC } from "@/lib/dates"
import { getPaymentAccounts, type PaymentAccountLite } from "@/lib/paymentAccounts"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// Stricter than the shared parseISODate: also rejects impossible calendar
// dates (e.g. 31/02) via a UTC reconstruct check. Kept local on purpose.
function parseDate(s: string | undefined): Date | null {
  if (!s || !ISO_DATE.test(s)) return null
  const [y, m, day] = s.split("-").map(Number)
  const d = new Date(s)
  if (isNaN(d.getTime())) return null
  if (d.getUTCFullYear() !== y || d.getUTCMonth() + 1 !== m || d.getUTCDate() !== day) return null
  return d
}

function toYMD(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
}

// Dashed DD-MM-YYYY for human-facing "As at" labels.
const toDMY = (d: Date) => formatDMY(d, "-")

export default async function BalanceSheetPage(props: {
  searchParams: Promise<{ date?: string }>
}) {
  const session = await auth()
  if (!canViewAccounting(session?.user?.role)) redirect("/")

  // Page view, not an export.
  void logAudit(
    actorId(session),
    "VIEW_FINANCIAL_REPORT",
    "BalanceSheet",
    undefined,
    { report: "balance-sheet" }
  )

  const searchParams = await props.searchParams
  const today = sydneyToday()
  const asAtDate = parseDate(searchParams.date) ?? today
  const dateStr = toYMD(asAtDate)
  const endOfDay = endOfDayUTC(asAtDate)

  // Reports show all accounts (incl. deactivated-with-history), not just active ones.
  const accounts = await getPaymentAccounts({ activeOnly: false })

  // Step 1: fetch opening balances in parallel
  const openingBalances = await prisma.accountOpeningBalance.findMany({
    where: { paymentAccountId: { in: accounts.map((a) => a.id) } },
  })
  const obByAccountId = new Map(openingBalances.map((ob) => [ob.paymentAccountId, ob]))

  function agg(
    accountId: number,
    ob: { asOfDate: Date } | null,
    type: TransactionType,
  ) {
    // No opening balance, or the as-at date precedes the anchor: the account
    // position is undefined then. Skip the query (an inverted gte>lte range would
    // silently return 0 and mis-attribute the full opening amount to that date).
    if (!ob || endOfDay < ob.asOfDate) return Promise.resolve({ _sum: { amount: null } })
    return prisma.transaction.aggregate({
      where: { paymentAccountId: accountId, type, date: { gte: ob.asOfDate, lte: endOfDay } },
      _sum: { amount: true },
    })
  }

  // Step 2: run aggregates for accounts that have opening balances
  const aggs = await Promise.all(
    accounts.map(async (acct) => {
      const ob = obByAccountId.get(acct.id) ?? null
      const [income, expense] = await Promise.all([
        agg(acct.id, ob, TransactionType.INCOME),
        agg(acct.id, ob, TransactionType.EXPENSE),
      ])
      return { acct, ob, income, expense }
    })
  )

  type AccountRow = {
    account: PaymentAccountLite
    ob: { amount: { toString(): string }; asOfDate: Date } | null
    income: number | null
    expense: number | null
    balance: number | null
  }

  // An account has a defined position only from its anchor forward. Before the
  // anchor the numeric columns render "—", not a mis-attributed opening amount.
  const activeAt = (ob: { asOfDate: Date } | null) => !!ob && endOfDay >= ob.asOfDate

  const rows: AccountRow[] = aggs.map(({ acct, ob, income, expense }) => ({
    account: acct,
    ob,
    income: activeAt(ob) ? centsToNumber(toCents(income._sum.amount ?? 0)) : null,
    expense: activeAt(ob) ? centsToNumber(toCents(expense._sum.amount ?? 0)) : null,
    balance: activeAt(ob)
      ? centsToNumber(toCents(ob!.amount) + toCents(income._sum.amount ?? 0) - toCents(expense._sum.amount ?? 0))
      : null,
  }))

  const totalBalance = centsToNumber(
    sumCents(rows.filter((r) => r.balance !== null).map((r) => r.balance!))
  )
  const hasAnyBalance = rows.some((r) => r.balance !== null)
  const missingOb = rows.filter((r) => !r.ob)

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-6 print:hidden">
        <h2 className="text-2xl font-semibold text-foreground">
          Balance Sheet — As at {toDMY(asAtDate)}
        </h2>
        <div className="flex items-center gap-3">
          <Suspense fallback={<div className="h-8 w-32 rounded bg-muted animate-pulse" />}>
            <BalanceSheetDatePicker value={dateStr} />
          </Suspense>
          <Button asChild variant="outline" size="sm">
            <Link href={`/api/accounting/reports/balance-sheet/export-csv?date=${dateStr}`}>Export CSV</Link>
          </Button>
          <PrintButton />
        </div>
      </div>
      <h2 className="hidden print:block text-xl font-semibold mb-4">
        Balance Sheet — As at {toDMY(asAtDate)}
      </h2>

      <div className="overflow-x-auto">
      <table className="w-full min-w-table text-sm">
        <thead>
          <tr className="border-b-2 border-border">
            <th className="text-left py-2 pr-3 font-semibold text-muted-foreground">Account</th>
            <th className="text-right py-2 pr-3 font-semibold text-muted-foreground">Opening Balance</th>
            <th className="text-right py-2 pr-3 font-semibold text-muted-foreground">+ Income</th>
            <th className="text-right py-2 pr-3 font-semibold text-muted-foreground">− Expenses</th>
            <th className="text-right py-2 font-semibold text-muted-foreground">Balance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ account, ob, income, expense, balance }) => (
            <tr key={account.id} className="border-b border-border">
              <td className="py-3 pr-3 font-medium">{account.name}</td>
              <td className="py-3 pr-3 text-right tabular">
                {ob && activeAt(ob) ? (
                  <>
                    {fmt(toFloat(ob.amount))}
                    <span className="block text-xs text-muted-foreground">
                      since {toDMY(ob.asOfDate)}
                    </span>
                  </>
                ) : "—"}
              </td>
              <td className="py-3 pr-3 text-right tabular text-income">
                {income !== null ? fmt(income) : "—"}
              </td>
              <td className="py-3 pr-3 text-right tabular text-expense">
                {expense !== null ? fmt(expense) : "—"}
              </td>
              <td className="py-3 text-right tabular font-semibold">
                {balance !== null ? fmt(balance) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border font-bold">
            <td colSpan={4} className="py-2 pr-3">Total</td>
            <td className="py-2 text-right tabular">
              {hasAnyBalance ? fmt(totalBalance) : "—"}
            </td>
          </tr>
        </tfoot>
      </table>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Book balance — includes all recorded transactions, reconciled or not. The{" "}
        <Link href="/accounting/reconciliation" className="underline print:no-underline">
          reconciliation page
        </Link>{" "}
        shows the bank balance (reconciled transactions only), so the two can differ.
      </p>

      {missingOb.length > 0 && (
        <div className="mt-4 space-y-2">
          {missingOb.map(({ account }) => (
            <div
              key={account.id}
              className="p-3 bg-warning/10 border border-warning/40 rounded text-sm text-warning"
            >
              ⚠ {account.name} has no opening balance set.{" "}
              <Link href="/accounting/settings" className="underline font-medium">
                Set one in Accounting Settings →
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
