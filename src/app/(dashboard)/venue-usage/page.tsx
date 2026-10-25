import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { canEdit } from "@/lib/roleGuard"
import { prisma } from "@/lib/prisma"
import { sydneyTodayYMD } from "@/lib/dates"
import { readVenueUsageSettings } from "@/lib/venueUsageSettings"
import { isValidMonth, monthRange, nextSundayYMD, previousMonth, utcDateToYmd } from "@/lib/venueUsage"
import { VenueUsageClient } from "@/components/venue-usage/VenueUsageClient"

/** Venue usage log: bookings for a month plus the monthly invoice-request panel. */
export default async function VenueUsagePage(
  props: Readonly<{ searchParams: Promise<{ month?: string }> }>,
) {
  const session = await auth()
  if (!canEdit(session?.user?.role)) redirect("/")
  const settings = await readVenueUsageSettings()
  if (!settings.enabled) redirect("/")

  const today = sydneyTodayYMD()
  const { month: rawMonth } = await props.searchParams
  const month = rawMonth && isValidMonth(rawMonth) ? rawMonth : today.slice(0, 7)
  const { start, end } = monthRange(month)

  const rows = await prisma.venueUsage.findMany({
    where: { date: { gte: start, lte: end } },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
    take: 200,
    select: { id: true, date: true, startTime: true, endTime: true, status: true, purpose: true, notes: true },
  })

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <div>
        <h1 className="text-2xl font-semibold">Venue usage</h1>
        <p className="text-sm text-muted-foreground">
          Log each booking of {settings.venueName || "the venue"}, then ask the venue for the month&apos;s invoice.
          Only confirmed bookings are counted in the request.
        </p>
      </div>
      <VenueUsageClient
        month={month}
        today={today}
        nextSunday={nextSundayYMD(today)}
        defaultRequestMonth={previousMonth(today)}
        rows={rows.map((r) => ({ ...r, date: utcDateToYmd(r.date) }))}
      />
    </div>
  )
}
