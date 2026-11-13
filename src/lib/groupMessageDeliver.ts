import { prisma } from "@/lib/prisma"
import { decrypt } from "@/lib/crypto"
import { logger } from "@/lib/logger"
import { sendEmail, isAmbiguousDeliveryError } from "@/lib/email"
import { getChurchSettings } from "@/lib/churchSettings"
import { escapeHtml } from "@/lib/venueUsage"

/**
 * Group-email delivery (#303). Same PENDING / SENT / FAILED / UNKNOWN machine as
 * the celebration sends (`celebrationClaim.ts` / `celebrationDeliver.ts`), but the
 * ledger row exists from the moment the message is queued, so the claim is an
 * atomic `updateMany` on that row instead of an insert:
 *  - clean pre-delivery failure -> FAILED (retryable, up to MAX_DELIVERY_ATTEMPTS);
 *  - ambiguous post-submission error, or a delivery whose SENT write failed
 *    -> UNKNOWN (terminal, never reclaimed);
 *  - a PENDING claim that outlives its lease (crash mid-send, or a terminal write
 *    that failed) is closed as UNKNOWN, never re-sent: the mail may have gone out.
 */

/** Tries per recipient (the first send counts as one). */
export const MAX_DELIVERY_ATTEMPTS = 3
/** A PENDING claim older than this is treated as abandoned (crash mid-send) and closed as UNKNOWN (never re-sent). */
export const GROUP_MESSAGE_LEASE_MS = 10 * 60 * 1000
/** The sweep only retries messages queued within this window. */
export const RETRY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const SWEEP_MESSAGE_LIMIT = 50

/** Outcome tally of a delivery pass. `inFlight` counts recipients another pass holds. */
export type DeliverCounts = { sent: number; failed: number; unknown: number; inFlight: number }

/** Consecutive clean failures after which a pass stops (SMTP is down), leaving the rest queued for the next sweep. */
export const MAX_CONSECUTIVE_FAILURES = 3

type Status = "SENT" | "FAILED" | "UNKNOWN"

/**
 * Prisma filter for recipients a pass must look at: queued rows, retryable FAILED
 * rows with attempts left, and PENDING rows whose lease went stale (so they can be
 * closed as UNKNOWN even when every attempt is used).
 * @param now current instant
 */
function openRecipientWhere(now: Date) {
  const staleBefore = new Date(now.getTime() - GROUP_MESSAGE_LEASE_MS)
  return {
    OR: [
      { status: "FAILED", attempts: { lt: MAX_DELIVERY_ATTEMPTS } },
      { status: "PENDING", OR: [{ claimedAt: null }, { claimedAt: { lt: staleBefore } }] },
    ],
  }
}

/**
 * Atomically take the right to send to one recipient. Wins only for a queued
 * (never-claimed) PENDING row or a FAILED row with attempts left. SENT / UNKNOWN
 * rows and a fresh in-flight claim never match. A PENDING row whose lease went
 * stale already had a send attempt that may have reached the mail server (crash
 * mid-send, or its terminal write failed), so it is closed as UNKNOWN and never
 * resent. `claimedAt` is the real claim time (not the pass start), so a long pass
 * never makes its own live claims look stale to a concurrent drain.
 * @param id GroupMessageRecipient id
 * @returns true if this caller won the claim and must send
 */
export async function claimGroupRecipient(id: number): Promise<boolean> {
  const at = new Date()
  const staleBefore = new Date(at.getTime() - GROUP_MESSAGE_LEASE_MS)
  await prisma.groupMessageRecipient.updateMany({
    where: { id, status: "PENDING", claimedAt: { lt: staleBefore } },
    data: { status: "UNKNOWN" },
  })
  const r = await prisma.groupMessageRecipient.updateMany({
    where: {
      id,
      OR: [
        { status: "FAILED", attempts: { lt: MAX_DELIVERY_ATTEMPTS } },
        { status: "PENDING", claimedAt: null },
      ],
    },
    data: { status: "PENDING", claimedAt: at, attempts: { increment: 1 } },
  })
  return r.count > 0
}

/**
 * Record a claimed recipient's final outcome.
 * @param id GroupMessageRecipient id
 * @param status SENT, FAILED (retryable) or UNKNOWN (terminal)
 */
export async function resolveGroupRecipient(id: number, status: Status): Promise<void> {
  await prisma.groupMessageRecipient.update({ where: { id }, data: { status } })
}

