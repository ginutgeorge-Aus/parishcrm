import { APP_LOCALE, APP_CURRENCY } from "@/lib/appConfig"

/**
 * Format a number as the configured currency via Intl, e.g. `$1,234.56` (AUD).
 * Currency + locale come from APP_CURRENCY / APP_LOCALE (src/lib/appConfig.ts)
 * (default AUD / en-AU). Name kept as `fmtAUD` to avoid churning ~133 call sites.
 */
export function fmtAUD(n: number): string {
  return n.toLocaleString(APP_LOCALE, { style: "currency", currency: APP_CURRENCY })
}

/**
 * Long-form date e.g. "1 July 2024". UTC parts so it never shifts by the
 * server's offset (same guard as formatDMY). Locale-aware via APP_LOCALE.
 */
export function formatLongDate(d: Date): string {
  return new Intl.DateTimeFormat(APP_LOCALE, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(d)
}

/**
 * Accounting-style currency with locale-aware negative formatting, e.g.
 * `$1,234.56` / `($1,234.56)`. The convention on the P&L and budget-vs-actual
 * reports. Currency and locale come from the runtime application config.
 */
export function fmtAUDAccounting(n: number): string {
  return new Intl.NumberFormat(APP_LOCALE, {
    style: "currency",
    currency: APP_CURRENCY,
    currencySign: "accounting",
  }).format(n === 0 ? 0 : n) // normalise -0, which accounting renders as ($0.00)
}

/** A Prisma Decimal, a plain number, or anything that stringifies to a decimal. */
export type Money = { toString(): string } | number | null | undefined

/**
 * Parse a money value to an exact integer number of cents. Summing in
 * integer cents — rather than accumulating `parseFloat`/`Number` dollars —
 * means a long run of Decimals never picks up IEEE-754 drift. Fractional
 * digits beyond two are truncated, which also discards float artefacts such as
 * the `0.30000000000000004` you get from `0.1 + 0.2`.
 */
export function toCents(m: Money): number {
  if (m == null) return 0
  const s = m.toString().trim()
  const neg = s.startsWith("-")
  const [whole, frac = ""] = s.replace(/^-/, "").split(".")
  const cents = Number.parseInt(whole || "0", 10) * 100 + Number.parseInt((frac + "00").slice(0, 2), 10)
  return neg ? -cents : cents
}

/** Sum a list of money values exactly, in integer cents. */
export function sumCents(values: Money[]): number {
  let total = 0
  for (const v of values) total += toCents(v)
  return total
}

/** Convert an integer-cents amount back to a dollar number for display. */
export function centsToNumber(cents: number): number {
  return cents / 100
}

/**
 * Uppercase month abbreviations — used where `toLocaleString` is unreliable
 * (e.g. petty-cash session titles on node:alpine).
 */
export const MONTH_ABBR = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
] as const

/**
 * Canonical petty-cash session title `DD-MMM-YYYY` from a `YYYY-MM-DD` string.
 * Parses the parts directly (no Date) so it is timezone-independent and produces
 * an identical title for the same calendar date whether the session is created
 * manually (createSession) or automatically (ensureWeeklySession) — the title
 * is the dedup key for the weekly auto-open. Lives here (not the "use server"
 * petty-cash actions file) because every export there must be an async action.
 */
export function pettyCashTitle(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number)
  return `${String(d).padStart(2, "0")}-${MONTH_ABBR[m - 1]}-${y}`
}

/**
 * Inverse of `pettyCashTitle`: parse a `DD-MMM-YYYY` session title back to a
 * UTC-midnight Date, or `null` if the title is not in that format. Used to sort
 * the petty cash session list by session (Sunday) date rather than creation
 * time, and to derive a session's date for ledger mirroring. UTC midnight
 * matches the transfer date convention so all rows in a session share an
 * instant regardless of server timezone.
 */
export function sessionDateFromTitle(title: string): Date | null {
  const m = title.match(/^(\d{2})-([A-Z]{3})-(\d{4})$/)
  const month = m ? (MONTH_ABBR as readonly string[]).indexOf(m[2]) : -1
  if (!m || month === -1) {
    console.error(`sessionDateFromTitle: unparseable session title "${title}"`)
    return null
  }
  return new Date(Date.UTC(Number(m[3]), month, Number(m[1])))
}

/**
 * Title-case month abbreviations — used for human-facing report date display
 * (e.g. the reconciliation report). Kept SEPARATE from `MONTH_ABBR` so neither
 * call site's displayed casing changes.
 */
export const MONTH_ABBR_TITLE = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const

/**
 * Format a Date as `DD<sep>MM<sep>YYYY` from its UTC parts (default separator
 * `/`). UTC so the displayed calendar date is server-timezone-independent.
 * Consolidates the per-file day-month-year formatters; pass `"-"` for
 * the dashed variant. Output is byte-identical to the helpers it replaces.
 */
export function formatDMY(d: Date, sep: string = "/"): string {
  const dd = String(d.getUTCDate()).padStart(2, "0")
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0")
  return `${dd}${sep}${mm}${sep}${d.getUTCFullYear()}`
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Parse a `YYYY-MM-DD` string to a Date, returning null for non-ISO or
 * invalid dates. Does NOT do a calendar reconstruct check — callers needing
 * to reject e.g. 31/02 must keep their own stricter parser.
 */
export function parseISODate(s: string | null | undefined): Date | null {
  if (!s || !ISO_DATE.test(s)) return null
  // Reconstruct via Date.UTC so a calendar date never shifts by the local
  // offset — matches the repo convention for date-only values. Guard
  // the month/day ranges to keep the legacy string-parse rejections (month
  // 0/13, day 0/32 → null); day-overflow within range still rolls over as
  // before.
  const [y, m, d] = s.split("-").map(Number)
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  return Number.isNaN(dt.getTime()) ? null : dt
}

// Parse a decrypted date-of-birth string into a Date, tolerating bad data.
// A malformed value (corrupt row, decryption-failure fallback text, empty
// string) yields an Invalid Date whose .toLocaleDateString()/.getFullYear()
// throws or renders "Invalid Date" downstream. Return null
// instead so callers uniformly treat an unparseable DOB as "no DOB".
export function safeDobDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

// Mask an email for display next to who-updated info: keep the first character
// of the local part and the full domain, redact the rest. A value without an
// "@" (or empty) is not a real address — render a fully-redacted placeholder.
export function maskEmail(email: string): string {
  const at = email.indexOf("@")
  if (at < 1) return "***"
  return `${email[0]}***${email.slice(at)}`
}
