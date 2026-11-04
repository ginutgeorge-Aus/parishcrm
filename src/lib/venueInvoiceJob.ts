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
import { sydneyClock } from "@/lib/dates"
import { VENUE_JOB_LAST_DAY, venueInvoiceMonth, venueJobWindowOpen } from "@/lib/venueSchedule"
import { confirmedOnly, describeIncomplete, formatHours, monthCompleteness, monthRange, totalHours } from "@/lib/venueUsage"
import { VENUE_JOB_LEASE_MS, VENUE_SENDING_WARNING_TTL_MS } from "@/lib/venueApproval"

/** A claim older than this is treated as abandoned (the work is a few emails, so a live run never gets near it). */
export { VENUE_JOB_LEASE_MS }

/** The persisted SUCCESS send the notices-only retry rebuilds its notice from. */
type RecordedSend = { staleAt: Date | null; sentAt: Date | null; sentRowCount: number | null; sentHours: unknown }

/**
 * Whether the month's recorded SUCCESS send was stale (bookings changed while it went out), for the notices-only retry.
 * `staleAt` wins. Otherwise the send's audit row says whether the post-send check ran: it is written after the fenced
 * `staleAt` write and carries this send's `sentAt` (#550), so a matching row with no `stale` flag means the check ran
 * clean; a `recheckFailed` row means the check threw, so it is re-derived. Audit rows from before `sentAt` was recorded are trusted as they are (legacy). No matching row (the process
 * died, or the audit write failed, between the SUCCESS outcome write and the stale marker) means the check never
 * landed, so it is re-derived from the rows ({@link changedSinceSend}). Erring toward "stale" only adds a
 * check-and-resend line.
 * @param month "YYYY-MM"
 * @param sent the request row's stale flag, `sentAt` and sent snapshot
 */
async function recordedSendWasStale(month: string, sent: RecordedSend): Promise<boolean> {
  if (sent.staleAt) return true
  try {
    const row = await prisma.auditLog.findFirst({
      where: { action: "VENUE_USAGE_REQUEST_SENT", resourceType: "VenueUsageRequest", metadata: { path: ["month"], equals: month } },
      orderBy: { id: "desc" }, select: { metadata: true },
    })
    const meta = row?.metadata
    if (meta && typeof meta === "object" && !Array.isArray(meta)) {
      if (meta.stale === true) return true
      // The post-send re-check itself failed (#550): nothing was verified, so fall through to re-derive.
      if (meta.recheckFailed === true) return sent.sentAt ? changedSinceSend(month, sent.sentAt, sent) : false
      if (meta.sentAt === undefined || meta.sentAt === sent.sentAt?.toISOString()) return false
    }
  } catch (e) {
    logger.error(`[venueInvoiceJob] reading the send's stale flag failed: ${e instanceof Error ? e.message : String(e)}`)
  }
  return sent.sentAt ? changedSinceSend(month, sent.sentAt, sent) : false
}

/**
 * Re-derive the post-send stale check when its result was never recorded (#550): stale when any row of the month was
 * written since the send's claim could have been taken (`sentAt` minus {@link VENUE_SENDING_WARNING_TTL_MS}, the
 * in-flight stamp's lifetime), or when the month's CONFIRMED rows no longer add up to the persisted snapshot (catches
 * deletes). Edits after the send also count, so it errs toward the warning. A failed read is reported as stale.
 * @param month "YYYY-MM"
 * @param sentAt the SUCCESS send's `sentAt`
 * @param snapshot the persisted `sentRowCount`/`sentHours` (null on rows sent before they existed)
 */
async function changedSinceSend(month: string, sentAt: Date, snapshot: { sentRowCount: number | null; sentHours: unknown }): Promise<boolean> {
  try {
    const { start, end } = monthRange(month)
    const rows = await prisma.venueUsage.findMany({
      where: { date: { gte: start, lte: end } }, take: MAX_ROWS_PER_MONTH,
      select: { date: true, startTime: true, endTime: true, status: true, updatedAt: true },
    })
    const since = sentAt.getTime() - VENUE_SENDING_WARNING_TTL_MS
    if (rows.some((r) => r.updatedAt.getTime() >= since)) return true
    if (snapshot.sentRowCount == null || snapshot.sentHours == null) return false
    const confirmed = confirmedOnly(rows)
    return confirmed.length !== snapshot.sentRowCount || Math.abs(totalHours(confirmed) - Number(snapshot.sentHours)) >= 0.005
  } catch (e) {
    logger.error(`[venueInvoiceJob] re-deriving the send's stale flag failed: ${e instanceof Error ? e.message : String(e)}`)
    return true
  }
}

/**
 * Withdraw the month's approval so no later run (for example after a restart and lease expiry) can email the venue again.
 * Same effect as `withdrawVenueApproval`, without the audit row. Never throws.
 * @param month "YYYY-MM"
 * @returns whether the write succeeded
 */
