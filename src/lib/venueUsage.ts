// Pure helpers for the venue usage log + monthly invoice-request email.
// No DB / server-only imports: safe for client components and unit tests.
//
// Dates are UTC-midnight calendar dates (the app's storage convention) and are
// always formatted in UTC, never server-local. Times are "HH:mm" 24h strings.

import { isValidEmail } from "@/lib/validation"
import { applyVars, DEFAULT_EMAIL_TEMPLATES, type EmailTemplateFields } from "@/lib/emailTemplates"

/** Setting keys (AppSetting) owned by the venue usage feature. */
export const VENUE_USAGE_SETTING_KEYS = [
  "venueUsage.enabled",
  "venueUsage.venueName",
  "venueUsage.contactName",
  "venueUsage.contactEmail",
  "venueUsage.ccEmail",
  "venueUsage.replyToEmail",
  "venueUsage.bookingCcEmails",
] as const

/** Booking lifecycle; mirrors the Prisma `VenueBookingStatus` enum (kept local so this module stays client-safe). */
export const VENUE_BOOKING_STATUSES = ["REQUESTED", "CONFIRMED", "CANCELLED"] as const
export type VenueBookingStatusValue = (typeof VENUE_BOOKING_STATUSES)[number]

/** One usage line as the email/preview needs it. A missing `status` counts as CONFIRMED. */
export type VenueUsageLine = {
  date: Date
  startTime: string
  endTime: string
  status?: VenueBookingStatusValue
}

/**
 * Only CONFIRMED lines are billable: REQUESTED and CANCELLED never reach the
 * invoice-request email or the monthly totals. A line without a status counts as confirmed.
 * @param rows usage lines
 */
export function confirmedOnly<T extends { status?: VenueBookingStatusValue }>(rows: readonly T[]): T[] {
  return rows.filter((r) => (r.status ?? "CONFIRMED") === "CONFIRMED")
}

/**
 * Default status for a newly added booking: future dates start as REQUESTED,
 * today and past dates as CONFIRMED (already happened / in use).
 * @param ymd booking date "YYYY-MM-DD"
 * @param todayYMD today's Sydney calendar date "YYYY-MM-DD"
 */
