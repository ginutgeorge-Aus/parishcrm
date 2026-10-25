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
import { bookingRecipients, deliverInvoiceRequest, loadActor, MAX_ROWS_PER_MONTH, prepareInvoiceRequest } from "@/lib/venueInvoice"
import { buildCancellationEmail, parseCcList, sundaysInMonth, utcDateToYmd } from "@/lib/venueUsage"
import type { VenueUsageLine } from "@/lib/venueUsage"
import { readVenueUsageSettings } from "@/lib/venueUsageSettings"
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
 * Create a venue usage row. ADMIN/PASTOR/OFFICE_ADMIN (`canEdit`); feature must be enabled.
 * Clears the approval of the row's month (same transaction) when it was approved and unsent.
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
  const cleared = await prisma.$transaction(async (tx) => {
    const row = await tx.venueUsage.create({
      data: { ...rest, date: ymdToUtcDate(date), createdById: userId },
      select: { id: true },
    })
    const months = await clearApprovalTx(tx, [date.slice(0, 7)], userId)
    await logAuditTx(tx, userId, "VENUE_USAGE_CREATED", "VenueUsage", row.id, { date, status: rest.status })
    return months
  })
  revalidatePath("/venue-usage")
  return mutationOk("Booking added", cleared)
}

/**
 * Update a venue usage row (`canEdit`). A date move clears the approval of both the old and new month.
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
  const existing = await prisma.venueUsage.findUnique({ where: { id }, select: { id: true, date: true } })
  if (!existing) return { error: "Booking not found" }
  const { date, ...rest } = parsed.data

  const userId = actorId(session)
  const cleared = await prisma.$transaction(async (tx) => {
    await tx.venueUsage.update({ where: { id }, data: { ...rest, date: ymdToUtcDate(date) }, select: { id: true } })
    const months = await clearApprovalTx(tx, [monthOfDate(existing.date), date.slice(0, 7)], userId)
    await logAuditTx(tx, userId, "VENUE_USAGE_UPDATED", "VenueUsage", id, { date, status: rest.status })
    return months
  })
  revalidatePath("/venue-usage")
  return mutationOk("Booking updated", cleared)
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

  const existing = await prisma.venueUsage.findUnique({ where: { id }, select: { id: true, date: true } })
  if (!existing) return { error: "Booking not found" }
  const userId = actorId(session)
  const cleared = await prisma.$transaction(async (tx) => {
    await tx.venueUsage.delete({ where: { id } })
    const months = await clearApprovalTx(tx, [monthOfDate(existing.date)], userId)
    await logAuditTx(tx, userId, "VENUE_USAGE_DELETED", "VenueUsage", id, { date: utcDateToYmd(existing.date) })
    return months
  })
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
  const { added, cleared } = await prisma.$transaction(async (tx) => {
    const existing = await tx.venueUsage.findMany({
      where: { date: { in: sundays.map(ymdToUtcDate) }, status: { not: "CANCELLED" } },
      select: { date: true },
      take: MAX_ROWS_PER_MONTH,
    })
    const taken = new Set(existing.map((e) => utcDateToYmd(e.date)))
    const free = sundays.filter((s) => !taken.has(s))
    if (free.length === 0) return { added: 0, cleared: [] as string[] }
    await tx.venueUsage.createMany({
      data: free.map((s) => ({ date: ymdToUtcDate(s), startTime, endTime, status: "REQUESTED" as const, purpose, createdById: userId })),
    })
    const months = await clearApprovalTx(tx, [month], userId)
    await logAuditTx(tx, userId, "VENUE_USAGE_BULK_ADDED", "VenueUsage", undefined, { month, added: free.length, skipped: sundays.length - free.length })
    return { added: free.length, cleared: months }
  })
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
      select: { id: true, date: true, startTime: true, endTime: true, status: true },
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
  return { ...base, ...(await emailCancellation(settings, changed, userId)) }
}

/**
 * Send the cancellation notice to the venue; returns a `warning` on failure (the cancellation itself stands).
 * @param settings venue settings
 * @param rows the rows that were just cancelled
 * @param userId acting user id
 */
async function emailCancellation(settings: VenueUsageSettings, rows: VenueUsageLine[], userId: number): Promise<{ warning?: string }> {
  const [actor, church] = await Promise.all([loadActor(userId), getChurchSettings()])
  const { to, cc, replyTo } = bookingRecipients(settings, actor)
  if (!to) return { warning: "Could not email the venue: no contact email is set." }
  const mail = buildCancellationEmail({ churchName: church.name, venueName: settings.venueName, contactName: settings.contactName, cancelled: rows, senderName: actor.name })
  try {
    await sendVenueUsageRequestEmail({ to, cc: cc.length ? cc.join(", ") : undefined, replyTo: replyTo || undefined, ...mail })
    await logAudit(userId, "VENUE_CANCELLATION_EMAILED", "VenueUsage", undefined, { count: rows.length })
    return {}
  } catch {
    await logAudit(userId, "VENUE_CANCELLATION_EMAIL_FAILED", "VenueUsage", undefined, { count: rows.length })
    return { warning: "Could not email the venue. The dates are cancelled; let them know another way." }
  }
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

  const { status } = await deliverInvoiceRequest(p, { month, userId, autoSent: false, resend })
  revalidatePath("/venue-usage")
  if (status === "FAILED") return { error: "Could not send the email. Check email settings and try again." }
  return { success: "Invoice request sent" }
}
