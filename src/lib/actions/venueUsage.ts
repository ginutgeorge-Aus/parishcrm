"use server"

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { actorId } from "@/lib/actor"
import { canEdit, isAdmin } from "@/lib/roleGuard"
import { logAudit, logAuditTx, logAuditManyTx } from "@/lib/audit"
import { clearApprovalTx, monthOfDate } from "@/lib/venueApproval"
import { getChurchSettings } from "@/lib/churchSettings"
import { sendVenueUsageRequestEmail } from "@/lib/email"
import type { VenueUsageSettings } from "@/lib/venueUsageSettings"
import { assertNotDemo } from "@/lib/demoMode"
import { isValidEmail, isValidPgId } from "@/lib/validation"
import { bookingRecipients, deliverInvoiceRequest, loadActor, MAX_ROWS_PER_MONTH, MONTH_FULL_ERROR, prepareInvoiceRequest } from "@/lib/venueInvoice"
import { autoSendLabel } from "@/lib/venueSchedule"
import { sydneyTodayYMD } from "@/lib/dates"
import { buildCancellationEmail, describeIncomplete, monthRange, parseCcList, sundaysInMonth, utcDateToYmd } from "@/lib/venueUsage"
import type { VenueUsageLine } from "@/lib/venueUsage"
import type { Prisma } from "@/lib/generated/prisma/client"
import { readVenueUsageSettings } from "@/lib/venueUsageSettings"
import { logger } from "@/lib/logger"
import { serializableWrite as sharedSerializableWrite } from "@/lib/serializableWrite"
import {
  VENUE_BOOKING_STATUSES, isValidMonth, isValidYMD, totalHours,
  validateTimeRange, ymdToUtcDate, VENUE_USAGE_SETTING_KEYS,
} from "@/lib/venueUsage"
import type { ActionResultWithSuccess } from "./types"

const emptyToNull = (max: number) =>
  z.string().max(max, "Too long").optional().transform((v) => v?.trim() || null)

const UsageSchema = z
  .object({
    date: z.string().refine(isValidYMD, "Enter a valid date"),
    startTime: z.string(),
    endTime: z.string(),
    status: z.enum(VENUE_BOOKING_STATUSES),
    purpose: emptyToNull(200),
    notes: emptyToNull(500),
  })
  .superRefine((v, ctx) => {
    const err = validateTimeRange(v.startTime, v.endTime)
    if (err) ctx.addIssue({ code: "custom", message: err, path: ["endTime"] })
  })

/** Client input for a usage row (date as "YYYY-MM-DD", times "HH:mm"). */
export type VenueUsageInput = z.input<typeof UsageSchema>

/** Everything the "Request invoice" panel needs for one month. */
export type VenueRequestPreview = {
  month: string
  subject: string
  text: string
  to: string
  cc: string
  replyTo: string
  rowCount: number
  totalHours: number
  /** Why Send is disabled, or null when sending is allowed. */
  blockedReason: string | null
  last: { status: string | null; sentAt: string | null; errorMessage: string | null } | null
  /** True when `month` is the current Sydney month (the only one that can be approved). */
  isCurrentMonth: boolean
  /** When the job sends this month's request, e.g. "1 November, 9:00 AM". */
  autoSendLabel: string
  approval: { approvedAt: string; approvedBy: string | null } | null
  canApprove: boolean
  /** Reasons the month is incomplete (empty when complete). */
  warnings: string[]
  autoSent: boolean
}

/** Result of a booking mutation; `approvalCleared` tells the UI to show the re-approve notice, `warning` a non-fatal problem. */
export type VenueMutationResult = { success: string; approvalCleared?: boolean; warning?: string } | { error: string }

/**
 * Success result carrying the approval-cleared flag only when it applies.
 * @param success message
 * @param cleared months whose approval was cleared
 */
function mutationOk(success: string, cleared: string[]): VenueMutationResult {
  return cleared.length ? { success, approvalCleared: true } : { success }
}

/**
 * Whether adding `adding` rows to `month` would exceed {@link MAX_ROWS_PER_MONTH} (all statuses count, as the
 * capped month reads do). Callers run it inside {@link serializableWrite}, so two concurrent creates near the cap
 * conflict (P2034) and the loser re-counts instead of both inserting.
 * @param tx transaction client
 * @param month "YYYY-MM"
 * @param adding rows about to be created
 */
