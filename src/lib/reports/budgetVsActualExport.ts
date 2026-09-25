import { escapeCsv } from "@/lib/csvUtils"
import { centsToNumber } from "@/lib/formatting"

/** One account line as rendered on the Budget vs Actual page (already-computed cents). budgetCents null = no budget set for that account. */
export type BudgetVsActualRow = {
  code: string
  name: string
  groupName: string
  type: "INCOME" | "EXPENSE"
  budgetCents: number | null
  actualCents: number
}

export type BudgetVsActualTotals = {
  incomeBudgetCents: number
  incomeActualCents: number
  expenseBudgetCents: number
  expenseActualCents: number
  netBudgetCents: number
  netActualCents: number
}

const HEADERS = ["Section", "Group", "Code", "Account", "Budget", "Actual", "Variance", "Variance %"]

const money = (cents: number | null): string => (cents === null ? "" : centsToNumber(cents).toFixed(2))

function pct(varianceCents: number | null, budgetCents: number | null): string {
  if (varianceCents === null || budgetCents === null || budgetCents === 0) return ""
  return ((varianceCents / budgetCents) * 100).toFixed(1)
}

function totalsRow(label: string, budgetCents: number, actualCents: number): string {
  const varianceCents = actualCents - budgetCents
  return ["", "", "", label, money(budgetCents), money(actualCents), money(varianceCents), pct(varianceCents, budgetCents)]
    .map(escapeCsv)
    .join(",")
}

/** CSV mirroring the Budget vs Actual page table (account-level rows + section/net totals; group subtotals shown on-screen are omitted here). */
export function generateBudgetVsActualCsv(rows: BudgetVsActualRow[], totals: BudgetVsActualTotals): string {
  const body = rows.map((r) => {
    const varianceCents = r.budgetCents !== null ? r.actualCents - r.budgetCents : null
    return [
      r.type === "INCOME" ? "Income" : "Expenses",
      r.groupName,
      r.code,
      r.name,
      money(r.budgetCents),
      money(r.actualCents),
      varianceCents !== null ? money(varianceCents) : "",
      pct(varianceCents, r.budgetCents),
    ]
      .map(escapeCsv)
      .join(",")
  })

  const netVarianceCents = totals.netActualCents - totals.netBudgetCents
  const footer = [
    totalsRow("Total Income", totals.incomeBudgetCents, totals.incomeActualCents),
    totalsRow("Total Expenses", totals.expenseBudgetCents, totals.expenseActualCents),
    ["", "", "", "Net", money(totals.netBudgetCents), money(totals.netActualCents), money(netVarianceCents), pct(netVarianceCents, totals.netBudgetCents)]
      .map(escapeCsv)
      .join(","),
  ]

  return [HEADERS.map(escapeCsv).join(","), ...body, ...footer].join("\n")
}
