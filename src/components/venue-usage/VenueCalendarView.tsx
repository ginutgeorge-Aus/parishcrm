import Link from "next/link"
import {
  CALENDAR_FUTURE_MONTHS,
  CALENDAR_PAST_MONTHS,
  buildMonthGrid,
  calendarStatusLabel,
  type CalendarEntry,
} from "@/lib/venueCalendar"
import {
  addMonths,
  durationHours,
  formatHours,
  formatMonthLabel,
  formatTime12,
  formatUsageDate,
  ymdToUtcDate,
} from "@/lib/venueUsage"

const WEEKDAY_HEADS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const STATUS_CLASS = {
  CONFIRMED: "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-100",
  REQUESTED: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
} as const

/**
 * Read-only month view for the public venue calendar: a Sunday-first grid (colour plus text labels) and a
 * list of the month's dates below it. Server component; navigation is plain links.
 * @param props venue name, month, token (for prev/next links), Sydney today and the month's entries
 */
export function VenueCalendarView({
  venueName,
  month,
  token,
  todayYMD,
  entries,
}: Readonly<{
  venueName: string
  month: string
  token: string
  todayYMD: string
  entries: CalendarEntry[]
}>) {
  const current = todayYMD.slice(0, 7)
  const prev = addMonths(month, -1)
  const next = addMonths(month, 1)
  const canPrev = prev >= addMonths(current, -CALENDAR_PAST_MONTHS)
  const canNext = next <= addMonths(current, CALENDAR_FUTURE_MONTHS)
  const grid = buildMonthGrid(month, entries)
  const navClass = "inline-flex h-10 min-w-10 items-center justify-center rounded-md border px-3 text-sm"
  const base = `/venue/${encodeURIComponent(token)}`
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <h1 className="text-2xl font-semibold break-words">{venueName || "Venue"} bookings</h1>
      <div className="flex items-center justify-between gap-2">
        {canPrev ? (
          <Link className={navClass} href={`${base}?month=${prev}`} aria-label="Previous month">
            &larr;
          </Link>
        ) : (
          <span className={`${navClass} opacity-40`} aria-hidden>
            &larr;
          </span>
        )}
        <h2 className="text-lg font-medium">{formatMonthLabel(month)}</h2>
        {canNext ? (
          <Link className={navClass} href={`${base}?month=${next}`} aria-label="Next month">
            &rarr;
          </Link>
        ) : (
          <span className={`${navClass} opacity-40`} aria-hidden>
            &rarr;
          </span>
        )}
      </div>
      <table className="w-full table-fixed border-collapse text-xs sm:text-sm">
        <caption className="sr-only">{formatMonthLabel(month)} calendar</caption>
        <thead>
          <tr>
            {WEEKDAY_HEADS.map((d) => (
              <th key={d} scope="col" className="p-1 text-center font-medium text-muted-foreground">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map((week) => (
            <tr key={week[0].ymd}>
              {week.map((c) => (
                <td
                  key={c.ymd}
                  className={`h-14 overflow-hidden border p-1 align-top sm:h-20 ${c.inMonth ? "" : "bg-muted/30 text-muted-foreground/50"}`}
                >
                  <div className={c.ymd === todayYMD ? "font-bold underline" : ""}>{c.day}</div>
                  {c.entries.map((e) => (
                    <div key={e.id} className={`mt-0.5 truncate rounded px-1 ${STATUS_CLASS[e.status]}`}>
                      <span className="sr-only">{calendarStatusLabel(e.status)}: </span>
                      <span aria-hidden className="sm:hidden">
                        &bull;
                      </span>
                      <span className="hidden sm:inline">{formatTime12(e.startTime)}</span>
                    </div>
                  ))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No bookings this month.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {entries.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium">{formatUsageDate(ymdToUtcDate(e.date))}</p>
                <p className="text-muted-foreground">
                  {formatTime12(e.startTime)} – {formatTime12(e.endTime)} ({formatHours(durationHours(e.startTime, e.endTime))})
                </p>
                {e.purpose && <p className="break-words">{e.purpose}</p>}
              </div>
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[e.status]}`}>
                {calendarStatusLabel(e.status)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
