"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { actorId } from "@/lib/actor"
import { isAdmin } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { assertNotDemo } from "@/lib/demoMode"
import { readVenueUsageSettings } from "@/lib/venueUsageSettings"
import { VENUE_CALENDAR_TOKEN_KEY } from "@/lib/venueCalendar"
import { calendarUrl, mintCalendarToken } from "@/lib/venueCalendarToken"

/**
 * Create or replace the public calendar link (ADMIN only; blocked in demo mode; feature must be on).
 * Replacing the token kills the previously shared link immediately. The token is never logged.
 */
export async function resetVenueCalendarLink(): Promise<{ success: string; url: string | null } | { error: string }> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }
  const settings = await readVenueUsageSettings()
  if (!settings.enabled) return { error: "Venue usage is not enabled" }
  const token = mintCalendarToken()
  await prisma.appSetting.upsert({
    where: { key: VENUE_CALENDAR_TOKEN_KEY },
    create: { key: VENUE_CALENDAR_TOKEN_KEY, value: token },
    update: { value: token },
  })
  await logAudit(actorId(session), "VENUE_CALENDAR_LINK_RESET", "AppSetting", undefined, {})
  revalidatePath("/venue-usage")
  return { success: "Calendar link reset", url: calendarUrl(token) }
}
