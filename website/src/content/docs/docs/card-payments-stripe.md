---
title: "Card Payments (Stripe)"
description: "Events can optionally accept card payment through Stripe Checkout, as an alternative to (or alongside) bank transfer. This covers checkout, the webhook that…"
---

Events can optionally accept card payment through Stripe Checkout, as an alternative to (or
alongside) bank transfer. This covers checkout, the webhook that turns a successful payment into
a registration, the optional card-fee surcharge, "pay now" links for registrants who registered
by bank transfer but want to pay by card later, and the parish's no-refund policy. See
[Events Overview](/parishcrm/docs/events-overview/) for enabling online payment on an event and [Public Event Registration](/parishcrm/docs/public-event-registration/) for
the registrant-facing form.

## Using it

### For registrants

On the public event page, if online payment is enabled, a "pay by card" option sits alongside
bank transfer. Choosing it redirects to a Stripe-hosted checkout page; on completion the
registrant is bounced back to the event's success page, which now shows a paid confirmation
instead of bank-transfer instructions. If the event passes the card processing fee on to the
payer, the checkout total includes an extra "Card processing fee" line so the amount charged
matches what's shown at checkout.

A registrant who registered by bank transfer and later wants to pay by card instead can use the
**pay now** button that appears on their success/reminder page (also reachable from a payment
reminder email — see [Event Reminders](/parishcrm/docs/event-reminders/)) as long as their registration is still `PENDING` and
non-free. Opening the pay-now link twice (two tabs, or clicking a reminder link again) reuses the
same in-progress Stripe session rather than starting a second one.

### For staff

Enabling online payment and the surcharge are both event-level toggles on the event edit form
(**Events Overview**). There is no separate Stripe admin screen in the app — the card fee rate
itself (percentage + fixed cents) is an admin-only application setting, not per-event, with a
1.7% + $0.30 default matching Stripe's published Australian domestic card rate.

## How it works

### Checkout flow (`src/lib/actions/eventCheckout.ts`, `src/lib/stripeCheckout.ts`)

1. `startEventCheckout` (a server action, callable from the public page) re-prices the
   registration server-side exactly like the free/bank-transfer path, then creates a Stripe
   Checkout Session and a `CheckoutSession` staging row holding the priced, **encrypted**
   registration payload. **No `Registration` row exists yet** — it is created only once the
   webhook confirms the money actually arrived.
2. Per-ticket Stripe line items are used when no event-level discount applies (tiered pricing or
   family waiver); when a discount does apply, Stripe forbids negative line items, so the order
   collapses to one "Registration" line at the discounted net total to keep the charged amount
   and the priced total in exact agreement.
3. The checkout session expires 31 minutes after creation (just over Stripe's 30-minute floor).
4. `startExistingRegistrationCheckout` is the equivalent for the **pay-now** flow against an
   already-existing `PENDING` registration — it stages `registrationId` instead of a fresh
   payload, and locks the registration row so two concurrent pay-now attempts can't both open a
   payable session.

### Webhook (`POST /api/stripe/webhook`, `src/lib/stripeCheckout.ts::handleStripeWebhook`)

Verifies the Stripe signature over the raw request body before doing anything else; an unsigned
or badly-signed request is rejected without being parsed or logged. Handles:

| Event | Effect |
|-------|--------|
| `checkout.session.completed` (payment_status = `paid`) | Claims the staging row (atomic `OPEN`→`COMPLETED`, so a redelivered webhook can't double-process) and creates the `Registration` as `PAID` — or, for a pay-now session, flips the existing `PENDING` registration to `PAID` |
| `checkout.session.completed` (not yet settled, e.g. a delayed bank-debit method) / `checkout.session.async_payment_succeeded` | Extends the staging row's expiry so the sweep doesn't scrub it before settlement, then completes once success actually fires |
| `checkout.session.async_payment_failed` | Marks the staging row `EXPIRED` — no registration is created |
| `charge.refunded` (full) | Resolves the registration by its Stripe PaymentIntent and flips it to `CANCELLED`, freeing the seat |
| `charge.refunded` (partial) | Left alone — surfaced as an ops alert for manual review, since the parish's refunds are all-or-nothing |
| `charge.dispute.created` | Same cancel-by-PaymentIntent as a full refund |

The amount actually charged by Stripe is compared against the exact amount priced (net total
plus the surcharge snapshotted at checkout time) before a registration is ever created — a
mismatch (which should be unreachable in normal operation) blocks the registration, keeps the
money, and raises an ops alert rather than silently trusting Stripe.

### No-refund policy

The parish's policy is that **event tickets are never refunded** by the application. Every
"charged but the registration couldn't be completed" scenario (capacity sold out between
checkout and webhook, the event was deleted mid-checkout, an amount mismatch, a genuine duplicate
charge) keeps the money and raises an ops alert (email + log) for a human to resolve manually —
the code never calls Stripe's refund API on its own initiative. `charge.refunded` and
`charge.dispute.created` only **react** to a reversal a human or the cardholder's bank already
initiated in Stripe; they free the seat, they don't request the reversal.

A `CheckoutSession` can reach a terminal `UNFULFILLED` status specifically for this "charged, not
registered" case, so the success page can tell the payer plainly that something needs manual
follow-up instead of showing "still finalising" forever.

### Abandoned-checkout cleanup (`POST /api/cron/sweep-checkouts`)

An hourly, bearer-token-gated cron (`src/lib/checkoutSweep.ts`) marks any `CheckoutSession` still
`OPEN` past its expiry as `EXPIRED` and scrubs its encrypted PII payload — so an abandoned
checkout (someone who never completed Stripe Checkout) doesn't leave registrant data sitting
around indefinitely. A misconfigured/missing `CRON_SECRET` makes the sweep refuse every call
(HTTP 503) rather than silently no-op, so the failure is visible in logs.

### Security

- The webhook route requires the raw request body (needed for signature verification) and only
  runs in the Node.js runtime, never Edge.
- `AUTH_URL`/`APP_URL`, not the request's `Origin` header, is the trusted base URL used to build
  Stripe's success/cancel redirect targets — a spoofed header could otherwise be used as an
  open-redirect off the back of a real payment.
- Checkout creation is rate-limited (10/minute/IP) the same as the free registration path.

## Configuration

| Var | Effect |
|-----|--------|
| `STRIPE_SECRET_KEY` | Enables the Stripe integration; without it, online payment is unavailable regardless of the event's toggle |
| `STRIPE_WEBHOOK_SECRET` | Required for the webhook route to accept deliveries — register a webhook endpoint in the Stripe Dashboard pointed at `<your-app-url>/api/stripe/webhook`, subscribed at minimum to `checkout.session.completed` |
| `CRON_SECRET` | Bearer token the sweep-checkouts (and reminder) crons must present; unset disables the sweep |
| Card fee rate | Admin application setting (percentage + fixed cents per charge), not an env var — see `docs/stripe-surcharge-compliance.md` in the source repo for the legal basis (surcharge may never exceed Stripe's actual cost of acceptance) |
