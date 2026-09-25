import { prisma } from "@/lib/prisma"
import { isP2002 } from "@/lib/validation"

// Recipients audited per-Person under these actions; mirrors the AuditLog
// action names (see security.md) so the two stay obviously paired.
export const BIRTHDAY_ACTION = "BIRTHDAY_EMAIL_SENT" as const
export const ANNIVERSARY_ACTION = "ANNIVERSARY_EMAIL_SENT" as const
export type CelebrationAction = typeof BIRTHDAY_ACTION | typeof ANNIVERSARY_ACTION

// Lease for an in-flight PENDING claim ( follow-up). Mirrors the reminder
// sweep lease (REMINDER_LEASE_MS): if an invocation wins a claim then dies
// before resolving it — crash/timeout between the create and the send/resolve —
// the PENDING row would otherwise strand that person's celebration for the rest
// of the Sydney day, with no retry path (only FAILED slots are reclaimable). A
// later invocation reclaims a PENDING slot once its lease has gone stale. The
// row's @updatedAt is the lease clock: Prisma stamps it on create and on every
// reclaim, and it stays put while a claim is held (nothing writes the row
// between claim and resolve), so `updatedAt < staleBefore` detects abandonment.
// 10 min is comfortably longer than a realistic send loop, so a live claim is
// never stolen from an actively-sending invocation.
const CELEBRATION_LEASE_MS = 10 * 60 * 1000

/**
 * Atomic delivery reservation for a celebration email. Overlapping
 * invocations — the daily cron sweep running twice, or a manual send racing
 * the cron — used to read an in-memory "already sent today" set before
 * sending: a pure read-then-write race that let both through. This makes the
 * DB row insert itself the atomic decision point: call BEFORE sending, and
 * only proceed to send if this call returns true.
 *
 * Returns true if the caller won the claim (created a fresh PENDING row,
 * reclaimed a previously FAILED attempt, or reclaimed a PENDING attempt whose
 * lease went stale — see CELEBRATION_LEASE_MS) and should send. Returns false
 * if another invocation actively holds (fresh PENDING, in flight) or has
 * resolved (SENT) this slot — the caller must not send.
 */
export async function claimCelebrationSend(
  personId: number,
  action: CelebrationAction,
  sendDate: string
): Promise<boolean> {
  try {
    await prisma.celebrationSend.create({ data: { personId, action, sendDate, status: "PENDING" } })
    return true
  } catch (e) {
    if (!isP2002(e)) throw e
    // A slot already exists. Reclaim it atomically only if it's retryable: a
    // previously FAILED attempt, or a PENDING attempt whose lease has gone
    // stale (an earlier invocation claimed it then died before resolving, so no
    // email is in flight). A fresh PENDING (another invocation sending right
    // now) or a SENT slot is never reclaimed. The updateMany's WHERE is the
    // atomic decision point — two racing reclaimers can't both win: the first
    // flips the row and bumps @updatedAt, so the second's WHERE no longer
    // matches (count 0).
    const staleBefore = new Date(Date.now() - CELEBRATION_LEASE_MS)
    const reclaimed = await prisma.celebrationSend.updateMany({
      where: {
        personId,
        action,
        sendDate,
        OR: [{ status: "FAILED" }, { status: "PENDING", updatedAt: { lt: staleBefore } }],
      },
      data: { status: "PENDING" },
    })
    return reclaimed.count > 0
  }
}

/**
 * Resolve a claimed reservation to its final delivery outcome.
 * - "SENT": delivered and recorded.
 * - "FAILED": send definitely failed before delivery — retryable (the reclaim
 *   WHERE above matches it, so a later run may take over).
 * - "UNKNOWN": terminal, non-retryable. Used when the mail may already have
 *   gone out but we can't confirm the reservation is durably SENT — an
 *   ambiguous post-submission SMTP error, or a confirmed delivery whose SENT
 *   write failed. Deliberately absent from the reclaim WHERE, so no later
 *   invocation can resend; surfaced in logs for operator review instead.
 */
export async function resolveCelebrationSend(
  personId: number,
  action: CelebrationAction,
  sendDate: string,
  status: "SENT" | "FAILED" | "UNKNOWN"
): Promise<void> {
  await prisma.celebrationSend.update({
    where: { personId_action_sendDate: { personId, action, sendDate } },
    data: { status },
  })
}
