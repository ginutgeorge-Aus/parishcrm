import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { canAccessAccounting, canViewAccounting } from "@/lib/roleGuard"
import { safeDecrypt } from "@/lib/crypto"
import { fmtAUD, toCents, centsToNumber } from "@/lib/formatting"
import { currentFYYear, fyDateRange } from "@/lib/fiscalYear"
import { getPaymentAccounts } from "@/lib/paymentAccounts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { APP_LOCALE } from "@/lib/appConfig"

export default async function AccountingPage() {
  const session = await auth()
  if (!canViewAccounting(session?.user?.role)) redirect("/")

  const fyYear = currentFYYear()
  // Bounded half-open FY range — without the upper bound, future-dated
  // transactions (e.g. a statement spanning into the next FY) inflate the
  // current-FY income/expense/net cards and the FY transaction count.
  const { start: startOfFY, end: endOfFY } = fyDateRange(fyYear)

  const [incomeResult, expenseResult, txCount, accountCount, balanceRows, accounts] = await Promise.all([
    prisma.transaction.aggregate({
      where: { type: "INCOME", date: { gte: startOfFY, lt: endOfFY } },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { type: "EXPENSE", date: { gte: startOfFY, lt: endOfFY } },
      _sum: { amount: true },
    }),
    prisma.transaction.count({ where: { date: { gte: startOfFY, lt: endOfFY } } }),
    prisma.account.count({ where: { isActive: true } }),
    prisma.transaction.groupBy({
      by: ["paymentAccountId", "type"],
      where: { paymentAccountId: { not: null } },
      _sum: { amount: true },
    }),
    // Reports show all accounts (incl. deactivated-with-history), not just active ones.
    getPaymentAccounts({ activeOnly: false }),
  ])

  const userCanEdit = canAccessAccounting(session?.user?.role)
  // Integer cents throughout — single divide at display avoids float drift.
  const incomeCents = toCents(incomeResult._sum.amount)
  const expenseCents = toCents(expenseResult._sum.amount)
  const income = centsToNumber(incomeCents)
  const expense = centsToNumber(expenseCents)
  const net = centsToNumber(incomeCents - expenseCents)

  // Accumulate in integer cents, convert to dollars only at display.
  const balanceCents = new Map<number, number>(accounts.map((a) => [a.id, 0]))
  for (const row of balanceRows) {
    if (row.paymentAccountId === null) continue
    if (!balanceCents.has(row.paymentAccountId)) continue
    const cents = toCents(row._sum.amount)
    const prev = balanceCents.get(row.paymentAccountId)!
    balanceCents.set(row.paymentAccountId, row.type === "INCOME" ? prev + cents : prev - cents)
  }

  const fmt = fmtAUD

  const stats = [
    { label: `FY ${fyYear}–${fyYear + 1} Income`, value: fmt(income) },
    { label: `FY ${fyYear}–${fyYear + 1} Expenses`, value: fmt(expense) },
    { label: `FY ${fyYear}–${fyYear + 1} Net`, value: fmt(net), highlight: net >= 0 ? "text-income" : "text-expense" },
    { label: "Transactions (FY)", value: txCount },
  ]

  const recentTxRaw = await prisma.transaction.findMany({
    orderBy: { date: "desc" },
    take: 10,
    include: { account: { select: { name: true, code: true } }, family: { select: { name: true } } },
  })

  const recentTx = recentTxRaw.map((tx) => ({
    ...tx,
    description: safeDecrypt(tx.description),
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-foreground">Accounting</h2>
        <div className="flex gap-2 print:hidden">
          <Button variant="outline" size="sm" asChild>
            <Link href="/accounting/accounts">Categories</Link>
          </Button>
          {userCanEdit && (
            <Button size="sm" asChild>
              <Link href="/accounting/transactions/new">New transaction</Link>
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {s.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className={`text-2xl font-bold ${s.highlight ?? ""}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-2">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Account Balances (all-time, CRM transactions only)
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Cumulative net of every recorded transaction per account — not FY-scoped like the cards above. Reflects transactions recorded in this system only; may not match your bank statement if historical data was not imported.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {accounts.map((acct) => {
            const bal = centsToNumber(balanceCents.get(acct.id) ?? 0)
            return (
              <Card key={acct.id} className={bal >= 0 ? "border-l-4 border-l-green-500" : "border-l-4 border-l-red-500"}>
                <CardHeader className="pb-1 pt-4 px-4">
                  <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {acct.name}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <p className={`text-2xl font-bold ${bal >= 0 ? "text-income" : "text-expense"}`}>
                    {fmt(bal)}
                  </p>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-foreground">Recent transactions</h3>
          <Button variant="outline" size="sm" asChild>
            <Link href="/accounting/transactions">View all</Link>
          </Button>
        </div>
        {recentTx.length === 0 ? (
          <p className="text-sm text-muted-foreground">No transactions yet.</p>
        ) : (
          <>
            {/* Mobile: card per transaction (avoids sideways table scroll) */}
            <ul className="space-y-2 md:hidden">
              {recentTx.map((tx) => (
                <li key={tx.id} className="rounded-lg border bg-card p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">
                        <Link href={`/accounting/transactions/${tx.id}`} className="hover:underline">
                          {tx.description}
                        </Link>
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {tx.date.toLocaleDateString(APP_LOCALE, { timeZone: "UTC" })} · {tx.account.code} {tx.account.name}
                      </p>
                    </div>
                    <span className={`shrink-0 tabular font-semibold whitespace-nowrap ${tx.type === "INCOME" ? "text-income" : "text-expense"}`}>
                      {tx.type === "INCOME" ? "+" : "-"}{fmt(Number(tx.amount))}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{tx.family?.name ?? "—"}</p>
                </li>
              ))}
            </ul>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 font-medium">Date</th>
                    <th className="pb-2 font-medium">Description</th>
                    <th className="pb-2 font-medium">Category</th>
                    <th className="pb-2 font-medium">Family</th>
                    <th className="pb-2 font-medium text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {recentTx.map((tx) => (
                    <tr key={tx.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 whitespace-nowrap">
                        {tx.date.toLocaleDateString(APP_LOCALE, { timeZone: "UTC" })}
                      </td>
                      <td className="py-2 pr-4">
                        <Link href={`/accounting/transactions/${tx.id}`} className="hover:underline">
                          {tx.description}
                        </Link>
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">{tx.account.code} {tx.account.name}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{tx.family?.name ?? "—"}</td>
                      <td className={`py-2 text-right tabular whitespace-nowrap ${tx.type === "INCOME" ? "text-income" : "text-expense"}`}>
                        {tx.type === "INCOME" ? "+" : "-"}{fmt(Number(tx.amount))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 max-w-full">
        <p className="text-xs text-muted-foreground">Active accounts: {accountCount}</p>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button variant="outline" size="sm" asChild>
            <Link href="/accounting/reports/pl">P&amp;L Report</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/accounting/reports/budget-vs-actual">Budget vs Actual</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/accounting/reports/giving-summary">Giving Summary</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/accounting/reports/trial-balance">Trial Balance</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/accounting/reports/cash-flow">Cash Flow</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/accounting/reports/general-ledger">General Ledger</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/accounting/reports/funds">Fund Report</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
