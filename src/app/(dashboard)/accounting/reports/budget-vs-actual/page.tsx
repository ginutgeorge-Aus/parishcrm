import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { canViewAccounting, canAccessAccounting } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { YearSelector } from "@/components/accounting/YearSelector"
import { PrintButton } from "@/components/ui/PrintButton"
import { Button } from "@/components/ui/button"
import { parseVarianceThreshold } from "@/lib/reports/budgetVarianceHelpers"
import { getBudgetVsActualData, resolveBudgetYear } from "@/lib/reports/budgetVsActualQuery"
import { BudgetVsActualTable } from "@/components/accounting/BudgetVsActualTable"
import { BudgetVsActualMobileCards } from "@/components/accounting/BudgetVsActualMobileCards"

type Props = {
  searchParams: Promise<{ year?: string; threshold?: string }>
}

export default async function BudgetVsActualPage(props: Props) {
  const searchParams = await props.searchParams
  const session = await auth()
  if (!canViewAccounting(session?.user?.role)) redirect("/")

  const userId = actorId(session)
  // Accounting staff (ADMIN | PASTOR) may add/edit variance notes;
  // other accounting roles (AUDITOR, OFFICE_ADMIN) view them read-only.
  const canEditNotes = canAccessAccounting(session?.user?.role)
  // Page view, not an export.
  void logAudit(userId, "VIEW_FINANCIAL_REPORT", "Transaction", undefined, { report: "budget-vs-actual" })

  const year = resolveBudgetYear(searchParams.year)
  const varianceThresholdPct = parseVarianceThreshold(searchParams.threshold)

  const data = await getBudgetVsActualData(year)

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-6 print:hidden">
        <h2 className="text-2xl font-semibold text-foreground">
          Budget vs Actual — FY {year}–{year + 1}
        </h2>
        <div className="flex items-center gap-3">
          <YearSelector currentYear={year} />
          <Button asChild variant="outline" size="sm">
            <Link href={`/api/accounting/reports/budget-vs-actual/export-csv?year=${year}`}>Export CSV</Link>
          </Button>
          <PrintButton />
        </div>
      </div>
      <h2 className="hidden print:block text-xl font-semibold mb-4">
        Budget vs Actual — FY {year}–{year + 1}
      </h2>

      <p className="mb-3 text-xs text-muted-foreground">
        <span aria-hidden="true" className="text-gold-foreground">⚠</span> flags lines varying more than {varianceThresholdPct}% from budget.
      </p>

      {/* Mobile: cards per account group (avoids sideways table scroll) */}
      <BudgetVsActualMobileCards
        {...data}
        year={year}
        varianceThresholdPct={varianceThresholdPct}
        canEditNotes={canEditNotes}
      />

      {/* Desktop: full table */}
      <BudgetVsActualTable
        {...data}
        year={year}
        varianceThresholdPct={varianceThresholdPct}
        canEditNotes={canEditNotes}
      />
    </div>
  )
}
