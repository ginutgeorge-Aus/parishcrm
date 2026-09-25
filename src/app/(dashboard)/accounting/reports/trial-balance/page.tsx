import React from "react"
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
import { toCents, centsToNumber, fmtAUDAccounting } from "@/lib/formatting"

type Props = { searchParams: Promise<{ year?: string }> }

const fmt = (cents: number) => fmtAUDAccounting(centsToNumber(cents))

type Row = {
  id: number
  code: string
  name: string
  type: string
  group: { id: number; name: string; sortOrder: number } | null
}

export default async function TrialBalancePage(props: Props) {
  const session = await auth()
  if (!canViewAccounting(session?.user?.role)) redirect("/")

  void logAudit(actorId(session), "VIEW_FINANCIAL_REPORT", "TrialBalance", undefined, { report: "trial-balance" })

  const sp = await props.searchParams
  const fyNow = currentFYYear()
  const parsedYear = parseInt(sp.year ?? String(fyNow), 10)
  const year = parsedYear >= 2000 && parsedYear <= fyNow + 10 ? parsedYear : fyNow
  const { start: fyStart, end: fyEnd } = fyDateRange(year)

  const [accounts, totals] = await Promise.all([
    prisma.account.findMany({
      where: {
        // Exclude the internal-transfer clearing account: its two
        // legs (INCOME + EXPENSE, both positive `amount`) sum to a positive
        // total under this report's type-grouped `_sum.amount`, inflating
        // Total Debit the same way it inflated P&L Total Expenses. See
        // xferAccount.ts.
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

  const totalCredit = accounts.filter((a) => a.type === "INCOME").reduce((s, a) => s + totalFor(a.id), 0)
  const totalDebit = accounts.filter((a) => a.type === "EXPENSE").reduce((s, a) => s + totalFor(a.id), 0)
  const net = totalCredit - totalDebit

  function renderSection(groups: AccountGroup<Row>[], side: "debit" | "credit", heading: string) {
    return (
      <>
        <tr>
          <td colSpan={4} className="pt-4 pb-1 font-bold uppercase text-xs text-muted-foreground tracking-wide">{heading}</td>
        </tr>
        {groups.map((g) => (
          <React.Fragment key={`${side}-${g.groupName}`}>
            <tr>
              <td colSpan={4} className="pt-3 pb-0.5 pl-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{g.groupName}</td>
            </tr>
            {g.accounts.map((a) => (
              <tr key={a.id} className="border-b border-border">
                <td className="py-1.5 pr-3 pl-4 font-mono text-muted-foreground">{a.code}</td>
                <td className="py-1.5 pr-3 pl-4">{a.name}</td>
                <td className="py-1.5 pr-3 text-right tabular">{side === "debit" ? fmt(totalFor(a.id)) : ""}</td>
                <td className="py-1.5 text-right tabular">{side === "credit" ? fmt(totalFor(a.id)) : ""}</td>
              </tr>
            ))}
          </React.Fragment>
        ))}
      </>
    )
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-6 print:hidden">
        <h2 className="text-2xl font-semibold text-foreground">Trial Balance — FY {year}–{year + 1}</h2>
        <div className="flex items-center gap-3">
          <YearSelector currentYear={year} />
          <Button asChild variant="outline" size="sm">
            <Link href={`/api/accounting/reports/trial-balance/export-csv?year=${year}`}>Export CSV</Link>
          </Button>
          <PrintButton />
        </div>
      </div>
      <h2 className="hidden print:block text-xl font-semibold mb-4">Trial Balance — FY {year}–{year + 1}</h2>

      <div className="overflow-x-auto">
        <table className="w-full min-w-table text-sm">
          <thead>
            <tr className="border-b-2 border-border">
              <th className="text-left py-2 pr-3 font-semibold text-muted-foreground">Code</th>
              <th className="text-left py-2 pr-3 font-semibold text-muted-foreground">Account</th>
              <th className="text-right py-2 pr-3 font-semibold text-muted-foreground">Debit</th>
              <th className="text-right py-2 font-semibold text-muted-foreground">Credit</th>
            </tr>
          </thead>
          <tbody>
            {renderSection(expenseGroups, "debit", "Expenses")}
            {renderSection(incomeGroups, "credit", "Income")}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-bold">
              <td colSpan={2} className="py-2 pr-3">Total</td>
              <td className="py-2 pr-3 text-right tabular">{fmt(totalDebit)}</td>
              <td className="py-2 text-right tabular">{fmt(totalCredit)}</td>
            </tr>
            <tr className="font-semibold">
              <td colSpan={2} className="py-2 pr-3">Net surplus / (deficit)</td>
              <td colSpan={2} className={`py-2 text-right tabular ${net >= 0 ? "text-income" : "text-expense"}`}>{fmt(net)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Single-entry books — debit (expenses) and credit (income) totals are not expected to be equal; the
        difference is the net surplus/deficit for the year.
      </p>
    </div>
  )
}
