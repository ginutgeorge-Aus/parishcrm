"use server"

import { auth } from "@/auth"
import { logger } from "@/lib/logger"
import { actorId } from "@/lib/actor"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { canEdit, isAdmin } from "@/lib/roleGuard"
import { syncEventToWebsite, syncEventDeletion, resyncAllEvents } from "@/lib/websiteSync"
import { logAudit } from "@/lib/audit"
import { parseOptimisticUpdatedAt, isValidPgId, isP2034 } from "@/lib/validation"
import { Prisma } from "@/lib/generated/prisma/client"
import { EventImageKind } from "@/lib/generated/prisma/enums"
import {
  parseEventForm,
  eventData,
  parseImageUpload,
  applyImageOp,
  TICKET_TYPE_IN_USE,
  CAPACITY_BELOW_SOLD,
  STALE_EVENT,
} from "./eventForm"

import type { ActionResult, ActionResultWithSuccess } from "./types"

export async function createEvent(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" }

  const result = parseEventForm(formData)
  if ("error" in result) return { error: result.error }
  const { parsed, ticketTypes, customQuestions, organizers, tiers } = result

  const banner = await parseImageUpload(formData, "banner")
  if ("error" in banner) return { error: banner.error }
  const poster = await parseImageUpload(formData, "poster")
  if ("error" in poster) return { error: poster.error }

  let newEventId: number
  try {
    const event = await prisma.event.create({
      data: {
        ...eventData(parsed, tiers),
        customQuestions: customQuestions.length > 0 ? customQuestions : undefined,
        organizers: organizers.length > 0 ? organizers : undefined,
        ticketTypes: ticketTypes.length > 0
          ? { create: ticketTypes.map(({ name, price, capacity, countsTowardWaiver }) => ({ name, price, capacity, countsTowardWaiver })) }
          : undefined,
      },
    })
    newEventId = event.id
    // Intentionally non-atomic with event.create (brief-mandated): images are
    // applied via `prisma` right after the row exists, not wrapped in a shared
    // transaction. This asymmetry with updateEvent (which applies inside its
    // $transaction after the STALE_EVENT guard) is deliberate, not an oversight.
    await applyImageOp(prisma, event.id, EventImageKind.BANNER, banner)
    await applyImageOp(prisma, event.id, EventImageKind.POSTER, poster)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes("Unique constraint")) return { error: "Slug already in use" }
    throw e
  }

  await logAudit(actorId(session), "EVENT_CREATED", "Event", newEventId, {
    slug: parsed.slug,
  })
  await syncEventToWebsite(newEventId)
  // Without this, the new event can be missing from the /events list until a
  // hard reload — updateEvent/deleteEvent/publishEvent all revalidate "/events"
  // but createEvent never did.
  revalidatePath("/events")
  redirect(`/events/${newEventId}/edit`)
}