async function monthWouldOverflow(tx: Prisma.TransactionClient, month: string, adding: number): Promise<boolean> {
  const { start, end } = monthRange(month)
  const existing = await tx.venueUsage.count({ where: { date: { gte: start, lte: end } } })
  return existing + adding > MAX_ROWS_PER_MONTH
}

/** Result when a Serializable write keeps conflicting with concurrent bookings. */
const BUSY_ERROR = "Another change to the bookings was in progress. Please try again."

/**
 * Run a count-then-write booking body in a Serializable transaction (retried on conflict) so the monthly cap
 * cannot be overshot by concurrent requests.
 * @param fn transaction body
 */
function serializableWrite<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T | { error: string }> {
  return sharedSerializableWrite(fn, { error: BUSY_ERROR })
}

/** Refusal when date or times of a row the venue already knows about are edited. */
const VENUE_KNOWS_LOCK_ERROR =
  "The venue has already been asked about this date. To change it, cancel it (emailing the venue) and add a new booking."

const VENUE_KNOWS_CANCEL_ERROR =
  "The venue has already been asked about this date. Cancel it from the bookings list so you can email the venue."

/** Refusal when a move targets a full month. */
const MOVE_MONTH_FULL_ERROR = `That month already holds the maximum of ${MAX_ROWS_PER_MONTH} bookings. Choose another date.`

/**
 * Create a venue usage row. ADMIN/PASTOR/OFFICE_ADMIN (`canEdit`); feature must be enabled.
 * Clears the approval of the row's month (same transaction) when it was approved and unsent.
 * Refuses when the month already holds {@link MAX_ROWS_PER_MONTH} rows.
 * @param input date, times, status, purpose and notes
 */
export async function createVenueUsage(input: VenueUsageInput): Promise<VenueMutationResult> {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" }
  const settings = await readVenueUsageSettings()
  if (!settings.enabled) return { error: "Venue usage is not enabled" }

  const parsed = UsageSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const { date, ...rest } = parsed.data

  const userId = actorId(session)
  const cleared = await serializableWrite(async (tx) => {
    if (await monthWouldOverflow(tx, date.slice(0, 7), 1)) return null
    const row = await tx.venueUsage.create({
      data: { ...rest, date: ymdToUtcDate(date), createdById: userId },
      select: { id: true },
    })
    const months = await clearApprovalTx(tx, [date.slice(0, 7)], userId)
    await logAuditTx(tx, userId, "VENUE_USAGE_CREATED", "VenueUsage", row.id, { date, status: rest.status })
    return months
  })
  if (!cleared) return { error: MONTH_FULL_ERROR }
  if ("error" in cleared) return cleared
  revalidatePath("/venue-usage")
  return mutationOk("Booking added", cleared)
}

/**
 * Update a venue usage row (`canEdit`). A date move clears the approval of both the old and new month.
 * Once the venue knows a row (`venueNotifiedAt` or `bookingRequestedAt` set) its date and times are locked:
 * such an edit is refused ({@link VENUE_KNOWS_LOCK_ERROR}); status, purpose and notes stay editable, except that
 * cancelling such a row here is refused ({@link VENUE_KNOWS_CANCEL_ERROR}): it must go through
 * `setVenueUsageStatus`, which offers the cancellation email.
 * A status change resets `bookingRequestedAt` (date and times can only change on unasked rows, where it is
 * already null), so the stale "asked on" stamp disappears; purpose/notes edits leave it alone.
 * `venueNotifiedAt` is never touched: the venue still knows the row, so a later cancellation must reach them.
 * Moving the row into another month refuses when that month is already full ({@link MAX_ROWS_PER_MONTH}).
 * @param id VenueUsage id
 * @param input new field values
 */
