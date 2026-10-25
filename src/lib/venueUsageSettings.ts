import { prisma } from "@/lib/prisma"
import { VENUE_USAGE_SETTING_KEYS } from "@/lib/venueUsage"

// Plain server module (NOT "use server"): a normal function call, not a
// client-callable RPC. Callers are authenticated server contexts only.

export type VenueUsageSettings = {
  enabled: boolean
  venueName: string
  contactName: string
  contactEmail: string
  ccEmail: string
  replyToEmail: string
}

/**
 * Read the venue usage settings from `AppSetting`. Missing rows read as
 * disabled / blank.
 */
export async function readVenueUsageSettings(): Promise<VenueUsageSettings> {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: [...VENUE_USAGE_SETTING_KEYS] } },
  })
  const get = (key: string) => rows.find((r) => r.key === key)?.value ?? ""
  return {
    enabled: get("venueUsage.enabled") === "true",
    venueName: get("venueUsage.venueName"),
    contactName: get("venueUsage.contactName"),
    contactEmail: get("venueUsage.contactEmail"),
    ccEmail: get("venueUsage.ccEmail"),
    replyToEmail: get("venueUsage.replyToEmail"),
  }
}

/**
 * Whether the venue usage feature is switched on.
 */
export async function isVenueUsageEnabled(): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({ where: { key: "venueUsage.enabled" } })
  return row?.value === "true"
}
