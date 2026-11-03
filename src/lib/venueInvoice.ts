import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { encrypt } from "@/lib/crypto"
import { sendVenueUsageRequestEmail } from "@/lib/email"
import { getChurchSettings } from "@/lib/churchSettings"
import { getEmailTemplate } from "@/lib/emailTemplateStore"
import { logger } from "@/lib/logger"
import { readVenueUsageSettings, type VenueUsageSettings } from "@/lib/venueUsageSettings"
import { serializableWrite } from "@/lib/serializableWrite"
import { isP2002 } from "@/lib/validation"
import { VENUE_SENDING_WARNING_TTL_MS } from "@/lib/venueApproval"
import type { Prisma } from "@/lib/generated/prisma/client"
import {
  buildRequestEmail, confirmedOnly, monthCompleteness, monthRange, ccAddressesWithDropped,
  type MonthCompleteness, type VenueUsageLine,
} from "@/lib/venueUsage"

/** Most bookings one month may hold; creates enforce it and month reads `take` it (warning when they hit it). */
export const MAX_ROWS_PER_MONTH = 200

/** User-facing error when another send of the same month holds the in-flight claim (see `deliverInvoiceRequest`). */
export const INVOICE_SEND_BUSY_ERROR =
  "This month's invoice request is being sent right now (or its bookings are changing). Wait a minute, refresh, and check before sending again."

/** User-facing error when a create would push a month past {@link MAX_ROWS_PER_MONTH}. */
export const MONTH_FULL_ERROR = `A month can hold at most ${MAX_ROWS_PER_MONTH} bookings. Delete some before adding more.`

/**
 * Log a warning when a capped month read came back full, so a truncated list is never silent.
 * @param source log prefix naming the caller
 * @param month "YYYY-MM" that was read
 * @param count rows the read returned
 */
export function warnIfMonthCapped(source: string, month: string, count: number): void {
  if (count >= MAX_ROWS_PER_MONTH) {
    logger.warn(`[${source}] month read hit the row cap; later rows are ignored`, { month, cap: MAX_ROWS_PER_MONTH })
  }
}

/**
 * Run a write that follows an email already sent; never throws, logs failures (no PII).
 * @param what short label for the log
 * @param month "YYYY-MM" for log context
 * @param fn the write
 * @param attempts how many tries before giving up
 * @returns whether the write succeeded
 */
async function afterSendWrite(what: string, month: string, fn: () => Promise<unknown>, attempts: number): Promise<boolean> {
  for (let i = 1; i <= attempts; i++) {
    try {
      await fn()
      return true
    } catch (e) {
      if (i === attempts) {
        logger.error(`[venueInvoice] ${what}`, { month, attempts, error: e instanceof Error ? e.message : String(e) })
      }
    }
  }
  return false
}

export type ActorInfo = { name: string; email: string | null }
export type Recipients = { to: string; cc: string[]; replyTo: string }

/**
 * Look up a user's display name and email (the session never carries the email).
 * @param userId acting user id
 */
export async function loadActor(userId: number): Promise<ActorInfo> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } })
  return { name: user?.name ?? "", email: user?.email || null }
}

/**
 * Case-insensitive de-duplicated list of non-blank addresses, excluding `exclude`.
 * @param list candidate addresses
 * @param exclude an address to leave out (the To address)
 */
function dedupeAddresses(list: (string | null | undefined)[], exclude: string): string[] {
  const seen = new Set([exclude.toLowerCase()])
  const out: string[] = []
  for (const a of list) {
    const v = a?.trim()
    if (!v || seen.has(v.toLowerCase())) continue
    seen.add(v.toLowerCase())
    out.push(v)
  }
  return out
}

/**
 * CC addresses from a stored list, warning (count only, never the addresses) when entries were skipped.
 * @param stored the saved setting value
 * @param which which list, for the log line
 */
function ccList(stored: string, which: "invoice" | "booking"): string[] {
  const { list, dropped } = ccAddressesWithDropped(stored)
  if (dropped > 0) logger.warn(`[venueInvoice] ${which} CC list: skipped invalid, duplicate or over-cap entries`, { dropped })
  return list
}

/**
 * To / CC / Reply-To for the invoice request. Reply-To is the configured address, else the acting
 * user's email; the scheduler (no actor) uses the configured address or none.
 * @param settings venue settings
 * @param actor the acting user, or null for the scheduler
 */
