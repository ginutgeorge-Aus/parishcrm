import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { canViewAccounting } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import Link from "next/link"
import { YearSelector } from "@/components/accounting/YearSelector"
import { ViewToggle } from "@/components/accounting/ViewToggle"
import { PrintButton } from "@/components/ui/PrintButton"
import { Button } from "@/components/ui/button"
import { PLMonthlyTable } from "@/components/accounting/PLMonthlyTable"
import { PLAnnualTable } from "@/components/accounting/PLAnnualTable"
import { PLMobileCards } from "@/components/accounting/PLMobileCards"
import { getPLReportData, resolvePLYear } from "@/lib/reports/plQuery"

type Props = {
  searchParams: Promise<{ year?: string; view?: string }>
}

export default async function PLReportPage(props: Props) {
  const searchParams = await props.searchParams
  const session = await auth()
  if (!canViewAccounting(session?.user?.role)) redirect("/")

  const userId = actorId(session)
  // Page view, not an export — the actual P&L export is the print route, which
  // logs EXPORT_FINANCIAL_REPORT. Mirrors VIEW_TRANSACTION vs EXPORT_TRANSACTION_CSV.
  void logAudit(userId, "VIEW_FINANCIAL_REPORT", "Transaction", undefined, { report: "pl" })

  // Production CSP nonces style-src; the print <style> needs the nonce.
  const nonce = (await headers()).get("x-nonce") ?? undefined

  const year = resolvePLYear(searchParams.year)
  const isMonthly = searchParams.view === "monthly"

  const data = await getPLReportData(year, isMonthly)

  return (
    <div className={isMonthly ? "w-full" : "max-w-3xl"}>
      {isMonthly && (
        <style nonce={nonce}>{`@media print { @page { size: landscape; } }`}</style>
      )}

      <div className="flex items-center justify-between mb-6 print:hidden">
        <h2 className="text-2xl font-semibold text-foreground">
          P&amp;L Report — FY {year}–{year + 1}
        </h2>
        <div className="flex items-center gap-3">
          <ViewToggle currentView={isMonthly ? "monthly" : "annual"} year={year} />
          <YearSelector currentYear={year} />
          <Button asChild variant="outline" size="sm">
            <Link href={`/accounting/pl/print?year=${year}${isMonthly ? "&view=monthly" : ""}`} target="_blank" rel="noopener noreferrer">
              Print PDF
            </Link>
          </Button>
          <PrintButton />
        </div>
      </div>
      <h2 className="hidden print:block text-xl font-semibold mb-4">
        P&amp;L Report — FY {year}–{year + 1}{isMonthly ? " (Monthly)" : ""}
      </h2>

      {isMonthly ? (
        <PLMonthlyTable
          incomeGroups={data.incomeGroups}
          expenseGroups={data.expenseGroups}
          totalMap={data.totalMap}
          totalIncome={data.totalIncome}
          totalExpenses={data.totalExpenses}
          net={data.net}
          acctMonthlyMap={data.acctMonthlyMap}
          incomeMonthly={data.incomeMonthly}
          expenseMonthly={data.expenseMonthly}
          netMonthly={data.netMonthly}
        />
      ) : (
        <>
          <PLMobileCards
            incomeGroups={data.incomeGroups}
            expenseGroups={data.expenseGroups}
            totalMap={data.totalMap}
            totalIncome={data.totalIncome}
            totalExpenses={data.totalExpenses}
            net={data.net}
          />
          <PLAnnualTable
            incomeGroups={data.incomeGroups}
            expenseGroups={data.expenseGroups}
            totalMap={data.totalMap}
            totalIncome={data.totalIncome}
            totalExpenses={data.totalExpenses}
            net={data.net}
          />
        </>
      )}
    </div>
  )
}
