import { prisma } from "@/lib/prisma"
import { decrypt } from "@/lib/crypto"
import { logger } from "@/lib/logger"
import { sendEmail, isAmbiguousDeliveryError } from "@/lib/email"
import { getChurchSettings } from "@/lib/churchSettings"
import { escapeHtml } from "@/lib/venueUsage"
import { FamilyRole } from "@/lib/generated/prisma/enums"
import {
  GROUP_MESSAGE_LEASE_MS,
  MAX_CONSECUTIVE_FAILURES,
  MAX_DELIVERY_ATTEMPTS,
  RETRY_WINDOW_MS,
  renderGroupMessageText,
  type DeliverCounts,
} from "@/lib/groupMessageDeliver"

/**
 * Sunday School parent email delivery (OSS-14). The same PENDING / SENT / FAILED
 * / UNKNOWN ledger machine as group email (see `groupMessageDeliver.ts` for the
 * full rules), on `SundaySchoolMessageRecipient`. Duplicated narrowly rather than
 * extracted so group-email delivery stays byte-for-byte unchanged; the limits,
 * lease and text rendering are imported from the group module so the two cannot drift.
 */

const SWEEP_MESSAGE_LIMIT = 50

type Status = "SENT" | "FAILED" | "UNKNOWN"

/**
 * Prisma filter for recipients a pass must look at: queued, retryable FAILED,
 * and PENDING rows whose lease went stale (closed as UNKNOWN, never resent).
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
 * Atomically take the right to send to one recipient (see claimGroupRecipient).
 * A stale PENDING claim is closed as UNKNOWN first and never matches.
 * @param id SundaySchoolMessageRecipient id
 * @returns true if this caller won the claim and must send
 */
