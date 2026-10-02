---
title: "Registrations Management"
description: "Once an event is live, staff manage its bookings from the event's Registrations page (/events/[id]/registrations) — the running list of everyone registered,…"
---

Once an event is live, staff manage its bookings from the event's **Registrations** page
(`/events/[id]/registrations`) — the running list of everyone registered, payment status,
revenue stats, a waitlist view, CSV/print export, check-in, and manual payment-status changes.
This page covers the admin-side registration workflow; see [Public Event Registration](/parishcrm/docs/public-event-registration/) for how
a booking is created, [Card Payments Stripe](/parishcrm/docs/card-payments-stripe/) for how card payments settle automatically, and
[Check In](/parishcrm/docs/check-in/) for the day-of check-in screen.

## Using it

### The registrations list

Staff with people-viewing access (`canViewPeople` — ADMIN/PASTOR/OFFICE_ADMIN/VIEWER) can view an
event's registrations; only editors (ADMIN/PASTOR/OFFICE_ADMIN) see the export, check-in,
reminder, and reset controls. The page shows:

- Headline stats — total registrations, paid count, cancelled count, revenue, and tickets sold
  per ticket type. These are computed from a full database rollup, not just the rows displayed,
  so they stay exact even for a very large event.
- Fill-rate, revenue-by-ticket-type, and registrations-over-time charts.
- The registration table itself (decrypted name/email/phone/amount/status), capped at the most
  recent 2000 rows for display — a "newest N of M" note appears if an event has more than that.
- **Volunteer view** toggle — turns on/off the shareable read-only crew link (see [Volunteer
  Crew Page](/parishcrm/docs/volunteer-crew-page/)).
- **Event managers** panel — assign or remove `EVENT_ORGANISER` accounts for this event (see
  [Event Organisers](/parishcrm/docs/event-organisers/)).
- **Export** buttons — CSV download and a print-friendly page.
- **Send payment reminders** — bulk-email everyone still `PENDING` (see [Event Reminders](/parishcrm/docs/event-reminders/)).
- **Reset registrations** (ADMIN, draft events only) — hard-deletes every registration, waitlist
  entry and checkout session for an unpublished event, for wiping test data before going live.

A registration row opens a detail dialog with the full decrypted order: contact details, order-
and attendee-level custom-question answers, and payment method (card vs bank transfer, inferred
from whether a Stripe payment reference is present).

### Changing payment status

- **Mark paid** — flips a `PENDING` bank-transfer registration to `PAID` once staff have
  reconciled the incoming bank transfer. A no-op if already `PAID`; blocked on a `CANCELLED`
  registration (it must be reactivated deliberately, not silently flipped back).
- **Cancel** — moves a registration (pending or already paid) to `CANCELLED`, freeing its ticket
  capacity. Cancelling a paid registration is the normal path for a staff-approved refund done
  outside the app (the no-refund policy in [Card Payments Stripe](/parishcrm/docs/card-payments-stripe/) is about the app never
  *initiating* a Stripe refund itself, not staff never cancelling a booking).

Both actions are guarded against racing a concurrent change (e.g. a Stripe webhook settling the
same registration at the same moment) — a lost race re-derives the correct outcome instead of
overwriting it.

### Waitlist

`/events/[id]/waitlist` lists everyone waiting for a sold-out ticket type, in join order, with a
**notified** toggle staff flip once they've reached out to offer a freed seat — this is a manual
process; the app does not auto-email the waitlist when a seat opens up.

### Export

- **CSV** (`GET /api/events/[slug]/export-csv`) — one row per registration plus every ticket
  line and attendee, decrypted, with every custom-question answer as its own column. Rate-limited
  per user; every export is written to the audit log with the row count (never the exported PII
  itself). Available to editors and to an `EVENT_ORGANISER` assigned to that specific event.
- **Print** (`/events/[id]/registrations/print`) — a browser-printable page with registration,
  attendee, and custom-answer tables; also audit-logged on access.

Both exports prefix any CSV cell that starts with `=`, `+`, `-` or `@` with a leading quote, to
neutralise spreadsheet formula-injection from attacker-supplied names/answers.

### Roles

| Role | Access |
|------|--------|
| ADMIN | Full access, plus delete/reset a draft event's registrations |
| PASTOR | Full access except delete/reset |
| OFFICE_ADMIN | Full access except delete/reset |
| AUDITOR | No access to this page |
| VIEWER | Read-only — can view the list, no export/reminders/check-in/status changes |
| EVENT_ORGANISER | Their own assigned event's registrations only, via `/my-events` — see [Event Organisers](/parishcrm/docs/event-organisers/) |

## How it works

### Server actions (`src/lib/actions/registration.ts`)

- `markPaid`, `cancelRegistration` — `canEdit`-gated, each re-reads the current status and
  applies a guarded conditional update (only if the row is still in the expected source state)
  rather than an unconditional write, closing a race window against a concurrent webhook or
  another staff member.
- `getRegistrationDetail` — decrypts and returns one registration's full detail for the dialog;
  authorized for either a `canViewPeople` staff role or an organiser assigned to that event.
- `resetEventRegistrations` — see [Events Overview](/parishcrm/docs/events-overview/).
- `sendPaymentReminders`, `lastRemindedAtByRegistration` — see [Event Reminders](/parishcrm/docs/event-reminders/).

Every mutating action writes an audit-log entry (`REGISTRATION_PAID`, `REGISTRATION_CANCELLED`,
`EVENT_REGISTRATIONS_RESET`, `EXPORT_CSV`, `EXPORT_EVENT_REGISTRATIONS`, etc.) — never with
decrypted PII in the metadata, only ids/counts.

### Edge cases

- CSV/print exports run against `take: 10000` (CSV) or the full set (print) rather than the
  2000-row display cap, so the export is always complete even when the on-screen table is
  truncated.
- A cancelled registration's `RegistrationItem`s stay in the database (for audit trail) but are
  excluded from every capacity/fill-rate/tickets-sold count, matching the public page's sold-out
  logic exactly.

## Configuration

No dedicated environment variables — this area is gated purely by user role. CSV/print export
rate limits and the 2000-row display cap are fixed in code, not configurable.
