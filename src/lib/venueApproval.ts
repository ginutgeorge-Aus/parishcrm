import type { Prisma } from "@/lib/generated/prisma/client"
import { logAuditManyTx } from "@/lib/audit"
import { utcDateToYmd } from "@/lib/venueUsage"

/** Requests that have not been successfully sent. `status` can be null (never sent) or FAILED; SQL `!=` skips NULLs, hence the OR. */
export const UNSENT_FILTER = {
  OR: [{ status: null }, { status: { not: "SUCCESS" } }],
} satisfies Prisma.VenueUsageRequestWhereInput

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
