import { NextRequest, NextResponse } from "next/server"
import { fyYearParamOr400, guardAccountingExport } from "@/lib/reports/exportGuard"
import { logAudit } from "@/lib/audit"
import { getClientIp } from "@/lib/clientIp"
import { generateTrialBalanceCsv, type TrialBalanceRow } from "@/lib/reports/trialBalanceExport"
import { groupByAccountGroup } from "@/lib/reports/accountGrouping"
import { fyDateRange } from "@/lib/fiscalYear"
import { loadFyAccountTotals } from "@/lib/reports/fyAccountTotals"
import { sydneyTodayYMD } from "@/lib/dates"

export async function GET(req: NextRequest) {
  const guard = await guardAccountingExport("trial-balance")
  if (guard instanceof NextResponse) return guard

  const year = fyYearParamOr400(req.nextUrl.searchParams)
  if (year instanceof NextResponse) return year
  const { start: fyStart, end: fyEnd } = fyDateRange(year)

  const { accounts, totalFor } = await loadFyAccountTotals(fyStart, fyEnd)

  type Row = { id: number; code: string; name: string; type: string; group: { id: number; name: string; sortOrder: number } | null }
  const incomeGroups = groupByAccountGroup(accounts.filter((a) => a.type === "INCOME") as Row[])
  const expenseGroups = groupByAccountGroup(accounts.filter((a) => a.type === "EXPENSE") as Row[])

  const rows: TrialBalanceRow[] = [
    ...expenseGroups.flatMap((g) =>
      g.accounts.map((a) => ({ code: a.code, name: a.name, groupName: g.groupName, type: "EXPENSE" as const, amountCents: totalFor(a.id) })),
    ),
    ...incomeGroups.flatMap((g) =>
      g.accounts.map((a) => ({ code: a.code, name: a.name, groupName: g.groupName, type: "INCOME" as const, amountCents: totalFor(a.id) })),
    ),
  ]

  const totalCredit = accounts.filter((a) => a.type === "INCOME").reduce((s, a) => s + totalFor(a.id), 0)
  const totalDebit = accounts.filter((a) => a.type === "EXPENSE").reduce((s, a) => s + totalFor(a.id), 0)

  const csv = generateTrialBalanceCsv(rows, {
    totalDebitCents: totalDebit,
    totalCreditCents: totalCredit,
    netCents: totalCredit - totalDebit,
  })

  const ip = getClientIp(req)
  await logAudit(guard.actor, "EXPORT_FINANCIAL_REPORT", "TrialBalance", undefined, { report: "trial-balance", year, rowCount: rows.length }, ip)

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv",
      "content-disposition": `attachment; filename="trial-balance-fy${year}-${sydneyTodayYMD()}.csv"`,
      "cache-control": "no-store",
    },
  })
}
