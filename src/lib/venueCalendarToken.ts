import "server-only"
import { randomBytes } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { VENUE_CALENDAR_TOKEN_KEY } from "@/lib/venueCalendar"

/** A fresh calendar token: 24 CSPRNG bytes (192 bits) as 32 base64url characters. */
export function mintCalendarToken(): string {
  return randomBytes(24).toString("base64url")
}

/** The stored calendar token digest, or null when none is set (calendar disabled). The raw token is never stored. */
export async function readCalendarToken(): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: VENUE_CALENDAR_TOKEN_KEY } })
  return row?.value ? row.value : null
}

/**
 * Absolute calendar URL for a token (base from AUTH_URL).
 * @param token the calendar token
 * @returns the URL, or null when AUTH_URL is not a valid URL
 */
export function calendarUrl(token: string): string | null {
  try {
    return new URL(`/venue/${token}`, process.env.AUTH_URL ?? "http://localhost:3000").toString()
  } catch {
    return null
  }
}
