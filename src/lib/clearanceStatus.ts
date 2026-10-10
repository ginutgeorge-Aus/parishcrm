import { ClearanceType } from "@/lib/generated/prisma/enums"

// Pure + client-safe (no server-only imports). `today` MUST be the Sydney
// calendar date anchored at UTC midnight (`sydneyToday()` from src/lib/dates.ts)
// and `expiresAt` is a @db.Date (UTC midnight), so day arithmetic is exact.

/** Display/compliance state of one person's clearance of one type. */
export type ClearanceStatus = "MISSING" | "UNVERIFIED" | "VERIFIED" | "EXPIRING" | "EXPIRED"

/** A clearance is "expiring" when it lapses within this many days. */
export const EXPIRING_WINDOW_DAYS = 60

/** Human labels for each clearance type. */
export const CLEARANCE_TYPE_LABELS: Record<ClearanceType, string> = {
  WWCC: "Working With Children Check",
  SAFE_MINISTRY: "Safe Ministry",
}

/** Human labels for each status (badge text). */
export const CLEARANCE_STATUS_LABELS: Record<ClearanceStatus, string> = {
  MISSING: "Missing",
  UNVERIFIED: "Unverified",
  VERIFIED: "Verified",
  EXPIRING: `Expiring (${EXPIRING_WINDOW_DAYS} days)`,
  EXPIRED: "Expired",
}

const DAY_MS = 86_400_000

/**
 * Whole days from `today` until `expiresAt` (negative once past, 0 on the
 * expiry date itself), or null when there is no expiry date.
 * @param expiresAt expiry (@db.Date, UTC midnight) or null
 * @param today Sydney calendar date at UTC midnight
 */
export function daysUntilExpiry(expiresAt: Date | null, today: Date): number | null {
  return expiresAt ? Math.floor((expiresAt.getTime() - today.getTime()) / DAY_MS) : null
}

/**
 * Status of a clearance. Precedence: no row -> MISSING; past expiry -> EXPIRED;
 * not verified -> UNVERIFIED; within EXPIRING_WINDOW_DAYS of expiry ->
 * EXPIRING (a clearance is valid through its expiry date, so expiry == today
 * is EXPIRING, not EXPIRED); else VERIFIED. UNVERIFIED beats EXPIRING so the
 * badge never makes an unchecked clearance look like a checked one — EXPIRING
 * always means verified but lapsing. A row with no expiry date never expires.
 * @param c the clearance (or null if the person has none of this type)
 * @param today Sydney calendar date at UTC midnight
 */
export function clearanceStatus(
  c: { verifiedAt: Date | null; expiresAt: Date | null } | null,
  today: Date,
): ClearanceStatus {
  if (!c) return "MISSING"
  const daysLeft = daysUntilExpiry(c.expiresAt, today)
  if (daysLeft !== null && daysLeft < 0) return "EXPIRED"
  if (!c.verifiedAt) return "UNVERIFIED"
  if (daysLeft !== null && daysLeft <= EXPIRING_WINDOW_DAYS) return "EXPIRING"
  return "VERIFIED"
}
