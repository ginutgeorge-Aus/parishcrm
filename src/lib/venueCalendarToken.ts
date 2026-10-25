import "server-only"
import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { VENUE_CALENDAR_TOKEN_KEY } from "@/lib/venueCalendar"

/** A fresh calendar token: 24 CSPRNG bytes (192 bits) as 32 base64url characters. */
export function mintCalendarToken(): string {
  return randomBytes(24).toString("base64url")
}

/**
 * Constant-time token comparison. Both sides are hashed first so the comparison length never depends on the input.
 * @param provided token from the URL
 * @param stored token from settings
 */
export function tokenMatches(provided: string, stored: string): boolean {
  if (!provided || !stored) return false
  const a = createHash("sha256").update(provided).digest()
  const b = createHash("sha256").update(stored).digest()
  return timingSafeEqual(a, b)
}

/** The stored calendar token, or null when none is set (calendar disabled). */
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
