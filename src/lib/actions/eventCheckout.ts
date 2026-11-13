"use server"
import { headers } from "next/headers"
import { stripeConfigured } from "@/lib/stripe"
import { fetchEventWithTickets, validateAndPriceRegistration } from "@/lib/eventRegistrationPricing"
import { createEventCheckoutSession, createExistingRegistrationCheckoutSession, RegistrationNotPayableError } from "@/lib/stripeCheckout"
import { CurrencyPrecisionError } from "@/lib/stripeAmount"
import { rateLimit } from "@/lib/rateLimit"
import { isRegistrationClosed } from "@/lib/eventClose"
import { prisma } from "@/lib/prisma"
import { toCents } from "@/lib/formatting"
import { featureGuard } from "@/lib/featureFlags"
import { rateKeyFromHeaders, resolveClientIp } from "@/lib/clientIp"
import { entryTotals } from "@/lib/fundraiserMath"
import { trustedBaseUrl } from "@/lib/trustedBaseUrl"

// Fundraiser entry public tokens are base64url (mintEntryToken); reject anything else before a DB lookup.
const FUNDRAISER_TOKEN_RE = /^[A-Za-z0-9_-]{1,64}$/

/**
 * Public entry point for the optional Stripe event-payments flow: prices the
 * registration server-side (never trusting client-sent amounts), then stages
 * a CheckoutSession row and starts a Stripe Checkout Session. Mirrors the
 * unauth `POST /api/events/[slug]/register` route's guards (rate limit, IP
 * trust, publish/past-event checks) since this is equally a public callable
 * endpoint despite being a server action rather than a route handler.
 */
export async function startEventCheckout(
  slug: string,
  rawBody: unknown,
): Promise<{ ok: true; url: string } | { ok: false; status: number; error: string }> {
  if (!stripeConfigured()) {
    return { ok: false, status: 400, error: "Online payment unavailable" }
  }

  const h = await headers()
  // Resolved once, same rule as the register route: `key` (IPv4 or IPv6 /64) feeds the limiter, `ip` is the validated address.
  const { ip, key } = resolveClientIp(h)
  if (!rateLimit(`checkout:${key}`, 10, 60_000)) {
    return { ok: false, status: 429, error: "Too many attempts" }
  }
  // After the throttle; public caller gets the unpublished-event 404, not the admin wording.
  if (await featureGuard("events")) return { ok: false, status: 404, error: "Event not found" }

  // Shared with createEventRegistration so both flows agree on ticket/capacity
  // data and the include shape can't silently drift between them.
  const event = await fetchEventWithTickets(slug)

  // Unpublished must be indistinguishable from not-found.
  if (!event?.isPublished) {
    return { ok: false, status: 404, error: "Event not found" }
  }

  // Past events stop accepting registrations/payments — same rule as
  // createEventRegistration.
  const closesAt = event.endDate ?? event.date
  if (closesAt && closesAt < new Date()) {
    return { ok: false, status: 404, error: "Event not found" }
  }

  // Registration explicitly closed (manual flag or deadline passed) — the
  // bank-transfer/free path (createEventRegistration) gates on this before
  // pricing; the card path must too, or a closed event stays payable by card
  // while the free form 400s. Same 400/message as that path.
  if (isRegistrationClosed(event)) {
    return { ok: false, status: 400, error: "Registration for this event is closed." }
  }

  if (!event.onlinePaymentEnabled) {
    return { ok: false, status: 400, error: "Online payment not enabled for this event" }
  }

  const v = await validateAndPriceRegistration(event, rawBody, ip)
  if (!v.ok) return v

  if (v.priced.totalAmount <= 0) {
    return { ok: false, status: 400, error: "This event is free — register without payment" }
  }

  // Stripe return URLs: trusted config only (see trustedReturnOrigin).
  const origin = trustedReturnOrigin(trustedBaseUrl(), h.get("origin"))
  if (!origin) {
    return { ok: false, status: 500, error: "Payment configuration error" }
  }
  return withCurrencyGuard(() => createEventCheckoutSession(event, v.priced, origin))
}