export function defaultStatusForDate(ymd: string, todayYMD: string): VenueBookingStatusValue {
  return ymd > todayYMD ? "REQUESTED" : "CONFIRMED"
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/
const YMD_RE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

/**
 * Parse a strict 24h "HH:mm" string.
 * @param value candidate time
 * @returns total minutes since midnight, or null when malformed / out of range
 */
export function parseTimeToMinutes(value: string): number | null {
  const m = TIME_RE.exec(value)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/**
 * True when `value` is a valid 24h "HH:mm" time.
 * @param value candidate time
 */
export function isValidTime(value: string): boolean {
  return parseTimeToMinutes(value) !== null
}

/**
 * Validate a start/end pair: both valid "HH:mm" and end strictly after start (no overnight).
 * @param start start time "HH:mm"
 * @param end end time "HH:mm"
 * @returns an error message, or null when the range is valid
 */
export function validateTimeRange(start: string, end: string): string | null {
  const s = parseTimeToMinutes(start)
  const e = parseTimeToMinutes(end)
  if (s === null) return "Start time must be a valid time (HH:mm)"
  if (e === null) return "End time must be a valid time (HH:mm)"
  if (e <= s) return "End time must be after the start time"
  return null
}

/**
 * Duration between two times in decimal hours (e.g. 17:00-20:30 -> 3.5).
 * @param start start time "HH:mm"
 * @param end end time "HH:mm"
 * @throws RangeError when either time is invalid or end is not after start
 */
export function durationHours(start: string, end: string): number {
  const err = validateTimeRange(start, end)
  if (err) throw new RangeError(err)
  return ((parseTimeToMinutes(end) as number) - (parseTimeToMinutes(start) as number)) / 60
}

/**
 * Format decimal hours for display: "1 hour", "3.5 hours", "2.25 hours".
 * @param hours decimal hours
 */
export function formatHours(hours: number): string {
  const rounded = Math.round(hours * 100) / 100
  return `${rounded} ${rounded === 1 ? "hour" : "hours"}`
}

/**
 * Format a 24h "HH:mm" time as 12h, e.g. "17:00" -> "5:00 PM", "00:30" -> "12:30 AM".
 * @param value time "HH:mm"
 * @throws RangeError when the time is invalid
 */
export function formatTime12(value: string): string {
  const mins = parseTimeToMinutes(value)
  if (mins === null) throw new RangeError("Invalid time")
  const h = Math.floor(mins / 60)
  const m = mins % 60
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`
}

/**
 * Format a UTC-midnight calendar date as "Sunday, 6 September" (read in UTC, not server-local).
 * @param date UTC-midnight date
 */
export function formatUsageDate(date: Date): string {
  return `${WEEKDAYS[date.getUTCDay()]}, ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`
}

/**
 * True when `value` is a "YYYY-MM-DD" calendar date that exists.
 * @param value candidate date string
 */
export function isValidYMD(value: string): boolean {
  const m = YMD_RE.exec(value)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])
}

/**
 * Parse "YYYY-MM-DD" into a UTC-midnight Date.
 * @param ymd calendar date
 * @throws RangeError when not a valid calendar date
 */
export function ymdToUtcDate(ymd: string): Date {
  if (!isValidYMD(ymd)) throw new RangeError("Invalid date")
  const [y, m, d] = ymd.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

/**
 * Format a UTC-midnight Date as "YYYY-MM-DD".
 * @param date UTC-midnight date
 */
export function utcDateToYmd(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`
}

/**
 * True when `value` is a "YYYY-MM" month key (month 01-12).
 * @param value candidate month key
 */
export function isValidMonth(value: string): boolean {
  return MONTH_RE.test(value)
}

/**
 * Inclusive UTC date range of a month: first day and last day, both at UTC midnight
 * (matches `@db.Date` columns, so use `gte`/`lte`).
 * @param month "YYYY-MM"
 * @throws RangeError when malformed
 */
export function monthRange(month: string): { start: Date; end: Date } {
  const m = MONTH_RE.exec(month)
  if (!m) throw new RangeError("Invalid month")
  const y = Number(m[1])
  const mo = Number(m[2])
  return { start: new Date(Date.UTC(y, mo - 1, 1)), end: new Date(Date.UTC(y, mo, 0)) }
}

/**
 * Month key before the month containing `todayYMD` (Jan -> previous year's Dec).
 * @param todayYMD "YYYY-MM-DD" (pass the Sydney calendar date, e.g. `sydneyTodayYMD()`)
 * @throws RangeError when malformed
 */
export function previousMonth(todayYMD: string): string {
  if (!isValidYMD(todayYMD)) throw new RangeError("Invalid date")
  const y = Number(todayYMD.slice(0, 4))
  const mo = Number(todayYMD.slice(5, 7))
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`
}

/**
 * Human label of a month key, e.g. "2026-09" -> "September 2026".
 * @param month "YYYY-MM"
 * @throws RangeError when malformed
 */
export function formatMonthLabel(month: string): string {
  const m = MONTH_RE.exec(month)
  if (!m) throw new RangeError("Invalid month")
  return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`
}

/**
 * Next Sunday on or after `todayYMD` (today if it is a Sunday), as "YYYY-MM-DD".
 * @param todayYMD "YYYY-MM-DD" (Sydney calendar date)
 */
export function nextSundayYMD(todayYMD: string): string {
  const d = ymdToUtcDate(todayYMD)
  d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7))
  return utcDateToYmd(d)
}

/**
 * Escape text for safe interpolation into HTML.
 * @param value raw text
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/**
 * One usage line as text: "Sunday, 6 September: 5:00 PM – 8:30 PM (3.5 hours)".
 * @param row the usage line
 */
export function formatUsageLine(row: VenueUsageLine): string {
  return `${formatUsageDate(row.date)}: ${formatTime12(row.startTime)} – ${formatTime12(row.endTime)} (${formatHours(durationHours(row.startTime, row.endTime))})`
}

/**
 * Sum of decimal hours across CONFIRMED usage lines (requested/cancelled are ignored).
 * @param rows usage lines
 */
export function totalHours(rows: readonly VenueUsageLine[]): number {
  const total = confirmedOnly(rows).reduce((sum, r) => sum + durationHours(r.startTime, r.endTime), 0)
  return Math.round(total * 100) / 100
}

/**
 * Fill a template with variables and render plain text + HTML. Every value is substituted first and
 * HTML-escaped afterwards; the subject has its whitespace collapsed so a value cannot add a header line.
 * A paragraph made only of "- " lines becomes a list. The signoff drops blank lines.
 * @param template subject/intro/body/signoff with {vars}
 * @param vars values for the {vars}; unknown tokens stay visible
 */
export function renderVenueEmail(
  template: EmailTemplateFields,
  vars: Record<string, string>,
): { subject: string; text: string; html: string } {
  // Textareas submit CRLF; normalise so blank-line paragraph splits work.
  const fill = (s: string) => applyVars(s, vars).replace(/\r\n?/g, "\n")
  const signoff = fill(template.signoff).split("\n").map((l) => l.trim()).filter(Boolean).join("\n")
  const blocks = [fill(template.intro), fill(template.body), signoff].map((b) => b.trim()).filter(Boolean)
  const paragraphs = blocks.flatMap((b) => b.split(/\n{2,}/)).map((p) => p.trim()).filter(Boolean)
  const html = paragraphs
    .map((p) => {
      const lines = p.split("\n")
      if (lines.every((l) => l.startsWith("- "))) {
        return `<ul>${lines.map((l) => `<li>${escapeHtml(l.slice(2))}</li>`).join("")}</ul>`
      }
      return `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`
    })
    .join("\n")
  return { subject: fill(template.subject).replace(/\s+/g, " ").trim(), text: blocks.join("\n\n"), html }
}

