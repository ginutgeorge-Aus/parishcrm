import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { prisma } from "@/lib/prisma"
import { canViewAccounting } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { YearSelector } from "@/components/accounting/YearSelector"
import { currentFYYear, fyDateRange } from "@/lib/fiscalYear"
import { centsToNumber, fmtAUDAccounting } from "@/lib/formatting"
import { aggregateByFund } from "@/lib/reports/fundHelpers"

type Props = { searchParams: Promise<{ year?: string }> }

// Takes integer cents — every figure on this page is accumulated in
// cents and converted to dollars only here, at the moment of display.
function fmt(cents: number): string {
  return fmtAUDAccounting(centsToNumber(cents))
}

export default async function FundReportPage(props: Props) {
  const searchParams = await props.searchParams
  const session = await auth()
  if (!canViewAccounting(session?.user?.role)) redirect("/")

  void logAudit(actorId(session), "VIEW_FINANCIAL_REPORT", "Transaction", undefined, { report: "funds" })

  const fyNow = currentFYYear()
  const parsedYear = Number.parseInt(searchParams.year ?? String(fyNow), 10)
  const year = parsedYear >= 2000 && parsedYear <= 2100 ? parsedYear : fyNow

  // Half-open FY range — `lt`, not `lte` (fyDateRange's `end` is the exclusive
  // start of the next FY), matching every other FY-scoped report query.
  const { start: fyStart, end: fyEnd } = fyDateRange(year)

  const [grouped, funds] = await Promise.all([
    // Sum in the DB (one row per fund×type) instead of pulling every FY
    // transaction into JS — same shape every other FY report uses.
    prisma.transaction.groupBy({
      by: ["fundId", "type"],
      where: { date: { gte: fyStart, lt: fyEnd } },
      _sum: { amount: true },
    }),
    prisma.fund.findMany({ select: { id: true, name: true } }),
  ])
  const fundNames = new Map(funds.map((f) => [f.id, f.name]))
  const rows = grouped.map((g) => ({ fundId: g.fundId, type: g.type, amount: g._sum.amount ?? "0" }))
  const fundRows = aggregateByFund(rows, fundNames)

  // Plain integer sum — these are already cents, not Money/dollar strings, so
  // sumCents (which parses a dollar string per element) would double-convert.
  const totalIncome = fundRows.reduce((s, r) => s + r.incomeCents, 0)
  const totalExpense = fundRows.reduce((s, r) => s + r.expenseCents, 0)
  const totalNet = totalIncome - totalExpense

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-6 print:hidden">
        <h2 className="text-2xl font-semibold text-foreground">
          Fund Report — FY {year}–{year + 1}
        </h2>
        <YearSelector currentYear={year} />
      </div>
      <h2 className="hidden print:block text-xl font-semibold mb-4">
        Fund Report — FY {year}–{year + 1}
      </h2>

      {fundRows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No transactions recorded for FY {year}–{year + 1}. Try selecting another year.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-border">
                <th className="text-left py-1 pr-3 font-semibold text-muted-foreground">Fund</th>
                <th className="text-right py-1 pr-3 font-semibold text-muted-foreground">Income</th>
                <th className="text-right py-1 pr-3 font-semibold text-muted-foreground">Expense</th>
                <th className="text-right py-1 font-semibold text-muted-foreground">Net</th>
              </tr>
            </thead>
            <tbody>
              {fundRows.map((r) => (
                <tr key={r.fundId ?? "none"} className="border-b border-border">
                  <td className="py-1.5 pr-3 font-medium">
                    <Link href={`/accounting/transactions?fund=${r.fundId ?? "none"}`} className="hover:underline">
                      {r.name}
                    </Link>
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular">{fmt(r.incomeCents)}</td>
                  <td className="py-1.5 pr-3 text-right tabular">{fmt(r.expenseCents)}</td>
                  <td className={`py-1.5 text-right tabular ${r.netCents >= 0 ? "text-income" : "text-expense"}`}>
                    {fmt(r.netCents)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-foreground font-bold">
                <td className="pt-3 pr-3">Total</td>
                <td className="pt-3 pr-3 text-right tabular">{fmt(totalIncome)}</td>
                <td className="pt-3 pr-3 text-right tabular">{fmt(totalExpense)}</td>
                <td className={`pt-3 text-right tabular ${totalNet >= 0 ? "text-income" : "text-expense"}`}>
                  {fmt(totalNet)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