export async function updateEvent(id: number, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(id)) return { error: "Invalid event" }

  const result = parseEventForm(formData)
  if ("error" in result) return { error: result.error }
  const { parsed, ticketTypes, customQuestions, organizers, tiers } = result

  const banner = await parseImageUpload(formData, "banner")
  if ("error" in banner) return { error: banner.error }
  const poster = await parseImageUpload(formData, "poster")
  if ("error" in poster) return { error: poster.error }

  // Existence check: a non-existent id would otherwise surface a raw
  // Prisma P2025 as an unhandled 500.
  const exists = await prisma.event.findUnique({ where: { id }, select: { id: true } })
  if (!exists) return { error: "Event not found" }

  // Optimistic concurrency: the edit form submits the row's last-seen
  // updatedAt. Guard the write on it so two editors saving the same event
  // can't silently clobber each other — a mismatch matches 0 rows and the
  // caller is told to reload. Same pattern as person.ts::updatePerson.
  const seenAt = parseOptimisticUpdatedAt(formData)

  // Captured inside the $transaction callback; only valid for audit once the
  // transaction commits — every failure path below returns/throws before logAudit.
  let removedTicketTypeIds: number[] = []
  // The capacity-below-sold guard aggregates sold quantity then writes the lower
  // cap; a registration committed between those steps could consume a seat under
  // the old limit and leave the new cap below the true sold total. Run
  // the whole edit Serializable so it conflicts (P2034) with the equally
  // Serializable public registration txn (eventRegistrationPersist.ts) and retry.
  const MAX_TX_ATTEMPTS = 3
  for (let attempt = 1; ; attempt++) {
   try {
    // Diff ticket types instead of delete-all + recreate: existing rows
    // keep their ids so RegistrationItem FKs and unitPrice snapshots survive.
    await prisma.$transaction(async (tx) => {
      const existing = await tx.ticketType.findMany({
        where: { eventId: id },
        select: { id: true, capacity: true },
      })
      const existingIds = new Set(existing.map((t) => t.id))
      // Ids not belonging to this event are treated as new rows (IDOR guard).
      const keeps = ticketTypes.filter(
        (t): t is typeof t & { id: number } => t.id !== null && existingIds.has(t.id)
      )
      const creates = ticketTypes.filter((t) => t.id === null || !existingIds.has(t.id))
      const keptIds = new Set(keeps.map((t) => t.id))
      const removedIds = [...existingIds].filter((tid) => !keptIds.has(tid))
      removedTicketTypeIds = removedIds

      if (removedIds.length > 0) {
        const refs = await tx.registrationItem.count({
          where: { ticketTypeId: { in: removedIds } },
        })
        // Throw (not return) so the transaction rolls back.
        if (refs > 0) throw new Error(TICKET_TYPE_IN_USE)
        await tx.ticketType.deleteMany({ where: { id: { in: removedIds } } })
      }
      // Capacity lowered below already-sold quantity hides over-sold state and
      // corrupts the public capacity check. Only checked when the cap
      // tightens — an already over-sold but untouched value stays editable.
      const oldCapacityById = new Map(existing.map((t) => [t.id, t.capacity]))
      const tightened = keeps.filter((t) => {
        const oldCap = oldCapacityById.get(t.id) ?? null
        return t.capacity !== null && (oldCap === null || t.capacity < oldCap)
      })
      if (tightened.length > 0) {
        // One aggregate query for all tightened ticket types instead of one
        // per type — same shape as pettyCashImport.ts's batched writes.
        const sums = await tx.registrationItem.groupBy({
          by: ["ticketTypeId"],
          // Exclude CANCELLED registrations — a cancelled ticket frees
          // its seat, so counting it would wrongly block a valid capacity
          // reduction. Mirrors the public capacity re-check (eventRegistration.ts).
          where: {
            ticketTypeId: { in: tightened.map((t) => t.id) },
            registration: { paymentStatus: { not: "CANCELLED" } },
          },
          _sum: { quantity: true },
        })
        const soldById = new Map(sums.map((s) => [s.ticketTypeId, s._sum.quantity ?? 0]))
        for (const t of tightened) {
          const sold = soldById.get(t.id) ?? 0
          if (t.capacity! < sold) throw new Error(`${CAPACITY_BELOW_SOLD}:${sold}:${t.name}`)
        }
      }
      for (const t of keeps) {
        await tx.ticketType.update({
          where: { id: t.id },
          data: { name: t.name, price: t.price, capacity: t.capacity, countsTowardWaiver: t.countsTowardWaiver },
        })
      }
      if (creates.length > 0) {
        await tx.ticketType.createMany({
          data: creates.map((t) => ({ eventId: id, name: t.name, price: t.price, capacity: t.capacity, countsTowardWaiver: t.countsTowardWaiver })),
        })
      }
      const updateResult = await tx.event.updateMany({
        where: seenAt ? { id, updatedAt: seenAt } : { id },
        data: {
          ...eventData(parsed, tiers),
          // Empty array (not undefined) so removing every custom question
          // persists — undefined makes Prisma omit the column, leaving the old
          // questions in the DB. All readers guard with
          // Array.isArray(...) so [] reads identically to no questions.
          customQuestions: customQuestions.length > 0 ? customQuestions : [],
          // Empty array (not undefined) so removing every organiser persists —
          // same rationale as customQuestions above. Readers guard with
          // Array.isArray(...), so [] reads identically to "no organisers".
          organizers: organizers.length > 0 ? organizers : [],
        },
      })
      if (updateResult.count === 0) throw new Error(STALE_EVENT)

      await applyImageOp(tx, id, EventImageKind.BANNER, banner)
      await applyImageOp(tx, id, EventImageKind.POSTER, poster)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    break
   } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg === STALE_EVENT) {
      return {
        error: "This event was changed by someone else since you opened it. Reload the page and reapply your edit.",
      }
    }
    if (msg.includes("Unique constraint")) return { error: "Slug already in use" }
    // TICKET_TYPE_IN_USE = pre-checked; Foreign key = race backstop (FK Restrict).
    if (msg === TICKET_TYPE_IN_USE || msg.includes("Foreign key constraint"))
      return { error: "Cannot remove a ticket type that already has registrations" }
    if (msg.startsWith(CAPACITY_BELOW_SOLD)) {
      const [, sold, ...nameParts] = msg.split(":")
      return { error: `Cannot set ${nameParts.join(":")} capacity below ${sold} already sold` }
    }
    // Lost a serialization race to a concurrent registration — retry the whole
    // edit so the sold-quantity aggregate re-runs on fresh data.
    if (isP2034(e)) {
      if (attempt < MAX_TX_ATTEMPTS) continue
      return { error: "Someone is registering for this event right now — reload the page and reapply your edit." }
    }
    throw e
   }
  }

  await logAudit(actorId(session), "EVENT_UPDATED", "Event", id, {
    slug: parsed.slug,
    removedTicketTypeIds,
  })
  await syncEventToWebsite(id)
  revalidatePath(`/events/${id}/edit`)
  revalidatePath("/events")
  // ?saved=1 lets the edit page flash a success banner — the redirect back to
  // this same page otherwise gives the admin no signal the save landed (#save-feedback).
  redirect(`/events/${id}/edit?saved=1`)
}

