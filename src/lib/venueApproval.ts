import type { Prisma } from "@/lib/generated/prisma/client"
import { logAuditManyTx } from "@/lib/audit"
import { utcDateToYmd } from "@/lib/venueUsage"

/** Requests that have not been successfully sent. `status` can be null (never sent) or FAILED; SQL `!=` skips NULLs, hence the OR. */
export const UNSENT_FILTER = {
  OR: [{ status: null }, { status: { not: "SUCCESS" } }],
} satisfies Prisma.VenueUsageRequestWhereInput

/**
 * How long a `sendingAt` in-flight mark counts. A send takes seconds; a mark left behind by a process that died
 * mid-send stops counting after this, so it never warns forever. Also the job claim lease (re-exported by venueInvoiceJob).
 */
export const VENUE_JOB_LEASE_MS = 10 * 60_000

/** Months whose invoice request already went (`sent`) or is going out right now (`sending`). */
export type SentMonths = { sent: string[]; sending: string[] }

/**
 * Of `months`, those whose invoice request a CONFIRMED-row change can make stale: status SUCCESS (sent) or a
 * recent `sendingAt` (in flight between prepare and record, so the email may hold the old rows). A month both
 * sent and being resent counts as `sending`. One query, run inside the caller's transaction so the answer
 * matches the committed change and a failure rolls the edit back.
 * @param tx transaction client
 * @param months "YYYY-MM" values whose invoiced content (CONFIRMED rows: date, hours, status) changed
 * @param now clock for the in-flight cutoff
 * @returns sorted sent and in-flight months (both empty when none)
 */
export async function sentOrSendingMonthsTx(tx: Prisma.TransactionClient, months: readonly string[], now: Date = new Date()): Promise<SentMonths> {
  const unique = Array.from(new Set(months))
  if (unique.length === 0) return { sent: [], sending: [] }
  const cutoff = new Date(now.getTime() - VENUE_JOB_LEASE_MS)
  const rows = await tx.venueUsageRequest.findMany({
    where: { month: { in: unique }, OR: [{ status: "SUCCESS" }, { sendingAt: { gte: cutoff } }] },
    select: { month: true, status: true, sendingAt: true },
  })
  const sending = rows.filter((r) => r.sendingAt !== null && r.sendingAt >= cutoff)
  const sent = rows.filter((r) => !sending.includes(r) && r.status === "SUCCESS")
  return { sent: sent.map((r) => r.month).sort(), sending: sending.map((r) => r.month).sort() }
}

/**
 * "YYYY-MM" of a UTC-midnight `@db.Date` value.
 * @param d the date
 */
export function monthOfDate(d: Date): string {
  return utcDateToYmd(d).slice(0, 7)
}

/**
 * Clear the automatic-send approval of every approved, unsent month in `months` (inside the caller's
 * transaction, so the row change and the clear commit or roll back together) and audit each one.
 * Sent (SUCCESS) months are skipped; callers warn about those and in-flight ones via {@link sentOrSendingMonthsTx}.
 * @param tx interactive transaction client
 * @param months month keys touched by the row change (duplicates ignored)
 * @param userId acting user, or null for system actions
 * @returns the months whose approval was cleared
 */
export async function clearApprovalTx(tx: Prisma.TransactionClient, months: readonly string[], userId: number | null): Promise<string[]> {
  const unique = Array.from(new Set(months))
  if (unique.length === 0) return []
  const approved = await tx.venueUsageRequest.findMany({
    where: { month: { in: unique }, approvedAt: { not: null }, ...UNSENT_FILTER },
    select: { id: true, month: true },
  })
  if (approved.length === 0) return []
  await tx.venueUsageRequest.updateMany({ where: { id: { in: approved.map((a) => a.id) } }, data: { approvedAt: null, approvedById: null } })
  await logAuditManyTx(tx, approved.map((a) => ({
    userId, action: "VENUE_APPROVAL_CLEARED", resourceType: "VenueUsageRequest", resourceId: a.id,
    metadata: { month: a.month, reason: "booking changed" },
  })))
  return approved.map((a) => a.month)
}
