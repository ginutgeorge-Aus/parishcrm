/**
 * Pure aggregation helpers for service headcounts (OSS-308). No DB, no
 * local-time Date parsing: all calendar math is done on `YYYY-MM-DD` strings
 * via UTC-midnight dates. A period with no recorded rows is a gap (`null`),
 * never `0`; a recorded `0` stays `0`.
 */

/** One recorded headcount; `date` is a church calendar date (`YYYY-MM-DD`). */
export type HeadcountRow = {
  date: string
  serviceTypeId: number
  adults: number
  children: number
}

/** One chart point. `null` counts mean no headcount was recorded (a gap). */
export type Point = {
  key: string
  label: string
  adults: number | null
  children: number | null
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/**
 * Parse a `YYYY-MM-DD` string to a UTC-midnight Date.
 * @param ymd calendar date string
 */
function parseYMD(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`)
}

/**
 * Format a UTC-midnight Date as `YYYY-MM-DD`.
 * @param d the date
 */
function fmtYMD(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Add whole days to a calendar date.
 * @param ymd calendar date string
 * @param days days to add (may be negative)
 */
function addDays(ymd: string, days: number): string {
  const d = parseYMD(ymd)
  d.setUTCDate(d.getUTCDate() + days)
  return fmtYMD(d)
}

/**
 * The Monday (`YYYY-MM-DD`) of the ISO week containing a calendar date.
 * @param ymd calendar date string
 */
export function weekStartYMD(ymd: string): string {
  const dow = parseYMD(ymd).getUTCDay() // 0 = Sunday
  return addDays(ymd, -((dow + 6) % 7))
}

/**
 * ISO year and week number (1-53) of a calendar date.
 * @param ymd calendar date string
 */
function isoYearWeek(ymd: string): { year: number; week: number } {
  const d = parseYMD(ymd)
  const dow = (d.getUTCDay() + 6) % 7 // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow + 3) // Thursday of this ISO week
  const year = d.getUTCFullYear()
  const jan1 = Date.UTC(year, 0, 1)
  const week = Math.floor((d.getTime() - jan1) / (7 * 86_400_000)) + 1
  return { year, week }
}

/**
 * Add whole months to a `YYYY-MM` key.
 * @param month month key
 * @param n months to add
 */
function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number)
  const idx = y * 12 + (m - 1) + n
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`
}

/**
 * Sum adults and children per bucket key, optionally for one service type.
 * Only buckets that have at least one row appear in the map.
 * @param rows headcount rows
 * @param keyOf maps a row date to its bucket key
 * @param serviceTypeId optional service type filter
 */
function bucket(
  rows: HeadcountRow[],
  keyOf: (ymd: string) => string,
  serviceTypeId?: number,
): Map<string, { adults: number; children: number }> {
  const out = new Map<string, { adults: number; children: number }>()
  for (const r of rows) {
    if (serviceTypeId !== undefined && r.serviceTypeId !== serviceTypeId) continue
    const k = keyOf(r.date)
    const cur = out.get(k) ?? { adults: 0, children: 0 }
    cur.adults += r.adults
    cur.children += r.children
    out.set(k, cur)
  }
  return out
}

/**
 * One point per ISO week from the week of `fromYMD` to the week of `toYMD`
 * inclusive; weeks with no rows are gaps (`null`).
 * @param rows headcount rows
 * @param fromYMD first date of the range
 * @param toYMD last date of the range
 * @param serviceTypeId optional service type filter (default: all combined)
 */
export function buildWeekly(
  rows: HeadcountRow[],
  fromYMD: string,
  toYMD: string,
  serviceTypeId?: number,
): Point[] {
  const sums = bucket(rows, weekStartYMD, serviceTypeId)
  const last = weekStartYMD(toYMD)
  const points: Point[] = []
  for (let k = weekStartYMD(fromYMD); k <= last; k = addDays(k, 7)) {
    const s = sums.get(k)
    const d = parseYMD(k)
    points.push({
      key: k,
      label: `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`,
      adults: s ? s.adults : null,
      children: s ? s.children : null,
    })
  }
  return points
}

/**
 * One point per calendar month from `fromMonth` to `toMonth` inclusive
 * (`YYYY-MM`); months with no rows are gaps (`null`).
 * @param rows headcount rows
 * @param fromMonth first month key
 * @param toMonth last month key
 * @param serviceTypeId optional service type filter (default: all combined)
 */
export function buildMonthly(
  rows: HeadcountRow[],
  fromMonth: string,
  toMonth: string,
  serviceTypeId?: number,
): Point[] {
  const sums = bucket(rows, (ymd) => ymd.slice(0, 7), serviceTypeId)
  const points: Point[] = []
  for (let k = fromMonth; k <= toMonth; k = addMonths(k, 1)) {
    const s = sums.get(k)
    const m = Number(k.slice(5, 7)) - 1
    points.push({
      key: k,
      label: `${MONTHS[m]} ${k.slice(0, 4)}`,
      adults: s ? s.adults : null,
      children: s ? s.children : null,
    })
  }
  return points
}

/**
 * Total (adults + children) per ISO week number (1-53) or calendar month
 * (1-12) for `year` versus `year - 1`. A period with no rows, including week 53
 * in a 52-week year, is `null`.
 * @param rows headcount rows
 * @param year the year to show
 * @param granularity "week" (ISO week number) or "month"
 * @param serviceTypeId optional service type filter (default: all combined)
 */
export function buildYearOverYear(
  rows: HeadcountRow[],
  year: number,
  granularity: "week" | "month",
  serviceTypeId?: number,
): { period: number; thisYear: number | null; lastYear: number | null }[] {
  const keyOf = (ymd: string): string => {
    if (granularity === "month") return `${ymd.slice(0, 4)}-${Number(ymd.slice(5, 7))}`
    const { year: y, week } = isoYearWeek(ymd)
    return `${y}-${week}`
  }
  const sums = bucket(rows, keyOf, serviceTypeId)
  const total = (y: number, p: number): number | null => {
    const s = sums.get(`${y}-${p}`)
    return s ? s.adults + s.children : null
  }
  const periods = granularity === "week" ? 53 : 12
  return Array.from({ length: periods }, (_, i) => ({
    period: i + 1,
    thisYear: total(year, i + 1),
    lastYear: total(year - 1, i + 1),
  }))
}

/**
 * The latest headcount by service date (ties: lowest serviceTypeId) with the
 * total of the same service type exactly 7 days earlier, if recorded.
 * @param rows headcount rows
 */
export function latestWithDelta(rows: HeadcountRow[]): {
  date: string
  serviceTypeId: number
  adults: number
  children: number
  previousTotal: number | null
} | null {
  if (rows.length === 0) return null
  const latest = rows.reduce((best, r) =>
    r.date > best.date || (r.date === best.date && r.serviceTypeId < best.serviceTypeId) ? r : best,
  )
  const prevDate = addDays(latest.date, -7)
  const prev = rows.find((r) => r.date === prevDate && r.serviceTypeId === latest.serviceTypeId)
  return {
    date: latest.date,
    serviceTypeId: latest.serviceTypeId,
    adults: latest.adults,
    children: latest.children,
    previousTotal: prev ? prev.adults + prev.children : null,
  }
}