export function invoiceRecipients(settings: VenueUsageSettings, actor: ActorInfo | null): Recipients {
  const replyTo = settings.replyToEmail || actor?.email || ""
  return { to: settings.contactEmail, replyTo, cc: dedupeAddresses([...ccList(settings.ccEmail, "invoice"), replyTo, actor?.email], settings.contactEmail) }
}

/**
 * To / CC / Reply-To for booking requests and cancellation notices: the booking CC list plus the effective reply-to.
 * @param settings venue settings
 * @param actor the acting user
 */
export function bookingRecipients(settings: VenueUsageSettings, actor: ActorInfo | null): Recipients {
  const replyTo = settings.replyToEmail || actor?.email || ""
  return { to: settings.contactEmail, replyTo, cc: dedupeAddresses([...ccList(settings.bookingCcEmails, "booking"), replyTo], settings.contactEmail) }
}

export type InvoicePrep = {
  settings: VenueUsageSettings
  rows: VenueUsageLine[]
  completeness: MonthCompleteness
  subject: string
  text: string
  html: string
  to: string
  cc: string[]
  replyTo: string
  last: {
    status: string | null; sentAt: Date | null; errorMessage: string | null
    approvedAt: Date | null; approvedByName: string | null; autoSent: boolean
  } | null
}

/**
 * A month's bookings (all statuses, capped), in the order the invoice lists them.
 * @param start first day of the month (UTC midnight)
 * @param end last day of the month (UTC midnight)
 * @param db client to read with (a transaction client inside the send claim)
 */
function readMonthRows(start: Date, end: Date, db: Pick<Prisma.TransactionClient, "venueUsage"> = prisma) {
  return db.venueUsage.findMany({
    where: { date: { gte: start, lte: end } },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
    take: MAX_ROWS_PER_MONTH,
    select: { date: true, startTime: true, endTime: true, status: true },
  })
}

/**
 * A comparable key for what an invoice request lists: each CONFIRMED row's date and hours, order-independent.
 * @param rows rows of one month (any status; non-CONFIRMED rows are ignored)
 */
function invoiceFingerprint(rows: readonly VenueUsageLine[]): string {
  return confirmedOnly(rows).map((r) => `${r.date.toISOString()}|${r.startTime}|${r.endTime}`).sort().join(",")
}

/**
 * After a successful send, whether the month's CONFIRMED rows still match what the email listed. A booking edit
 * that committed between {@link prepareInvoiceRequest} and the send is otherwise invisible. Never throws (the
 * email has gone): a failed re-read is logged and reported as not stale.
 * @param p the prepared request that was sent
 * @param month "YYYY-MM"
 */
async function changedDuringSend(p: InvoicePrep, month: string): Promise<boolean> {
  try {
    const { start, end } = monthRange(month)
    const stale = invoiceFingerprint(await readMonthRows(start, end)) !== invoiceFingerprint(p.rows)
    if (stale) logger.warn("[venueInvoice] bookings changed while the invoice request was being sent", { month })
    return stale
  } catch (e) {
    logger.error("[venueInvoice] post-send re-check of the month failed", { month, error: e instanceof Error ? e.message : String(e) })
    return false
  }
}

/** Result of {@link claimSending}: another send holds the month, or this send's stamp (null when not written). */
type SendClaim = { busy: true } | { busy: false; stamp: Date | null; changed: boolean }

const CLAIM_BUSY = { busy: true } as const

/**
 * Claim the month for this send by stamping `sendingAt`, refusing while another send's stamp is younger than
 * {@link VENUE_SENDING_WARNING_TTL_MS} (#528: double click, or a manual send overlapping the job).
 *
 * Runs in one Serializable transaction that also re-reads the month's bookings. Booking edits run Serializable and
 * read the request row, so an edit concurrent with the claim forms a read/write cycle with it and Postgres aborts
 * one (the edit's retry then sees `sendingAt` and warns). That closes the window where an edit whose snapshot
 * predates the stamp commits after the post-send re-check (#509 #512). Two claims racing on the same row conflict
 * the same way (or collide on the unique month), and the loser reports busy.
 *
 * Other failures are best-effort: logged, and the send goes ahead without a stamp (so without the in-flight warning
 * or the double-send guard). The `sendingAt` migration must still be applied: other paths read the column.
 * @param p the prepared request (its rows are compared with the re-read)
 * @param month "YYYY-MM"
 * @returns busy, or the stamp written (null when the write failed) and whether the rows already changed since prepare
 */
