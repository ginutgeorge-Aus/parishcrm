"use server"

import { z } from "zod"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { canEdit, isAdmin, canViewPeople } from "@/lib/roleGuard"
import { canManageEvent } from "@/lib/eventManager"
import { isValidPgId, isValidEmail } from "@/lib/validation"
import { logAudit } from "@/lib/audit"
import { actorId } from "@/lib/actor"
import { safeDecrypt, encrypt } from "@/lib/crypto"
import { toAnswerMap } from "@/lib/eventAnswers"
import { formatAnswerForCsv, isAttendeeScoped, isQuestionApplicable, type CustomQuestion } from "@/lib/eventQuestions"
import { sendPaymentReminderEmail } from "@/lib/email"
import { getChurchName } from "@/lib/emailTemplateStore"
import { fmtAUD } from "@/lib/formatting"
import { toFloat } from "@/lib/utils"
import { logger } from "@/lib/logger"

import type { ActionResult } from "./types"

export async function markPaid(registrationId: number, eventId: number): Promise<ActionResult> {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" }

  const reg = await prisma.registration.findUnique({ where: { id: registrationId }, select: { eventId: true, paymentStatus: true } })
  if (!reg || reg.eventId !== eventId) return { error: "Registration not found" }

  // State machine: already PAID → idempotent no-op (no re-write, no duplicate
  // audit); CANCELLED → block (a cancelled reg must be re-activated deliberately,
  // never silently flipped back to PAID).
  if (reg.paymentStatus === "PAID") return
  if (reg.paymentStatus === "CANCELLED") return { error: "Cannot mark a cancelled registration as paid" }

  // Guarded transition — only flip a still-PENDING row (updateMany with the
  // source state in the predicate). The read above can go stale: a concurrent
  // cancelRegistration between it and this write would otherwise be silently
  // overwritten back to PAID. count === 0 means we lost that race — the
  // row is no longer PENDING, so re-derive the terminal outcome.
  const res = await prisma.registration.updateMany({
    where: { id: registrationId, eventId, paymentStatus: "PENDING" },
    data: { paymentStatus: "PAID" },
  })
  if (res.count === 0) {
    const cur = await prisma.registration.findUnique({ where: { id: registrationId }, select: { paymentStatus: true } })
    if (cur?.paymentStatus === "PAID") return
    return { error: "Cannot mark a cancelled registration as paid" }
  }
  await logAudit(actorId(session), "REGISTRATION_PAID", "Registration", registrationId, { eventId })
  revalidatePath(`/events/${eventId}/registrations`)
}

export async function cancelRegistration(registrationId: number, eventId: number): Promise<ActionResult> {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" }

  const reg = await prisma.registration.findUnique({ where: { id: registrationId }, select: { eventId: true, paymentStatus: true } })
  if (!reg || reg.eventId !== eventId) return { error: "Registration not found" }

  // Already CANCELLED → idempotent no-op. PENDING or PAID → cancel (cancelling a
  // PAID registration is a legitimate refund path).
  if (reg.paymentStatus === "CANCELLED") return

  // Guarded updateMany: the row may be deleted (resetEventRegistrations) or
  // cancelled concurrently after the read above; update() would throw P2025.
  const res = await prisma.registration.updateMany({
    where: { id: registrationId, eventId, paymentStatus: { not: "CANCELLED" } },
    data: { paymentStatus: "CANCELLED" },
  })
  if (res.count === 0) {
    const cur = await prisma.registration.findUnique({ where: { id: registrationId }, select: { paymentStatus: true } })
    if (cur?.paymentStatus === "CANCELLED") return
    return { error: "Registration not found" }
  }
  await logAudit(actorId(session), "REGISTRATION_CANCELLED", "Registration", registrationId, { eventId })
  revalidatePath(`/events/${eventId}/registrations`)
}

export async function toggleAttendeeCheckIn(
  attendeeId: number,
  eventId: number,
  checkIn: boolean,
): Promise<ActionResult> {
  const session = await auth()
  // Editors keep full access; an EVENT_ORGANISER assigned to this specific
  // event may also check attendees in on the day — the whole
  // organiser-delegation feature exists to let a non-admin volunteer run
  // their event, and check-in is the one action day-of that only admins
  // could previously perform.
  if (!session?.user || !(await canManageEvent(parseInt(session.user.id, 10), eventId, session.user.role))) {
    return { error: "Unauthorized" }
  }

  // IDOR: the attendee must belong to a registration of this event.
  const attendee = await prisma.attendee.findUnique({
    where: { id: attendeeId },
    select: { registrationItem: { select: { registration: { select: { eventId: true } } } } },
  })
  if (!attendee || attendee.registrationItem.registration.eventId !== eventId) {
    return { error: "Attendee not found" }
  }

  await prisma.attendee.update({
    where: { id: attendeeId },
    data: { checkedInAt: checkIn ? new Date() : null },
  })
  await logAudit(actorId(session), checkIn ? "ATTENDEE_CHECKED_IN" : "ATTENDEE_CHECKED_OUT", "Attendee", attendeeId, { eventId })
  revalidatePath(`/events/${eventId}/check-in`)
  revalidatePath(`/my-events/${eventId}/check-in`)
}

