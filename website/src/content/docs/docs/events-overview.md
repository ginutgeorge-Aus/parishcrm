---
title: "Events Overview"
description: "ParishCRM's Events module lets a parish create and publish events, sell tickets with optional tiered family pricing or a family fee waiver, collect custom…"
---

ParishCRM's Events module lets a parish create and publish events, sell tickets with optional
tiered family pricing or a family fee waiver, collect custom registration questions, cap
attendance with waitlists, take card payments via Stripe, and delegate day-of running of an
event to a non-admin volunteer. This page covers creating and configuring an event; see
[Public Event Registration](/parishcrm/docs/public-event-registration/) for what a registrant sees, [Card Payments Stripe](/parishcrm/docs/card-payments-stripe/) for the
payment flow, [Registrations Management](/parishcrm/docs/registrations-management/) for the admin registrations list, and
[Event Organisers](/parishcrm/docs/event-organisers/) / [Volunteer Crew Page](/parishcrm/docs/volunteer-crew-page/) for delegated access.

## Using it

### Creating and editing an event (staff)

From the sidebar, staff with edit access go to **Events** (`/events`) and click **New Event**.
The form (`/events/new`, and `/events/[id]/edit` for editing) covers:

- **Basics** — title, slug (used in the public URL `/e/<slug>`, lowercase letters/numbers/hyphens
  only), description, category (worship, youth, fellowship, education, parish, special —
  used as a tag if synced to a public website), location.
- **Kind** — a **one-off** event has a single date/time (and optional end date); a **recurring**
  event instead has a recurrence pattern (e.g. every Sunday, 2nd/3rd/4th Sunday) plus a display
  label and start time — recurring events have no concrete registration deadline logic tied to a
  single date.
- **Registration deadline** — an optional cut-off, separate from the event date itself; the form
  rejects a deadline set after the event/end date.
- **Ticket types** — up to 20 rows, each with a name, price, optional capacity, and a
  "counts toward family waiver" checkbox. Removing a ticket type that already has registrations
  is blocked; lowering its capacity below the quantity already sold is blocked too.
- **Family pricing** — mutually exclusive with the family waiver (below); when enabled, the
  registration is priced from a **tiered pricing schedule**: dollar amounts entered per
  headcount (1 attendee, 2 attendees, …), non-decreasing, up to 20 tiers. The array length is
  the hard cap on group size for one registration.
- **Family fee waiver** — alternative to tiered pricing. Once a single registration's headcount
  on waiver-eligible ticket types passes a configurable threshold (default 4), the extra
  attendees are free — cheapest ticket types waived first. A ticket type can be excluded (e.g. a
  "Visitor" type that should always pay).
- **Custom questions** — up to 20 questions (text, textarea, number, date, phone, email, select,
  radio, checkbox, consent), each optionally required, optionally scoped to specific ticket
  types, and optionally scoped **per-attendee** rather than once per order. Choice-type questions
  can allow a free-text **"Other" write-in**. Preset questions (dietary requirements,
  accessibility needs, emergency contact, t-shirt size) are offered as quick-adds.
- **Online payment** — toggle to accept card payment via Stripe (only shown/effective when
  Stripe is configured — see [Card Payments Stripe](/parishcrm/docs/card-payments-stripe/)), and an option to pass the card
  processing fee on to the payer as a surcharge.
- **Images** — an optional banner (shown on the public page hero) and poster, each up to 2 MB,
  JPEG/PNG/WebP. A pasted external image URL is also accepted as a banner fallback.
- **Reminder email** — an optional "remind registrants N days before" setting (one-off events
  only) — see [Event Reminders](/parishcrm/docs/event-reminders/).
- **Bank details** — BSB/account number shown to registrants who owe a bank transfer.

Saving is optimistic-concurrency guarded: if someone else changed the event since the form
loaded, the save is rejected with a reload prompt rather than silently overwriting their change.

**Publish / unpublish** and **close/open registration** are separate one-click toggles on the
events list or edit page. An unpublished (draft) event's public page returns the same "not
found" response as a nonexistent slug, so draft URLs can't be discovered by probing. Closing
registration keeps the public page visible but hides the registration form behind a
"registration closed" panel — useful for capping sign-ups without hiding the event.