async function claimSending(p: InvoicePrep, month: string): Promise<SendClaim> {
  const stamp = new Date()
  const cutoff = new Date(stamp.getTime() - VENUE_SENDING_WARNING_TTL_MS)
  try {
    const r = await serializableWrite(async (tx): Promise<SendClaim> => {
      const row = await tx.venueUsageRequest.findUnique({ where: { month }, select: { sendingAt: true } })
      if (row?.sendingAt && row.sendingAt >= cutoff) return CLAIM_BUSY
      const { start, end } = monthRange(month)
      const changed = invoiceFingerprint(await readMonthRows(start, end, tx)) !== invoiceFingerprint(p.rows)
      await tx.venueUsageRequest.upsert({ where: { month }, create: { month, sendingAt: stamp }, update: { sendingAt: stamp } })
      return { busy: false, stamp, changed }
    }, { error: "conflict" })
    // Every attempt hit a serialization conflict: another send or an edit of this month is in progress.
    return "error" in r ? CLAIM_BUSY : r
  } catch (e) {
    if (isP2002(e)) return CLAIM_BUSY
    logger.error("[venueInvoice] could not mark the invoice request in-flight; sending anyway", { month, error: e instanceof Error ? e.message : String(e) })
    return { busy: false, stamp: null, changed: false }
  }
}

/**
 * Clear this send's in-flight stamp, fenced on the stamp itself so a send that outlived its TTL never clears a
 * later send's claim (#528). Never throws (an abandoned stamp stops counting after its TTL).
 * @param month "YYYY-MM"
 * @param stamp the `sendingAt` value this send wrote
 */
async function clearSending(month: string, stamp: Date): Promise<void> {
  try {
    await prisma.venueUsageRequest.updateMany({ where: { month, sendingAt: stamp }, data: { sendingAt: null } })
  } catch (e) {
    logger.error("[venueInvoice] could not clear the in-flight stamp", { month, error: e instanceof Error ? e.message : String(e) })
  }
}

/**
 * Load the month, build the invoice-request email (template-driven) and resolve recipients. Callers gate first.
 * @param month "YYYY-MM"
 * @param actor the acting user, or null for the scheduler
 */
export async function prepareInvoiceRequest(month: string, actor: ActorInfo | null): Promise<InvoicePrep> {
  const settings = await readVenueUsageSettings()
  const { start, end } = monthRange(month)
  const [all, churchSettings, template, last] = await Promise.all([
    readMonthRows(start, end),
    getChurchSettings(),
    getEmailTemplate("venueInvoiceRequest"),
    prisma.venueUsageRequest.findUnique({
      where: { month },
      select: {
        status: true, sentAt: true, errorMessage: true, approvedAt: true, autoSent: true,
        approvedBy: { select: { name: true } },
      },
    }),
  ])
  warnIfMonthCapped("venueInvoice", month, all.length)
  const rows = confirmedOnly(all)
  const { subject, text, html } = buildRequestEmail({
    churchName: churchSettings.name, venueName: settings.venueName, contactName: settings.contactName,
    month, rows, senderName: actor?.name ?? null, template,
  })
  const { to, cc, replyTo } = invoiceRecipients(settings, actor)
  return {
    settings, rows, completeness: monthCompleteness(month, all), subject, text, html, to, cc, replyTo,
    last: last
      ? {
          status: last.status, sentAt: last.sentAt, errorMessage: last.errorMessage,
          approvedAt: last.approvedAt, approvedByName: last.approvedBy?.name ?? null, autoSent: last.autoSent,
        }
      : null,
  }
}