// Hard-delete all registrations for a DRAFT event, giving admins a clean slate
// after they test the public links + payment flow before sharing. Two guards
// (ADMIN-only + unpublished-only) make it impossible to wipe real public
// registrations — post-publish, cancelRegistration is the only removal path.
export async function resetEventRegistrations(eventId: number): Promise<ActionResult> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(eventId)) return { error: "Invalid event" }

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, isPublished: true },
  })
  if (!event) return { error: "Event not found" }
  // Re-check server-side — never trust the client-hidden button; the event
  // could have been published between page render and click.
  if (event.isPublished) return { error: "This event is published — reset is disabled." }

  // Guard on registration HISTORY, not publish state: isPublished alone
  // is a reversible one-click toggle, so a published event that already took
  // PAID Stripe registrations could be unpublished then reset — an irreversible
  // loss of paid records under the no-refund policy. Refuse (and delete nothing)
  // if any non-CANCELLED registration exists — that covers PENDING and PAID —
  // regardless of the event's current publish state.
  const activeRegistrations = await prisma.registration.count({
    where: { eventId, paymentStatus: { not: "CANCELLED" } },
  })
  if (activeRegistrations > 0) {
    return { error: "This event has registrations — cancel them individually before resetting." }
  }
  // Also refuse while a card checkout is in flight — the delete below
  // cascades CheckoutSession rows, so resetting while a customer is on Stripe
  // Checkout would strand the paid webhook with no staging row. Mirrors
  // deleteEvent's OPEN-checkout guard.
  const openCheckouts = await prisma.checkoutSession.count({
    where: { eventId, status: "OPEN" },
  })
  if (openCheckouts > 0) {
    return { error: "A payment is in progress — wait for it to finish before resetting." }
  }

  // RegistrationItem + Attendee cascade via schema onDelete: Cascade. One
  // transaction so a mid-way failure leaves nothing half-deleted.
  const [regs, waitlist, checkouts] = await prisma.$transaction([
    prisma.registration.deleteMany({ where: { eventId } }),
    prisma.waitlist.deleteMany({ where: { eventId } }),
    prisma.checkoutSession.deleteMany({ where: { eventId } }),
  ])

  await logAudit(actorId(session), "EVENT_REGISTRATIONS_RESET", "Event", eventId, {
    deletedRegistrations: regs.count,
    deletedWaitlist: waitlist.count,
    deletedCheckouts: checkouts.count,
  })
  revalidatePath(`/events/${eventId}/registrations`)
}

type LabelledAnswer = { label: string; value: string }
type RegistrationAttendeeDTO = {
  name: string
  ticketType: string
  checkedIn: boolean
  answers: LabelledAnswer[]
}
export type RegistrationDetailDTO = {
  id: number
  firstName: string
  lastName: string
  email: string
  phone: string | null
  totalAmount: number
  paymentStatus: string
  paymentMethod: string
  orderAnswers: LabelledAnswer[]
  attendees: RegistrationAttendeeDTO[]
}
export type RegistrationDetailResult = { data: RegistrationDetailDTO } | { error: string }

// Card registrations are created by the Stripe webhook with a PaymentIntent id in
// paymentRef; bank-transfer / cash bookings have none. Mirrors RegistrationsTable.
function paymentMethodOf(paymentRef: string | null): string {
  return paymentRef ? "Card" : "Bank transfer"
}

// Event.customQuestions is Prisma Json — validate the shape at the boundary
// and keep only the fields answer-labelling needs: id/label/type/scope/ticketTypeNames.
function coerceStoredQuestions(raw: unknown): CustomQuestion[] {
  if (!Array.isArray(raw)) return []
  const out: CustomQuestion[] = []
  for (const q of raw) {
    if (!q || typeof q !== "object") continue
    const o = q as Record<string, unknown>
    if (typeof o.id !== "string" || typeof o.label !== "string") continue
    out.push({
      id: o.id,
      label: o.label,
      required: o.required === true,
      type: (typeof o.type === "string" ? o.type : "text") as CustomQuestion["type"],
      scope: o.scope === "attendee" ? "attendee" : "order",
      ticketTypeNames: Array.isArray(o.ticketTypeNames) ? o.ticketTypeNames.filter((n): n is string => typeof n === "string") : undefined,
    })
  }
  return out
}