/**
 * Lines sorted by date, then start time (does not mutate the input).
 * @param rows usage lines
 */
function sortLines<T extends VenueUsageLine>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.date.getTime() - b.date.getTime() || a.startTime.localeCompare(b.startTime))
}

/**
 * "- <line>" per row, or "None" for an empty list.
 * @param rows usage lines
 */
function bulletLines(rows: readonly VenueUsageLine[]): string {
  return rows.length ? sortLines(rows).map((r) => `- ${formatUsageLine(r)}`).join("\n") : "None"
}

/**
 * Decimal hours across lines regardless of status (callers pre-filter).
 * @param rows usage lines
 */
function sumHours(rows: readonly VenueUsageLine[]): number {
  return Math.round(rows.reduce((sum, r) => sum + durationHours(r.startTime, r.endTime), 0) * 100) / 100
}

/**
 * Distinct month labels of the lines in date order, joined with " and ".
 * @param rows usage lines
 */
function monthsLabel(rows: readonly VenueUsageLine[]): string {
  const keys = Array.from(new Set(sortLines(rows).map((r) => utcDateToYmd(r.date).slice(0, 7))))
  return keys.map(formatMonthLabel).join(" and ")
}

/**
 * Variables shared by every venue email. A blank contact name is handled by the callers.
 * @param i names and sender
 */
function commonVars(i: { churchName: string; venueName: string; contactName: string; senderName?: string | null }) {
  return {
    churchName: i.churchName.trim(),
    venueName: i.venueName.trim() || "your venue",
    contactName: i.contactName.trim(),
    senderName: i.senderName?.trim() ?? "",
  }
}

/**
 * Replace the template intro with a neutral greeting when there is no contact name.
 * @param template the template to use
 * @param contactName trimmed contact name
 */
function withGreeting(template: EmailTemplateFields, contactName: string): EmailTemplateFields {
  return contactName ? template : { ...template, intro: "Hello," }
}

/**
 * Build the monthly invoice-request email (subject + plain text + HTML) from the
 * `venueInvoiceRequest` template. Only CONFIRMED rows are listed and totalled, sorted by date then start time.
 * @param input church/venue/contact names, month key, usage rows, sender name and an optional template override
 */
export function buildRequestEmail(input: {
  churchName: string
  venueName: string
  contactName: string
  month: string
  rows: readonly VenueUsageLine[]
  senderName?: string | null
  template?: EmailTemplateFields
}): { subject: string; text: string; html: string } {
  const confirmed = confirmedOnly(input.rows)
  const common = commonVars(input)
  const vars = {
    ...common,
    month: formatMonthLabel(input.month),
    dates: bulletLines(confirmed),
    bookedDates: "",
    totalHours: formatHours(totalHours(confirmed)),
  }
  return renderVenueEmail(withGreeting(input.template ?? DEFAULT_EMAIL_TEMPLATES.venueInvoiceRequest, common.contactName), vars)
}

/**
 * Build the booking-request email for new (REQUESTED) dates, with already-booked dates for reference.
 * @param input names, the requested rows, the already-booked rows, sender and optional template override
 */
export function buildBookingRequestEmail(input: {
  churchName: string
  venueName: string
  contactName: string
  requested: readonly VenueUsageLine[]
  booked: readonly VenueUsageLine[]
  senderName?: string | null
  template?: EmailTemplateFields
}): { subject: string; text: string; html: string } {
  const common = commonVars(input)
  const vars = {
    ...common,
    month: monthsLabel(input.requested),
    dates: bulletLines(input.requested),
    bookedDates: bulletLines(input.booked),
    totalHours: formatHours(sumHours(input.requested)),
  }
  return renderVenueEmail(withGreeting(input.template ?? DEFAULT_EMAIL_TEMPLATES.venueBookingRequest, common.contactName), vars)
}

const CANCELLATION_TEMPLATE: EmailTemplateFields = {
  subject: "Booking cancellation ({churchName})",
  intro: "Dear {contactName},",
  body:
    "Unfortunately we need to cancel our booking of {venueName} on the following dates:\n\n{dates}\n\nWe are sorry for any inconvenience this causes. Please let us know if you have any questions.",
  signoff: "Kind regards,\n{senderName}\n{churchName}",
}

/**
 * Build the cancellation notice for cancelled booking dates (fixed wording, not an editable template).
 * @param input names, the cancelled rows and the sender name
 */
