import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { prisma } from "@/lib/prisma"
import { canViewAccounting } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { getClientIp } from "@/lib/clientIp"
import { rateLimit } from "@/lib/rateLimit"
import { generateBudgetVsActualCsv, type BudgetVsActualRow } from "@/lib/reports/budgetVsActualExport"
import { currentFYYear, fyDateRange } from "@/lib/fiscalYear"
import { toCents, type Money } from "@/lib/formatting"
import { sydneyTodayYMD } from "@/lib/dates"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canViewAccounting(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (!rateLimit(`export:budget-vs-actual:${actorId(session)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const sp = req.nextUrl.searchParams
  const fyNow = currentFYYear()
  // A malformed/out-of-range ?year= used to silently fall back to the current
  // FY — reject it explicitly, mirroring general-ledger's ?account=
  // 400. Absent param still defaults to the current FY.
  const yearParam = sp.get("year")
  const parsedYear = yearParam === null ? fyNow : parseInt(yearParam, 10)
  if (yearParam !== null && !/^\d+$/.test(yearParam) || isNaN(parsedYear) || parsedYear < 2000 || parsedYear > 2100) {
    return NextResponse.json({ error: "Invalid year" }, { status: 400 })
  }
  const year = parsedYear
  const { start: fyStart, end: fyEnd } = fyDateRange(year)

  // Mirrors the Budget vs Actual page query exactly so the export never drifts from screen totals.
  const [accounts, budgetRows, actualGroups] = await Promise.all([
    prisma.account.findMany({
      // Exclude XFER — see the on-screen Budget vs Actual query comment.
      where: { code: { not: "XFER" }, OR: [{ isActive: true }, { transactions: { some: { date: { gte: fyStart, lt: fyEnd } } } }] },
      orderBy: [{ group: { sortOrder: "asc" } }, { code: "asc" }],
      include: { group: { select: { id: true, name: true, sortOrder: true } } },
    }),
    prisma.budget.findMany({ where: { year }, select: { accountId: true, amount: true } }),
    prisma.transaction.groupBy({ by: ["accountId"], where: { date: { gte: fyStart, lt: fyEnd } }, _sum: { amount: true } }),
  ])

  const budgetMap = new Map<number, Money>(budgetRows.map((b) => [b.accountId, b.amount]))
  const actualMap = new Map<number, Money>(actualGroups.map((g) => [g.accountId, g._sum.amount ?? 0]))

  const rows: BudgetVsActualRow[] = accounts.map((a) => ({
    code: a.code,
    name: a.name,
    groupName: a.group?.name ?? "Other",
    type: a.type as "INCOME" | "EXPENSE",
    budgetCents: budgetMap.has(a.id) ? toCents(budgetMap.get(a.id)) : null,
    actualCents: toCents(actualMap.get(a.id) ?? 0),
  }))

  const incomeRows = rows.filter((r) => r.type === "INCOME")
  const expenseRows = rows.filter((r) => r.type === "EXPENSE")
  // `budgetCents`/`actualCents` are ALREADY integer cents (toCents above), so sum
  // them with plain integer addition. Feeding them back through sumCents (which
  // re-applies toCents, treating its input as dollars) inflated every footer
  // total 100× and made the CSV inconsistent with its own account rows.
  const sumCentsField = (rs: BudgetVsActualRow[], pick: (r: BudgetVsActualRow) => number | null) =>
    rs.reduce((s, r) => s + (pick(r) ?? 0), 0)
  const incomeBudgetCents = sumCentsField(incomeRows, (r) => r.budgetCents)
  const incomeActualCents = sumCentsField(incomeRows, (r) => r.actualCents)
  const expenseBudgetCents = sumCentsField(expenseRows, (r) => r.budgetCents)
  const expenseActualCents = sumCentsField(expenseRows, (r) => r.actualCents)

  const csv = generateBudgetVsActualCsv(rows, {
    incomeBudgetCents,
    incomeActualCents,
    expenseBudgetCents,
    expenseActualCents,
    netBudgetCents: incomeBudgetCents - expenseBudgetCents,
    netActualCents: incomeActualCents - expenseActualCents,
  })

  const ip = getClientIp(req)
  await logAudit(actorId(session), "EXPORT_FINANCIAL_REPORT", "Transaction", undefined, { report: "budget-vs-actual", year, rowCount: rows.length }, ip)

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv",
      "content-disposition": `attachment; filename="budget-vs-actual-fy${year}-${sydneyTodayYMD()}.csv"`,
      "cache-control": "no-store",
    },
  })
}
