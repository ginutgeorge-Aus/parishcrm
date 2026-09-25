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

// Public entry point for the optional Stripe event-payments flow: prices the
// registration server-side (never trusting client-sent amounts), then stages
// a CheckoutSession row and starts a Stripe Checkout Session. Mirrors the
// unauth `POST /api/events/[slug]/register` route's guards (rate limit, IP
// trust, publish/past-event checks) since this is equally a public callable
// endpoint despite being a server action rather than a route handler.
export async function startEventCheckout(
  slug: string,
  rawBody: unknown,
): Promise<{ ok: true; url: string } | { ok: false; status: number; error: string }> {
  if (!stripeConfigured()) {
    return { ok: false, status: 400, error: "Online payment unavailable" }
  }

  const h = await headers()
  // Rightmost x-forwarded-for entry = trusted reverse-proxy hop, not
  // client-spoofable — same rule as the register route (getClientIp).
  const xff = h.get("x-forwarded-for") ?? ""
  const ip = xff.split(",").map((s) => s.trim()).filter(Boolean).pop() ?? "unknown"
  if (!rateLimit(`checkout:${ip}`, 10, 60_000)) {
    return { ok: false, status: 429, error: "Too many attempts" }
  }

  // Shared with createEventRegistration so both flows agree on ticket/capacity
  // data and the include shape can't silently drift between them.
  const event = await fetchEventWithTickets(slug)

  // Unpublished must be indistinguishable from not-found.
  if (!event || !event.isPublished) {
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

  // Base URL for Stripe's post-payment success/cancel redirects must come from
  // trusted config, NOT the request's origin header — Stripe redirects the
  // payer there after a real charge, so a spoofed header would be an
  // open-redirect off the back of a payment. In production the trusted base is
  // required (AUTH_URL is always set — login itself breaks without it); the
  // origin-header fallback is dev-only. A missing base in prod is a config
  // error, never a reason to trust the client header.
  const trustedBase = process.env.AUTH_URL ?? process.env.APP_URL
  const origin =
    trustedBase ?? (process.env.NODE_ENV === "production" ? "" : h.get("origin") ?? "")
  if (!origin) {
    return { ok: false, status: 500, error: "Payment configuration error" }
  }
  return withCurrencyGuard(() => createEventCheckoutSession(event, v.priced, origin))
}

// Pay-now-by-card for an EXISTING pending registration, reached from the
// payment-reminder success page. Public callable (like startEventCheckout), so
// it re-guards access itself: Stripe configured, rate-limited, event published +
// online-payment enabled, and the registration must be event-scoped + PENDING +
// non-free. No past-event / registration-closed gate: a registered attendee owes
// the money regardless of the event date.
export async function startExistingRegistrationCheckout(
  slug: string,
  publicToken: string,
): Promise<{ ok: true; url: string } | { ok: false; status: number; error: string }> {
  if (!stripeConfigured()) {
    return { ok: false, status: 400, error: "Online payment unavailable" }
  }

  const h = await headers()
  const xff = h.get("x-forwarded-for") ?? ""
  const ip = xff.split(",").map((s) => s.trim()).filter(Boolean).pop() ?? "unknown"
  if (!rateLimit(`checkout:${ip}`, 10, 60_000)) {
    return { ok: false, status: 429, error: "Too many attempts" }
  }

  const event = await prisma.event.findUnique({
    where: { slug },
    select: {
      id: true, slug: true, title: true, isPublished: true,
      onlinePaymentEnabled: true, passCardFee: true,
      ticketTypes: { select: { id: true, name: true } },
    },
  })
  // Unpublished must be indistinguishable from not-found.
  if (!event || !event.isPublished) {
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

  const trustedBase = process.env.AUTH_URL ?? process.env.APP_URL
  const origin =
    trustedBase ?? (process.env.NODE_ENV === "production" ? "" : h.get("origin") ?? "")
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

// A ticket price the configured currency can't charge (fractional amount in a
// zero-decimal currency like JPY) is an event-config error — surface a handled
// message instead of an uncaught 500.
async function withCurrencyGuard(create: () => Promise<{ url: string }>) {
  try {
    const { url } = await create()
    return { ok: true as const, url }
  } catch (e) {
    if (e instanceof CurrencyPrecisionError) {
      return { ok: false as const, status: 400, error: `This event's price can't be charged in ${e.currency} — please contact the organiser` }
    }
    throw e
  }
}
