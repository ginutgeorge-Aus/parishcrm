---
title: "Public Event Registration"
description: "Each published event gets a public, unauthenticated page at /e/<slug> where anyone can register — no account required. The page shows the event details, a…"
---

Each published event gets a public, unauthenticated page at `/e/<slug>` where anyone can
register — no account required. The page shows the event details, a ticket/attendee form with
any custom questions the parish configured, and (if the event is full) a waitlist form. After
submitting, the registrant lands on a success page with a QR check-in code and payment
instructions. This page covers the public-facing flow; see [Events Overview](/parishcrm/docs/events-overview/) for how staff
configure an event and [Card Payments Stripe](/parishcrm/docs/card-payments-stripe/) for the card-payment path.

## Using it

### Registering (public)

1. Open the event link (`/e/<slug>`). An unpublished or unknown slug both show the same
   "not found" page — there is no way to tell a draft event apart from one that doesn't exist.
   A past event (its end date, or date if no end date, already passed) also reads as not found.
2. Pick ticket type(s) and quantities. If pricing is **tiered by family size**, the total is
   looked up from the total number of attendees across the whole order rather than summed
   per-ticket; if a **family waiver** is configured, the parish's configured threshold and
   discount preview is shown as tickets are added.
3. Enter a name for every attendee (one name per ticket unit) plus the registrant's own contact
   details (name, email, phone).
4. Answer any custom questions the parish configured — some apply to the whole order, others are
   asked once per named attendee. A select/radio/checkbox question may offer a free-text
   **"Other"** box alongside its preset options.
5. If the event accepts card payment, choose to pay online (redirects to Stripe Checkout — see
   [Card Payments Stripe](/parishcrm/docs/card-payments-stripe/)) or leave it as a bank-transfer booking (pending until the parish
   receives and reconciles the transfer).
6. Submit. A registrant who resubmits with the same email for the same event within about 10
   minutes is treated as an accidental double-click — no second registration is created, and the
   success page shows a "you're already registered" notice referencing the original booking
   rather than creating a duplicate.

If every ticket type is sold out, the registration form is replaced (or, for a partially sold-out
event, supplemented) by a **waitlist form**: name + email against a specific sold-out ticket
type. A ticket type that still has capacity is never waitlistable — the form always registers
those directly. Joining a waitlist a second time for the same event/ticket type/email is treated
as a harmless no-op.

### Success page

After submitting, the registrant is redirected to `/e/<slug>/success?ref=<token>` and sees:

- Attendee summary, total amount, and — if a family waiver applied — how many attendees were
  freed.
- A **QR code** (the registration's opaque reference) to show at check-in.
- Either bank-transfer instructions (account name, BSB, account number, reference, amount, and a
  "Pay by card" button if online payment is enabled), a "paid by card" confirmation, or a
  "no payment required" notice for a free event.
- Add-to-calendar links (Google Calendar and a downloadable `.ics` file) for one-off events.
- The event's public organiser contacts, if configured.

The link stays valid, and the bank details/QR code keep working, for **30 days** after
registration — or 30 days from the most recent staff payment reminder, whichever is later — after
which the page shows "registration not found" rather than remain a permanent lookup for anyone
who finds the link. A cancelled registration (refunded, disputed, or cancelled by staff) shows an
explicit "registration cancelled" state instead of live booking details.

## How it works

### Registration pipeline (`src/lib/eventRegistration.ts`, `eventRegistrationPricing.ts`,
`eventRegistrationPersist.ts`)

`POST /api/events/[slug]/register` is public and unauthenticated. It:

1. Rate-limits to 10 requests/minute per IP and caps the request body at 100 KB before parsing.
2. Confirms the event is published, not past its end date, and registration isn't explicitly
   closed.
3. Validates the submitted body with Zod (ticket quantities capped at 100 per type and 100
   attendees total per registration; custom-question maps capped at 50 keys) and rejects any
   answer to a question the event doesn't actually have.
4. Runs three layered bot defences before anything else: a hidden **honeypot** field that a
   script but not a human fills in, a signed **timing token** issued when the page rendered
   (rejects submissions faster than 3 seconds or older than 2 hours), and — only when
   `TURNSTILE_SECRET_KEY` is configured — a **Cloudflare Turnstile** CAPTCHA check. All three
   failures return the same generic error so a bot can't tell which check it tripped.
5. Prices the order server-side from the event's current ticket prices, tiered schedule, or
   waiver rule — client-submitted prices are never trusted.
6. Persists the registration inside a `Serializable` database transaction that re-checks ticket
   capacity against live data (closing the gap between the pre-check above and the actual write)
   and retries automatically on a concurrent-registration conflict.
7. Sends a confirmation email (fire-and-forget; a delivery failure never fails the registration),
   itself rate-limited per recipient email to stop the public endpoint being used as a spam
   relay.

The response never echoes a duplicate registration's public token back to the resubmitting
caller — only the original submitter (who already has it from their first response/email) can
see it, so a repeat submission with someone else's email can't be used to steal their check-in
QR code.

### Registration statuses (`Registration.paymentStatus`)

`PENDING` (awaiting bank transfer or card payment) → `PAID` (bank transfer reconciled by staff,
or card payment confirmed by the Stripe webhook) or `CANCELLED` (staff cancellation, a full
Stripe refund, or a Stripe dispute — see [Card Payments Stripe](/parishcrm/docs/card-payments-stripe/)). A free ($0) registration
stays `PENDING` forever since no payment ever occurs — the UI treats that as "nothing to pay",
not "awaiting payment".

### Security

- Every public lookup (registration, checkout session, waitlist) is scoped by an opaque,
  cryptographically random token plus its parent event id — never a bare sequential row id — so
  a sequential-id enumeration attack can't walk other people's registrations.
- The success-page token lookup is itself rate-limited per IP to make brute-forcing a token
  impractical.
- All registrant PII (email, phone, custom-question answers, attendee names' associated answers)
  is encrypted at rest; an email **blind index** (a deterministic HMAC alongside the encrypted
  value) lets the app match a member's own registrations without decrypting the whole table.

## Configuration

| Var | Effect |
|-----|--------|
| `TURNSTILE_SECRET_KEY` / `TURNSTILE_SITE_KEY` | Both set → CAPTCHA is enforced on the register/waitlist forms; unset (default) → CAPTCHA step is skipped entirely, only the honeypot + timing token apply |
| `AUTH_SECRET` | Signs the anti-bot timing token; must be set (it's already required for login) |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Enables the "pay by card" path — see [Card Payments Stripe](/parishcrm/docs/card-payments-stripe/) |
