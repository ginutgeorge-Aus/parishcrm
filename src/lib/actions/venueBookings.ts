"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { actorId } from "@/lib/actor"
import { canEdit } from "@/lib/roleGuard"
import { logAudit, logAuditTx } from "@/lib/audit"
import { assertNotDemo } from "@/lib/demoMode"
import { isValidPgId } from "@/lib/validation"
import { sendVenueUsageRequestEmail } from "@/lib/email"
import { getChurchSettings } from "@/lib/churchSettings"
import { getEmailTemplate } from "@/lib/emailTemplateStore"
import { sydneyToday, sydneyTodayYMD } from "@/lib/dates"
import { readVenueUsageSettings } from "@/lib/venueUsageSettings"
import { MAX_ROWS_PER_MONTH, bookingRecipients, loadActor } from "@/lib/venueInvoice"
import { UNSENT_FILTER } from "@/lib/venueApproval"
import { autoSendLabel } from "@/lib/venueSchedule"
import {
  buildBookingRequestEmail, formatUsageLine, isValidMonth, monthCompleteness, monthRange, utcDateToYmd,
} from "@/lib/venueUsage"

/** One not-yet-asked REQUESTED date the secretary can tick for the booking request. */
export type BookingCandidate = { id: number; date: string; startTime: string; endTime: string; purpose: string | null }

/** Everything the "Request booking" dialog needs. */
export type BookingRequestPreview = {
  candidates: BookingCandidate[]
  selectedIds: number[]
  asked: { id: number; date: string; askedOn: string }[]
  booked: string[]
  subject: string
  text: string
  to: string
  cc: string
  replyTo: string
  blockedReason: string | null
}

/**
 * Role + feature gate shared by the booking actions.
 * @returns the session, venue settings and acting user id, or `{ error }`
 */
async function gate() {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" } as const
  const settings = await readVenueUsageSettings()
  if (!settings.enabled) return { error: "Venue usage is not enabled" } as const
  return { session, settings, userId: actorId(session) } as const
}

/** REQUESTED, not-yet-asked rows (all months), oldest first. */
function loadCandidates() {
  return prisma.venueUsage.findMany({
    where: { status: "REQUESTED", bookingRequestedAt: null },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
    take: MAX_ROWS_PER_MONTH,
    select: { id: true, date: true, startTime: true, endTime: true, purpose: true },
  })
}

/** CONFIRMED rows from today (Sydney) on: "already booked", for reference in the request. */
function loadBooked() {
  return prisma.venueUsage.findMany({
    where: { status: "CONFIRMED", date: { gte: sydneyToday() } },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
    take: MAX_ROWS_PER_MONTH,
    select: { date: true, startTime: true, endTime: true, status: true },
  })
}

/**
 * Preview the booking-request email (`canEdit`; feature must be enabled).
 * @param ids ticked candidate ids; omitted = every candidate ticked
 */
export async function getBookingRequestPreview(ids?: number[]): Promise<BookingRequestPreview | { error: string }> {
  const g = await gate()
  if (g.error !== undefined) return { error: g.error }
  const [candidates, asked, booked, actor, church, template] = await Promise.all([
    loadCandidates(),
    prisma.venueUsage.findMany({
      where: { status: "REQUESTED", bookingRequestedAt: { not: null }, date: { gte: sydneyToday() } },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
      take: MAX_ROWS_PER_MONTH,
      select: { id: true, date: true, bookingRequestedAt: true },
    }),
    loadBooked(),
    loadActor(g.userId),
    getChurchSettings(),
    getEmailTemplate("venueBookingRequest"),
  ])
  const selected = ids ? candidates.filter((c) => ids.includes(c.id)) : candidates
  const { to, cc, replyTo } = bookingRecipients(g.settings, actor)
  const mail = buildBookingRequestEmail({
    churchName: church.name, venueName: g.settings.venueName, contactName: g.settings.contactName,
    requested: selected.map((c) => ({ ...c, status: "REQUESTED" })), booked, senderName: actor.name, template,
  })
  let blockedReason: string | null = null
  if (!to) blockedReason = "Set the venue contact email in Settings first"
  else if (selected.length === 0) blockedReason = "Tick at least one date"
  return {
    candidates: candidates.map((c) => ({
      id: c.id, date: utcDateToYmd(c.date), startTime: c.startTime, endTime: c.endTime, purpose: c.purpose,
    })),
    selectedIds: selected.map((c) => c.id),
    asked: asked.map((a) => ({
      id: a.id, date: utcDateToYmd(a.date), askedOn: a.bookingRequestedAt ? sydneyTodayYMD(a.bookingRequestedAt) : "",
    })),
    booked: booked.map(formatUsageLine),
    subject: mail.subject,
    text: mail.text,
    to,
    cc: cc.join(", "),
    replyTo,
    blockedReason,
  }
}

/**
 * Put claimed rows back to "not yet asked" (only rows still stamped with this run's claim time).
 * @param ids claimed row ids
 * @param claimAt the claim timestamp this run wrote
 */
async function releaseClaim(ids: number[], claimAt: Date): Promise<void> {
  await prisma.venueUsage.updateMany({ where: { id: { in: ids }, bookingRequestedAt: claimAt }, data: { bookingRequestedAt: null } })
}

/**
 * Audit-log after the outcome is decided, without ever throwing.
 * @param userId acting user id
 * @param action audit action name
 * @param ids booking ids concerned
 */
async function auditBookingRequest(userId: number, action: string, ids: number[]): Promise<void> {
  try {
    await logAudit(userId, action, "VenueUsage", undefined, { count: ids.length, ids })
  } catch (err) {
    console.error("Venue booking request audit failed", err)
  }
}