export function buildCancellationEmail(input: {
  churchName: string
  venueName: string
  contactName: string
  cancelled: readonly VenueUsageLine[]
  senderName?: string | null
}): { subject: string; text: string; html: string } {
  const common = commonVars(input)
  const vars = { ...common, dates: bulletLines(input.cancelled) }
  return renderVenueEmail(withGreeting(CANCELLATION_TEMPLATE, common.contactName), vars)
}

/** Most extra booking-request / cancellation CC addresses an admin may configure. */
export const MAX_BOOKING_CC = 10

/**
 * Parse and validate a comma/semicolon/newline separated CC list (blank entries ignored,
 * duplicates dropped case-insensitively, original casing of the first occurrence kept).
 * @param value raw text from the settings form
 * @returns the clean list, or the first validation error
 */
export function parseCcList(value: string): { ok: true; list: string[] } | { ok: false; error: string } {
  const seen = new Set<string>()
  const list: string[] = []
  for (const raw of value.split(/[,;\n]/)) {
    const address = raw.trim()
    if (!address) continue
    if (!isValidEmail(address)) return { ok: false, error: `"${address}" is not a valid email address` }
    const key = address.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    list.push(address)
  }
  if (list.length > MAX_BOOKING_CC) return { ok: false, error: `Add at most ${MAX_BOOKING_CC} booking CC addresses` }
  return { ok: true, list }
}

/**
 * Every Sunday in a month as "YYYY-MM-DD", ascending (UTC calendar arithmetic, server-timezone independent).
 * @param month "YYYY-MM"
 * @throws RangeError when malformed
 */
export function sundaysInMonth(month: string): string[] {
  const { start, end } = monthRange(month)
  const d = new Date(start)
  d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7))
  const out: string[] = []
  for (; d.getTime() <= end.getTime(); d.setUTCDate(d.getUTCDate() + 7)) out.push(utcDateToYmd(d))
  return out
}

/**
 * Shift a month key by whole months (negative goes back; crosses year boundaries).
 * @param month "YYYY-MM"
 * @param delta months to add
 * @throws RangeError when malformed
 */
export function addMonths(month: string, delta: number): string {
  const m = MONTH_RE.exec(month)
  if (!m) throw new RangeError("Invalid month")
  const index = Number(m[1]) * 12 + (Number(m[2]) - 1) + delta
  const year = Math.floor(index / 12)
  const mo = (((index % 12) + 12) % 12) + 1
  return `${year}-${String(mo).padStart(2, "0")}`
}

/** A usage row reduced to what the completeness check needs. */
export type CompletenessRow = { date: Date; status: VenueBookingStatusValue }

/** Result of {@link monthCompleteness}. */
export type MonthCompleteness = {
  complete: boolean
  /** Sundays ("YYYY-MM-DD") with no CONFIRMED or CANCELLED row. */
  missingSundays: string[]
  requestedCount: number
  confirmedCount: number
}

/**
 * Whether a month is ready for the automatic invoice request: every Sunday has at least one
 * CONFIRMED or CANCELLED row, no row in the month is REQUESTED, and at least one row is CONFIRMED.
 * Rows outside `month` are ignored.
 * @param month "YYYY-MM"
 * @param rows usage rows (any month)
 */
export function monthCompleteness(month: string, rows: readonly CompletenessRow[]): MonthCompleteness {
  const inMonth = rows.filter((r) => utcDateToYmd(r.date).startsWith(`${month}-`))
  const requestedCount = inMonth.filter((r) => r.status === "REQUESTED").length
  const confirmedCount = inMonth.filter((r) => r.status === "CONFIRMED").length
  const settled = new Set(inMonth.filter((r) => r.status !== "REQUESTED").map((r) => utcDateToYmd(r.date)))
  const missingSundays = sundaysInMonth(month).filter((s) => !settled.has(s))
  return {
    complete: requestedCount === 0 && confirmedCount > 0 && missingSundays.length === 0,
    missingSundays,
    requestedCount,
    confirmedCount,
  }
}

/**
 * Human reasons a month is not complete, in a stable order; `[]` when it is complete.
 * Shared by the admin warnings and the scheduler's reminder email.
 * @param c result of {@link monthCompleteness}
 */
export function describeIncomplete(c: MonthCompleteness): string[] {
  const reasons: string[] = []
  if (c.requestedCount > 0) {
    reasons.push(`${c.requestedCount} ${c.requestedCount === 1 ? "date is" : "dates are"} still marked Requested`)
  }
  if (c.missingSundays.length > 0) {
    reasons.push(
      `No confirmed or cancelled booking for: ${c.missingSundays.map((s) => formatUsageDate(ymdToUtcDate(s))).join("; ")}`,
    )
  }
  if (c.confirmedCount === 0) reasons.push("No confirmed bookings in this month")
  return reasons
}