Deleting an event is blocked while it has non-cancelled registrations or an in-flight card
payment — cancel registrations individually first. A convenience **"Reset registrations"**
button (ADMIN only, draft events only) hard-deletes all registrations/waitlist/checkout rows in
one go, for testing an event before it goes live.

### Roles

| Role | Access |
|------|--------|
| ADMIN | Full create/edit/publish/delete; only role that can delete an event or reset draft registrations |
| PASTOR | Full create/edit/publish; cannot delete an event |
| OFFICE_ADMIN | Full create/edit/publish; cannot delete an event |
| AUDITOR | No access to event editing |
| VIEWER | Read-only — can view the events list and registrations, no edits |
| EVENT_ORGANISER | No access to the main Events admin — see [Event Organisers](/parishcrm/docs/event-organisers/) for their own `/my-events` area |

## How it works

### Data model (`prisma/schema.prisma`)

- `Event` — one row per event; `slug` is unique and is the public URL key. `customQuestions`,
  `organizers` (public-facing organiser contact list) and `familyPricingTiers` are stored as
  JSON columns.
- `TicketType` — belongs to an `Event`; `price` is a `Decimal(10,2)`, `capacity` optional.
- `Registration` → `RegistrationItem` (one row per ticket type in an order, snapshotting
  `unitPrice` at registration time so later price edits never affect existing orders) →
  `Attendee` (one row per named attendee, holding per-attendee custom-question answers).
- `Waitlist`, `CheckoutSession`, `EventImage`, `EventManager` — see [Public Event
  Registration](/parishcrm/docs/public-event-registration/), [Card Payments Stripe](/parishcrm/docs/card-payments-stripe/) and [Event Organisers](/parishcrm/docs/event-organisers/) respectively.

### Server actions (`src/lib/actions/event.ts`, `eventForm.ts`, `eventAccess.ts`)

- `createEvent` / `updateEvent` / `deleteEvent` / `publishEvent` / `setRegistrationClosed` —
  all role-gated with `canEdit` (delete additionally requires `isAdmin`), all re-validate
  server-side with a shared Zod schema (`EventSchema`) regardless of what the client sent.
- `updateEvent` diffs ticket types against the existing rows (rather than delete-all-recreate) so
  `RegistrationItem` foreign keys and price snapshots survive an edit, runs inside a
  `Serializable` transaction, and retries on a concurrent-registration conflict.
- Ticket-type capacity tightened below its already-sold quantity, or removal of an in-use ticket
  type, both roll back the whole save with a specific error rather than partially applying.
- `resetEventRegistrations` (`src/lib/actions/registration.ts`) is double-guarded: ADMIN only,
  and refuses if the event has ever taken a non-cancelled registration (checked by registration
  history, not just the current publish flag) — an event can't be unpublished then reset to
  silently destroy paid records.

### Edge cases

- A capacity change and a public registration can race; both the edit-save path and the public
  registration path re-check capacity inside a `Serializable` database transaction and retry on
  conflict, so neither can oversell a ticket type.
- Removing every custom question or organiser must persist as an empty list, not "no change" —
  the app writes `[]` explicitly rather than omitting the column.
- Postgres integer/decimal overflow (very large capacity or ticket price) is caught and turned
  into a friendly validation error rather than a raw 500.

## Configuration

No dedicated environment variables gate event creation itself. Related optional integrations:

| Var | Effect |
|-----|--------|
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Enables the online-payment toggle — see [Card Payments Stripe](/parishcrm/docs/card-payments-stripe/) |
| `TURNSTILE_SECRET_KEY` / `TURNSTILE_SITE_KEY` | Enables CAPTCHA on the public registration/waitlist forms |
| `WEBSITE_SYNC_URL` / `WEBSITE_SYNC_SECRET` | Pushes event create/update/publish/delete to an external public website as an HMAC-signed webhook, so a separate parish website can mirror a public events calendar without its own admin. Off by default; delivery is best-effort (a slow/unreachable receiver never blocks saving the event) and an ADMIN "Resync website" button on `/events` recovers any missed pushes |
| `CRON_SECRET` | Required for the reminder-email and abandoned-checkout sweep crons — see [Event Reminders](/parishcrm/docs/event-reminders/) and [Card Payments Stripe](/parishcrm/docs/card-payments-stripe/) |
