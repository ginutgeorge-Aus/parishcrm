import type { ClearanceStatus } from "@/lib/clearanceStatus"
import { formatDMY } from "@/lib/formatting"

/**
 * Pure, client-safe helpers shared by the clearance compliance page, the CSV
 * export, the batch-verify client component and the digest. No Prisma, no
 * crypto: anything here may be bundled into the browser.
 */

/** Status badge labels: single source of truth lives in clearanceStatus. */
export { CLEARANCE_STATUS_LABELS } from "@/lib/clearanceStatus"

export type StatusBadgeVariant = "default" | "secondary" | "destructive" | "outline"

export const CLEARANCE_STATUS_VARIANT: Record<ClearanceStatus, StatusBadgeVariant> = {
  MISSING: "destructive",
  EXPIRED: "destructive",
  UNVERIFIED: "secondary",
  EXPIRING: "outline",
  VERIFIED: "default",
}

/** Filter chips, in display order (also the digest bucket order). */
/** Most clearances one Mark verified request may carry (the server action rejects more). */
export const BULK_VERIFY_MAX = 200

export const COMPLIANCE_FILTERS = ["expired", "expiring", "missing", "unverified"] as const
export type ComplianceFilter = (typeof COMPLIANCE_FILTERS)[number]

export const FILTER_STATUS: Record<ComplianceFilter, ClearanceStatus> = {
  expired: "EXPIRED",
  expiring: "EXPIRING",
  missing: "MISSING",
  unverified: "UNVERIFIED",
}

export const FILTER_LABELS: Record<ComplianceFilter, string> = {
  expired: "Expired",
  expiring: "Expiring (60 days)",
  missing: "Missing",
  unverified: "Unverified",
}

/**
 * Parses the `?status=` query value. Anything unknown (including wrong case)
 * is "no filter" so a bad link never throws.
 */
export function parseComplianceFilter(raw: string | undefined | null): ComplianceFilter | null {
  return (COMPLIANCE_FILTERS as readonly string[]).includes(raw ?? "") ? (raw as ComplianceFilter) : null
}

/** A UTC-midnight calendar date as dd/mm/yyyy, or null. */
export function dmy(d: Date | null): string | null {
  return d ? formatDMY(d) : null
}

/**
 * One WWCC awaiting (re)verification, shaped for the OCG employer portal form:
 * Family name, Date of birth, WWC number. Plain strings only (it crosses the
 * server/client boundary). `familyName` is the person's surname, not the
 * household name.
 */
export type WwccBatchRow = {
  clearanceId: string
  personId: number
  familyName: string
  givenName: string
  dobDmy: string | null
  number: string | null
  status: "UNVERIFIED" | "EXPIRING"
  expiresDmy: string | null
  /** ISO `updatedAt` as loaded; the bulk verify guard rejects the row if it changed since. */
  updatedAt: string
}

/** Reasons a row cannot be pasted into the portal or marked verified. */
export function batchRowIssues(row: Pick<WwccBatchRow, "dobDmy" | "number">): string[] {
  const issues: string[] = []
  if (!row.dobDmy) issues.push("Missing date of birth")
  if (!row.number) issues.push("Missing WWC number")
  return issues
}

/** True when a row has everything the portal asks for. */
export function isBatchRowReady(row: Pick<WwccBatchRow, "dobDmy" | "number">): boolean {
  return batchRowIssues(row).length === 0
}

/** Collapses tabs/newlines to spaces so a cell can never shift TSV columns. */
function cleanCell(s: string | null): string {
  return (s ?? "").replace(/[\t\r\n]+/g, " ").trim()
}

/** `Family name<TAB>DOB<TAB>WWC number` — the portal's field order, for pasting. */
export function batchRowTsv(row: Pick<WwccBatchRow, "familyName" | "dobDmy" | "number">): string {
  return [cleanCell(row.familyName), cleanCell(row.dobDmy), cleanCell(row.number)].join("\t")
}

/** All ready rows, one per line. Rows with missing data are left out. */
export function batchTsv(rows: WwccBatchRow[]): string {
  return rows.filter(isBatchRowReady).map(batchRowTsv).join("\n")
}