/**
 * Render the plain-text body: greeting, the sender's text, and a branding signature.
 * The shared email chokepoint appends the admin-configured footer.
 * @param firstName recipient's given name
 * @param body the message text
 * @param groupName the group's name
 * @param churchName church name from settings
 */
export function renderGroupMessageText(firstName: string, body: string, groupName: string, churchName: string): string {
  return `Hello ${firstName},\n\n${body.trim()}\n\n—\n${groupName}\n${churchName}`
}

/**
 * Wrap the plain text for the HTML alternative (escaped, line breaks kept).
 * @param text the plain-text body
 */
function textToHtml(text: string): string {
  return `<div style="white-space:pre-wrap;font-family:sans-serif;font-size:14px;line-height:1.5">${escapeHtml(text)}</div>`
}

type MessageCtx = { groupId: number; subject: string; body: string; groupName: string; churchName: string }

/** Recipients claimed and sent at once within a pass (bounded so a big group does not open a flood of SMTP connections). */
export const SEND_CONCURRENCY = 3

/** The person fields `sendClaimed` needs, batch-loaded once per pass. */
type MailablePerson = {
  id: number
  firstName: string
  email: string | null
  emailConsent: boolean
  archivedAt: Date | null
  groupMemberships: { id: number }[]
}

/**
 * Send to one already-claimed recipient and durably resolve it. A person who
 * left the group's mailing set since queueing (removed from the group, group archived, person archived, opted out, address gone)
 * is closed as a terminal FAILED without sending. Sends bypass the owner alert
 * (`alertOwner: false`): one dead SMTP must not mail the owner once per recipient;
 * failures surface in the history page and the sweep's error log instead.
 * @param recipientId GroupMessageRecipient id
 * @param person the recipient's person row (batch-loaded), or undefined when it no longer exists
 * @param ctx message-level context
 * @returns the outcome, or "SKIPPED" when the person is no longer mailable
 */
async function sendClaimed(recipientId: number, person: MailablePerson | undefined, ctx: MessageCtx): Promise<Status | "SKIPPED"> {
  let to: string | null = null
  try {
    to = person?.email ? decrypt(person.email).trim() : null
  } catch {
    logger.error("[groupMessage] recipient email undecryptable — skipped (run rotation/backfill)")
  }
  if (!person || person.archivedAt || !person.emailConsent || !to || person.groupMemberships.length === 0) {
    // Terminal: burn the remaining attempts so the sweep never picks it up again.
    await prisma.groupMessageRecipient.update({ where: { id: recipientId }, data: { status: "FAILED", attempts: MAX_DELIVERY_ATTEMPTS } })
    return "SKIPPED"
  }
  const text = renderGroupMessageText(person.firstName, ctx.body, ctx.groupName, ctx.churchName)
  try {
    await sendEmail(to, ctx.subject, textToHtml(text), text, undefined, { alertOwner: false })
  } catch (err) {
    const status: Status = isAmbiguousDeliveryError(err) ? "UNKNOWN" : "FAILED"
    await resolveGroupRecipient(recipientId, status)
    return status
  }
  try {
    await resolveGroupRecipient(recipientId, "SENT")
  } catch {
    // If this write fails too the row stays PENDING; its lease expires and the next claim closes it as UNKNOWN (never resent).
    await resolveGroupRecipient(recipientId, "UNKNOWN").catch(() => {})
    logger.error(`[groupMessage] recipient ${recipientId} delivered but could not record SENT — marked UNKNOWN to prevent resend`)
    return "UNKNOWN"
  }
  return "SENT"
}

/**
 * Deliver every sendable recipient of one message: queued or retryable FAILED
 * (an abandoned PENDING claim is closed as UNKNOWN, not resent). Safe to run concurrently (the claim is the atomic decision).
 * Never logs an address.
 * @param messageId GroupMessage id
 * Recipients are sent SEND_CONCURRENCY at a time. Stops after MAX_CONSECUTIVE_FAILURES
 * clean failures in a row (SMTP down), leaving the rest queued for the next sweep.
 * @returns outcome counts (`aborted` when it stopped early)
 */
