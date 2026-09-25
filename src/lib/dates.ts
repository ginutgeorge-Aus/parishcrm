/**
 * Timezone-safe date helpers.
 *
 * The production server runs in UTC but the church operates in Sydney, so any
 * "today"/"now" derived from the server clock is a calendar day behind for the
 * first ~10 hours of each Sydney day. These helpers derive the wall-clock date
 * in the configured APP_TIMEZONE (default Australia/Sydney) and anchor stored
 * calendar dates at UTC midnight — the
 * convention `fyDateRange` and the report pages already use.
 */

import { APP_TIMEZONE, APP_LOCALE } from "@/lib/appConfig"

const TZ = APP_TIMEZONE

/** Year / month (1–12) / day of the wall clock in Sydney for an instant. */
export function sydneyParts(at: Date = new Date()): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at)
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value)
  return { year: get("year"), month: get("month"), day: get("day") }
}

/** The Sydney calendar date as `YYYY-MM-DD`. */
export function sydneyTodayYMD(at: Date = new Date()): string {
  const { year, month, day } = sydneyParts(at)
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

/**
 * The Sydney calendar date anchored at UTC midnight — the app's storage
 * convention for date-only values. Use as a default "today" on report pages.
 */
export function sydneyToday(at: Date = new Date()): Date {
  return new Date(sydneyTodayYMD(at) + "T00:00:00.000Z")
}

/**
 * The inclusive end-of-day UTC instant for a UTC-midnight calendar date. Use as
 * the `lte` upper bound of a date range so every transaction stamped anywhere
 * within that calendar day is included, regardless of its time component.
 */
export function endOfDayUTC(d: Date): Date {
  const ymd = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
  return new Date(ymd + "T23:59:59.999Z")
}

/**
 * The UTC offset of APP_TIMEZONE at a given instant, in milliseconds
 * (+10h in AEST, +11h in AEDT). Positive = ahead of UTC. DST-aware.
 */
function sydneyOffsetMs(at: Date): number {
  // Read the Sydney wall clock via Intl parts, treat those parts as if they were
  // UTC, and diff against the real instant → the zone offset (whole minutes).
  // Parsing `toLocaleString` output with `new Date()` was fragile: modern ICU
  // separates the time and AM/PM with U+202F (narrow no-break space), which some
  // V8 builds fail to parse → Invalid Date → NaN offset. This matches the
  // formatToParts convention used everywhere else in this file.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(at)
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value)
  // Some ICU builds render midnight as hour "24" paired with the PREVIOUS
  // calendar day (24:00 of day D == 00:00 of day D+1). Mapping 24→0 alone would
  // leave the date a day behind → a 24h-wrong offset. Roll the day forward too;
  // Date.UTC normalises day overflow across month/year boundaries.
  const rawHour = get("hour")
  const hour = rawHour % 24
  const dayShift = rawHour === 24 ? 1 : 0
  const asIfUTC = Date.UTC(get("year"), get("month") - 1, get("day") + dayShift, hour, get("minute"), get("second"))
  return Math.round((asIfUTC - at.getTime()) / 60_000) * 60_000
}

/**
 * Read a `datetime-local` input value (`YYYY-MM-DDTHH:mm`, no timezone) as a
 * Sydney wall-clock time and return the matching UTC instant. Without this the
 * server (UTC in prod) parses the naive string as UTC, shifting every event
 * time +10/+11h. DST-aware via `sydneyOffsetMs`.
 *
 * Two passes: the offset at the naive instant is only a first guess — the naive
 * reading sits a whole offset away from the real instant, so it can land across
 * a DST transition. Re-read the offset at the guessed instant.
 */
export function sydneyDatetimeLocalToUTC(local: string): Date {
  const naive = new Date(local + ":00.000Z").getTime()
  const guess = naive - sydneyOffsetMs(new Date(naive))
  return new Date(naive - sydneyOffsetMs(new Date(guess)))
}

/**
 * Format a stored UTC instant as a `datetime-local` value (`YYYY-MM-DDTHH:mm`)
 * showing the Sydney wall clock, for pre-filling the event edit form. Inverse of
 * `sydneyDatetimeLocalToUTC`.
 */
export function toSydneyDatetimeLocal(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d)
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value)
  // ICU may render Sydney midnight as hour "24" paired with the PREVIOUS calendar
  // day (24:00 of day D == 00:00 of day D+1). Mapping 24→00 alone leaves the date a
  // day behind, so roll the day forward too; Date.UTC normalises day overflow across
  // month/year boundaries. Mirrors the sydneyOffsetMs fix.
  const rawHour = get("hour")
  const norm = new Date(
    Date.UTC(get("year"), get("month") - 1, get("day") + (rawHour === 24 ? 1 : 0), rawHour % 24, get("minute")),
  )
  const p = (n: number) => String(n).padStart(2, "0")
  return `${norm.getUTCFullYear()}-${p(norm.getUTCMonth() + 1)}-${p(norm.getUTCDate())}T${p(norm.getUTCHours())}:${p(norm.getUTCMinutes())}`
}

/**
 * Render a stored UTC instant as the Sydney wall-clock date, e.g. `Thu 8 Oct
 * 2026`. For display on public/server-rendered pages: `date-fns` `format()`
 * uses the server's zone (UTC in prod), so an 8:30 AM Sydney event stored as
 * the prior day's UTC instant renders with the wrong day/time. FORCES
 * APP_TIMEZONE via Intl.
 */