/**
 * Pay-now-by-card for an EXISTING pending registration, reached from the
 * payment-reminder success page. Public callable (like startEventCheckout), so
 * it re-guards access itself: Stripe configured, rate-limited, event published +
 * online-payment enabled, and the registration must be event-scoped + PENDING +
 * non-free. No past-event / registration-closed gate: a registered attendee owes
 * the money regardless of the event date.
 */
export async function startExistingRegistrationCheckout(
  slug: string,
  publicToken: string,
): Promise<{ ok: true; url: string } | { ok: false; status: number; error: string }> {
  if (!stripeConfigured()) {
    return { ok: false, status: 400, error: "Online payment unavailable" }
  }

  const h = await headers()
  const key = rateKeyFromHeaders(h)
  if (!rateLimit(`checkout:${key}`, 10, 60_000)) {
    return { ok: false, status: 429, error: "Too many attempts" }
  }
  // After the throttle; public caller gets the unpublished-event 404, not the admin wording.
  if (await featureGuard("events")) return { ok: false, status: 404, error: "Event not found" }

  const event = await prisma.event.findUnique({
    where: { slug },
    select: {
      id: true, slug: true, title: true, isPublished: true,
      onlinePaymentEnabled: true, passCardFee: true,
      ticketTypes: { select: { id: true, name: true } },
    },
  })
  // Unpublished must be indistinguishable from not-found.
  if (!event?.isPublished) {
    return { ok: false, status: 404, error: "Event not found" }
  }
  if (!event.onlinePaymentEnabled) {
    return { ok: false, status: 400, error: "Online payment not enabled for this event" }
  }

  // Event-scoped, opaque-token lookup — never findUnique({id}) (enumeration).
  const registration = await prisma.registration.findFirst({
    where: { publicToken, eventId: event.id },
    select: {
      id: true, publicToken: true, paymentStatus: true, totalAmount: true,
      items: { select: { ticketTypeId: true, quantity: true, unitPrice: true } },
    },
  })
  if (!registration) {
    return { ok: false, status: 404, error: "Registration not found" }
  }
  if (registration.paymentStatus !== "PENDING") {
    return { ok: false, status: 400, error: "This registration is not awaiting payment" }
  }
  if (toCents(registration.totalAmount) <= 0) {
    return { ok: false, status: 400, error: "This registration is free — nothing to pay" }
  }

  const origin = trustedReturnOrigin(trustedBaseUrl(), h.get("origin"))
  if (!origin) {
    return { ok: false, status: 500, error: "Payment configuration error" }
  }

  try {
    return await withCurrencyGuard(() => createExistingRegistrationCheckoutSession(event, registration, origin))
  } catch (e) {
    // settled (or prior checkout paid) between the read above and the lock.
    if (e instanceof RegistrationNotPayableError) {
      return { ok: false, status: 400, error: "This registration is not awaiting payment" }
    }
    throw e
  }
}

/**
 * Pay a fundraiser entry's remaining balance by card, from the public
 * /pay/fundraiser/[token] page. Public callable, so it re-guards itself: Stripe
 * configured, rate-limited, events feature on, entry found by its opaque token
 * only, event online payment on, and something still owed. No publish or
 * past-event gate: the token is the only key and the money is owed regardless.
 * @param publicToken the entry's opaque public token
 * @returns the Stripe Checkout URL, or a status + message
 */