// Read-only drill-down into one registration for the admin detail dialog.
// Decrypts registrant PII + custom answers server-side and returns a plain DTO —
// never ciphertext. Authz matches BOTH entry points of RegistrationsTable: staff
// via canViewPeople and an assigned organiser via canManageEvent.
export async function getRegistrationDetail(registrationId: number): Promise<RegistrationDetailResult> {
  const session = await auth()
  const notFound = { error: "Registration not found" }
  if (!session?.user) return notFound
  if (!isValidPgId(registrationId)) return notFound

  // Probe the parent event id first — authorize before fetching/decrypting PII.
  const probe = await prisma.registration.findUnique({
    where: { id: registrationId },
    select: { eventId: true },
  })
  if (!probe) return notFound

  const userId = parseInt(session.user.id, 10)
  const allowed =
    canViewPeople(session.user.role) ||
    (await canManageEvent(userId, probe.eventId, session.user.role))
  if (!allowed) return notFound   // generic — never leak existence to a denied caller

  const reg = await prisma.registration.findFirst({
    where: { id: registrationId },
    include: {
      items: { include: { attendees: true, ticketType: { select: { name: true } } } },
      event: { select: { customQuestions: true } },
    },
  })
  if (!reg) return notFound

  const questions = coerceStoredQuestions(reg.event.customQuestions)
  const selectedNames = new Set(reg.items.map(i => i.ticketType.name))

  const orderMap = toAnswerMap(reg.customAnswers)
  const orderAnswers: LabelledAnswer[] = questions
    .filter(q => !isAttendeeScoped(q) && isQuestionApplicable(q, selectedNames))
    .map(q => ({ label: q.label, value: formatAnswerForCsv(orderMap?.[q.id], q.type) }))
    .filter(a => a.value !== "")

  const attendees: RegistrationAttendeeDTO[] = reg.items.flatMap(item =>
    item.attendees.map(a => {
      const map = toAnswerMap(a.answers)
      const answers = questions
        .filter(q => isAttendeeScoped(q) && isQuestionApplicable(q, new Set([item.ticketType.name])))
        .map(q => ({ label: q.label, value: formatAnswerForCsv(map?.[q.id], q.type) }))
        .filter(v => v.value !== "")
      return { name: a.name, ticketType: item.ticketType.name, checkedIn: a.checkedInAt != null, answers }
    }),
  )

  await logAudit(actorId(session), "VIEW_REGISTRATION", "Registration", registrationId, { eventId: probe.eventId })

  return {
    data: {
      id: reg.id,
      firstName: reg.firstName,
      lastName: reg.lastName,
      email: reg.email ? safeDecrypt(reg.email) : "",
      phone: reg.phone ? safeDecrypt(reg.phone) : null,
      totalAmount: Number(reg.totalAmount),
      paymentStatus: reg.paymentStatus,
      paymentMethod: paymentMethodOf(reg.paymentRef),
      orderAnswers,
      attendees,
    },
  }
}

const MAX_REMINDER_BATCH_SIZE = 200

export type ReminderRow = { registrationId: number }
export type SendRemindersResult =
  | { error: string }
  | { sent: number; failed: number; errors: { registrationId: number; error: string }[] }

// Only the body is operator-authored. The subject is fixed server-side
// (`Payment pending — <event title>`) — a free-text subject would let PII/amounts
// reach mail-server logs, which store subjects in plaintext.
const reminderTextSchema = z.object({
  message: z.string().trim().min(1, "Message is required").max(5000),
})

