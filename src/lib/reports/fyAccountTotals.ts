import { prisma } from "@/lib/prisma"
import { toCents } from "@/lib/formatting"

/**
 * Accounts + per-account FY totals (cents) shared by the Trial Balance and
 * Cash Flow pages and their CSV exports, so an export can never drift from
 * the on-screen totals.
 *
 * Excludes the internal-transfer clearing account (XFER): its two legs
 * (INCOME + EXPENSE, both positive `amount`) sum to a positive total under
 * the type-grouped `_sum.amount`, inflating Total Debit / Total Cash Out the
 * same way it inflated P&L Total Expenses. See xferAccount.ts.
 */
export async function loadFyAccountTotals(fyStart: Date, fyEnd: Date) {
  const [accounts, totals] = await Promise.all([
    prisma.account.findMany({
      where: {
        code: { not: "XFER" },
        OR: [{ isActive: true }, { transactions: { some: { date: { gte: fyStart, lt: fyEnd } } } }],
      },
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
  return { accounts, totalFor }
}
