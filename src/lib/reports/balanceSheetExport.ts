import { escapeCsv } from "@/lib/csvUtils"
import { centsToNumber, formatDMY } from "@/lib/formatting"

/** One payment-account line as rendered on the Balance Sheet page (already-computed cents). Null = undefined position (no opening balance, or as-at date precedes the anchor). */
export type BalanceSheetRow = {
  label: string
  openingCents: number | null
  openingAsOf: Date | null
  incomeCents: number | null
  expenseCents: number | null
  balanceCents: number | null
}

const HEADERS = ["Account", "Opening Balance", "Opening As Of", "Income", "Expenses", "Balance"]

const money = (cents: number | null): string => (cents === null ? "" : centsToNumber(cents).toFixed(2))

/** CSV mirroring the Balance Sheet page table. */
export function generateBalanceSheetCsv(rows: BalanceSheetRow[], totalBalanceCents: number | null): string {
  const body = rows.map((r) =>
    [r.label, money(r.openingCents), r.openingAsOf ? formatDMY(r.openingAsOf) : "", money(r.incomeCents), money(r.expenseCents), money(r.balanceCents)]
      .map(escapeCsv)
      .join(","),
  )
  const totalRow = ["Total", "", "", "", "", money(totalBalanceCents)].map(escapeCsv).join(",")
  return [HEADERS.map(escapeCsv).join(","), ...body, totalRow].join("\n")
}
