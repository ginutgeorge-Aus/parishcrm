import { sendEmail, isAmbiguousDeliveryError } from "@/lib/email"
import { logger } from "@/lib/logger"
import { resolveCelebrationSend, type CelebrationAction } from "@/lib/celebrationClaim"

/**
 * Send one already-claimed celebration email and durably resolve its
 * reservation. Returns true if delivered (the caller then audits). Shared by
 * the daily sweep (`celebrationSweep.ts`) and the manual send actions
 * (`actions/birthday.ts`, `actions/anniversary.ts`) so every path resolves
 * outcomes identically — auditing stays with each caller so their existing
 * per-send vs batch-only audit semantics are unchanged.
 *
 * Idempotency-critical: the send and the terminal-state write are
 * handled separately so a post-delivery failure can never flip the reservation
 * to a retryable FAILED and cause a resend on a later run —
 *  - send throws, ambiguous post-submission error → UNKNOWN (mail may be out;
 *    terminal, never reclaimed);
 *  - send throws, clean pre-delivery failure → FAILED (retryable);
 *  - send succeeds but the SENT write fails → UNKNOWN (mail is out; terminal),
 *    loud-logged for operator review.
 */
export async function deliverCelebration(
  to: string,
  subject: string,
  html: string,
  text: string,
  personId: number,
  action: CelebrationAction,
  sendDate: string,
): Promise<boolean> {
  try {
    await sendEmail(to, subject, html, text)
  } catch (err) {
    await resolveCelebrationSend(personId, action, sendDate, isAmbiguousDeliveryError(err) ? "UNKNOWN" : "FAILED")
    return false
  }
  try {
    await resolveCelebrationSend(personId, action, sendDate, "SENT")
  } catch {
    await resolveCelebrationSend(personId, action, sendDate, "UNKNOWN").catch(() => {})
    logger.error(`[celebration] ${action} to person ${personId} delivered but could not record SENT — marked UNKNOWN to prevent resend`)
  }
  return true
}