export async function updateVenueUsage(id: number, input: VenueUsageInput): Promise<VenueMutationResult> {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(id)) return { error: "Invalid booking" }
  const settings = await readVenueUsageSettings()
  if (!settings.enabled) return { error: "Venue usage is not enabled" }

  const parsed = UsageSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const { date, ...rest } = parsed.data

  const userId = actorId(session)
  // Read the row inside the transaction so the old month is the one actually being replaced.
  const outcome = await serializableWrite(async (tx) => {
    const existing = await tx.venueUsage.findUnique({ where: { id }, select: { id: true, date: true, startTime: true, endTime: true, status: true, venueNotifiedAt: true, bookingRequestedAt: true } })
    if (!existing) return { notFound: true } as const
    const timingChanged =
      utcDateToYmd(existing.date) !== date || existing.startTime !== rest.startTime || existing.endTime !== rest.endTime
    const venueKnows = existing.venueNotifiedAt !== null || existing.bookingRequestedAt !== null
    if (timingChanged && venueKnows) return { locked: true } as const
    if (venueKnows && existing.status !== "CANCELLED" && rest.status === "CANCELLED") return { cancelViaList: true } as const
    if (monthOfDate(existing.date) !== date.slice(0, 7) && (await monthWouldOverflow(tx, date.slice(0, 7), 1))) {
      return { full: true } as const
    }
    const rescheduled = timingChanged || existing.status !== rest.status
    await tx.venueUsage.update({
      where: { id },
      data: { ...rest, date: ymdToUtcDate(date), ...(rescheduled ? { bookingRequestedAt: null } : {}) },
      select: { id: true },
    })
    const months = await clearApprovalTx(tx, [monthOfDate(existing.date), date.slice(0, 7)], userId)
    await logAuditTx(tx, userId, "VENUE_USAGE_UPDATED", "VenueUsage", id, { date, status: rest.status })
    return { months }
  })
  if ("error" in outcome) return outcome
  if ("notFound" in outcome) return { error: "Booking not found" }
  if ("locked" in outcome) return { error: VENUE_KNOWS_LOCK_ERROR }
  if ("cancelViaList" in outcome) return { error: VENUE_KNOWS_CANCEL_ERROR }
  if ("full" in outcome) return { error: MOVE_MONTH_FULL_ERROR }
  revalidatePath("/venue-usage")
  return mutationOk("Booking updated", outcome.months)
}

/**
 * Delete a venue usage row (`canEdit`). Clears the approval of the row's month.
 * @param id VenueUsage id
 */
export async function deleteVenueUsage(id: number): Promise<VenueMutationResult> {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(id)) return { error: "Invalid booking" }
  const settings = await readVenueUsageSettings()
  if (!settings.enabled) return { error: "Venue usage is not enabled" }

  const userId = actorId(session)
  // Read the row inside the transaction so a concurrent move or delete cannot leave a stale month.
  const cleared = await prisma.$transaction(async (tx) => {
    const existing = await tx.venueUsage.findUnique({ where: { id }, select: { id: true, date: true } })
    if (!existing) return null
    await tx.venueUsage.delete({ where: { id } })
    const months = await clearApprovalTx(tx, [monthOfDate(existing.date)], userId)
    await logAuditTx(tx, userId, "VENUE_USAGE_DELETED", "VenueUsage", id, { date: utcDateToYmd(existing.date) })
    return months
  })
  if (!cleared) return { error: "Booking not found" }
  revalidatePath("/venue-usage")
  return mutationOk("Booking deleted", cleared)
}

const AddAllSchema = z.object({
  month: z.string().refine(isValidMonth, "Invalid month"),
  startTime: z.string(),
  endTime: z.string(),
  purpose: emptyToNull(200),
})

/**
 * Add a REQUESTED booking for every Sunday of a month that has no non-cancelled booking yet (`canEdit`).
 * Refuses (adds nothing) when the new rows would push the month past {@link MAX_ROWS_PER_MONTH}.
 * @param input month "YYYY-MM", shared start/end time and optional public purpose
 */
