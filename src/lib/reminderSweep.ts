import { prisma } from "@/lib/prisma"
import { safeDecrypt } from "@/lib/crypto"
import { sendEventReminderEmail } from "@/lib/email"
import { isReminderDue } from "@/lib/eventReminders"
import { bearerOk } from "@/lib/cronAuth"
import { getChurchSettings } from "@/lib/churchSettings"
import { APP_TIMEZONE, APP_LOCALE } from "@/lib/appConfig"
import type { Organizer } from "@/lib/eventOrganizers"

// Bound how many reminder emails go out concurrently per event — fine
// at current volume sent one-at-a-time, but a concurrency cap keeps a
// larger-than-usual registration list from serializing hundreds of SMTP round
// trips.
const SEND_CHUNK_SIZE = 10

// Lease duration for the claim marker. A crash/timeout/unhandled
// exception mid-send-loop must not permanently mark an event "reminded" with
// some registrants never emailed — the durable reminderSentAt marker is only
// ever set AFTER delivery work completes. reminderClaimedAt is the
// recoverable lease taken before sending; a later sweep may reclaim it once
// it goes stale. The lease is renewed before every send chunk, so it
// only has to outlast one chunk's SMTP retry budget. The workflow's half-hourly
// recovery runs (22:30–00:00 UTC) reclaim a crashed run's stale lease the same
// morning.
const REMINDER_LEASE_MS = 10 * 60 * 1000

