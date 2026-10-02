---
title: "Birthdays and Celebrations"
description: "ParishCRM tracks member birthdays and family wedding anniversaries, surfaces them on the dashboard and dedicated pages, and can send personalised celebration…"
---

ParishCRM tracks member birthdays and family wedding anniversaries, surfaces them on the dashboard and dedicated pages, and can send personalised celebration emails — either sent manually by staff or automatically every day.

## Using it

**Nav:** dashboard home widgets, plus *People → Birthdays* (`/people/birthdays`) and *People → Anniversaries* (`/people/anniversaries`).

### Birthdays page
Lists members whose birthday falls within a chosen window (7, 14, or 30 days), grouped and sorted by how soon they're coming up, showing each member's family and how old they're turning. Anyone who can view people (`canViewPeople`) can see the list. Editors (`canEdit`: ADMIN/PASTOR/OFFICE_ADMIN) additionally see **Send** buttons to email an individual member, or a **Send all** bulk action for the current window.

### Anniversaries page
Same pattern for wedding anniversaries — reads `Family.marriageDate`, shows the couple's names (Head + Spouse), and how many years they'll be married. Manual send actions are limited to editors.

### Sending rules
- A birthday/anniversary email is only ever sent to someone with `emailConsent` still set and a usable email address — anyone who has withdrawn consent, or has no email on file, is skipped and counted separately from a real send.
- A person can never be emailed twice for the same celebration on the same day, no matter whether the send came from a manual click, a bulk "send all", or the automatic daily sweep (see below) — they all share one delivery lock.
- The email's wording adapts to the member's recorded gender (he/she/they pronouns); an unset gender defaults to "they/them".
- ADMIN can customise the birthday and anniversary email templates (subject/intro/body/signoff) in Settings, and send a test copy to themselves.

### Dashboard widgets
The dashboard home page shows a **Birthday widget** and an **Anniversary widget** (upcoming 7 days) plus a **Marriage Anniversary widget** for the current calendar month, for any role that can view people. These are read-only previews of the same underlying data — actually sending emails happens on the dedicated Birthdays/Anniversaries pages. See [Dashboard](/parishcrm/docs/dashboard/) for the rest of the home page.

### Roles
| Role | Access |
|------|--------|
| `ADMIN`, `PASTOR`, `OFFICE_ADMIN` | View lists + widgets, send individual/bulk emails, edit templates (ADMIN only) |
| `AUDITOR` | No access (accounting-only role) |
| `VIEWER` | View lists + widgets only, no send |
| `EVENT_ORGANISER` | No access |

## How it works

### Matching logic (pure, no DB)
`src/lib/birthdays.ts` and `src/lib/anniversaries.ts` are pure calculation modules — given a list of people/families and a window in days, they compute who's due, handling the year-end wrap (e.g. a birthday on 30 December still shows up from a query made on 28 December). Anniversary years are counted only from the first anniversary onward (the wedding year itself is excluded).

### Manual send (`src/lib/actions/birthday.ts`, `src/lib/actions/anniversary.ts`)
`sendBirthdayEmail(personId)` / `sendBirthdayEmailsBulk(windowDays)` — both `canEdit`-gated. Each decrypts the member's stored date of birth and email; a corrupted/undecryptable field is skipped (and, in the bulk path, logged without the member's identifier, so operational logs never couple a member id with a PII failure) rather than aborting the whole batch. Audited as `BIRTHDAY_EMAIL_SENT` (single) / `BIRTHDAY_EMAIL_BATCH_SENT` (bulk, with `{ window, sent, skipped, failed }`), and mirrored for anniversaries.

### Automatic daily sweep
`src/lib/celebrationSweep.ts::sendDueCelebrations` runs once a day (`/api/cron/send-celebrations`), reusing the same matchers at a zero-day window (exactly today). It's gated by two independent settings toggles (auto-birthday-email, auto-anniversary-email — both default **off**) so a parish can enable either feed independently. The route is authenticated with a bearer secret (`CRON_SECRET`) rather than a user session — since there's no session, it reads settings through session-free readers and records the audit trail against a null "System" actor (`AuditLog.userId` is nullable specifically for this).

### Idempotent delivery (no double-sends)
Both the manual send and the automatic sweep share one mechanism: before sending, the code inserts a `CelebrationSend` reservation row (unique on person + action + date). The **insert itself** is the race decision point — if two triggers (say, an admin's manual click and the daily cron) try to claim the same person/day at once, only one insert succeeds; the loser sees a conflict and skips. A `FAILED` reservation (the send attempt itself errored) can be retried; a `PENDING` reservation whose lease has gone stale (an invocation crashed mid-send) can be reclaimed after a short timeout; a `SENT` reservation is final.

## Configuration

- **Settings → auto-birthday-email / auto-anniversary-email** toggles (default off) — enable the daily automatic sweep independently for each celebration type.
- `CRON_SECRET` env var — required for the `/api/cron/send-celebrations` route to accept requests; if unset, the sweep refuses to run (fails loudly rather than silently sending nothing).
- Birthday/anniversary email subject/intro/body/signoff are editable per-parish in Settings → Email Templates.
