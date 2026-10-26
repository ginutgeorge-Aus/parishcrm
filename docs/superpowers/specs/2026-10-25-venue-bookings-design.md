# Venue bookings & monthly invoice request — design

Date: 2026-10-25 · Status: approved by PO · Branch: `feat/venue-usage`

## Problem

Some churches don't own a building and hire another parish's church/hall (typically every
Sunday). Today an officer tracks dates by hand, emails the venue to book dates, and each month
emails the venue asking for an invoice listing each date used, its times and hours. Committee
members have no shared view of booked dates.

## Goals

1. Record venue bookings per date, with a lifecycle (requested → confirmed / cancelled).
2. Email the venue a booking request for new dates (with already-booked dates for reference).
3. Email the venue a monthly invoice request listing confirmed usage and total hours —
   manually, or automatically on the 1st at 09:00 (Australia/Sydney) once an admin approves.
4. Give committee members a no-login, read-only calendar via a secret, resettable link.

Non-goals (v1): accounting link (invoice is recorded as a normal expense), `.ics` feed,
committee-submitted requests, standing/recurring bookings, multiple venues.

## Data model

### `VenueUsage` (one row per booked date; part 1 — exists)
| Field | Notes |
|---|---|
| `date` `@db.Date` | UTC-midnight calendar date |
| `startTime`, `endTime` | `"HH:mm"` (any minute; the time inputs use the browser default step), end > start, no overnight |
| `status` `VenueBookingStatus` | `REQUESTED` \| `CONFIRMED` \| `CANCELLED` |
| `purpose String?` | **Public** (shown on the calendar) |
| `notes String?` | Private |
| `bookingRequestedAt DateTime?` | **New (part 3):** set when included in a sent booking request |
| `createdById` | User, `SetNull` |

One row per date. Times hold the booked times; after the day the admin edits them to the
actual times used (the original booked time is not kept). Multiple rows per date allowed.

### `VenueUsageRequest` (one row per month `"YYYY-MM"`; part 1 — exists)
Existing: `sentAt`, `sentTo` (encrypted), `status`, `errorMessage`, `sentById`,
`reminderSentAt`, `reminderClaimedAt`.
**New (part 2):** `approvedAt DateTime?`, `approvedById Int?` (User, `SetNull`),
`autoSent Boolean @default(false)`.

### Settings (`AppSetting`, allowlisted)
Existing: `venueUsage.enabled`, `.venueName`, `.contactName`, `.contactEmail`,
`.ccEmail` (invoice CC), `.replyToEmail`.
**New:** `.bookingCcEmails` (comma-separated, each validated).
The calendar token is stored in its own `AppSetting` key (`VENUE_CALENDAR_TOKEN_KEY` in
`src/lib/venueCalendar.ts`), outside the settings allowlist (CSPRNG, unset = calendar
disabled; "Reset link" mints a new one).

### Rules
- Invoice request and totals count **CONFIRMED** rows in the month only.
- "Already booked" in booking requests = CONFIRMED rows with `date >= today` (Sydney).
- A month is **complete** when every Sunday in it has ≥1 CONFIRMED or CANCELLED row, no
  row in the month is REQUESTED, and ≥1 row is CONFIRMED.

## Admin page — "Venue bookings" (canEdit, feature enabled)

- Month picker; table (cards <md) — status badge, date, time, hours, purpose, edit/cancel;
  confirmed-hours total.
- Add single date (prefill next Sunday 17:00–20:00; future → REQUESTED, past/today →
  CONFIRMED) **or** "Add all Sundays in <month>" (same times, REQUESTED, skips dates that
  already have a non-cancelled row).
- Bulk select → "Mark confirmed" / "Cancel".
- **Cancel** asks "Email venue about this cancellation?" → optional cancellation notice to
  contact + booking CCs.
- **Send booking request** panel: REQUESTED rows with `bookingRequestedAt = null`, ticked by
  default; preview (new dates + "Already booked"), To / CC / "Replies go to". On success sets
  `bookingRequestedAt`; already-asked rows show "asked on <date>".
