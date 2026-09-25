import { prisma } from "@/lib/prisma"
import { notFound } from "next/navigation"
import { headers } from "next/headers"
import { rateLimit } from "@/lib/rateLimit"
import { fmtAUD, toCents, centsToNumber } from "@/lib/formatting"
import { buildIcs, googleCalendarUrl } from "@/lib/ics"
import { QrCode } from "@/components/QrCode"
import { getChurchSettings } from "@/lib/churchSettings"
import { computeFamilyWaiver } from "@/lib/eventWaiver"
import { PayNowButton } from "./PayNowButton"
import { stripeConfigured } from "@/lib/stripe"
import type { Metadata } from "next"

// Opaque-token page revealing registrant name + church bank details — never
// index/follow, so a leaked/linked URL can't be search-indexed.
export const metadata: Metadata = { robots: { index: false, follow: false } }

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ ref?: string; token?: string; dup?: string }> }

// The success page is an unauthenticated oracle keyed by an opaque token: a
// valid ?ref= reveals the registrant's name + the church BSB/account.
// Throttle lookups per IP so brute-forcing tokens is not viable, and
// expire the token 30 days after registration so an intercepted/screenshotted
// link is not a permanent key — well past the 7-day payment window.
// Single replica → the in-memory limiter is authoritative (see rateLimit.ts).
const SUCCESS_LOOKUP_LIMIT = 20
const SUCCESS_LOOKUP_WINDOW_MS = 60_000
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000

function getClientIp(h: Headers): string {
  // Rightmost x-forwarded-for IP is appended by the trusted reverse proxy.
  const last = h.get("x-forwarded-for")?.split(",").at(-1)?.trim()
  return last || "unknown"
}

// Earliest createdAt a token lookup will still match. Kept out of the
// component body so Date.now() doesn't trip the render-purity lint rule.
function tokenExpiryFloor(): Date {
  return new Date(Date.now() - TOKEN_TTL_MS)
}

