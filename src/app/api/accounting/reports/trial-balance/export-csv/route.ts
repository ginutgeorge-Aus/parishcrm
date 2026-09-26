import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { prisma } from "@/lib/prisma"
import { canViewAccounting } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { getClientIp } from "@/lib/clientIp"
import { rateLimit } from "@/lib/rateLimit"
import { generateTrialBalanceCsv, type TrialBalanceRow } from "@/lib/reports/trialBalanceExport"
import { groupByAccountGroup } from "@/lib/reports/accountGrouping"
import { currentFYYear, fyDateRange, parseFyYearParam } from "@/lib/fiscalYear"
import { toCents } from "@/lib/formatting"
import { sydneyTodayYMD } from "@/lib/dates"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canViewAccounting(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (!rateLimit(`export:trial-balance:${actorId(session)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const sp = req.nextUrl.searchParams
  const fyNow = currentFYYear()
  // A malformed/out-of-range ?year= used to silently fall back to the current
  // FY — reject it explicitly, mirroring general-ledger's ?account=
  // 400. Absent param still defaults to the current FY.
  const year = parseFyYearParam(sp.get("year"), fyNow)
  if (year === null) {
    return NextResponse.json({ error: "Invalid year" }, { status: 400 })
  }
  const { start: fyStart, end: fyEnd } = fyDateRange(year)

  // Mirrors the Trial Balance page query exactly so the export never drifts from screen totals.
  const [accounts, totals] = await Promise.all([
    prisma.account.findMany({
      // Exclude XFER — see the on-screen Trial Balance query comment.
      where: { code: { not: "XFER" }, OR: [{ isActive: true }, { transactions: { some: { date: { gte: fyStart, lt: fyEnd } } } }] },
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
  await logAudit(actorId(session), "EXPORT_FINANCIAL_REPORT", "TrialBalance", undefined, { report: "trial-balance", year, rowCount: rows.length }, ip)

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv",
      "content-disposition": `attachment; filename="trial-balance-fy${year}-${sydneyTodayYMD()}.csv"`,
      "cache-control": "no-store",
    },
  })
}