- **Invoice request** panel (default previous month): warnings (past REQUESTED, unsettled
  Sundays, zero rows), preview, last-sent status, Send / Resend (explicit).
  For the **current** month: "Approve automatic send on 1 <next month>, 9:00 AM" — enabled
  only when complete; confirm dialog with preview; records `approvedAt/By`.
  "Withdraw approval" available until sent.
- **Approval invalidation:** any create/update/delete/status change of a row in an approved,
  unsent month clears `approvedAt/By` (same transaction) and audits it; UI shows
  "Approval cleared — dates changed, please re-approve".
- Calendar link box: copy link, reset link (ADMIN).

## Emails

All sent via the existing mail helper with `replyTo` = `replyToEmail` (fallback: acting user;
for the scheduler: `replyToEmail`, else no Reply-To).

| Email | To | CC |
|---|---|---|
| Booking request | contact | booking CCs, reply-to address |
| Cancellation notice | contact | booking CCs, reply-to address |
| Invoice request | contact | invoice CC, reply-to address |
| Reminder / "sent" notice | all active canEdit users | — |

Wording for booking request and invoice request is editable via `EmailTemplate` keys
`venueBookingRequest` and `venueInvoiceRequest` with vars `{venueName}`, `{contactName}`,
`{churchName}`, `{month}`, `{dates}`, `{bookedDates}`, `{totalHours}`, `{senderName}`.
Date lines render as `Sunday, 6 September: 5:00 PM – 8:30 PM (3.5 hours)`. All interpolated
values HTML-escaped.

## Monthly job (in-app scheduler)

Runs daily; acts only inside the window `venueJobWindowOpen` (`src/lib/venueSchedule.ts`): Sydney day 1 to 7 of the month, from 09:00. A month already sent is left alone, so later days of the window do nothing. For the previous
month:
1. Feature disabled or no contact email → no-op.
2. Claim the month's `VenueUsageRequest` via an atomic lease on `reminderClaimedAt`
   (pattern: `celebrationClaim` / `reminderSweep`; stale after 10 min). Lost claim → no-op.
3. Already `sentAt` with SUCCESS → release, no-op.
4. Approved **and** still complete → send invoice request (`autoSent = true`), then email
   all canEdit users "Invoice request for <month> sent".
5. Otherwise → email all canEdit users the reminder: what's missing + link to the page.
6. Set `reminderSentAt` only after the work completes; never before.

## Public calendar — `/venue/[token]`

- No auth; token compared against `venueUsage.calendarToken` (constant-time); unknown or
  feature disabled → 404. `robots: noindex`; rate-limited (`src/lib/rateLimit.ts`).
- Month grid (confirmed = green, pending = amber) + list below: date, time, purpose,
  Confirmed/Pending. CANCELLED hidden. Prev/next month; range −12 to +6 months.
- Shows venue name only — no CRM data, no notes, no names. Mobile-first.

## Errors, security, audit

- Every send writes outcome (status, error) and is retryable; failures surface in UI.
- Role gates at page **and** action (`canEdit`; settings + link reset = ADMIN).
- `logAudit` on every mutation, approval, approval-clear, send, link reset.
- Demo mode: sends blocked (as part 1).

## Testing

- Lib: time parsing, hours, Sunday enumeration, month completeness, month boundaries,
  Dec→Jan, Sydney 1st-at-09:00 gate.
- Email builders: lines, totals, booked-dates section, escaping, template vars.
- Actions: role gates, validation, add-all-Sundays dedup, approval + invalidation,
  booking-request marking, cancellation email, send success/failure, resend guard.
- Job: claim once (concurrent), approved+complete → send, not approved → reminder,
  already sent → no-op, stale lease reclaim.
- Public page: valid/invalid/reset token, disabled feature, no notes leaked.
- Manual: 375px and ≥1920px layouts of admin page and calendar.

## Delivery

- **Part 1 (done, `cb921d8`):** model, settings, log page, manual invoice send.
- **Part 2:** approval + monthly job + EmailTemplate integration + website docs/README.
- **Part 3:** booking request + cancellation email + `bookingCcEmails` + public calendar.

Shipped as one PR (risky class: migration + public route) → waits for CodeRabbit review.