export async function deliverGroupMessage(messageId: number): Promise<DeliverCounts & { aborted?: boolean }> {
  const counts: DeliverCounts & { aborted?: boolean } = { sent: 0, failed: 0, unknown: 0, inFlight: 0 }
  let streak = 0
  const msg = await prisma.groupMessage.findUnique({
    where: { id: messageId },
    select: { groupId: true, subject: true, body: true, group: { select: { name: true } } },
  })
  if (!msg) return counts
  const { name: churchName } = await getChurchSettings()
  const ctx: MessageCtx = { groupId: msg.groupId, subject: msg.subject, body: msg.body, groupName: msg.group.name, churchName }

  const open = await prisma.groupMessageRecipient.findMany({
    where: { messageId, ...openRecipientWhere(new Date()) },
    select: { id: true, personId: true, status: true, claimedAt: true },
    orderBy: { id: "asc" },
  })
  // One query for every recipient's person (not one per recipient). Runs before any claim, so a failure leaves rows untouched for the next sweep.
  const people = await prisma.person.findMany({
    where: { id: { in: open.map((r) => r.personId) } },
    select: {
      id: true, firstName: true, email: true, emailConsent: true, archivedAt: true,
      // Still a member of a live group? Membership can change between queueing and sending.
      groupMemberships: { where: { groupId: ctx.groupId, group: { archivedAt: null } }, select: { id: true } },
    },
  })
  const byId = new Map(people.map((p) => [p.id, p]))
  const staleBefore = new Date(Date.now() - GROUP_MESSAGE_LEASE_MS)
  for (let i = 0; i < open.length; i += SEND_CONCURRENCY) {
    const chunk = open.slice(i, i + SEND_CONCURRENCY)
    const outcomes = await Promise.all(chunk.map(async (r) => {
      if (!(await claimGroupRecipient(r.id))) {
        // A stale PENDING claim was just closed as UNKNOWN by the claim; only a live claim elsewhere is in flight.
        return r.status === "PENDING" && r.claimedAt && r.claimedAt < staleBefore ? "STALE" as const : "INFLIGHT" as const
      }
      return sendClaimed(r.id, byId.get(r.personId), ctx)
    }))
    for (const outcome of outcomes) {
      if (outcome === "STALE") { counts.unknown++; continue }
      if (outcome === "INFLIGHT") { counts.inFlight++; continue }
      if (outcome === "SENT") counts.sent++
      else if (outcome === "UNKNOWN") counts.unknown++
      else counts.failed++
      // Only a real send failure counts toward the streak (a skipped, no-longer-mailable person is not an SMTP problem).
      streak = outcome === "FAILED" ? streak + 1 : outcome === "SKIPPED" ? streak : 0
    }
    if (streak >= MAX_CONSECUTIVE_FAILURES) { counts.aborted = true; break }
  }
  return counts
}

/**
 * Close recipients of messages older than the retry window that never reached a
 * terminal state (still queued, or a claim that outlived its lease). The sweep no
 * longer retries them, so without this they would read "Queued" forever. Closed as
 * UNKNOWN (never resent: delivery cannot be confirmed).
 * @param now current instant
 * @returns number of recipients closed
 */
export async function closeStaleRecipients(now: Date): Promise<number> {
  const r = await prisma.groupMessageRecipient.updateMany({
    where: {
      status: "PENDING",
      OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(now.getTime() - GROUP_MESSAGE_LEASE_MS) } }],
      message: { createdAt: { lt: new Date(now.getTime() - RETRY_WINDOW_MS) } },
    },
    data: { status: "UNKNOWN" },
  })
  return r.count
}

/**
 * Scheduler job: retry recent messages that still have queued or failed
 * recipients (a missed immediate drain, an SMTP blip, a crash mid-send), and
 * close out PENDING recipients of messages past the retry window.
 * @param now current instant
 * @returns summed counts (numbers only, so the scheduler log never carries PII)
 */
export async function runGroupMessageSweep(now: Date): Promise<DeliverCounts & { messages: number; closed: number }> {
  const total: DeliverCounts & { messages: number; closed: number } = { sent: 0, failed: 0, unknown: 0, inFlight: 0, messages: 0, closed: 0 }
  total.closed = await closeStaleRecipients(now)
  const messages = await prisma.groupMessage.findMany({
    where: {
      createdAt: { gte: new Date(now.getTime() - RETRY_WINDOW_MS) },
      recipients: { some: openRecipientWhere(now) },
    },
    select: { id: true },
    orderBy: { id: "asc" },
    take: SWEEP_MESSAGE_LIMIT,
  })
  for (const m of messages) {
    const c = await deliverGroupMessage(m.id)
    total.sent += c.sent; total.failed += c.failed; total.unknown += c.unknown; total.inFlight += c.inFlight
    total.messages++
    if (c.aborted) break
  }
  return total
}
