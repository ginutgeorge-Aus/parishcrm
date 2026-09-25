import { escapeCsv } from "@/lib/csvUtils"
import { centsToNumber } from "@/lib/formatting"

/** One account line as rendered on the Trial Balance page (already-computed cents). */
export type TrialBalanceRow = {
  code: string
  name: string
  groupName: string
  type: "INCOME" | "EXPENSE"
  amountCents: number
}

export type TrialBalanceTotals = {
  totalDebitCents: number
  totalCreditCents: number
  netCents: number
}

const HEADERS = ["Code", "Account", "Group", "Debit", "Credit"]

/** CSV mirroring the Trial Balance page table: expenses in Debit, income in Credit. */
export function generateTrialBalanceCsv(rows: TrialBalanceRow[], totals: TrialBalanceTotals): string {
  const body = rows.map((r) =>
    [
      r.code,
      r.name,
      r.groupName,
      r.type === "EXPENSE" ? centsToNumber(r.amountCents).toFixed(2) : "",
      r.type === "INCOME" ? centsToNumber(r.amountCents).toFixed(2) : "",
    ]
      .map(escapeCsv)
      .join(","),
  )
  const totalRow = ["", "Total", "", centsToNumber(totals.totalDebitCents).toFixed(2), centsToNumber(totals.totalCreditCents).toFixed(2)]
    .map(escapeCsv)
    .join(",")
  const netRow = ["", "Net surplus / (deficit)", "", "", centsToNumber(totals.netCents).toFixed(2)]
    .map(escapeCsv)
    .join(",")
  return [HEADERS.map(escapeCsv).join(","), ...body, totalRow, netRow].join("\n")
}