// Bulk payment-reminder send for an event organiser/admin. Every attempt
// is re-validated server-side (status/email/amount) — the client's selection is
// only ever a list of ids, never trusted for content. Each send writes its own
// tracking row immediately (not a trailing createMany) so an interrupted batch
// never loses a record of what was actually sent.
export async function sendPaymentReminders(
  eventId: number,
  rows: ReminderRow[],
  message: string
): Promise<SendRemindersResult> {
  const session = await auth()
  const userId = parseInt(session?.user?.id ?? "", 10)
  if (Number.isNaN(userId) || !(await canManageEvent(userId, eventId, session?.user?.role))) {
    return { error: "Unauthorized" }
  }
  const text = reminderTextSchema.safeParse({ message })
  if (!text.success) return { error: text.error.issues[0].message }
  if (rows.length > MAX_REMINDER_BATCH_SIZE) return { error: `Max ${MAX_REMINDER_BATCH_SIZE} per batch` }
  if (rows.length === 0) return { sent: 0, failed: 0, errors: [] }

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, title: true, slug: true },
  })
  if (!event) return { error: "Event not found" }

  // Validate the base URL once, up front — a misconfigured base must fail loudly
  // before we email anyone. The per-recipient success URL is built in the loop.
  const base = process.env.AUTH_URL || process.env.NEXTAUTH_URL || ""
  try {
    new URL(`/e/${event.slug}`, base)
  } catch {
    return { error: "Server misconfiguration: AUTH_URL is not set or invalid" }
  }

  const ids = Array.from(new Set(rows.map((r) => r.registrationId)))
  // Event-scoped fetch — a registration id from another event is filtered out
  // here (IDOR guard); status/email/amount are re-derived server-side, never
  // trusted from the client.
  const regs = await prisma.registration.findMany({
    where: { id: { in: ids }, eventId },
    select: { id: true, firstName: true, email: true, paymentStatus: true, totalAmount: true, publicToken: true },
  })
  const byId = new Map(regs.map((r) => [r.id, r]))

  const sentById = actorId(session)
  const churchName = await getChurchName()
  let sent = 0
  let failed = 0
  const errors: { registrationId: number; error: string }[] = []

  for (const registrationId of ids) {
    const reg = byId.get(registrationId)
    if (!reg) { failed++; errors.push({ registrationId, error: "Registration not found" }); continue }
    if (reg.paymentStatus !== "PENDING") {
      failed++; errors.push({ registrationId, error: "No longer pending" }); continue
    }
    const email = reg.email ? safeDecrypt(reg.email) : ""
    if (!isValidEmail(email)) {
      failed++; errors.push({ registrationId, error: "No valid email" }); continue
    }
    const eventUrl = new URL(`/e/${event.slug}/success?ref=${reg.publicToken}`, base).toString()
    try {
      await sendPaymentReminderEmail(email, {
        churchName,
        eventTitle: event.title,
        recipientName: reg.firstName,
        amountDue: fmtAUD(toFloat(reg.totalAmount)),
        message: text.data.message,
        eventUrl,
      })
    } catch {
      // Delivery failed — the email did NOT go out. Never log the raw error:
      // nodemailer/SMTP messages embed the recipient address. Log
      // a stable message + the non-PII registrationId only.
      logger.error("[reminder] sendPaymentReminders failed", { registrationId })
      try {
        await prisma.paymentReminderSend.create({
          data: { registrationId, sentTo: encrypt(email), sentById, status: "FAILED", errorMessage: "Email delivery failed" },
        })
      } catch (writeErr) {
        // A DB error persisting the FAILED row must not abort the remaining rows
        // or skip the final logAudit — log and carry on (mirror receipt.ts).
        logger.error("[reminder] failed to persist FAILED paymentReminderSend", { error: writeErr instanceof Error ? writeErr.message : String(writeErr) })
      }
      failed++
      errors.push({ registrationId, error: "Email delivery failed" })
      continue
    }
    // Delivered. Persist the SUCCESS row separately — a tracking-write failure
    // here must NOT be caught as a delivery failure (the email already went out)
    // nor abort the batch. Count it as sent regardless, so any retry is driven by
    // real delivery state, never a lost DB write.
    try {
      await prisma.paymentReminderSend.create({
        data: { registrationId, sentTo: encrypt(email), sentById, status: "SUCCESS" },
      })
    } catch (writeErr) {
      logger.error("[reminder] failed to persist SUCCESS paymentReminderSend", { error: writeErr instanceof Error ? writeErr.message : String(writeErr) })
    }
    sent++
  }

  await logAudit(sentById, "EVENT_PAYMENT_REMINDER_SENT", "Event", eventId, { sent, failed })
  revalidatePath(`/events/${eventId}/registrations`)
  revalidatePath(`/my-events/${eventId}/registrations`)
  return { sent, failed, errors }
}

// registrationId -> ISO timestamp of the latest SUCCESS reminder, for PENDING regs only.
export async function lastRemindedAtByRegistration(eventId: number): Promise<Record<number, string>> {
  // Exported from a "use server" module = a callable endpoint. Gate it the same
  // as sendPaymentReminders — without this any authenticated session could
  // enumerate reminder activity for an arbitrary event. Unauthorized → empty
  // (the calling pages are already access-gated, so legit callers pass).
  const session = await auth()
  const userId = parseInt(session?.user?.id ?? "", 10)
  if (Number.isNaN(userId) || !(await canManageEvent(userId, eventId, session?.user?.role))) {
    return {}
  }
  const grouped = await prisma.paymentReminderSend.groupBy({
    by: ["registrationId"],
    where: { status: "SUCCESS", registration: { eventId, paymentStatus: "PENDING" } },
    _max: { sentAt: true },
  })
  const out: Record<number, string> = {}
  for (const g of grouped) {
    if (g._max.sentAt) out[g.registrationId] = g._max.sentAt.toISOString()
  }
  return out
}