// Refuse to delete an event that still has active registrations or an
// in-flight card checkout. CheckoutSession.event is onDelete:Cascade,
// so deleting an event mid-checkout wipes the staging row — the customer then
// pays, the webhook finds no staging row, and (pre-fix) silently no-ops:
// a real charge with zero CRM record. It also destroys paid registration
// records under the no-refund policy. Mirrors resetEventRegistrations' guard
//: cancel/refund them individually first. An OPEN CheckoutSession is
// the live-payment window; non-CANCELLED registrations cover PENDING + PAID.
async function assertNoActiveRegistrationsOrCheckouts(tx: Prisma.TransactionClient, id: number): Promise<void> {
  const activeRegistrations = await tx.registration.count({
    where: { eventId: id, paymentStatus: { not: "CANCELLED" } },
  })
  const openCheckouts = await tx.checkoutSession.count({
    where: { eventId: id, status: "OPEN" },
  })
  if (activeRegistrations > 0 || openCheckouts > 0) {
    throw new Error("GUARDED_DELETE_BLOCKED")
  }
}

// Maps a deleteEvent transaction failure to its caller-facing result. The
// P2034 serialization race is handled by the retry loop in deleteEvent itself
// (it needs the attempt counter), so it never reaches here.
function deleteEventFailureResult(e: unknown): ActionResult {
  const msg = e instanceof Error ? e.message : String(e)
  if (msg === "GUARDED_DELETE_BLOCKED") {
    return {
      error: "This event has registrations or a payment in progress — cancel them individually before deleting.",
    }
  }
  logger.error("[deleteEvent] delete failed", { error: msg })
  return { error: "Could not delete this event. Please try again." }
}

