import { centsToNumber, fmtAUDAccounting } from "@/lib/formatting"
import type { PLAccountRow } from "@/lib/reports/plQuery"

// Takes integer cents — every figure on the P&L is accumulated in cents
// and converted to dollars only here, at the moment of display.
export function fmt(cents: number): string {
  return fmtAUDAccounting(centsToNumber(cents))
}

export function accountTotal(a: PLAccountRow, totalMap: Map<number, number>): number {
  return totalMap.get(a.id) ?? 0
}