export async function addAllSundays(input: { month: string; startTime: string; endTime: string; purpose?: string }): Promise<VenueMutationResult> {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" }
  const settings = await readVenueUsageSettings()
  if (!settings.enabled) return { error: "Venue usage is not enabled" }
  const parsed = AddAllSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const { month, startTime, endTime, purpose } = parsed.data
  const timeError = validateTimeRange(startTime, endTime)
  if (timeError) return { error: timeError }

  const userId = actorId(session)
  const sundays = sundaysInMonth(month)
  const outcome = await serializableWrite(async (tx) => {
    const existing = await tx.venueUsage.findMany({
      where: { date: { in: sundays.map(ymdToUtcDate) }, status: { not: "CANCELLED" } },
      select: { date: true },
      take: MAX_ROWS_PER_MONTH,
    })
    const taken = new Set(existing.map((e) => utcDateToYmd(e.date)))
    const free = sundays.filter((s) => !taken.has(s))
    if (free.length === 0) return { added: 0, cleared: [] as string[] }
    if (await monthWouldOverflow(tx, month, free.length)) return null
    await tx.venueUsage.createMany({
      data: free.map((s) => ({ date: ymdToUtcDate(s), startTime, endTime, status: "REQUESTED" as const, purpose, createdById: userId })),
    })
    const months = await clearApprovalTx(tx, [month], userId)
    await logAuditTx(tx, userId, "VENUE_USAGE_BULK_ADDED", "VenueUsage", undefined, { month, added: free.length, skipped: sundays.length - free.length })
    return { added: free.length, cleared: months }
  })
  if (!outcome) return { error: MONTH_FULL_ERROR }
  if ("error" in outcome) return outcome
  const { added, cleared } = outcome
  revalidatePath("/venue-usage")
  if (added === 0) return { success: "Nothing to add: every Sunday already has a booking" }
  const skipped = sundays.length - added
  const label = `Added ${added} ${added === 1 ? "Sunday" : "Sundays"}${skipped ? ` (${skipped} skipped: already booked)` : ""}`
  return mutationOk(label, cleared)
}

/**
 * Mark bookings CONFIRMED or CANCELLED in bulk (`canEdit`). Rows already in the target status are skipped.
 * Cancelling can also email the venue a cancellation notice (not undone if the email fails).
 * @param ids VenueUsage ids (1 to 200)
 * @param status target status
 * @param opts `emailVenue`: send the cancellation notice (CANCELLED only)
 */
export async function setVenueUsageStatus(
  ids: number[],
  status: "CONFIRMED" | "CANCELLED",
  opts: { emailVenue?: boolean } = {},
): Promise<VenueMutationResult> {
  const emailVenue = status === "CANCELLED" && !!opts.emailVenue
  if (emailVenue) {
    const demo = assertNotDemo()
    if (demo) return demo
  }
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" }
  if (ids.length === 0) return { error: "Select at least one booking" }
  if (ids.length > MAX_ROWS_PER_MONTH) return { error: "Too many bookings selected" }
  if (!ids.every(isValidPgId)) return { error: "Invalid booking" }
  const settings = await readVenueUsageSettings()
  if (!settings.enabled) return { error: "Venue usage is not enabled" }

  const userId = actorId(session)
  const uniqueIds = Array.from(new Set(ids))
  const result = await prisma.$transaction(async (tx) => {
    const rows = await tx.venueUsage.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, date: true, startTime: true, endTime: true, status: true, venueNotifiedAt: true, bookingRequestedAt: true },
    })
    if (rows.length !== uniqueIds.length) return null
    const toChange = rows.filter((r) => r.status !== status)
    if (toChange.length === 0) return { changed: [] as typeof rows, cleared: [] as string[] }
    await tx.venueUsage.updateMany({ where: { id: { in: toChange.map((r) => r.id) } }, data: { status } })
    const months = await clearApprovalTx(tx, toChange.map((r) => monthOfDate(r.date)), userId)
    await logAuditManyTx(tx, toChange.map((r) => ({
      userId, action: "VENUE_USAGE_STATUS_CHANGED", resourceType: "VenueUsage", resourceId: r.id,
      metadata: { date: utcDateToYmd(r.date), from: r.status, to: status },
    })))
    return { changed: toChange, cleared: months }
  })
  if (!result) return { error: "Booking not found" }
  const { changed, cleared } = result
  revalidatePath("/venue-usage")
  if (changed.length === 0) return { error: "No bookings to change" }
  const noun = changed.length === 1 ? "date" : "dates"
  const base = mutationOk(`${status === "CANCELLED" ? "Cancelled" : "Confirmed"} ${changed.length} ${noun}`, cleared) as Extract<VenueMutationResult, { success: string }>
  if (!emailVenue) return base
  // Only tell the venue about dates they knew: included in a sent booking request (ever), claimed by a request (fallback if the notified stamp failed), or previously confirmed.
  const known = changed.filter((r) => r.venueNotifiedAt !== null || r.bookingRequestedAt !== null || r.status === "CONFIRMED")
  if (known.length === 0) {
    return { ...base, success: `${base.success}. The venue was not emailed: none of these dates had been shared with them.` }
  }
  return { ...base, ...(await emailCancellation(settings, known, userId)) }
}

