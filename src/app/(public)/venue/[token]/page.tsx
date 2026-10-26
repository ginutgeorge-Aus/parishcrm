import { headers } from "next/headers"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { prisma } from "@/lib/prisma"
import { rateLimit } from "@/lib/rateLimit"
import { clientIpFromHeaders } from "@/lib/clientIp"
import { sydneyTodayYMD } from "@/lib/dates"
import { readVenueUsageSettings } from "@/lib/venueUsageSettings"
import { readCalendarToken, tokenMatches } from "@/lib/venueCalendarToken"
import { clampCalendarMonth, type CalendarEntry } from "@/lib/venueCalendar"
import { monthRange, utcDateToYmd } from "@/lib/venueUsage"
import { MAX_ROWS_PER_MONTH } from "@/lib/venueInvoice"
import { VenueCalendarView } from "@/components/venue-usage/VenueCalendarView"

// Always current; never cached or indexed. The token is the only secret, so the
// page also suppresses the Referer header should it ever link out.
export const dynamic = "force-dynamic"
export const metadata: Metadata = {
  title: "Venue calendar",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
}

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ month?: string }> }

/**
 * Public, read-only venue calendar for committee members. Gated only by the secret token (constant-time compare);
 * a wrong token, no token or the feature being off all 404. Shows venue name, dates, times, purpose and
 * Confirmed/Pending only: no notes, names or CRM data. The token is never logged.
 * @param props route params (token) and search params (month)
 */
export default async function VenueCalendarPage({ params, searchParams }: Readonly<Props>) {
  const { token } = await params
  const ip = clientIpFromHeaders(await headers())
  if (!rateLimit(`venueCal:${ip}`, 60, 60_000)) {
    return <p className="p-6 text-center text-sm">Too many requests. Please try again in a minute.</p>
  }
  const [settings, stored] = await Promise.all([readVenueUsageSettings(), readCalendarToken()])
  if (!settings.enabled || !stored || !tokenMatches(token, stored)) notFound()

  const today = sydneyTodayYMD()
  const { month: raw } = await searchParams
  const month = clampCalendarMonth(raw, today)
  const { start, end } = monthRange(month)
  const rows = await prisma.venueUsage.findMany({
    where: { date: { gte: start, lte: end }, status: { in: ["REQUESTED", "CONFIRMED"] } },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
    take: MAX_ROWS_PER_MONTH, // same cap writes enforce, so a full month is never cut off
    select: { id: true, date: true, startTime: true, endTime: true, purpose: true, status: true },
  })
  const entries: CalendarEntry[] = rows.map((r) => ({
    id: r.id,
    date: utcDateToYmd(r.date),
    startTime: r.startTime,
    endTime: r.endTime,
    purpose: r.purpose,
    status: r.status === "CONFIRMED" ? "CONFIRMED" : "REQUESTED",
  }))
  return <VenueCalendarView venueName={settings.venueName} month={month} token={token} todayYMD={today} entries={entries} />
}