async function closeApproval(month: string): Promise<boolean> {
  try {
    await prisma.venueUsageRequest.updateMany({ where: { month, approvedAt: { not: null } }, data: { approvedAt: null, approvedById: null } })
    return true
  } catch (e) {
    logger.error(`[venueInvoiceJob] withdrawing the approval failed: ${e instanceof Error ? e.message : String(e)}`)
    return false
  }
}

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
 * @param sent the row count and total hours the request listed
 * @param changedDuringSend the bookings changed while the request was going out (staff should check and resend)
 */
function autoSentNotice(churchName: string, month: string, sent: { rowCount: number; hours: number }, changedDuringSend = false) {
  return buildAutoSentEmail({ churchName, month, rowCount: sent.rowCount, totalHoursLabel: formatHours(sent.hours), changedDuringSend })
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
 * missing staff notice is better than a duplicate venue email. When the bookings changed while the request was
 * going out (`stale`), the staff notice says so and asks them to check and resend. A manual send already in flight
 * makes the send refuse (BUSY): the claim is released and the run reports `inFlight`. All reads that depend on the claim happen
 * here, after it was won.
 * @param month "YYYY-MM" being invoiced
 * @param claimAt the claim timestamp this run holds (fence for the final write)
 */
async function work(month: string, claimAt: Date): Promise<VenueJobResult> {
  const request = await prisma.venueUsageRequest.findUnique({
    where: { month }, select: { id: true, status: true, approvedAt: true, autoSent: true, staleAt: true, sentAt: true, sentRowCount: true, sentHours: true },
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
    // Sent by an earlier run whose notices all failed: retry the notices only (no send). The notice comes from what
    // was persisted with the send; only rows from before that existed (null count) fall back to the current rows.
    // The stale flag is `staleAt`, else the send's audit flag, else re-derived from the rows (see recordedSendWasStale).
    isInvoiceNotice = true
    const stale = await recordedSendWasStale(month, request)
    if (request.sentRowCount != null && request.sentHours != null) {
      mail = autoSentNotice(churchName, month, { rowCount: request.sentRowCount, hours: Number(request.sentHours) }, stale)
    } else {
      const { start, end } = monthRange(month)
      const current = confirmedOnly(await prisma.venueUsage.findMany({
        where: { date: { gte: start, lte: end } }, take: MAX_ROWS_PER_MONTH, select: { date: true, startTime: true, endTime: true, status: true },
      }))
      mail = autoSentNotice(churchName, month, { rowCount: current.length, hours: totalHours(current) }, stale)
    }
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
      if (result.status === "BUSY") {
        // A manual send of this month is in flight (#528): nothing went out. Release so a later run re-checks
        // (it then finds the month sent by hand and stops).
        const lastDay = Number(sydneyClock(new Date()).ymd.slice(8, 10)) >= VENUE_JOB_LAST_DAY
        const detail = `[venueInvoiceJob] send for ${month} refused (BUSY, claim held ${Math.round((Date.now() - claimAt.getTime()) / 1000)}s)`
        if (lastDay) logger.error(`${detail}; last day of the window, later runs may refuse again and the window then closes: send it by hand`)
        else logger.warn(detail)
        await releaseClaim(month, claimAt)
        return { ...ZERO, inFlight: 1 }
      }
      if (result.status === "FAILED") {
        await releaseClaim(month, claimAt)
        return { ...ZERO, failed: 1 }
      }
      sent = 1
      sentUnrecorded = !result.recorded
      isInvoiceNotice = true
      mail = autoSentNotice(churchName, month, result.snapshot, result.stale)
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
    if (sentUnrecorded) {
      // Close the approval so a restart plus lease expiry cannot resend (the next run then only sends a reminder).
      if (await closeApproval(month)) {
        logger.error(`[venueInvoiceJob] ${month} was emailed to the venue but never recorded. The approval was withdrawn so it cannot be resent; check the venue was emailed.`)
        return { sent, notified, failed: 1, inFlight: 0 }
      }
      // Could not close it either: reported as a clean run on purpose, so the scheduler's per-process month memo
      // stops later ticks and this process never retries into a second venue email. Do not restart; withdraw the approval by hand.
      logger.error(`[venueInvoiceJob] ${month} was emailed to the venue but never recorded. Do NOT restart the server (the expired lease would resend). Withdraw the approval in the UI (withdrawVenueApproval) and check the venue was emailed.`)
      return { sent, notified, failed: 0, inFlight: 0 }
    }
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
 * A month this process emailed but could not record returns a result without failures, so the scheduler's per-process
 * month memo stops further ticks and the expired lease cannot cause a second venue email. Residual: a process restart
 * inside the 1st-7th window loses that memo and, once the lease expires, can resend; operators must withdraw the
 * approval (`withdrawVenueApproval`) and check the venue was emailed instead of restarting. When the completion
 * write also fails, the job first withdraws the approval itself (best-effort) and reports `failed: 1`, so the scheduler does not
 * log a clean run and a restart cannot resend; only if that write fails too does it fall back to the clean result above.
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