/**
 * Audit-log after the fact without ever throwing: the action's outcome is already decided.
 * @param userId acting user id
 * @param action audit action name
 * @param count number of bookings concerned
 */
async function auditCancellationEmail(userId: number, action: string, count: number): Promise<void> {
  try {
    await logAudit(userId, action, "VenueUsage", undefined, { count })
  } catch (err) {
    console.error("Venue cancellation audit failed", err)
  }
}

/**
 * Send the cancellation notice to the venue; returns a `warning` on any failure (the cancellation itself already committed and stands).
 * Lookups, email build and send all sit inside one guard; audit logging has its own guard so it cannot change the outcome.
 * @param settings venue settings
 * @param rows the rows that were just cancelled
 * @param userId acting user id
 */
async function emailCancellation(settings: VenueUsageSettings, rows: VenueUsageLine[], userId: number): Promise<{ warning?: string }> {
  try {
    const [actor, church] = await Promise.all([loadActor(userId), getChurchSettings()])
    const { to, cc, replyTo } = bookingRecipients(settings, actor)
    if (!to) return { warning: "Could not email the venue: no contact email is set." }
    const mail = buildCancellationEmail({ churchName: church.name, venueName: settings.venueName, contactName: settings.contactName, cancelled: rows, senderName: actor.name })
    await sendVenueUsageRequestEmail({ to, cc: cc.length ? cc.join(", ") : undefined, replyTo: replyTo || undefined, ...mail })
  } catch {
    await auditCancellationEmail(userId, "VENUE_CANCELLATION_EMAIL_FAILED", rows.length)
    return { warning: "Could not email the venue. The dates are cancelled; let them know another way." }
  }
  await auditCancellationEmail(userId, "VENUE_CANCELLATION_EMAILED", rows.length)
  return {}
}

const OptionalEmail = z.union([z.literal(""), z.string().max(254).refine(isValidEmail, "Enter a valid email address")])

const SettingsSchema = z.object({
  enabled: z.string().optional().transform((v) => v === "on" || v === "true"),
  venueName: z.string().trim().max(200, "Venue name is too long"),
  contactName: z.string().trim().max(200, "Contact name is too long"),
  contactEmail: OptionalEmail,
  ccEmail: OptionalEmail,
  replyToEmail: OptionalEmail,
  bookingCcEmails: z
    .string()
    .max(1000, "Booking CC list is too long")
    .superRefine((v, ctx) => {
      const r = parseCcList(v)
      if (!r.ok) ctx.addIssue({ code: "custom", message: r.error })
    })
    .default(""),
})

/**
 * Save the venue usage settings (one form). ADMIN only; blocked in demo mode.
 * Enabling requires a venue contact email. The booking CC list is validated and
 * stored normalised (comma-joined, de-duplicated, max 10).
 */
export async function updateVenueUsageSettings(
  _prev: ActionResultWithSuccess,
  formData: FormData,
): Promise<ActionResultWithSuccess> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }

  const parsed = SettingsSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const v = parsed.data
  if (v.enabled && !v.contactEmail) return { error: "Enter the venue contact email to enable venue usage" }

  const entries: { key: (typeof VENUE_USAGE_SETTING_KEYS)[number]; value: string }[] = [
    { key: "venueUsage.enabled", value: v.enabled ? "true" : "false" },
    { key: "venueUsage.venueName", value: v.venueName },
    { key: "venueUsage.contactName", value: v.contactName },
    { key: "venueUsage.contactEmail", value: v.contactEmail },
    { key: "venueUsage.ccEmail", value: v.ccEmail },
    { key: "venueUsage.replyToEmail", value: v.replyToEmail },
    { key: "venueUsage.bookingCcEmails", value: (parseCcList(v.bookingCcEmails) as { ok: true; list: string[] }).list.join(", ") },
  ]
  await Promise.all(
    entries.map((e) =>
      prisma.appSetting.upsert({ where: { key: e.key }, create: e, update: { value: e.value } }),
    ),
  )
  // Keys only: values hold email addresses.
  await logAudit(actorId(session), "SETTING_UPDATED", "AppSetting", undefined, { keys: entries.map((e) => e.key) })
  revalidatePath("/settings")
  revalidatePath("/", "layout")
  return { success: "Venue usage settings saved" }
}

