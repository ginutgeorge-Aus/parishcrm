import { sumCents, centsToNumber, formatLongDate, fmtAUD } from "@/lib/formatting"
import { currentFYYear, fyDateRange } from "@/lib/fiscalYear"
import { FY_START_MONTH } from "@/lib/appConfig"
import { applyVars } from "@/lib/emailTemplates"
import type { ReceiptSettings } from "@/lib/receiptSettings"

export type DgrLine = { date: string; amount: number; method: string }

/**
 * DgrReceipt.status values (a String column, not a DB enum). UNKNOWN = the
 * mail provider may have accepted the email before the connection dropped
 * (isAmbiguousDeliveryError): treated like SENT for edit and delete, but a
 * resend of the same, unchanged receipt is allowed after staff check.
 */
export const DGR_STATUS = {
  DRAFT: "DRAFT",
  SENDING: "SENDING",
  SENT: "SENT",
  FAILED: "FAILED",
  UNKNOWN: "UNKNOWN",
} as const

/**
 * A SENDING claim older than this is treated as a crashed send and may be
 * recovered by editing the receipt. Same window as the giving-statement claim.
 * While SENDING, `sentAt` holds the claim time (overwritten on SENT, cleared on FAILED).
 */
export const DGR_SEND_STALE_MS = 15 * 60 * 1000

/**
 * Whether a receipt may be edited: DRAFT, FAILED (definite failure), or a
 * SENDING whose claim went stale. A SENDING row with no claim time predates
 * the claim timestamp and is treated as stale.
 * @param status receipt status
 * @param sentAt claim time while SENDING
 * @param now current time
 */
export function isDgrReceiptEditable(status: string, sentAt: Date | null | undefined, now: Date = new Date()): boolean {
  if (status === DGR_STATUS.DRAFT || status === DGR_STATUS.FAILED) return true
  if (status !== DGR_STATUS.SENDING) return false
  return !sentAt || now.getTime() - sentAt.getTime() > DGR_SEND_STALE_MS
}

/**
 * Badge variant for a receipt status on the list page: SENT solid, FAILED
 * destructive, UNKNOWN outline (needs a staff check), anything else secondary.
 * @param status receipt status
 */
export function dgrStatusBadgeVariant(status: string): "default" | "destructive" | "outline" | "secondary" {
  if (status === DGR_STATUS.SENT) return "default"
  if (status === DGR_STATUS.FAILED) return "destructive"
  if (status === DGR_STATUS.UNKNOWN) return "outline"
  return "secondary"
}

/**
 * Whether `sentAt` is a real delivery time to show in the list: only SENT.
 * While SENDING it is the claim time, and UNKNOWN may not have been delivered.
 * @param status receipt status
 */
export function dgrShowsSentAt(status: string): boolean {
  return status === DGR_STATUS.SENT
}

/**
 * Whether a receipt may be deleted: only DRAFT, or FAILED with a definite
 * failure. SENDING and UNKNOWN may have reached the donor; SENT has.
 * @param status receipt status
 */
export function isDgrReceiptDeletable(status: string): boolean {
  return status === DGR_STATUS.DRAFT || status === DGR_STATUS.FAILED
}

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

/**
 * Issuer details, legal text and issue date frozen on a DgrReceipt at send
 * (DgrReceipt.issuer). Holds no donor data, so it is stored as plain JSON.
 */
export type DgrIssuerSnapshot = Pick<
  DgrPdfModel,
  | "churchName"
  | "churchAbn"
  | "churchAddress"
  | "churchEmail"
  | "documentTitle"
  | "totalDonationsLabel"
  | "legalLines"
  | "coveredPeriod"
  | "issueDate"
>

/** Pick the frozen-at-send fields out of a built PDF model. */
export function toIssuerSnapshot(m: DgrPdfModel): DgrIssuerSnapshot {
  return {
    churchName: m.churchName,
    churchAbn: m.churchAbn,
    churchAddress: m.churchAddress,
    churchEmail: m.churchEmail,
    documentTitle: m.documentTitle,
    totalDonationsLabel: m.totalDonationsLabel,
    legalLines: m.legalLines,
    coveredPeriod: m.coveredPeriod,
    issueDate: m.issueDate,
  }
}

/** Narrow the Json column to a usable snapshot; null for legacy rows or malformed data. */
export function parseIssuerSnapshot(v: unknown): DgrIssuerSnapshot | null {
  if (!v || typeof v !== "object") return null
  const o = v as Record<string, unknown>
  const strs = ["churchName", "churchAbn", "churchAddress", "churchEmail", "documentTitle", "totalDonationsLabel", "coveredPeriod", "issueDate"] as const
  if (!strs.every((k) => typeof o[k] === "string")) return null
  if (!Array.isArray(o.legalLines) || !o.legalLines.every((l) => typeof l === "string")) return null
  return o as unknown as DgrIssuerSnapshot
}