export async function startFundraiserCheckout(
  publicToken: string,
): Promise<{ ok: true; url: string } | { ok: false; status: number; error: string }> {
  if (!stripeConfigured()) {
    return { ok: false, status: 400, error: "Online payment unavailable" }
  }
  const h = await headers()
  const key = rateKeyFromHeaders(h)
  if (!rateLimit(`fundraiser-checkout:${key}`, 10, 60_000)) {
    return { ok: false, status: 429, error: "Too many attempts" }
  }
  if (await featureGuard("events")) return { ok: false, status: 404, error: "Not found" }
  if (typeof publicToken !== "string" || !FUNDRAISER_TOKEN_RE.test(publicToken)) {
    return { ok: false, status: 404, error: "Not found" }
  }

  const entry = await prisma.fundraiserEntry.findUnique({
    where: { publicToken },
    select: {
      id: true, publicToken: true, quantity: true, unitPrice: true,
      payments: { select: { amount: true } },
      fundraiser: { select: { event: { select: { id: true, title: true, passCardFee: true, onlinePaymentEnabled: true } } } },
    },
  })
  if (!entry) return { ok: false, status: 404, error: "Not found" }
  const event = entry.fundraiser.event
  if (!event.onlinePaymentEnabled) {
    return { ok: false, status: 400, error: "Online payment not enabled for this event" }
  }
  const { remainingCents } = entryTotals(entry, entry.payments)
  if (remainingCents <= 0) return { ok: false, status: 400, error: "Nothing left to pay" }

  const origin = trustedReturnOrigin(trustedBaseUrl(), h.get("origin"))
  if (!origin) {
    return { ok: false, status: 500, error: "Payment configuration error" }
  }

  // Loaded lazily: fundraiserCheckout pulls cardFeeSettings (next/cache), which
  // the ticket-checkout action tests' jsdom env can't load.
  const { createFundraiserCheckoutSession, FundraiserNotPayableError, FundraiserAmountOutOfRangeError } =
    await import("@/lib/fundraiserCheckout")
  try {
    return await withCurrencyGuard(() =>
      createFundraiserCheckoutSession({ id: entry.id, publicToken: entry.publicToken, remainingCents }, event, origin),
    )
  } catch (e) {
    if (e instanceof FundraiserNotPayableError) {
      return { ok: false, status: 400, error: "Nothing left to pay, or a card payment is already being processed" }
    }
    if (e instanceof FundraiserAmountOutOfRangeError) {
      return { ok: false, status: 400, error: "This amount can't be paid by card — please contact the organiser" }
    }
    throw e
  }
}

/**
 * Origin (scheme + host + port) for Stripe's return URLs (ticket, existing
 * registration and fundraiser checkouts). Must come from trusted config, never
 * the request: Stripe redirects the payer there after a real charge, so a
 * spoofed header would be an open redirect. The trusted base may carry a path
 * (e.g. AUTH_URL `https://host/api/auth`), so only its origin is kept, matching
 * the reminder email's pay link. The request's Origin header is a dev-only
 * fallback; a missing base in production is a config error (returns "").
 * @param trustedBase configured base URL (AUTH_URL / APP_URL), if any
 * @param headerOrigin the request's Origin header, if any
 * @returns the origin, or "" when none is usable (config error)
 */
function trustedReturnOrigin(trustedBase: string | undefined, headerOrigin: string | null): string {
  if (trustedBase !== undefined) {
    try {
      const { origin } = new URL(trustedBase)
      // Non-http(s) schemes have an opaque origin, serialised as "null".
      return origin === "null" ? "" : origin
    } catch {
      return ""
    }
  }
  return process.env.NODE_ENV === "production" ? "" : headerOrigin ?? ""
}

// A ticket price the configured currency can't charge (fractional amount in a
// zero-decimal currency like JPY) is an event-config error — surface a handled
// message instead of an uncaught 500.
async function withCurrencyGuard(create: () => Promise<{ url: string } | { ok: false; status: 404; error: string }>) {
  try {
    const res = await create()
    if ("ok" in res) return res
    return { ok: true as const, url: res.url }
  } catch (e) {
    if (e instanceof CurrencyPrecisionError) {
      return { ok: false as const, status: 400, error: `This event's price can't be charged in ${e.currency} — please contact the organiser` }
    }
    throw e
  }
}
