// Canonical list of audited feature areas (AuditLog.resourceType values). The
// "dormant features" panel needs this because a groupBy can't surface an area
// with ZERO rows. MAINTENANCE: add an entry here when a new audited
// resourceType ships (grep `logAudit(` for the 3rd argument).
export const TRACKED_FEATURE_AREAS = [
  "Person",
  "Family",
  "Event",
  "Attendee",
  "Transaction",
  "Account",
  "AccountGroup",
  "Budget",
  "PettyCashSession",
  "DgrReceipt",
  "MembershipApplication",
  "EmailTemplate",
  "User",
  "Report",
] as const

export function dormantAreas(seen: string[]): string[] {
  const seenSet = new Set(seen)
  return TRACKED_FEATURE_AREAS.filter((a) => !seenSet.has(a))
}

export function weekBuckets(
  now: Date,
  weeks: number
): { start: Date; end: Date; label: string }[] {
  const WEEK = 7 * 86400_000
  const out: { start: Date; end: Date; label: string }[] = []
  for (let i = weeks - 1; i >= 0; i--) {
    const end = new Date(now.getTime() - i * WEEK)
    const start = new Date(end.getTime() - WEEK)
    out.push({ start, end, label: start.toISOString().slice(0, 10) })
  }
  return out
}
