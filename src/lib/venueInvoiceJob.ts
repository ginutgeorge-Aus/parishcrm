import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { sendEmail } from "@/lib/email"
import { getChurchName } from "@/lib/emailTemplateStore"
import { FEATURE_OFF_SKIP } from "@/lib/features"
import { UserRole } from "@/lib/generated/prisma/enums"
import { isP2002 } from "@/lib/validation"
import { logger } from "@/lib/logger"
import { readVenueUsageSettings } from "@/lib/venueUsageSettings"
import { deliverInvoiceRequest, prepareInvoiceRequest, MAX_ROWS_PER_MONTH, warnIfMonthCapped } from "@/lib/venueInvoice"
import { buildAutoSentEmail, buildReminderEmail, venuePageUrl } from "@/lib/venueNotices"
import { venueInvoiceMonth, venueJobWindowOpen } from "@/lib/venueSchedule"
import { describeIncomplete, formatHours, monthCompleteness, monthRange, totalHours } from "@/lib/venueUsage"

/** A claim older than this is treated as abandoned (the work is a few emails, so a live run never gets near it). */
export const VENUE_JOB_LEASE_MS = 10 * 60_000

/** `failed` and `inFlight` are what the scheduler retries on; `sent` = invoice requests emailed, `notified` = staff notices sent. */
export type VenueJobResult = { sent: number; notified: number; failed: number; inFlight: number }
const ZERO: VenueJobResult = { sent: 0, notified: 0, failed: 0, inFlight: 0 }

/**
 * Create the month's request row if missing; a racing instance creating it first is fine.
 * @param month "YYYY-MM"
 */
async function ensureRequestRow(month: string): Promise<void> {
  try {
    await prisma.venueUsageRequest.upsert({ where: { month }, create: { month }, update: {} })
  } catch (e) {
    if (!isP2002(e)) throw e
  }
}

/**
 * Give the claim back (only if it is still ours) so a later tick can retry. Never throws: a failing
 * release must not mask the error or result that led here (an unreleased claim just expires with its lease).
 * @param month "YYYY-MM"
 * @param claimAt the claim timestamp this run holds
 */
