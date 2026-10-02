---
title: "Event Reminders"
description: "ParishCRM sends two different kinds of reminder email around an event: an automated \"the event is coming up\" email to everyone already registered, and a…"
---

ParishCRM sends two different kinds of reminder email around an event: an automated **"the event
is coming up"** email to everyone already registered, and a manual, staff-triggered
**"you still owe payment"** nudge to anyone whose registration is still unpaid. Both are separate
from event registration itself — see [Public Event Registration](/parishcrm/docs/public-event-registration/) for how a registration is
created and [Card Payments Stripe](/parishcrm/docs/card-payments-stripe/) for how a payment settles.

## Using it

### Automated event reminder (staff configures, system sends)

On the event edit form (see [Events Overview](/parishcrm/docs/events-overview/)), a one-off event can set **remind registrants N
days before** (1–90 days). Once set, a scheduled job checks daily whether the event has entered
that lead window and, if so, emails every non-cancelled registrant once — the event's date,
location, and public organiser contacts, in the parish's local timezone. This only applies to
one-off events with a concrete date; recurring events have no single date to count down from, so
they don't offer this option.

The reminder is sent **once per event**, ever — there's no per-registrant re-send and no way to
trigger it manually from the UI; it's purely a scheduled background job.

### Manual payment reminder (staff triggers)

From an event's registrations page (or an organiser's own event page), staff select some or all
`PENDING` registrations and send a **payment reminder** — free-text message plus the amount
owed and a link back to the registrant's own success page (which includes bank-transfer details
and, if online payment is enabled, a "pay now" button). Each attempt is tracked individually, so
the UI can show when a given registrant was last reminded, and a failed send doesn't block the
rest of the batch.

### Roles

| Role | Access |
|------|--------|
| ADMIN / PASTOR / OFFICE_ADMIN | Can send manual payment reminders for any event; configure the automated reminder on the event form |
| AUDITOR / VIEWER | No access to sending reminders |
| EVENT_ORGANISER | Can send manual payment reminders for events they're assigned to manage (see [Event Organisers](/parishcrm/docs/event-organisers/)) |

## How it works

### Automated reminder sweep (`src/lib/reminderSweep.ts`, `src/lib/eventReminders.ts`)

`POST /api/cron/send-reminders` is a bearer-token-gated endpoint, called by a scheduled job once
a day (plus several short-interval recovery calls shortly after, to catch a run that crashed
mid-send). For each candidate event:

1. `isReminderDue` (a pure, unit-tested function) checks the event is published, one-off, has a
   future date, has a reminder configured, and hasn't been sent yet.
2. The sweep **claims** the event with a short-lived lease before sending — this makes an
   overlapping or retried run safe: only one run can hold the lease at a time, and a run that
   crashes mid-send leaves the lease to expire so a later run can pick the event back up, rather
   than the event being stuck "reminded" forever with some registrants never actually emailed.
3. Emails are sent in small batches, renewing the lease between batches so a slow run for one
   large event can't be mistaken for a crashed one.
4. The durable "already reminded" marker is written only **after** delivery work has actually
   completed (at least one send succeeded) — never before — so a crash before that point is
   always recoverable by a later sweep, and never results in a false "sent" state with nothing
   delivered.
5. A total failure (every send for an event failed, e.g. mail delivery was down) releases the
   claim for retry rather than marking the event done; a partial failure still marks it done
   (each successful recipient was genuinely emailed) but logs the shortfall for ops visibility.

### Manual payment reminders (`sendPaymentReminders`, `src/lib/actions/registration.ts`)

- Re-validates every selected registration server-side (must belong to the given event, must
  still be `PENDING`, must have a valid email) — the client's selection is only ever a list of
  ids, never trusted for content.
- The email subject is fixed server-side (`Payment pending — <event title>`); only the body is
  operator-authored free text, capped in length — a free-text subject isn't allowed, since it
  would let PII or amounts leak into mail-server logs that store subjects in plaintext.
- Every attempt writes a `PaymentReminderSend` row (success or failure, with the recipient email
  encrypted at rest) immediately, so an interrupted batch never loses a record of what was
  actually attempted, and the UI can show "last reminded" per registration.
- Batches are capped (200 recipients per call).
- Sending a reminder **also extends the registrant's success-page link validity** by another 30
  days from the send — so a reminder to someone whose original link had already expired still
  gives them a working link, rather than showing "registration not found".

## Configuration

| Var | Effect |
|-----|--------|
| `CRON_SECRET` | Bearer token the automated reminder sweep (and the abandoned-checkout sweep — see [Card Payments Stripe](/parishcrm/docs/card-payments-stripe/)) must present. Unset makes the endpoint refuse every call (HTTP 503) rather than silently sending nothing — a misconfiguration is meant to be loud, not a quiet no-op |
| Scheduling | The reminder sweep and checkout sweep are triggered by an external scheduler (e.g. a daily/hourly CI job) calling their endpoints with the bearer token — the app itself has no built-in scheduler |

Manual payment reminders have no separate configuration — they use the same outbound email
setup as every other transactional email in the app.
