import { NextRequest, NextResponse } from "next/server"
import { guardAccountingExport } from "@/lib/reports/exportGuard"
import { logAudit } from "@/lib/audit"
import { auditIpFromRequest } from "@/lib/clientIp"
import { generateBudgetVsActualCsv, type BudgetVsActualRow } from "@/lib/reports/budgetVsActualExport"
import { currentFYYear } from "@/lib/fiscalYear"
import { getBudgetVsActualData } from "@/lib/reports/budgetVsActualQuery"
import { toCents } from "@/lib/formatting"
import { sydneyTodayYMD } from "@/lib/dates"
import { featureNotFound } from "@/lib/featureFlags"

/** GET /api/accounting/reports/budget-vs-actual/export-csv. Accounting viewers only. */
export async function GET(req: NextRequest) {
  const guard = await guardAccountingExport("budget-vs-actual")
  if (guard instanceof NextResponse) return guard
  const off = await featureNotFound("budget")
  if (off) return off

  const sp = req.nextUrl.searchParams
  const fyNow = currentFYYear()
  // A malformed/out-of-range ?year= used to silently fall back to the current
  // FY — reject it explicitly, mirroring general-ledger's ?account=
  // 400. Absent param still defaults to the current FY.
  const yearParam = sp.get("year")
  const parsedYear = yearParam === null ? fyNow : Number.parseInt(yearParam, 10)
  if (yearParam !== null && !/^\d+$/.test(yearParam) || Number.isNaN(parsedYear) || parsedYear < 2000 || parsedYear > 2100) {
    return NextResponse.json({ error: "Invalid year" }, { status: 400 })
  }
  const year = parsedYear
  // Same query as the on-screen report (incl. inactive accounts that only carry a budget), so the CSV cannot drift from it.
  const data = await getBudgetVsActualData(year)
  const toRows = (groups: typeof data.incomeGroups, type: "INCOME" | "EXPENSE"): BudgetVsActualRow[] =>
    groups.flatMap((g) =>
      g.accounts.map((a) => ({
        code: a.code,
        name: a.name,
        groupName: g.groupName,
        type,
        budgetCents: a.budget === null ? null : toCents(a.budget),
        actualCents: toCents(a.actual),
      })),
    )
  const rows: BudgetVsActualRow[] = [...toRows(data.incomeGroups, "INCOME"), ...toRows(data.expenseGroups, "EXPENSE")]
  const incomeBudgetCents = toCents(data.totalIncomeBudget)
  const incomeActualCents = toCents(data.totalIncomeActual)
  const expenseBudgetCents = toCents(data.totalExpenseBudget)
  const expenseActualCents = toCents(data.totalExpenseActual)

  const csv = generateBudgetVsActualCsv(rows, {
    incomeBudgetCents,
    incomeActualCents,
    expenseBudgetCents,
    expenseActualCents,
    netBudgetCents: incomeBudgetCents - expenseBudgetCents,
    netActualCents: incomeActualCents - expenseActualCents,
  })

  const ip = auditIpFromRequest(req)
  await logAudit(guard.actor, "EXPORT_FINANCIAL_REPORT", "Transaction", undefined, { report: "budget-vs-actual", year, rowCount: rows.length }, ip)

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv",
      "content-disposition": `attachment; filename="budget-vs-actual-fy${year}-${sydneyTodayYMD()}.csv"`,
      "cache-control": "no-store",
    },
  })
}