export default async function SuccessPage(props: Props) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  // Church identity from configured settings, mirroring other pages — not hardcoded.
  const { name: churchName, email: churchEmail } = await getChurchSettings()
  const event = await prisma.event.findUnique({
    where: { slug: params.slug },
    select: {
      id: true, title: true, isPublished: true, bankBsb: true, bankAccount: true,
      date: true, endDate: true, description: true, location: true,
      familyWaiverEnabled: true, familyWaiverThreshold: true, organizers: true,
      onlinePaymentEnabled: true, passCardFee: true,
    },
  })
  // isPublished guard: without it, any valid slug — including drafts —
  // exposes the church bank BSB/account on this unauthenticated page.
  if (!event || !event.isPublished) notFound()

  // A duplicated query param (?token=a&token=b) arrives as an array, so `token`
  // is typed string but can be string[] at runtime — `.startsWith` on an array
  // throws an unhandled TypeError (500). Take the first value defensively;
  // ref feeds a Prisma filter, so normalise it the same way.
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const ref = first(searchParams.ref) ?? ""
  const token = first(searchParams.token)
  // Stripe redirects the pay-now flow back with ?token={CHECKOUT_SESSION_ID}
  // (a cs_... id) instead of our own ?ref= registration token.
  const cardToken = token?.startsWith("cs_") ? token : null

  // Throttle the token lookup: only the ?ref=/?token= paths are an
  // oracle, so count a request against the per-IP budget only when one is supplied.
  if (ref || cardToken) {
    const ip = getClientIp(await headers())
    if (!rateLimit(`success:${ip}`, SUCCESS_LOOKUP_LIMIT, SUCCESS_LOOKUP_WINDOW_MS)) {
      return (
        <div className="max-w-lg mx-auto py-12 px-4">
          <div className="bg-card rounded-2xl border border-border p-8 text-center">
            <div aria-hidden="true" className="text-4xl mb-4">⏳</div>
            <h1 className="text-2xl font-bold text-foreground mb-2">Too many requests</h1>
            <p className="text-muted-foreground">
              Please wait a moment and reload this page. Questions? Contact us at
              {" "}{churchEmail}
            </p>
          </div>
        </div>
      )
    }
  }

  // Resolve a card (pay-now) return to the registration's own publicToken via
  // the CheckoutSession the webhook (Task 5) stamps on payment success. The
  // webhook can lag the Stripe redirect by a moment, so a matching session
  // with no publicToken yet is "payment received, still finalising" — not a
  // 404 — while a token that matches no session at all falls through to the
  // ordinary not-found view below.
  let resolvedRef = ref
  let paymentPending = false
  let paymentUnfulfilled = false
  if (cardToken && !resolvedRef) {
    const checkoutSession = await prisma.checkoutSession.findUnique({
      where: { stripeSessionId: cardToken },
    })
    // Event-scope the match (style guard) — a session for a different
    // event must not resolve here even though cs_... ids aren't enumerable.
    if (checkoutSession && checkoutSession.eventId === event.id) {
      if (checkoutSession.publicToken) resolvedRef = checkoutSession.publicToken
      // Terminal "charged but couldn't register" outcomes where the webhook keeps
      // the money for manual ops and never writes a publicToken — render the
      // contact-us state, not "being finalised" forever:
      //  - UNFULFILLED: capacity gone / event deleted / amount mismatch.
      //  - EXPIRED: the checkout sweep flipped the row, then a late webhook (e.g.
      //    BECS async payment) still confirmed the charge.
      //  - COMPLETED with no token: a genuine duplicate charge whose token
      //    deliberately withholds for the second payer.
      // Any other non-terminal status (OPEN) is a real pre-webhook lag → pending.
      else if (
        checkoutSession.status === "UNFULFILLED" ||
        checkoutSession.status === "EXPIRED" ||
        checkoutSession.status === "COMPLETED"
      ) paymentUnfulfilled = true
      else paymentPending = true
    }
  }

  if (paymentUnfulfilled) {
    return (
      <div className="max-w-lg mx-auto py-12 px-4">
        <div className="bg-card rounded-2xl border border-border p-8 text-center">
          <div aria-hidden="true" className="text-4xl mb-4">⚠️</div>
          <h1 className="text-2xl font-bold text-foreground mb-2">We couldn&apos;t complete your registration</h1>
          <p className="text-muted-foreground">
            Your payment reached us, but we were unable to register you for {event.title} — the
            event may have filled up. You are <strong>not</strong> registered. Please contact us at
            {" "}{churchEmail} and we&apos;ll sort this out for you.
          </p>
        </div>
      </div>
    )
  }

  if (paymentPending) {
    return (
      <div className="max-w-lg mx-auto py-12 px-4">
        <div className="bg-card rounded-2xl border border-border p-8 text-center">
          <div aria-hidden="true" className="text-4xl mb-4">⏳</div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Payment received</h1>
          <p className="text-muted-foreground">
            Your confirmation is being finalised — check your email shortly. Questions? Contact
            us at {churchEmail}
          </p>
        </div>
      </div>
    )
  }

  // Look up by the opaque CSPRNG token, never the sequential id, so REG-1..N
  // cannot be enumerated; still event-scoped to block cross-event lookups.
  const linkFloor = tokenExpiryFloor()
  const registration = !resolvedRef
    ? null
    : await prisma.registration.findFirst({
        where: {
          publicToken: resolvedRef,
          eventId: event.id,
          // Expire the receipt link 30 days after registration so a
          // leaked/screenshotted link isn't a permanent oracle to the church
          // bank details — UNLESS a staff payment reminder was sent within the
          // same window, which re-authorises the link for a fresh 30-day bound
          // from the send. Without this OR, a reminder to an unpaid registrant
          // older than 30 days opens "Registration not found" and shows neither
          // bank details nor the pay-now button. The link still dies 30 days
          // after the last legitimate reminder, keeping the oracle bounded.
          OR: [
            { createdAt: { gte: linkFloor } },
            { paymentReminders: { some: { status: "SUCCESS", sentAt: { gte: linkFloor } } } },
          ],
        },
        // paymentStatus is a plain scalar so it rides along with `include`
        // (not select-based) — used below to gate the bank-transfer block so
        // a card-paid registration doesn't leak "please pay by bank" details.
        include: { items: { include: { ticketType: true } } },
      })

  // A non-matching (mistyped, hand-crafted, or legacy REG-<id>) ref must not
  // render the "registered" confirmation + bank details with the bogus ref as
  // the payment reference — the visitor could pay under an unknown reference
  //. Show an explicit not-found message instead.
  if (!registration) {
    return (
      <div className="max-w-lg mx-auto py-12 px-4">
        <div className="bg-card rounded-2xl border border-border p-8 text-center">
          <div aria-hidden="true" className="text-4xl mb-4">🔍</div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Registration not found</h1>
          <p className="text-muted-foreground">
            We couldn&apos;t find a registration for this link. Please check the link from your
            confirmation, or register again.
          </p>
          <p className="text-xs text-muted-foreground mt-6">
            Questions? Contact us at {churchEmail}
          </p>
        </div>
      </div>
    )
  }

  // A cancelled registration (refund/dispute → CANCELLED, or admin cancel) must
  // not render as an active booking: otherwise the registrant sees
  // "You're registered!" + bank-transfer details instructing them to pay for a
  // seat that no longer exists. Show an explicit cancelled state instead.
  if (registration.paymentStatus === "CANCELLED") {
    return (
      <div className="max-w-lg mx-auto py-12 px-4">
        <div className="bg-card rounded-2xl border border-border p-8 text-center">
          <div aria-hidden="true" className="text-4xl mb-4">🚫</div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Registration cancelled</h1>
          <p className="text-muted-foreground">
            This registration for {event.title} has been cancelled. No payment is
            due. If you believe this is a mistake, please contact us at {churchEmail}.
          </p>
        </div>
      </div>
    )
  }

  // Add-to-calendar — one-off events only (recurring events have no date).
  let gcalUrl: string | null = null
  let icsDataUri: string | null = null
  if (event.date) {
    const start = event.date
    const end = event.endDate ?? new Date(start.getTime() + 2 * 60 * 60 * 1000)
    gcalUrl = googleCalendarUrl({
      title: event.title,
      details: event.description ?? undefined,
      location: event.location ?? undefined,
      start,
      end,
    })
    const ics = buildIcs({
      uid: registration.publicToken,
      title: event.title,
      description: event.description ?? undefined,
      location: event.location ?? undefined,
      start,
      end,
    })
    icsDataUri = `data:text/calendar;base64,${Buffer.from(ics, "utf8").toString("base64")}`
  }

  const { freeCount } = computeFamilyWaiver(
    registration.items.map((item) => ({
      unitPriceCents: toCents(item.ticketType.price),
      quantity: item.quantity,
      countsTowardWaiver: item.ticketType.countsTowardWaiver,
    })),
    {
      enabled: event.familyWaiverEnabled,
      threshold: event.familyWaiverThreshold,
    },
  )

  // Dedupe hit: the submit was a repeat of an existing registration
  // (same event + email within the dedupe window) so no new row was created —
  // this page is showing the EXISTING booking. Cosmetic banner only; ?dup is
  // user-controllable and carries no security surface.
  const isDuplicate = searchParams.dup === "1"

  // Free ($0) registrations stay PENDING (no card/bank payment ever occurs) —
  // mirror the confirmation email's guard (eventRegistration.ts: PENDING &&
  // totalAmount > 0) so a $0 PENDING registration doesn't render the
  // bank-transfer block ("Amount $0.00", BSB/account) or the 7-day-hold
  // footer.
  const totalCents = toCents(registration.totalAmount)
  const isFree = totalCents === 0

  const organizers = (Array.isArray(event.organizers) ? event.organizers : []) as unknown as import("@/lib/eventOrganizers").Organizer[]

  return (
    <div className="max-w-lg mx-auto py-12 px-4">
      <div className="bg-card rounded-2xl border border-border p-8">
        {isDuplicate && (
          <div role="alert" className="mb-6 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm text-warning">
            <p className="font-semibold">You&apos;re already registered with this email.</p>
            <p className="mt-1">
              This is your existing booking — a new one wasn&apos;t created. To add attendees or
              change it, contact us at {churchEmail}.
            </p>
          </div>
        )}
        <div aria-hidden="true" className="text-4xl mb-4">🎉</div>
        <h1 className="text-2xl font-bold text-foreground mb-2">You&apos;re registered!</h1>
        <p className="text-muted-foreground mb-6">{event.title}</p>

        {registration && (
          <div className="mb-6">
            <p className="text-sm text-muted-foreground mb-1">
              <strong>{registration.firstName} {registration.lastName}</strong>
            </p>
            {registration.items.map(item => (
              <p key={item.id} className="text-sm text-muted-foreground">
                {item.quantity}× {item.ticketType.name}
              </p>
            ))}
            <p className="font-bold text-foreground mt-2">
              Total: {fmtAUD(centsToNumber(toCents(registration.totalAmount)))}
            </p>
            {freeCount > 0 && (
              <p className="text-sm text-success mt-1">
                Family waiver applied — {freeCount} member{freeCount === 1 ? "" : "s"} free.
              </p>
            )}
          </div>
        )}

        <div className="mb-6 flex flex-col items-center rounded-xl border border-border bg-muted p-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Check-in code</p>
          <div className="rounded-lg bg-card p-3">
            <QrCode value={registration.publicToken} title={`Check-in code ${registration.publicToken}`} />
          </div>
          <p className="mt-3 text-center text-xs text-muted-foreground">Show this at check-in</p>
        </div>

        {registration.paymentStatus === "PAID" ? (
          // Already paid by card (#Stripe event payments) — the church bank
          // BSB/account is pay-later instructions and must not be shown
          // alongside a registration that's already settled.
          <div className="bg-muted rounded-xl border border-border p-5 text-center">
            {/* PAID is set by two paths: the Stripe webhook (stamps paymentRef =
                PaymentIntent id) and the admin markRegistrationPaid action for a
                reconciled bank transfer (no paymentRef). Only claim "by card"
                when a paymentRef proves it — otherwise a bank-transfer payer
                reopening this link would be wrongly told they paid by card
. */}
            <p className="text-sm font-semibold text-foreground">
              {registration.paymentRef ? "Paid by card" : "Payment received"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {fmtAUD(centsToNumber(toCents(registration.totalAmount)))} received — no further payment needed.
            </p>
          </div>
        ) : isFree ? (
          // A free ($0) registration stays PENDING (no payment ever occurs) —
          // showing bank-transfer instructions for $0.00 is nonsensical.
          <div className="bg-muted rounded-xl border border-border p-5 text-center">
            <p className="text-sm font-semibold text-foreground">No payment required</p>
            <p className="text-xs text-muted-foreground mt-1">
              This registration is free — there is nothing further to pay.
            </p>
          </div>
        ) : (
          <div className="bg-muted rounded-xl border border-border p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Bank Transfer Details</p>
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Account name</span>
                <span className="font-semibold text-foreground">{churchName}</span>
              </div>
              {event.bankBsb && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">BSB</span>
                  <span className="font-semibold text-foreground">{event.bankBsb}</span>
                </div>
              )}
              {event.bankAccount && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Account number</span>
                  <span className="font-semibold text-foreground">{event.bankAccount}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Reference</span>
                <span className="font-bold text-primary">{resolvedRef}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Amount</span>
                <span className="font-bold text-foreground">
                  {fmtAUD(centsToNumber(toCents(registration.totalAmount)))}
                </span>
              </div>
            </div>
            {event.onlinePaymentEnabled && stripeConfigured() && (
              <PayNowButton slug={params.slug} publicToken={registration.publicToken} passCardFee={event.passCardFee} />
            )}
          </div>
        )}

        {gcalUrl && icsDataUri && (
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <a
              href={gcalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 rounded-lg bg-primary px-4 py-2 text-center text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              Add to Google Calendar
            </a>
            <a
              href={icsDataUri}
              download="event.ics"
              className="flex-1 rounded-lg border border-border px-4 py-2 text-center text-sm font-semibold text-foreground hover:bg-muted"
            >
              Download .ics
            </a>
          </div>
        )}

        {organizers.length > 0 && (
          <div className="mt-5 rounded-xl border border-border bg-muted p-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {organizers.length === 1 ? "Organiser" : "Organisers"}
            </p>
            <div className="flex flex-col gap-1 text-sm">
              {organizers.map((o, i) => (
                <div key={i} className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-foreground">{o.name}</span>
                  {o.phone && (
                    <a href={`tel:${o.phone.replace(/\s+/g, "")}`} className="text-primary underline">
                      {o.phone}
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground mt-4 text-center">
          {registration.paymentStatus === "PAID" || isFree
            ? <>Questions? Contact us at {churchEmail}</>
            : <>Your spot is held for 7 days pending payment. Questions? Contact us at {churchEmail}</>}
        </p>
      </div>
    </div>
  )
}
