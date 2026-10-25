"use server"

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { actorId } from "@/lib/actor"
import { canEdit, isAdmin } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { assertNotDemo } from "@/lib/demoMode"
import { isValidEmail, isValidPgId } from "@/lib/validation"
import { deliverInvoiceRequest, loadActor, prepareInvoiceRequest } from "@/lib/venueInvoice"
import { parseCcList } from "@/lib/venueUsage"
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

/**
 * Create a venue usage row. ADMIN/PASTOR/OFFICE_ADMIN (`canEdit`); feature must be enabled.
 * @param input date, times, status, purpose and notes
 */
export async function createVenueUsage(input: VenueUsageInput): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" }
  const settings = await readVenueUsageSettings()
  if (!settings.enabled) return { error: "Venue usage is not enabled" }

  const parsed = UsageSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const { date, ...rest } = parsed.data

  const userId = actorId(session)
  const row = await prisma.venueUsage.create({
    data: { ...rest, date: ymdToUtcDate(date), createdById: userId },
    select: { id: true },
  })
  await logAudit(userId, "VENUE_USAGE_CREATED", "VenueUsage", row.id, { date, status: rest.status })
  revalidatePath("/venue-usage")
  return { success: "Booking added" }
}

/**
 * Update a venue usage row (`canEdit`).
 * @param id VenueUsage id
 * @param input new field values
 */
export async function updateVenueUsage(id: number, input: VenueUsageInput): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(id)) return { error: "Invalid booking" }
  const settings = await readVenueUsageSettings()
  if (!settings.enabled) return { error: "Venue usage is not enabled" }

  const parsed = UsageSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const existing = await prisma.venueUsage.findUnique({ where: { id }, select: { id: true } })
  if (!existing) return { error: "Booking not found" }
  const { date, ...rest } = parsed.data

  await prisma.venueUsage.update({ where: { id }, data: { ...rest, date: ymdToUtcDate(date) } })
  await logAudit(actorId(session), "VENUE_USAGE_UPDATED", "VenueUsage", id, { date, status: rest.status })
  revalidatePath("/venue-usage")
  return { success: "Booking updated" }
}

/**
 * Delete a venue usage row (`canEdit`).
 * @param id VenueUsage id
 */
export async function deleteVenueUsage(id: number): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(id)) return { error: "Invalid booking" }
  const settings = await readVenueUsageSettings()
  if (!settings.enabled) return { error: "Venue usage is not enabled" }

  const existing = await prisma.venueUsage.findUnique({ where: { id }, select: { id: true, date: true } })
  if (!existing) return { error: "Booking not found" }
  await prisma.venueUsage.delete({ where: { id } })
  await logAudit(actorId(session), "VENUE_USAGE_DELETED", "VenueUsage", id, {
    date: existing.date.toISOString().slice(0, 10),
  })
  revalidatePath("/venue-usage")
  return { success: "Booking deleted" }
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
