import { NextRequest, NextResponse } from "next/server"
import { fyYearParamOr400, guardAccountingExport } from "@/lib/reports/exportGuard"
import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { getClientIp } from "@/lib/clientIp"
import { generateCashFlowCsv, type CashFlowOperatingRow, type CashFlowPositionRow } from "@/lib/reports/cashFlowExport"
import { groupByAccountGroup, type AccountGroup } from "@/lib/reports/accountGrouping"
import { fyDateRange } from "@/lib/fiscalYear"
import { toCents } from "@/lib/formatting"
import { TransactionType } from "@/lib/generated/prisma/enums"
import { sydneyTodayYMD } from "@/lib/dates"
import { getPaymentAccounts } from "@/lib/paymentAccounts"

type Row = { id: number; type: string; group: { id: number; name: string; sortOrder: number } | null }

export async function GET(req: NextRequest) {
  const guard = await guardAccountingExport("cash-flow")
  if (guard instanceof NextResponse) return guard

  const year = fyYearParamOr400(req.nextUrl.searchParams)
  if (year instanceof NextResponse) return year
  const { start: fyStart, end: fyEnd } = fyDateRange(year)

  // Mirrors the Cash Flow page query exactly so the export never drifts from screen totals.
  const [accounts, totals] = await Promise.all([
    prisma.account.findMany({
      // Exclude XFER — see the on-screen Cash Flow query comment.
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

  const incomeGroups = groupByAccountGroup(accounts.filter((a) => a.type === "INCOME") as Row[])
  const expenseGroups = groupByAccountGroup(accounts.filter((a) => a.type === "EXPENSE") as Row[])
  const groupTotal = (g: AccountGroup<Row>) => g.accounts.reduce((s, a) => s + totalFor(a.id), 0)

  const cashIn = incomeGroups.reduce((s, g) => s + groupTotal(g), 0)
  const cashOut = expenseGroups.reduce((s, g) => s + groupTotal(g), 0)

  const operating: CashFlowOperatingRow[] = [
    ...incomeGroups.map((g) => ({ direction: "IN" as const, groupName: g.groupName, amountCents: groupTotal(g) })),
    ...expenseGroups.map((g) => ({ direction: "OUT" as const, groupName: g.groupName, amountCents: groupTotal(g) })),
  ]

  // Section 2 — cash position per payment account. Reports show all accounts
  // (incl. deactivated-with-history), not just active ones.
  const paymentAccounts = await getPaymentAccounts({ activeOnly: false })
  const obs = await Promise.all(
    paymentAccounts.map((acct) => prisma.accountOpeningBalance.findUnique({ where: { paymentAccountId: acct.id } })),
  )

  function movement(accountId: number, gte: Date, lt: Date) {
    return Promise.all([
      prisma.transaction.aggregate({ where: { paymentAccountId: accountId, type: TransactionType.INCOME, date: { gte, lt } }, _sum: { amount: true } }),
      prisma.transaction.aggregate({ where: { paymentAccountId: accountId, type: TransactionType.EXPENSE, date: { gte, lt } }, _sum: { amount: true } }),
    ])
  }

  const positions: CashFlowPositionRow[] = await Promise.all(
    paymentAccounts.map(async (account, i): Promise<CashFlowPositionRow> => {
      const ob = obs[i]
      const label = account.name
      if (!ob) return { label, openingCents: null, inCents: null, outCents: null, closingCents: null }
      if (ob.asOfDate >= fyEnd) return { label, openingCents: null, inCents: null, outCents: null, closingCents: null }

      const movementStart = ob.asOfDate > fyStart ? ob.asOfDate : fyStart
      const [fyIn, fyOut] = await movement(account.id, movementStart, fyEnd)
      const inCents = toCents(fyIn._sum.amount ?? 0)
      const outCents = toCents(fyOut._sum.amount ?? 0)
      let openingCents: number
      if (ob.asOfDate > fyStart) {
        openingCents = toCents(ob.amount)
      } else {
        const [preIn, preOut] = await movement(account.id, ob.asOfDate, fyStart)
        openingCents = toCents(ob.amount) + toCents(preIn._sum.amount ?? 0) - toCents(preOut._sum.amount ?? 0)
      }
      return { label, openingCents, inCents, outCents, closingCents: openingCents + inCents - outCents }
    }),
  )

  const hasClosing = positions.some((p) => p.closingCents !== null)
  // `closingCents` values are ALREADY integer cents (built via toCents above), so
  // add them with plain integer addition. Feeding them back through sumCents (which
  // re-applies toCents, treating its input as dollars) inflated the closing footer
  // total 100× and made the CSV inconsistent with its own position rows.
  const totalClosing = hasClosing ? positions.filter((p) => p.closingCents !== null).reduce((s, p) => s + p.closingCents!, 0) : null

  const csv = generateCashFlowCsv(
    operating,
    { cashInCents: cashIn, cashOutCents: cashOut, netMovementCents: cashIn - cashOut },
    positions,
    totalClosing,
  )

  const ip = getClientIp(req)
  await logAudit(guard.actor, "EXPORT_FINANCIAL_REPORT", "CashFlow", undefined, { report: "cash-flow", year }, ip)

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv",
      "content-disposition": `attachment; filename="cash-flow-fy${year}-${sydneyTodayYMD()}.csv"`,
      "cache-control": "no-store",
    },
  })
}