// Cron sweep core. Kept out of the route module so unit tests don't import
// next/server (which references the jsdom-absent Request global at load), and
// separate from the pure isReminderDue helper so its DB/email deps don't leak
// into that helper's tests.
export async function sendDueReminders(
  authorization: string | null,
  now: Date
): Promise<{ status: number; body: Record<string, unknown> }> {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    // Loud, not silent: an unset secret means reminder emails are never sent.
    // Surface it to App Insights (console.error) and fail the cron run (503) so
    // the misconfiguration is visible rather than a green no-op — matching the
    // sibling sweep-checkouts route. This is the 2026-08-02 incident class
    // ( reminders silently unsent for weeks).
    console.error("[reminderSweep] CRON_SECRET unset — event reminder sweep is DISABLED")
    return { status: 503, body: { error: "CRON_SECRET unset — reminders disabled" } }
  }
  if (!bearerOk(authorization, secret)) return { status: 401, body: { error: "Unauthorized" } }

  // Cheap SQL pre-filter; the lead-window bound is applied by isReminderDue.
  const candidates = await prisma.event.findMany({
    where: {
      isPublished: true,
      kind: "one_off",
      date: { gte: now },
      reminderDaysBefore: { not: null },
      reminderSentAt: null,
    },
    include: {
      registrations: {
        where: { paymentStatus: { not: "CANCELLED" }, anonymizedAt: null },
        select: { firstName: true, lastName: true, email: true },
      },
    },
  })

  let eventsReminded = 0
  let emailsSent = 0
  let emailsFailed = 0

  // Read once per sweep (the DB row is cached) so reminder emails carry the
  // Settings-UI-configured church name, not just the CHURCH_NAME env var.
  const { name: churchName } = await getChurchSettings()

  for (const event of candidates) {
    if (!isReminderDue(event, now)) continue

    // Atomic claim via a recoverable lease: the SELECT above
    // and this UPDATE are two separate round trips, so an overlapping cron
    // run (or a manual + scheduled run) can see the same not-yet-marked
    // event. Claim only if no lease is held, or the held lease is stale (past
    // REMINDER_LEASE_MS) — a genuine crash's abandoned claim gets reclaimed
    // by a later sweep instead of the event staying permanently "reminded"
    // with nothing delivered. Re-checking reminderSentAt: null too so an
    // event already durably marked sent by another run's successful
    // completion is never re-claimed.
    // Fresh wall-clock per event, not the request-start `now`: after a slow
    // earlier event, a claim stamped with `now` would already be stale and
    // immediately reclaimable by an overlapping sweep.
    const claimAt = new Date(Math.max(Date.now(), now.getTime()))
    const leaseStaleBefore = new Date(claimAt.getTime() - REMINDER_LEASE_MS)
    const claim = await prisma.event.updateMany({
      where: {
        id: event.id,
        reminderSentAt: null,
        OR: [{ reminderClaimedAt: null }, { reminderClaimedAt: { lt: leaseStaleBefore } }],
      },
      data: { reminderClaimedAt: claimAt },
    })
    if (claim.count === 0) continue // another run holds an active lease, or already sent

    const eventDateLabel = event.date!.toLocaleString(APP_LOCALE, {
      weekday: "short", day: "numeric", month: "short", year: "numeric",
      hour: "numeric", minute: "2-digit", timeZone: APP_TIMEZONE,
    })
    const organizers = Array.isArray(event.organizers)
      ? (event.organizers as unknown as Organizer[])
      : undefined
    let eventSent = 0
    let eventFailed = 0
    // Current lease value — the fence every later write keys on. Renewed before
    // each chunk after the first so a long/slow send loop can't outlive
    // REMINDER_LEASE_MS and let an overlapping sweep reclaim and re-deliver
    //. If renewal matches nothing, another run has reclaimed the stale
    // lease and owns the event now: stop sending, and leave the durable marker
    // to that run.
    let lease = claimAt
    let leaseLost = false
    for (let i = 0; i < event.registrations.length; i += SEND_CHUNK_SIZE) {
      if (i > 0) {
        const renewed = new Date(Math.max(Date.now(), lease.getTime() + 1))
        const renewal = await prisma.event.updateMany({
          where: { id: event.id, reminderSentAt: null, reminderClaimedAt: lease },
          data: { reminderClaimedAt: renewed },
        })
        if (renewal.count === 0) {
          leaseLost = true
          break
        }
        lease = renewed
      }
      const chunk = event.registrations.slice(i, i + SEND_CHUNK_SIZE)
      const results = await Promise.allSettled(
        chunk.map((reg) =>
          sendEventReminderEmail(safeDecrypt(reg.email), {
            churchName,
            firstName: reg.firstName,
            eventTitle: event.title,
            eventDateLabel,
            eventLocation: event.location ?? undefined,
            organizers,
          })
        )
      )
      for (const r of results) {
        // One bad address must not abort the batch; sendEmail already retries
        // transient SMTP. Count and continue.
        if (r.status === "fulfilled") eventSent++
        else eventFailed++
      }
    }
    emailsSent += eventSent
    emailsFailed += eventFailed
    if (leaseLost) {
      console.error(
        `[reminderSweep] event ${event.id} "${event.title}": lease lost mid-send after ${eventSent} sent — another sweep reclaimed it; stopping this run's sends`
      )
      continue
    }
    // If EVERY send for this event failed (e.g. SMTP fully down for the sweep),
    // release the lease (not the durable marker, which was never set) so the
    // next sweep retries, and surface the failure. Partial/full success below
    // sets the durable reminderSentAt marker only now — AFTER delivery work
    // has actually completed — and clears the lease.
    if (event.registrations.length > 0 && eventSent === 0) {
      await prisma.event.updateMany({
        where: { id: event.id, reminderClaimedAt: lease },
        data: { reminderClaimedAt: null },
      })
      console.error(
        `[reminderSweep] event ${event.id} "${event.title}": all ${eventFailed} reminder send(s) failed; released claim for retry`
      )
      continue
    }
    // Partial failure (some delivered, some bounced): the durable marker is
    // still set below (at-most-once for the addresses that received it), but
    // a mass partial bounce would otherwise be invisible — the workflow
    // checks HTTP status only and status stays 200. Surface a structured
    // line so it reaches container logs / App Insights.
    if (eventFailed > 0) {
      console.error(
        `[reminderSweep] event ${event.id} "${event.title}": partial reminder delivery — ${eventSent} sent, ${eventFailed} failed`
      )
    }
    // Delivery work is done (or there was nothing to deliver) — only now is
    // the durable "sent" marker set, and the lease released. This
    // write is idempotency-critical: if it never lands, reminderSentAt
    // stays null and a later stale-lease reclaim resends to everyone already
    // emailed. Retry a transient blip (the WHERE keys on reminderClaimedAt=lease,
    // so a retry after a silent success is a harmless no-op); if it still
    // fails, loud-log rather than abort the whole sweep. Keying on this run's
    // current `lease` keeps the retry safe even across an intervening reclaim.
    // A first-attempt zero-row match means the lease went stale during the last
    // chunk and another sweep reclaimed it — this run no longer owns the
    // marker, so surface it rather than report success. (A zero match on a
    // retry is expected after a silently-committed earlier attempt.)
    let marked = false
    let markLost = false
    for (let attempt = 1; attempt <= 3 && !marked; attempt++) {
      try {
        const mark = await prisma.event.updateMany({
          where: { id: event.id, reminderClaimedAt: lease },
          data: { reminderSentAt: now, reminderClaimedAt: null },
        })
        marked = true
        markLost = attempt === 1 && mark.count === 0
      } catch (err) {
        if (attempt === 3) {
          console.error(
            `[reminderSweep] event ${event.id} "${event.title}": delivered but failed to persist the durable sent marker after ${attempt} attempts — a later sweep may resend; ${err instanceof Error ? err.message : String(err)}`
          )
        }
      }
    }
    if (markLost) {
      console.error(
        `[reminderSweep] event ${event.id} "${event.title}": lease lost before the durable sent marker after ${eventSent} sent — another sweep reclaimed it and may resend`
      )
      continue
    }
    eventsReminded++
  }

  return { status: 200, body: { eventsReminded, emailsSent, emailsFailed } }
}