/**
 * Send the prepared invoice request and record the outcome (also on failure). A failed RESEND after an
 * earlier SUCCESS records only the error, so the month still reads as sent and the job cannot send a duplicate.
 * "Sent" is `status === "SUCCESS"`, never `sentAt != null` (FAILED sends also stamp `sentAt`).
 *
 * Once the email has gone, nothing after it may turn the result into a failure (that would make the job or
 * the user send again): the SUCCESS write is retried once, then logged loudly, and the audit write never
 * throws. Residual window: if both SUCCESS writes fail (or the process dies between the send and the
 * write), the row does not read as sent, so a later manual send or job run could email the venue again.
 * `recorded: false` reports that case: the job then never releases its claim and always writes
 * `reminderSentAt` (closing the month for it), and a manual send warns the user not to send again. A
 * process death between the send and the write is not covered.
 *
 * In-flight window (#509 #512 #528): before the email goes, {@link claimSending} stamps `sendingAt` in a
 * Serializable transaction that re-reads the month. A live stamp from another send refuses this one (`status:
 * "BUSY"`: nothing is sent or recorded), so a double click or a manual send overlapping the job cannot email the
 * venue twice. The stamp is cleared after the outcome, fenced on its own value so it never clears another send's
 * claim. While it is live, a booking edit warns the editor (see `sentOrSendingMonthsTx`; `status` keeps its
 * SUCCESS/FAILED meaning). An edit that committed after the prepare read is caught by the claim's re-read or by
 * re-reading the month once the SUCCESS is recorded: `stale: true` means the venue got rows that no longer match,
 * it is kept in the audit metadata (the job's notice retry reads it back), and callers tell staff to check and resend.
 * @param p result of {@link prepareInvoiceRequest}
 * @param ctx month, acting user (null = scheduler), whether the scheduler sent it, whether it is an explicit resend
 * @returns the send status (BUSY = refused, another send holds the month), its error, whether the outcome row was
 *   written (`recorded`), and whether the month's CONFIRMED rows changed during the send (`stale`)
 */
export async function deliverInvoiceRequest(
  p: InvoicePrep,
  ctx: { month: string; userId: number | null; autoSent: boolean; resend: boolean },
): Promise<{ status: "SUCCESS" | "FAILED" | "BUSY"; errorMessage: string | null; recorded: boolean; stale: boolean }> {
  const claim = await claimSending(p, ctx.month)
  if (claim.busy) {
    logger.warn("[venueInvoice] invoice request refused: another send of the month is in flight", { month: ctx.month })
    return { status: "BUSY", errorMessage: INVOICE_SEND_BUSY_ERROR, recorded: false, stale: false }
  }
  let status: "SUCCESS" | "FAILED" = "SUCCESS"
  let errorMessage: string | null = null
  try {
    await sendVenueUsageRequestEmail({
      to: p.to, cc: p.cc.length ? p.cc.join(", ") : undefined, replyTo: p.replyTo || undefined,
      subject: p.subject, html: p.html, text: p.text,
    })
  } catch (err) {
    status = "FAILED"
    errorMessage = (err instanceof Error ? err.message : "Send failed").slice(0, 500)
  }
  const data = { sentAt: new Date(), sentTo: encrypt(p.to), status, errorMessage, sentById: ctx.userId, autoSent: ctx.autoSent }
  const record = () => prisma.venueUsageRequest.upsert({ where: { month: ctx.month }, create: { month: ctx.month, ...data }, update: data })
  let recorded = false
  try {
    if (status === "SUCCESS") {
      recorded = await afterSendWrite("invoice request was SENT but the success was not recorded", ctx.month, record, 2)
    } else {
      if (p.last?.status === "SUCCESS") {
        await prisma.venueUsageRequest.update({ where: { month: ctx.month }, data: { errorMessage } })
      } else {
        await record()
      }
      recorded = true
    }
  } finally {
    // Release only our own claim, whether or not the outcome landed, so edits stop warning.
    if (claim.stamp) await clearSending(ctx.month, claim.stamp)
  }
  // Re-check only after the outcome is recorded, so no read sits between the send and its record.
  const stale = status === "SUCCESS" && (claim.changed || (await changedDuringSend(p, ctx.month)))
  await afterSendWrite("audit write failed", ctx.month, () => logAudit(
    ctx.userId, status === "SUCCESS" ? "VENUE_USAGE_REQUEST_SENT" : "VENUE_USAGE_REQUEST_FAILED", "VenueUsageRequest", undefined,
    { month: ctx.month, rows: p.rows.length, resend: ctx.resend, autoSent: ctx.autoSent, ...(stale ? { stale: true } : {}) },
  ), 1)
  return { status, errorMessage, recorded, stale }
}
