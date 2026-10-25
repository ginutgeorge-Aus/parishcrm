import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { encrypt } from "@/lib/crypto"
import { sendVenueUsageRequestEmail } from "@/lib/email"
import { getChurchSettings } from "@/lib/churchSettings"
import { getEmailTemplate } from "@/lib/emailTemplateStore"
import { logger } from "@/lib/logger"
import { readVenueUsageSettings, type VenueUsageSettings } from "@/lib/venueUsageSettings"
import {
  buildRequestEmail, confirmedOnly, monthCompleteness, monthRange, parseCcList,
  type MonthCompleteness, type VenueUsageLine,
} from "@/lib/venueUsage"

/** Most bookings one month may hold; creates enforce it and month reads `take` it (warning when they hit it). */
export const MAX_ROWS_PER_MONTH = 200

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
 * To / CC / Reply-To for the invoice request. Reply-To is the configured address, else the acting
 * user's email; the scheduler (no actor) uses the configured address or none.
 * @param settings venue settings
 * @param actor the acting user, or null for the scheduler
 */
export function invoiceRecipients(settings: VenueUsageSettings, actor: ActorInfo | null): Recipients {
  const replyTo = settings.replyToEmail || actor?.email || ""
  return { to: settings.contactEmail, replyTo, cc: dedupeAddresses([settings.ccEmail, replyTo, actor?.email], settings.contactEmail) }
}

/**
 * To / CC / Reply-To for booking requests and cancellation notices: the booking CC list plus the effective reply-to.
 * @param settings venue settings
 * @param actor the acting user
 */
export function bookingRecipients(settings: VenueUsageSettings, actor: ActorInfo | null): Recipients {
  const replyTo = settings.replyToEmail || actor?.email || ""
  const parsed = parseCcList(settings.bookingCcEmails)
  return { to: settings.contactEmail, replyTo, cc: dedupeAddresses([...(parsed.ok ? parsed.list : []), replyTo], settings.contactEmail) }
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
 * Load the month, build the invoice-request email (template-driven) and resolve recipients. Callers gate first.
 * @param month "YYYY-MM"
 * @param actor the acting user, or null for the scheduler
 */
export async function prepareInvoiceRequest(month: string, actor: ActorInfo | null): Promise<InvoicePrep> {
  const settings = await readVenueUsageSettings()
  const { start, end } = monthRange(month)
  const [all, churchSettings, template, last] = await Promise.all([
    prisma.venueUsage.findMany({
      where: { date: { gte: start, lte: end } },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
      take: MAX_ROWS_PER_MONTH,
      select: { date: true, startTime: true, endTime: true, status: true },
    }),
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
 * (A SENDING pre-mark was not added: `status` is shown and filtered as SUCCESS/FAILED across the UI and
 * the approval queries, so a third value would need changes beyond this function.)
 * @param p result of {@link prepareInvoiceRequest}
 * @param ctx month, acting user (null = scheduler), whether the scheduler sent it, whether it is an explicit resend
 * @returns the send status, its error, and whether the outcome row was written (`recorded`)
 */
export async function deliverInvoiceRequest(
  p: InvoicePrep,
  ctx: { month: string; userId: number | null; autoSent: boolean; resend: boolean },
): Promise<{ status: "SUCCESS" | "FAILED"; errorMessage: string | null; recorded: boolean }> {
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
  let recorded = true
  if (status === "SUCCESS") {
    recorded = await afterSendWrite("invoice request was SENT but the success was not recorded", ctx.month, record, 2)
  } else if (p.last?.status === "SUCCESS") {
    await prisma.venueUsageRequest.update({ where: { month: ctx.month }, data: { errorMessage } })
  } else {
    await record()
  }
  await afterSendWrite("audit write failed", ctx.month, () => logAudit(
    ctx.userId, status === "SUCCESS" ? "VENUE_USAGE_REQUEST_SENT" : "VENUE_USAGE_REQUEST_FAILED", "VenueUsageRequest", undefined,
    { month: ctx.month, rows: p.rows.length, resend: ctx.resend, autoSent: ctx.autoSent },
  ), 1)
  return { status, errorMessage, recorded }
}
