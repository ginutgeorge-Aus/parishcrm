import { prisma } from "@/lib/prisma"
import { accumulateMonthlyByAccount } from "@/lib/reports/plHelpers"
import { forEachTransactionBatch } from "@/lib/reports/txBatches"
import { groupByAccountGroup, type AccountGroup } from "@/lib/reports/accountGrouping"
import { currentFYYear, fyDateRange } from "@/lib/fiscalYear"
import { toCents } from "@/lib/formatting"

/** Row shape the P&L page renders — its own subset of the fetched account. */
export type PLAccountRow = {
  id: number
  code: string
  name: string
  isActive: boolean
  group: { id: number; name: string; sortOrder: number } | null
}

export type PLReportData = {
  incomeGroups: AccountGroup<PLAccountRow>[]
  expenseGroups: AccountGroup<PLAccountRow>[]
  /** Annual per-account totals in integer cents, keyed by accountId. */
  totalMap: Map<number, number>
  totalIncome: number
  totalExpenses: number
  net: number
  /** Per-account 12-month cent arrays — populated only in the monthly view. */
  acctMonthlyMap: Map<number, number[]>
  incomeMonthly: number[]
  expenseMonthly: number[]
  netMonthly: number[]
}

/**
 * Clamp a raw `?year=` param to a valid FY year, defaulting to the current FY.
 * Valid range: a sane floor plus a decade ahead of the current FY.
 * Pure — no DB — so the boundary cases are unit-testable.
 */
export function resolvePLYear(rawYear: string | undefined): number {
  const fyNow = currentFYYear()
  const MIN_FY_YEAR = 2000
  const MAX_FY_YEAR = fyNow + 10
  if (rawYear === undefined) return fyNow
  // `parseInt` stops at the first non-digit, so "2024junk" parsed as
  // the in-range year 2024 instead of being rejected. Require the whole
  // param to be digits before converting it.
  if (!/^\d+$/.test(rawYear)) return fyNow
  const parsed = Number(rawYear)
  return parsed >= MIN_FY_YEAR && parsed <= MAX_FY_YEAR ? parsed : fyNow
}

function accountTotal(a: PLAccountRow, totalMap: Map<number, number>): number {
  return totalMap.get(a.id) ?? 0
}

/**
 * Fetch and aggregate every figure the P&L page renders for one FY.
 *
 * Annual totals are summed in the DB via `transaction.groupBy`. Monthly
 * breakdowns are computed only when `isMonthly` — FY-scoped transactions are
 * streamed in keyset-paginated batches and folded by accountId into 12-month
 * arrays, bounding peak memory to one batch regardless of transaction count
 *; the accumulated totals are identical to loading every row at once.
 */
export async function getPLReportData(year: number, isMonthly: boolean): Promise<PLReportData> {
  const { start: fyStart, end: fyEnd } = fyDateRange(year)

  const [accounts, totalGroups] = await Promise.all([
    prisma.account.findMany({
      where: {
        // Exclude the internal-transfer clearing account: its EXPENSE
        // legs from petty-cash→bank transfers are not real income/expense, and
        // the `transactions: { some }` clause below would otherwise pull the
        // inactive XFER account back into Total Expenses. See xferAccount.ts.
        code: { not: "XFER" },
        OR: [
          { isActive: true },
          { transactions: { some: { date: { gte: fyStart, lt: fyEnd } } } },
        ],
      },
      orderBy: [{ group: { sortOrder: "asc" } }, { code: "asc" }],
      include: {
        group: { select: { id: true, name: true, sortOrder: true } },
      },
    }),
    prisma.transaction.groupBy({
      by: ["accountId"],
      where: { date: { gte: fyStart, lt: fyEnd } },
      _sum: { amount: true },
    }),
  ])

  const totalMap = new Map<number, number>(
    totalGroups.map((g) => [g.accountId, toCents(g._sum.amount)]),
  )

  const incomeAccounts = accounts.filter((a) => a.type === "INCOME")
  const expenseAccounts = accounts.filter((a) => a.type === "EXPENSE")

  const incomeGroups = groupByAccountGroup(incomeAccounts)
  const expenseGroups = groupByAccountGroup(expenseAccounts)

  const totalIncome = incomeAccounts.reduce((s, a) => s + accountTotal(a, totalMap), 0)
  const totalExpenses = expenseAccounts.reduce((s, a) => s + accountTotal(a, totalMap), 0)
  const net = totalIncome - totalExpenses

  const acctMonthlyMap = new Map<number, number[]>()
  if (isMonthly) {
    await forEachTransactionBatch(
      (page) =>
        prisma.transaction.findMany({
          where: { date: { gte: fyStart, lt: fyEnd } },
          select: { id: true, accountId: true, amount: true, date: true },
          orderBy: { id: "asc" },
          ...page,
        }),
      (batch) => accumulateMonthlyByAccount(acctMonthlyMap, batch),
    )
  }

  const sumAccounts = (accs: PLAccountRow[]): number[] =>
    accs.reduce(
      (acc, a) => acc.map((v, i) => v + (acctMonthlyMap.get(a.id)?.[i] ?? 0)),
      new Array<number>(12).fill(0),
    )

  const incomeMonthly = isMonthly ? sumAccounts(incomeAccounts) : []
  const expenseMonthly = isMonthly ? sumAccounts(expenseAccounts) : []
  const netMonthly = isMonthly ? incomeMonthly.map((v, i) => v - expenseMonthly[i]) : []

  return {
    incomeGroups,
    expenseGroups,
    totalMap,
    totalIncome,
    totalExpenses,
    net,
    acctMonthlyMap,
    incomeMonthly,
    expenseMonthly,
    netMonthly,
  }
}