/**
 * Preview the invoice-request email for a month (`canEdit`; feature must be enabled).
 * @param month "YYYY-MM"
 */
export async function getVenueRequestPreview(month: string): Promise<VenueRequestPreview | { error: string }> {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidMonth(month)) return { error: "Invalid month" }
  const p = await prepareInvoiceRequest(month, await loadActor(actorId(session)))
  if (!p.settings.enabled) return { error: "Venue usage is not enabled" }

  let blockedReason: string | null = null
  if (!p.to) blockedReason = "Set the venue contact email in Settings first"
  else if (p.rows.length === 0) blockedReason = "No confirmed bookings in this month"
  const isCurrentMonth = month === sydneyTodayYMD().slice(0, 7)
  return {
    month,
    subject: p.subject,
    text: p.text,
    to: p.to,
    cc: p.cc.join(", "),
    replyTo: p.replyTo,
    rowCount: p.rows.length,
    totalHours: totalHours(p.rows),
    blockedReason,
    last: p.last
      ? { status: p.last.status, sentAt: p.last.sentAt?.toISOString() ?? null, errorMessage: p.last.errorMessage }
      : null,
    isCurrentMonth,
    autoSendLabel: autoSendLabel(month),
    approval: p.last?.approvedAt ? { approvedAt: p.last.approvedAt.toISOString(), approvedBy: p.last.approvedByName } : null,
    canApprove: isCurrentMonth && p.completeness.complete && !!p.to && p.last?.status !== "SUCCESS",
    warnings: describeIncomplete(p.completeness),
    autoSent: p.last?.autoSent ?? false,
  }
}

/**
 * Email the venue contact asking for the month's invoice (`canEdit`). Always
 * records the attempt in `VenueUsageRequest` (also on failure). Refuses when the
 * feature is off, no contact email is set, or the month has no CONFIRMED rows;
 * a month already sent successfully needs `resend: true`.
 * @param month "YYYY-MM"
 * @param resend explicit confirmation to send again after a prior SUCCESS
 */
export async function sendVenueUsageRequest(month: string, resend = false): Promise<ActionResultWithSuccess> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidMonth(month)) return { error: "Invalid month" }

  const userId = actorId(session)
  const p = await prepareInvoiceRequest(month, await loadActor(userId))
  if (!p.settings.enabled) return { error: "Venue usage is not enabled" }
  if (!p.to) return { error: "Set the venue contact email in Settings first" }
  if (p.rows.length === 0) return { error: "No confirmed bookings in this month" }
  if (p.last?.status === "SUCCESS" && !resend) {
    return { error: "A request for this month was already sent. Confirm to send it again." }
  }

  const { status, recorded } = await deliverInvoiceRequest(p, { month, userId, autoSent: false, resend })
  revalidatePath("/venue-usage")
  if (status === "FAILED") return { error: "Could not send the email. Check email settings and try again." }
  // The invoice has been requested by hand: a pending automatic-send approval is now moot. The email has
  // already gone, so a failure here must not surface as an error (the user would send again).
  try {
    await prisma.venueUsageRequest.updateMany({ where: { month }, data: { approvedAt: null, approvedById: null } })
  } catch (e) {
    logger.error("[venueUsage] could not clear approval after manual send", { month, error: e instanceof Error ? e.message : String(e) })
  }
  if (!recorded) {
    return { success: "Invoice request sent, but it could not be recorded. Do not send it again; check the venue's inbox before retrying." }
  }
  return { success: "Invoice request sent" }
}