export async function claimSsRecipient(id: number): Promise<boolean> {
  const at = new Date()
  const staleBefore = new Date(at.getTime() - GROUP_MESSAGE_LEASE_MS)
  await prisma.sundaySchoolMessageRecipient.updateMany({
    where: { id, status: "PENDING", claimedAt: { lt: staleBefore } },
    data: { status: "UNKNOWN" },
  })
  const r = await prisma.sundaySchoolMessageRecipient.updateMany({
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
 * @param id SundaySchoolMessageRecipient id
 * @param status SENT, FAILED (retryable) or UNKNOWN (terminal)
 */
async function resolveSsRecipient(id: number, status: Status): Promise<void> {
  await prisma.sundaySchoolMessageRecipient.update({ where: { id }, data: { status } })
}

/**
 * Wrap the plain text for the HTML alternative (escaped, line breaks kept).
 * @param text the plain-text body
 */
function textToHtml(text: string): string {
  return `<div style="white-space:pre-wrap;font-family:sans-serif;font-size:14px;line-height:1.5">${escapeHtml(text)}</div>`
}

type MessageCtx = { subject: string; body: string; className: string; churchName: string }

/**
 * Send to one already-claimed parent and durably resolve it. A parent who is no
 * longer mailable (archived, opted out, address gone, no longer HEAD/SPOUSE) is
 * closed as a terminal FAILED without sending.
 * @param recipientId the ledger row
 * @param personId the parent
 * @param ctx message text and names
 * @returns the outcome, or "SKIPPED" when the parent is no longer mailable
 */
async function sendClaimed(recipientId: number, personId: number, ctx: MessageCtx): Promise<Status | "SKIPPED"> {
  let person
  try {
    person = await prisma.person.findUnique({
      where: { id: personId },
      select: { firstName: true, email: true, emailConsent: true, archivedAt: true, role: true },
    })
  } catch {
    // Nothing was sent yet: release the claim as retryable FAILED.
    await resolveSsRecipient(recipientId, "FAILED").catch(() => {})
    logger.error(`[ssMessage] recipient ${recipientId} lookup failed before send — left retryable`)
    return "FAILED"
  }
  let to: string | null = null
  try {
    to = person?.email ? decrypt(person.email).trim() : null
  } catch {
    logger.error("[ssMessage] recipient email undecryptable — skipped (run rotation/backfill)")
  }
  const isParent = person?.role === FamilyRole.HEAD || person?.role === FamilyRole.SPOUSE
  if (!person || person.archivedAt || !person.emailConsent || !to || !isParent) {
    // Terminal: burn the remaining attempts so the sweep never picks it up again.
    await prisma.sundaySchoolMessageRecipient.update({ where: { id: recipientId }, data: { status: "FAILED", attempts: MAX_DELIVERY_ATTEMPTS } })
    return "SKIPPED"
  }
  const text = renderGroupMessageText(person.firstName, ctx.body, ctx.className, ctx.churchName)
  try {
    await sendEmail(to, ctx.subject, textToHtml(text), text)
  } catch (err) {
    const status: Status = isAmbiguousDeliveryError(err) ? "UNKNOWN" : "FAILED"
    await resolveSsRecipient(recipientId, status)
    return status
  }
  try {
    await resolveSsRecipient(recipientId, "SENT")
  } catch {
    // If this write fails too the row stays PENDING; its lease expires and the next claim closes it as UNKNOWN.
    await resolveSsRecipient(recipientId, "UNKNOWN").catch(() => {})
    logger.error(`[ssMessage] recipient ${recipientId} delivered but could not record SENT — marked UNKNOWN to prevent resend`)
    return "UNKNOWN"
  }
  return "SENT"
}

/**
 * Deliver every sendable recipient of one Sunday School message. Safe to run
 * concurrently (the claim is the atomic decision). Never logs an address. Stops
 * after MAX_CONSECUTIVE_FAILURES clean failures in a row (SMTP down).
 * @param messageId SundaySchoolMessage id
 * @returns outcome counts (`aborted` when it stopped early)
 */
export async function deliverSsMessage(messageId: number): Promise<DeliverCounts & { aborted?: boolean }> {
  const counts: DeliverCounts & { aborted?: boolean } = { sent: 0, failed: 0, unknown: 0, inFlight: 0 }
  let streak = 0
  const msg = await prisma.sundaySchoolMessage.findUnique({
    where: { id: messageId },
    select: { subject: true, body: true, class: { select: { name: true } } },
  })
  if (!msg) return counts
  const { name: churchName } = await getChurchSettings()
  const ctx: MessageCtx = { subject: msg.subject, body: msg.body, className: msg.class.name, churchName }

  const open = await prisma.sundaySchoolMessageRecipient.findMany({
    where: { messageId, ...openRecipientWhere(new Date()) },
    select: { id: true, personId: true, status: true, claimedAt: true },
    orderBy: { id: "asc" },
  })
  const staleBefore = new Date(Date.now() - GROUP_MESSAGE_LEASE_MS)
  for (const r of open) {
    if (!(await claimSsRecipient(r.id))) {
      if (r.status === "PENDING" && r.claimedAt && r.claimedAt < staleBefore) counts.unknown++
      else counts.inFlight++
      continue
    }
    const outcome = await sendClaimed(r.id, r.personId, ctx)
    if (outcome === "SENT") counts.sent++
    else if (outcome === "UNKNOWN") counts.unknown++
    else counts.failed++
    streak = outcome === "FAILED" ? streak + 1 : outcome === "SKIPPED" ? streak : 0
    if (streak >= MAX_CONSECUTIVE_FAILURES) { counts.aborted = true; break }
  }
  return counts
}

/**
 * Scheduler job: retry recent Sunday School messages that still have queued or
 * failed recipients.
 * @param now current instant
 * @returns summed counts (numbers only, so the scheduler log never carries PII)
 */
export async function runSsMessageSweep(now: Date): Promise<DeliverCounts & { messages: number }> {
  const total: DeliverCounts & { messages: number } = { sent: 0, failed: 0, unknown: 0, inFlight: 0, messages: 0 }
  const messages = await prisma.sundaySchoolMessage.findMany({
    where: {
      createdAt: { gte: new Date(now.getTime() - RETRY_WINDOW_MS) },
      recipients: { some: openRecipientWhere(now) },
    },
    select: { id: true },
    orderBy: { id: "asc" },
    take: SWEEP_MESSAGE_LIMIT,
  })
  for (const m of messages) {
    const c = await deliverSsMessage(m.id)
    total.sent += c.sent; total.failed += c.failed; total.unknown += c.unknown; total.inFlight += c.inFlight
    total.messages++
    if (c.aborted) break
  }
  return total
}