/**
 * Email the venue a booking request for the ticked dates (`canEdit`; blocked in demo mode).
 * Claims the rows first (conditional `updateMany`) so a double-click cannot email twice, and
 * releases only its own claim if the send fails.
 * @param ids ticked VenueUsage ids (1 to 200)
 */
export async function sendBookingRequest(ids: number[]): Promise<{ success: string } | { error: string }> {
  const demo = assertNotDemo()
  if (demo) return demo
  const g = await gate()
  if (g.error !== undefined) return { error: g.error }
  if (ids.length === 0) return { error: "Tick at least one date" }
  if (ids.length > MAX_ROWS_PER_MONTH || !ids.every(isValidPgId)) return { error: "Invalid booking" }
  if (!g.settings.contactEmail) return { error: "Set the venue contact email in Settings first" }

  const [candidates, booked, actor, church, template] = await Promise.all([
    prisma.venueUsage.findMany({
      where: { id: { in: ids }, status: "REQUESTED", bookingRequestedAt: null },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
      select: { id: true, date: true, startTime: true, endTime: true, status: true },
    }),
    loadBooked(), loadActor(g.userId), getChurchSettings(), getEmailTemplate("venueBookingRequest"),
  ])
  if (candidates.length === 0) return { error: "Those dates were already requested. Refresh the page." }
  const claimedIds = candidates.map((c) => c.id)
  const claimAt = new Date()
  const claim = await prisma.venueUsage.updateMany({
    where: { id: { in: claimedIds }, status: "REQUESTED", bookingRequestedAt: null },
    data: { bookingRequestedAt: claimAt },
  })
  if (claim.count !== claimedIds.length) {
    if (claim.count > 0) await releaseClaim(claimedIds, claimAt)
    return { error: "Those dates were already requested. Refresh the page." }
  }
  try {
    const { to, cc, replyTo } = bookingRecipients(g.settings, actor)
    const mail = buildBookingRequestEmail({
      churchName: church.name, venueName: g.settings.venueName, contactName: g.settings.contactName,
      requested: candidates, booked, senderName: actor.name, template,
    })
    await sendVenueUsageRequestEmail({ to, cc: cc.length ? cc.join(", ") : undefined, replyTo: replyTo || undefined, ...mail })
  } catch {
    await releaseClaim(claimedIds, claimAt)
    await auditBookingRequest(g.userId, "VENUE_BOOKING_REQUEST_FAILED", claimedIds)
    return { error: "Could not send the email. Check email settings and try again." }
  }
  await auditBookingRequest(g.userId, "VENUE_BOOKING_REQUEST_SENT", claimedIds)
  revalidatePath("/venue-usage")
  return { success: `Booking request sent for ${claimedIds.length} ${claimedIds.length === 1 ? "date" : "dates"}` }
}

/**
 * Approve the current Sydney month for the automatic invoice request (`canEdit`).
 * Needs a contact email and a complete month; refuses once the request was sent.
 * Completeness is read and the approval written in one transaction; the job re-checks at send time.
 * @param month "YYYY-MM", must be the current Sydney month
 */
export async function approveVenueMonth(month: string): Promise<{ success: string } | { error: string }> {
  const g = await gate()
  if (g.error !== undefined) return { error: g.error }
  if (!isValidMonth(month)) return { error: "Invalid month" }
  if (month !== sydneyTodayYMD().slice(0, 7)) return { error: "Only the current month can be approved" }
  if (!g.settings.contactEmail) return { error: "Set the venue contact email in Settings first" }
  const { start, end } = monthRange(month)
  const outcome = await prisma.$transaction(async (tx) => {
    const [rows, request] = await Promise.all([
      tx.venueUsage.findMany({ where: { date: { gte: start, lte: end } }, take: MAX_ROWS_PER_MONTH, select: { date: true, status: true } }),
      tx.venueUsageRequest.findUnique({ where: { month }, select: { status: true } }),
    ])
    if (request?.status === "SUCCESS") return "The invoice request for this month was already sent"
    if (!monthCompleteness(month, rows).complete) return "The month is not complete yet"
    const data = { approvedAt: new Date(), approvedById: g.userId }
    await tx.venueUsageRequest.upsert({ where: { month }, create: { month, ...data }, update: data })
    await logAuditTx(tx, g.userId, "VENUE_MONTH_APPROVED", "VenueUsageRequest", undefined, { month })
    return null
  })
  if (outcome) return { error: outcome }
  revalidatePath("/venue-usage")
  return { success: `Approved: the invoice request will be sent on ${autoSendLabel(month)}` }
}

/**
 * Withdraw an unsent approval (`canEdit`).
 * @param month "YYYY-MM"
 */
export async function withdrawVenueApproval(month: string): Promise<{ success: string } | { error: string }> {
  const g = await gate()
  if (g.error !== undefined) return { error: g.error }
  if (!isValidMonth(month)) return { error: "Invalid month" }
  const done = await prisma.$transaction(async (tx) => {
    const { count } = await tx.venueUsageRequest.updateMany({
      where: { month, approvedAt: { not: null }, ...UNSENT_FILTER },
      data: { approvedAt: null, approvedById: null },
    })
    if (count === 0) return false
    await logAuditTx(tx, g.userId, "VENUE_APPROVAL_WITHDRAWN", "VenueUsageRequest", undefined, { month })
    return true
  })
  if (!done) return { error: "There is no approval to withdraw" }
  revalidatePath("/venue-usage")
  return { success: "Approval withdrawn" }
}
