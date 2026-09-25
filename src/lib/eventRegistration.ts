import { fetchEventWithTickets, validateAndPriceRegistration } from "@/lib/eventRegistrationPricing"
import { persistRegistration, type RegisterResult } from "@/lib/eventRegistrationPersist"
import { isRegistrationClosed } from "@/lib/eventClose"

// Re-exported for callers that only need the pipeline entry point / its result
// type. The validation+pricing and persistence stages live in their own modules
// (eventRegistrationPricing / eventRegistrationPersist) so a change to
// pricing doesn't touch persistence and vice versa.
export type { RegisterResult }

// Core public-registration pipeline. `rawBody` is the already-parsed JSON body;
// `ip` is the resolved client IP (used for the Turnstile check + confirmation
// mail throttle). Returns a typed result; never throws for a caller-visible
// error — only unexpected/DB faults propagate (→ 500 at the route).
export async function createEventRegistration(
  slug: string,
  rawBody: unknown,
  ip: string,
): Promise<RegisterResult> {
  const event = await fetchEventWithTickets(slug)
  // Unpublished must be indistinguishable from not-found, or the status-code
  // difference lets attackers enumerate valid draft slugs.
  if (!event || !event.isPublished) {
    return { ok: false, status: 404, error: "Event not found" }
  }

  // A still-published past event keeps accepting public registrations forever
  //: junk registrations, inflated counts, and the paid-event success page
  // keeps surfacing church bank details. Close registration once the event is over.
  // endDate wins when set (multi-day/recurring); else fall back to the one-off date.
  // Events with neither date stay open. Same 404 as not-found to avoid leaking state.
  const closesAt = event.endDate ?? event.date
  if (closesAt && closesAt < new Date()) {
    return { ok: false, status: 404, error: "Event not found" }
  }

  // Registration explicitly closed (manual flag or deadline passed). Distinct
  // 400 (not the 404 used for unpublished/past events) — the event page is still
  // live and legitimately reachable; the form is just closed.
  if (isRegistrationClosed(event)) {
    return { ok: false, status: 400, error: "Registration for this event is closed." }
  }

  const v = await validateAndPriceRegistration(event, rawBody, ip)
  if (!v.ok) return v
  return persistRegistration(event, v.priced, { paymentStatus: "PENDING" })
}