export async function deleteEvent(id: number): Promise<ActionResult> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(id)) return { error: "Invalid event" }

  // Existence check — also keeps syncEventDeletion from firing for
  // arbitrary ids that never existed. Select the slug too so the public page
  // cache can be invalidated — syncEventDeletion only tells the
  // external website, it never touches this app's own /e/[slug] render.
  const exists = await prisma.event.findUnique({ where: { id }, select: { id: true, slug: true } })
  if (!exists) return { error: "Event not found" }

  // Safety check + deletion must be one serialized operation: a checkout
  // created between a standalone count and the delete would be wiped by the
  // event cascade while Stripe completes the payment. Wrap both in a
  // Serializable txn and re-check inside it so count + delete see one
  // consistent snapshot; a concurrent checkout/reregistration that races the
  // delete produces P2034, which we catch and retry on.
  const MAX_TX_ATTEMPTS = 3
  for (let attempt = 1; ; attempt++) {
   try {
    await prisma.$transaction(async (tx) => {
      await assertNoActiveRegistrationsOrCheckouts(tx, id)
      // registrations/ticket types cascade (schema); a future FK or transient
      // error must surface as a friendly message, not a 500.
      // redirect() below must stay OUTSIDE this txn (it throws NEXT_REDIRECT).
      await tx.event.delete({ where: { id } })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    break
   } catch (e: unknown) {
    // Serialization race — retry so count + delete re-run on fresh data.
    if (isP2034(e)) {
      if (attempt < MAX_TX_ATTEMPTS) continue
      return { error: "Someone is registering for this event right now — reload the page and try again." }
    }
    return deleteEventFailureResult(e)
   }
  }
  await logAudit(actorId(session), "EVENT_DELETED", "Event", id)
  await syncEventDeletion(id)
  revalidatePath("/events")
  revalidatePath(`/e/${exists.slug}`)
  redirect("/events")
}

export async function publishEvent(id: number, publish: boolean): Promise<ActionResult> {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(id)) return { error: "Invalid event" }

  // Select the slug so the public event page can be revalidated too — publish
  // flips the page between full render and notFound(), so a stale cached
  // render of the previous state must not survive the toggle.
  const exists = await prisma.event.findUnique({ where: { id }, select: { id: true, slug: true } })
  if (!exists) return { error: "Event not found" }

  await prisma.event.update({ where: { id }, data: { isPublished: publish } })
  await logAudit(actorId(session), "EVENT_PUBLISHED", "Event", id, { published: publish })
  await syncEventToWebsite(id)
  revalidatePath(`/events/${id}/edit`)
  revalidatePath(`/e/${exists.slug}`)
  revalidatePath("/events")
}

// Manually open/close public registration without unpublishing the event —
// the event page stays live and shows a "registration closed" panel. canEdit-gated.
export async function setRegistrationClosed(id: number, closed: boolean): Promise<ActionResult> {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(id)) return { error: "Invalid event" }

  // Select the slug so the public event page can be revalidated too — closing
  // registration must invalidate the cached /e/<slug> render immediately.
  const exists = await prisma.event.findUnique({ where: { id }, select: { id: true, slug: true } })
  if (!exists) return { error: "Event not found" }

  await prisma.event.update({ where: { id }, data: { registrationClosed: closed } })
  await logAudit(actorId(session), "EVENT_REGISTRATION_CLOSED", "Event", id, { closed })
  revalidatePath(`/events/${id}/edit`)
  revalidatePath(`/e/${exists.slug}`)
  revalidatePath("/events")
}

// Backstop for missed webhooks: re-push every event to the website. ADMIN only.
export async function resyncEventsToWebsite(): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }

  const { synced, failed, truncated, disabled } = await resyncAllEvents()
  if (disabled) return { error: "Website sync is not configured — nothing was sent." }
  // ADMIN-only bulk push of up to 500 events' public data — leave a trail of who
  // triggered a full resync and when, like every sibling event action.
  await logAudit(actorId(session), "EVENTS_RESYNCED", "Event", undefined, { synced, failed, truncated })
  return { success: `Synced ${synced} event${synced === 1 ? "" : "s"} to website${failed ? `, ${failed} failed` : ""}${truncated ? " (capped at 500 — some events not synced)" : ""}` }
}

// Event access-delegation actions (volunteer view token, organiser assignment)
// live in ./eventAccess.
