import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { canEdit, isAdmin } from "@/lib/roleGuard"
import { prisma } from "@/lib/prisma"
import { sydneyTodayYMD } from "@/lib/dates"
import { readVenueUsageSettings } from "@/lib/venueUsageSettings"
import { isValidMonth, monthRange, nextSundayYMD, previousMonth, utcDateToYmd } from "@/lib/venueUsage"
import { calendarUrl, readCalendarToken } from "@/lib/venueCalendarToken"
import { VenueUsageClient } from "@/components/venue-usage/VenueUsageClient"

/** Venue bookings: bookings for a month plus the monthly invoice-request panel. */
export default async function VenueUsagePage(
  props: Readonly<{ searchParams: Promise<{ month?: string }> }>,
) {
  const session = await auth()
  if (!canEdit(session?.user?.role)) redirect("/")
  const settings = await readVenueUsageSettings()
  if (!settings.enabled) redirect("/")

  // Bearer secret: only read here, after the canEdit gate above, so it never reaches a non-editor's payload.
  const token = await readCalendarToken()

  const today = sydneyTodayYMD()
  const { month: rawMonth } = await props.searchParams
  const month = rawMonth && isValidMonth(rawMonth) ? rawMonth : today.slice(0, 7)
  const { start, end } = monthRange(month)

  const rows = await prisma.venueUsage.findMany({
    where: { date: { gte: start, lte: end } },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
    take: 200,
    select: { id: true, date: true, startTime: true, endTime: true, status: true, purpose: true, notes: true, bookingRequestedAt: true },
  })

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <div>
        <h1 className="text-2xl font-semibold">Venue bookings</h1>
        <p className="text-sm text-muted-foreground">
          Plan and confirm dates at {settings.venueName || "the venue"}, ask the venue to book them, then request the
          monthly invoice. Only confirmed bookings are counted in the invoice request.
        </p>
      </div>
      <VenueUsageClient
        month={month}
        today={today}
        nextSunday={nextSundayYMD(today)}
        defaultRequestMonth={previousMonth(today)}
        calendarUrl={token ? calendarUrl(token) : null}
        canResetCalendar={isAdmin(session?.user?.role)}
        rows={rows.map((r) => ({ ...r, date: utcDateToYmd(r.date), bookingRequestedAt: r.bookingRequestedAt?.toISOString() ?? null }))}
      />
    </div>
  )
}
