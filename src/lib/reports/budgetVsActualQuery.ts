import { prisma } from "@/lib/prisma"
import { groupByAccountGroup, type AccountGroup } from "@/lib/reports/accountGrouping"
import { currentFYYear, fyDateRange } from "@/lib/fiscalYear"
import { toCents, centsToNumber, sumCents, type Money } from "@/lib/formatting"

/** One account line the Budget vs Actual report renders. */
export type BudgetActualRow = {
  id: number
  code: string
  name: string
  type: "INCOME" | "EXPENSE"
  actual: Money
  budget: Money | null
  note: string | null
  group: { id: number; name: string; sortOrder: number } | null
}

export type BudgetVsActualData = {
  incomeGroups: AccountGroup<BudgetActualRow>[]
  expenseGroups: AccountGroup<BudgetActualRow>[]
  // Section totals, in dollars (already cent-summed then converted).
  totalIncomeBudget: number
  totalIncomeActual: number
  totalExpenseBudget: number
  totalExpenseActual: number
  netBudget: number
  netActual: number
  incomeVariance: number
  expenseVariance: number
  netVariance: number
}

/**
 * Clamp a raw `?year=` param to a valid FY year, defaulting to the current FY.
 * Pure — no DB — so the boundary cases are unit-testable.
 */
export function resolveBudgetYear(rawYear: string | undefined): number {
  const fyNow = currentFYYear()
  const parsed = Number.parseInt(rawYear ?? String(fyNow), 10)
  return parsed >= 2000 && parsed <= 2100 ? parsed : fyNow
}

/**
 * Fetch accounts, their FY budgets and FY actuals, then roll them up into the
 * income/expense group structure the Budget vs Actual report renders, with
 * section budget/actual/variance totals. Actuals are summed in the DB via
 * `transaction.groupBy`; every figure is kept in integer cents until the final
 * dollar conversion, matching the P&L report's money handling.
 */
export async function getBudgetVsActualData(year: number): Promise<BudgetVsActualData> {
  const { start: fyStart, end: fyEnd } = fyDateRange(year)

  const [accounts, budgetRows, actualGroups] = await Promise.all([
    prisma.account.findMany({
      // Include inactive accounts that still have FY actuals — same
      // filter as the P&L report, else their totals vanish from this report.
      where: {
        // Exclude the internal-transfer clearing account: it has
        // no budget row, so showing its transfer-leg actuals is noise, and the
        // type-grouped `_sum.amount` here would otherwise inflate Total
        // Expenses actual the same way it inflated P&L. See xferAccount.ts.
        code: { not: "XFER" },
        OR: [
          { isActive: true },
          { transactions: { some: { date: { gte: fyStart, lt: fyEnd } } } },
          // (HIGH): an inactive account with a budget row for this FY
          // but no transaction that year fell through both prior clauses and
          // never became a row — silently dropping its budgeted amount from
          // the section totals. Widen the filter to match the budget query
          // below (same `year`).
          { budgets: { some: { year } } },
        ],
      },
      orderBy: [{ group: { sortOrder: "asc" } }, { code: "asc" }],
      include: {
        group: { select: { id: true, name: true, sortOrder: true } },
      },
    }),
    prisma.budget.findMany({
      where: { year },
      select: { accountId: true, amount: true, note: true },
    }),
    prisma.transaction.groupBy({
      by: ["accountId"],
      where: { date: { gte: fyStart, lt: fyEnd } },
      _sum: { amount: true },
    }),
  ])

  const budgetMap = Object.fromEntries(budgetRows.map((b) => [b.accountId, b.amount]))
  const noteMap: Record<number, string | null> = Object.fromEntries(
    budgetRows.map((b) => [b.accountId, b.note]),
  )
  const actualMap: Record<number, Money> = Object.fromEntries(
    actualGroups.map((g) => [g.accountId, g._sum.amount ?? 0]),
  )

  const rows: BudgetActualRow[] = accounts.map((a) => ({
    id: a.id,
    code: a.code,
    name: a.name,
    type: a.type as "INCOME" | "EXPENSE",
    actual: actualMap[a.id] ?? 0,
    budget: budgetMap[a.id] ?? null,
    note: noteMap[a.id] ?? null,
    group: a.group,
  }))

  const incomeRows = rows.filter((r) => r.type === "INCOME")
  const expenseRows = rows.filter((r) => r.type === "EXPENSE")

  const totalIncomeBudget = centsToNumber(sumCents(incomeRows.map((r) => r.budget ?? 0)))
  const totalIncomeActual = centsToNumber(sumCents(incomeRows.map((r) => r.actual)))
  const totalExpenseBudget = centsToNumber(sumCents(expenseRows.map((r) => r.budget ?? 0)))
  const totalExpenseActual = centsToNumber(sumCents(expenseRows.map((r) => r.actual)))
  const netBudget = centsToNumber(toCents(totalIncomeBudget) - toCents(totalExpenseBudget))
  const netActual = centsToNumber(toCents(totalIncomeActual) - toCents(totalExpenseActual))

  const incomeGroups = groupByAccountGroup(incomeRows)
  const expenseGroups = groupByAccountGroup(expenseRows)
  const incomeVariance = centsToNumber(toCents(totalIncomeActual) - toCents(totalIncomeBudget))
  const expenseVariance = centsToNumber(toCents(totalExpenseActual) - toCents(totalExpenseBudget))
  const netVariance = centsToNumber(toCents(netActual) - toCents(netBudget))

  return {
    incomeGroups,
    expenseGroups,
    totalIncomeBudget,
    totalIncomeActual,
    totalExpenseBudget,
    totalExpenseActual,
    netBudget,
    netActual,
    incomeVariance,
    expenseVariance,
    netVariance,
  }
}