async function releaseClaim(month: string, claimAt: Date): Promise<void> {
  try {
    await prisma.venueUsageRequest.updateMany({ where: { month, reminderClaimedAt: claimAt }, data: { reminderClaimedAt: null } })
  } catch (e) {
    logger.error(`[venueInvoiceJob] releasing the claim failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * Send one notice to every active editor, sequentially; counts only (never addresses in logs).
 * @param mail subject, html and text of the notice
 */
async function notifyEditors(mail: { subject: string; html: string; text: string }): Promise<{ notified: number; failed: number }> {
  const users = await prisma.user.findMany({
    where: { role: { in: [UserRole.ADMIN, UserRole.PASTOR, UserRole.OFFICE_ADMIN] }, archivedAt: null },
    select: { email: true },
  })
  let notified = 0
  let failed = 0
  for (const to of Array.from(new Set(users.map((u) => u.email.trim().toLowerCase())))) {
    try {
      await sendEmail(to, mail.subject, mail.html, mail.text)
      notified++
    } catch {
      failed++
      logger.error("[venueInvoiceJob] notice send failed for one recipient")
    }
  }
  return { notified, failed }
}

/**
 * The "invoice request sent" notice for a month, with its row count and total hours.
 * @param churchName church name for the notice
 * @param month "YYYY-MM"
 * @param rows the rows the request listed
 */
function autoSentNotice(churchName: string, month: string, rows: Parameters<typeof totalHours>[0]) {
  return buildAutoSentEmail({ churchName, month, rowCount: rows.length, totalHoursLabel: formatHours(totalHours(rows)) })
}

/** Attempts to write `reminderSentAt` before giving up. */
const DONE_ATTEMPTS = 3

/**
 * Write `reminderSentAt` (fenced on our claim), retrying a thrown error with a short backoff.
 * @param month "YYYY-MM"
 * @param claimAt the claim timestamp this run holds
 * @returns whether the write succeeded
 */
async function markMonthDone(month: string, claimAt: Date): Promise<boolean> {
  for (let attempt = 1; attempt <= DONE_ATTEMPTS; attempt++) {
    try {
      await prisma.venueUsageRequest.updateMany({ where: { month, reminderClaimedAt: claimAt }, data: { reminderSentAt: new Date() } })
      return true
    } catch (e) {
      logger.error(`[venueInvoiceJob] recording completion failed (attempt ${attempt}): ${e instanceof Error ? e.message : String(e)}`)
      if (attempt < DONE_ATTEMPTS) await new Promise((r) => setTimeout(r, 50 * attempt))
    }
  }
  return false
}

/**
 * Run the month's work under a held claim: skip if sent by hand, send the invoice request when approved and
 * still complete (else build a reminder), notify editors, then mark the month done. A month the job itself
 * already sent (SUCCESS + autoSent, but `reminderSentAt` still null because every notice failed) only
 * retries the staff notices and never emails the venue again. If this run sent the venue email but could not
 * record it, the claim is never released and `reminderSentAt` is written even when every notice failed: a
 * missing staff notice is better than a duplicate venue email. All reads that depend on the claim happen
 * here, after it was won.
 * @param month "YYYY-MM" being invoiced
 * @param claimAt the claim timestamp this run holds (fence for the final write)
 */
async function work(month: string, claimAt: Date): Promise<VenueJobResult> {
  const request = await prisma.venueUsageRequest.findUnique({
    where: { month }, select: { id: true, status: true, approvedAt: true, autoSent: true },
  })
  const churchName = await getChurchName()
  let sent = 0
  let isInvoiceNotice = false
  let sentUnrecorded = false
  let mail: { subject: string; html: string; text: string }
  if (request?.status === "SUCCESS") {
    if (!request.autoSent) {
      await releaseClaim(month, claimAt)
      return ZERO
    }
    // Sent by an earlier run whose notices all failed: retry the notices only (read-only prepare, no send).
    const prep = await prepareInvoiceRequest(month, null)
    isInvoiceNotice = true
    mail = autoSentNotice(churchName, month, prep.rows)
  } else {
    const { start, end } = monthRange(month)
    const rows = await prisma.venueUsage.findMany({
      where: { date: { gte: start, lte: end } }, take: MAX_ROWS_PER_MONTH, select: { date: true, status: true },
    })
    warnIfMonthCapped("venueInvoiceJob", month, rows.length)
    const completeness = monthCompleteness(month, rows)
    if (request?.approvedAt && completeness.complete) {
      const prep = await prepareInvoiceRequest(month, null)
      const result = await deliverInvoiceRequest(prep, { month, userId: null, autoSent: true, resend: false })
      if (result.status === "FAILED") {
        await releaseClaim(month, claimAt)
        return { ...ZERO, failed: 1 }
      }
      sent = 1
      sentUnrecorded = !result.recorded
      isInvoiceNotice = true
      mail = autoSentNotice(churchName, month, prep.rows)
    } else {
      const problems = completeness.complete
        ? ["Everything is recorded, but the invoice request has not been approved for automatic sending."]
        : describeIncomplete(completeness)
      mail = buildReminderEmail({ churchName, month, problems, url: venuePageUrl(month) })
    }
  }

  let notified = 0
  let failed = 0
  try {
    ;({ notified, failed } = await notifyEditors(mail))
  } catch (e) {
    // Once the venue email went out, a notice failure must not release the claim (a retry would resend it).
    if (!sentUnrecorded) throw e
    logger.error(`[venueInvoiceJob] notifying staff threw after the invoice was sent: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (notified === 0 && failed > 0 && !sentUnrecorded) {
    await releaseClaim(month, claimAt)
    return { sent, notified, failed, inFlight: 0 }
  }
  if (sentUnrecorded) logger.error(`[venueInvoiceJob] invoice request for ${month} was sent but not recorded; closing the month to avoid a duplicate venue email`)
  if (failed > 0) logger.error(`[venueInvoiceJob] ${failed} notice(s) failed; not retried to avoid repeats`)
  const recorded = await markMonthDone(month, claimAt)
  if (!recorded) {
    if (!sentUnrecorded && sent === 0 && notified === 0) throw new Error("could not record month completion")
    // Something already went out: releasing the claim would repeat it. Let the lease expire instead.
    logger.error(`[venueInvoiceJob] completion for ${month} is unrecorded after ${DONE_ATTEMPTS} attempts; claim kept until the lease expires`)
    return { sent, notified, failed: failed + 1, inFlight: 0 }
  }
  // The send already happened: an audit failure must not turn it into a failed run (which would retry and duplicate).
  try {
    await logAudit(null, isInvoiceNotice ? "VENUE_INVOICE_NOTICE_SENT" : "VENUE_REMINDER_SENT", "VenueUsageRequest", request?.id, { month, notified, failed })
  } catch (e) {
    logger.error(`[venueInvoiceJob] audit write failed: ${e instanceof Error ? e.message : String(e)}`)
  }
  return { sent, notified, failed: 0, inFlight: 0 }
}

/**
 * Monthly venue job, called by the scheduler. Within the Sydney 1st-7th window (from 09:00; the later days
 * are outage catch-up) it handles the previous month: sends the invoice request when an admin approved it and
 * the month is still complete, otherwise emails the editors a reminder. Idempotent per month through a lease
 * on `reminderClaimedAt` and a final `reminderSentAt`, so later days of the window are no-ops once done.
 * @param now run time
 */
export async function runVenueInvoiceJob(now: Date = new Date()): Promise<VenueJobResult | typeof FEATURE_OFF_SKIP> {
  if (!venueJobWindowOpen(now)) return ZERO
  const settings = await readVenueUsageSettings()
  if (!settings.enabled || !settings.contactEmail) return FEATURE_OFF_SKIP
  const month = venueInvoiceMonth(now)
  await ensureRequestRow(month)

  const claimAt = new Date(Math.max(Date.now(), now.getTime()))
  const staleBefore = new Date(claimAt.getTime() - VENUE_JOB_LEASE_MS)
  const claim = await prisma.venueUsageRequest.updateMany({
    where: { month, reminderSentAt: null, OR: [{ reminderClaimedAt: null }, { reminderClaimedAt: { lt: staleBefore } }] },
    data: { reminderClaimedAt: claimAt },
  })
  if (claim.count === 0) {
    const row = await prisma.venueUsageRequest.findUnique({ where: { month }, select: { reminderSentAt: true } })
    return row?.reminderSentAt ? ZERO : { ...ZERO, inFlight: 1 }
  }
  try {
    return await work(month, claimAt)
  } catch (e) {
    logger.error(`[venueInvoiceJob] run failed: ${e instanceof Error ? e.message : String(e)}`)
    await releaseClaim(month, claimAt)
    throw e
  }
}
