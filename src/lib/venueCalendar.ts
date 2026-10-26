import { addMonths, isValidMonth, monthRange, utcDateToYmd } from "@/lib/venueUsage"

/** AppSetting key holding the public calendar token. Not in the settings allowlist: only the reset action writes it. */
export const VENUE_CALENDAR_TOKEN_KEY = "venueUsage.calendarToken"
/** How many months back the public calendar can navigate. */
export const CALENDAR_PAST_MONTHS = 12
/** How many months forward the public calendar can navigate. */
export const CALENDAR_FUTURE_MONTHS = 6

/** One booking as shown on the public calendar (no notes or PII). */
export type CalendarEntry = {
  id: number
  date: string
  startTime: string
  endTime: string
  purpose: string | null
  status: "REQUESTED" | "CONFIRMED"
}
/** One day cell of the month grid. */
export type CalendarCell = { ymd: string; day: number; inMonth: boolean; entries: CalendarEntry[] }

/**
 * Month to show: the requested one clamped to 12 months back and 6 forward of today, or the current month
 * when the request is missing or malformed.
 * @param requested the `?month=` value
 * @param todayYMD Sydney "today" as "YYYY-MM-DD"
 */
export function clampCalendarMonth(requested: string | undefined, todayYMD: string): string {
  const current = todayYMD.slice(0, 7)
  if (!requested || !isValidMonth(requested)) return current
  const min = addMonths(current, -CALENDAR_PAST_MONTHS)
  const max = addMonths(current, CALENDAR_FUTURE_MONTHS)
  if (requested < min) return min
  if (requested > max) return max
  return requested
}

/**
 * Sunday-first weeks covering the month; days outside it are padding with no entries. A cell's
 * entries are sorted by start time.
 * @param month "YYYY-MM"
 * @param entries the month's CONFIRMED/REQUESTED rows
 */
export function buildMonthGrid(month: string, entries: readonly CalendarEntry[]): CalendarCell[][] {
  const { start, end } = monthRange(month)
  const cursor = new Date(start)
  cursor.setUTCDate(cursor.getUTCDate() - cursor.getUTCDay())
  const byDate = new Map<string, CalendarEntry[]>()
  for (const e of entries) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e])
  const weeks: CalendarCell[][] = []
  while (cursor.getTime() <= end.getTime() || cursor.getUTCDay() !== 0) {
    const week: CalendarCell[] = []
    for (let i = 0; i < 7; i++) {
      const ymd = utcDateToYmd(cursor)
      const inMonth = ymd.startsWith(`${month}-`)
      week.push({
        ymd, day: cursor.getUTCDate(), inMonth,
        entries: inMonth ? (byDate.get(ymd) ?? []).slice().sort((a, b) => a.startTime.localeCompare(b.startTime)) : [],
      })
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
    weeks.push(week)
  }
  return weeks
}

/**
 * Public wording for a status ("Pending" for REQUESTED).
 * @param status calendar entry status
 */
export function calendarStatusLabel(status: CalendarEntry["status"]): "Confirmed" | "Pending" {
  return status === "CONFIRMED" ? "Confirmed" : "Pending"
}
