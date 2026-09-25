import { sumCents, centsToNumber, formatLongDate, fmtAUD } from "@/lib/formatting"
import { currentFYYear, fyDateRange } from "@/lib/fiscalYear"
import { FY_START_MONTH } from "@/lib/appConfig"
import { applyVars } from "@/lib/emailTemplates"
import type { ReceiptSettings } from "@/lib/receiptSettings"

export type DgrLine = { date: string; amount: number; method: string }

// DGR receipts key FYs by their END year. A January-start FY is the calendar
// year, so its start and end year coincide (label "2026", not "2025–26").
export function fyLabel(fyEndYear: number): string {
  if (FY_START_MONTH === 1) return String(fyEndYear)
  return `${fyEndYear - 1}–${String(fyEndYear).slice(-2)}`
}

// End year of the FY containing `date` — currentFYYear() returns the START year.
export function currentFyEndYear(date: Date = new Date()): number {
  return FY_START_MONTH === 1 ? currentFYYear(date) : currentFYYear(date) + 1
}

// Inclusive UTC date-only window for the FY ending in `fyEndYear`. Delegates to
// the central configurable FY helper (fyDateRange takes the FY *start* year
// and returns a half-open range); we subtract one day from the
// exclusive end to preserve the inclusive `to` (Jun-30 for the AU July FY) that
// dgrReceipt.ts's line-range check relies on. Generalises July→June to any
// configured FY start month ( bypass site).
export function fyRange(fyEndYear: number): { from: Date; to: Date } {
  const startYear = FY_START_MONTH === 1 ? fyEndYear : fyEndYear - 1
  const { start, end } = fyDateRange(startYear)
  return { from: start, to: new Date(end.getTime() - 86_400_000) }
}

export function formatReceiptNo(fyEndYear: number, seq: number, prefix = "DGR"): string {
  return `${prefix}-${fyEndYear}-${String(seq).padStart(3, "0")}`
}

export type DgrPdfModel = {
  churchName: string
  churchAbn: string
  churchAddress: string
  churchEmail: string
  receiptNo: string
  issueDate: string
  fyLabel: string
  donorName: string
  documentTitle: string
  totalDonationsLabel: string
  legalLines: string[]
  lines: { dateLabel: string; amountLabel: string; method: string }[]
  totalLabel: string
  coveredPeriod: string
}

export function buildDgrPdfModel(
  input: { receiptNo: string; fyEndYear: number; issueDate: Date; donorName: string; lines: DgrLine[] },
  church: { name: string; abn: string; address: string; email: string },
  receipt: ReceiptSettings
): DgrPdfModel {
  // Integer-cents sum (never float + on money) so the PDF total is
  // bit-identical to the persisted DgrReceipt.totalAmount.
  const total = centsToNumber(sumCents(input.lines.map((l) => l.amount)))
  const { from, to } = fyRange(input.fyEndYear)
  return {
    churchName: church.name,
    churchAbn: church.abn,
    churchAddress: church.address,
    churchEmail: church.email,
    receiptNo: input.receiptNo,
    // formatLongDate reads UTC parts so the date never shifts by the server offset.
    issueDate: formatLongDate(input.issueDate),
    fyLabel: fyLabel(input.fyEndYear),
    donorName: input.donorName,
    documentTitle: receipt.documentTitle,
    totalDonationsLabel: receipt.totalLabel,
    legalLines: applyVars(receipt.legalText, { churchName: church.name })
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean),
    lines: input.lines.map((l) => ({
      dateLabel: formatLongDate(new Date(l.date + "T00:00:00Z")),
      amountLabel: fmtAUD(l.amount),
      method: l.method,
    })),
    totalLabel: fmtAUD(total),
    coveredPeriod: applyVars(receipt.coveredPeriodTemplate, {
      from: formatLongDate(from),
      to: formatLongDate(to),
    }),
  }
}
