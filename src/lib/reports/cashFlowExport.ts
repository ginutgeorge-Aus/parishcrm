import { escapeCsv } from "@/lib/csvUtils"
import { centsToNumber } from "@/lib/formatting"

/** One account-group line in the Operating Activities section (already-computed cents). */
export type CashFlowOperatingRow = {
  direction: "IN" | "OUT"
  groupName: string
  amountCents: number
}

export type CashFlowOperatingTotals = {
  cashInCents: number
  cashOutCents: number
  netMovementCents: number
}

/** One payment-account line in the Cash Position section. Null = no opening balance set. */
export type CashFlowPositionRow = {
  label: string
  openingCents: number | null
  inCents: number | null
  outCents: number | null
  closingCents: number | null
}

const OPERATING_HEADERS = ["Category", "Group", "Amount"]
const POSITION_HEADERS = ["Account", "Opening", "In", "Out", "Closing"]

const money = (cents: number | null): string => (cents === null ? "" : centsToNumber(cents).toFixed(2))

/** CSV mirroring the Cash Flow page's two tables: Operating Activities, then Cash Position by account. */
export function generateCashFlowCsv(
  operating: CashFlowOperatingRow[],
  totals: CashFlowOperatingTotals,
  positions: CashFlowPositionRow[],
  totalClosingCents: number | null,
): string {
  const operatingBody = operating.map((r) =>
    [r.direction === "IN" ? "Cash In" : "Cash Out", r.groupName, centsToNumber(r.amountCents).toFixed(2)]
      .map(escapeCsv)
      .join(","),
  )
  const operatingSection = [
    "Operating Activities",
    OPERATING_HEADERS.map(escapeCsv).join(","),
    ...operatingBody,
    ["Cash In", "Total", centsToNumber(totals.cashInCents).toFixed(2)].map(escapeCsv).join(","),
    ["Cash Out", "Total", centsToNumber(totals.cashOutCents).toFixed(2)].map(escapeCsv).join(","),
    ["Net Cash Movement", "", centsToNumber(totals.netMovementCents).toFixed(2)].map(escapeCsv).join(","),
  ]

  const positionBody = positions.map((p) =>
    [p.label, money(p.openingCents), money(p.inCents), money(p.outCents), money(p.closingCents)].map(escapeCsv).join(","),
  )
  const positionSection = [
    "Cash Position by Account",
    POSITION_HEADERS.map(escapeCsv).join(","),
    ...positionBody,
    ["Total", "", "", "", money(totalClosingCents)].map(escapeCsv).join(","),
  ]

  return [...operatingSection, "", ...positionSection].join("\n")
}