export function formatSydneyDate(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).formatToParts(d)
  const get = (type: string) => parts.find((p) => p.type === type)!.value
  return `${get("weekday")} ${get("day")} ${get("month")} ${get("year")}`
}

/**
 * Render a stored UTC instant as the Sydney wall-clock time, e.g. `8:30 AM`.
 * Companion to `formatSydneyDate` — see it for why the server zone can't be
 * trusted. FORCES APP_TIMEZONE via Intl.
 */
export function formatSydneyTime(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(d)
  const get = (type: string) => parts.find((p) => p.type === type)!.value
  return `${get("hour")}:${get("minute")} ${get("dayPeriod").toUpperCase()}`
}

/**
 * Render a stored UTC instant as the Sydney wall-clock date + 24h time in the
 * compact numeric `dd/MM/yyyy HH:mm` style used by the accounting/audit tables
 * (e.g. `08/10/2026 08:30`). Like `formatSydneyDate`, date-fns `format()` can't
 * be trusted here — it uses the server zone (UTC in prod), shifting the day/time
 * of a real timestamp such as `ReceiptSend.sentAt`. FORCES APP_TIMEZONE via
 * Intl. The calendar date comes from `sydneyParts` (immune to the ICU hour-"24"
 * midnight quirk); the hour is mapped 24→00 to match.
 */
export function formatSydneyDateTime(d: Date): string {
  const { year, month, day } = sydneyParts(d)
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d)
  const get = (type: string) => parts.find((p) => p.type === type)!.value
  const p = (n: number | string) => String(n).padStart(2, "0")
  const hour = get("hour") === "24" ? "00" : get("hour")
  return `${p(day)}/${p(month)}/${year} ${hour}:${get("minute")}`
}

/**
 * The UTC instant of Sydney 00:00:00.000 on the given `YYYY-MM-DD` calendar
 * date. Use as the `gte` lower bound when filtering real (non-date-only)
 * timestamps (e.g. AuditLog.createdAt) by a Sydney calendar day.
 */
export function sydneyStartOfDayUTC(ymd: string): Date {
  const naive = new Date(ymd + "T00:00:00.000Z")
  return new Date(naive.getTime() - sydneyOffsetMs(naive))
}

/**
 * The UTC instant of Sydney 23:59:59.999 on the given `YYYY-MM-DD` calendar
 * date. Use as the `lte` upper bound when filtering real (non-date-only)
 * timestamps by a Sydney calendar day. The offset is whole hours, so the
 * .999 millisecond precision is preserved.
 */
export function sydneyEndOfDayUTC(ymd: string): Date {
  const naive = new Date(ymd + "T23:59:59.999Z")
  return new Date(naive.getTime() - sydneyOffsetMs(naive))
}

/**
 * The `YYYY-MM-DD` of the most recent Sunday on or before the Sydney calendar
 * day of `at`. On a Sunday it returns that day; otherwise it walks back to the
 * prior Sunday. Used to anchor the auto-opened weekly petty cash session to the
 * collection day. Computed from the Sydney wall clock (not the server clock) so
 * it is stable regardless of the server timezone.
 */
export function mostRecentSundayYMD(at: Date = new Date()): string {
  const { year, month, day } = sydneyParts(at)
  // Day-of-week from a UTC-midnight anchor of the Sydney calendar date — getUTCDay
  // avoids any server-local timezone shift. 0 = Sunday.
  const anchor = new Date(Date.UTC(year, month - 1, day))
  const sunday = new Date(anchor)
  sunday.setUTCDate(anchor.getUTCDate() - anchor.getUTCDay())
  return `${sunday.getUTCFullYear()}-${String(sunday.getUTCMonth() + 1).padStart(2, "0")}-${String(sunday.getUTCDate()).padStart(2, "0")}`
}

/**
 * Every Sunday (`YYYY-MM-DD`) from the Sunday of `fromYMD`'s week through the
 * Sunday of `toYMD`'s week, inclusive. Inputs are `YYYY-MM-DD` calendar dates.
 * UTC-anchored like `mostRecentSundayYMD` so it is stable regardless of server
 * timezone. Returns `[]` if `fromYMD`'s Sunday falls after `toYMD`'s Sunday.
 */
export function sundaysBetween(fromYMD: string, toYMD: string): string[] {
  const sundayOf = (ymd: string): Date => {
    const [y, m, d] = ymd.split("-").map(Number)
    const anchor = new Date(Date.UTC(y, m - 1, d))
    anchor.setUTCDate(anchor.getUTCDate() - anchor.getUTCDay())
    return anchor
  }
  const fmt = (dt: Date): string =>
    `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`
  const start = sundayOf(fromYMD)
  const end = sundayOf(toYMD)
  const out: string[] = []
  for (const cur = start; cur.getTime() <= end.getTime(); cur.setUTCDate(cur.getUTCDate() + 7)) {
    out.push(fmt(cur))
  }
  return out
}

/**
 * Short label for APP_TIMEZONE at an instant, e.g. "AEST"/"AEDT", "EST"/"EDT"
 * — for suffixing timestamps in alerts and issue bodies. Can't ride on
 * the timestamp formatter itself: Intl rejects timeZoneName with dateStyle.
 */
export function zoneLabel(at: Date = new Date()): string {
  return new Intl.DateTimeFormat(APP_LOCALE, { timeZone: TZ, timeZoneName: "short" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")!.value
}
