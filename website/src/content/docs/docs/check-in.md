---
title: "Check-In"
description: "On the day of an event, staff or an assigned organiser can check attendees in from a mobile-friendly list with search and QR scanning, using the check-in code…"
---

On the day of an event, staff or an assigned organiser can check attendees in from a
mobile-friendly list with search and QR scanning, using the check-in code shown on each
registrant's confirmation page. See [Public Event Registration](/parishcrm/docs/public-event-registration/) for where the registrant gets
their code, [Registrations Management](/parishcrm/docs/registrations-management/) for the wider registration list, and [Event
Organisers](/parishcrm/docs/event-organisers/) for the organiser's equivalent page.

## Using it

Staff open **Check-in** from an event's registrations page (`/events/[id]/check-in`); an assigned
`EVENT_ORGANISER` opens the same view from their own event (`/my-events/[id]/check-in`). Both
show one flat list of every named attendee across every non-cancelled registration for the
event — ticket type and who booked them, with a running "N / total checked in" count.

- **Search** — type a name, or a registrant's reference code, to filter the list.
- **Scan** — the scan button opens the device camera to read a registrant's QR code (from their
  success page or a printed pass); a successful scan fills the search box with the decoded
  reference so the matching attendee(s) surface immediately.
- **Check in / check out** — tap an attendee to toggle their status. The toggle applies
  immediately in the UI and confirms with the server in the background; if the server rejects it
  (e.g. a permissions problem, or the attendee no longer exists), the toggle reverts and an error
  is shown.

Checking an attendee in or out does not affect their registration's payment status — it is a
separate, purely attendance-tracking flag.

### Roles

| Role | Access |
|------|--------|
| ADMIN / PASTOR / OFFICE_ADMIN | Full check-in access on every event |
| AUDITOR | No access |
| VIEWER | No access — check-in requires edit-level access |
| EVENT_ORGANISER | Check-in access, but only for events they are explicitly assigned to manage |

## How it works

### Data (`Attendee.checkedInAt`)

Each `Attendee` row (one per named ticket-holder — see [Events Overview](/parishcrm/docs/events-overview/)) carries a nullable
`checkedInAt` timestamp. The check-in page fetches only non-PII fields for the list (names, no
email/phone), even though the underlying tables hold encrypted registrant contact details — the
check-in screen deliberately never needs or requests that data.

### Server action (`toggleAttendeeCheckIn`, `src/lib/actions/registration.ts`)

- Authorization uses the shared `canManageEvent` helper — true for any editor role, or for an
  `EVENT_ORGANISER` with an `EventManager` row linking them to this specific event. A downgraded
  organiser (role changed away from `EVENT_ORGANISER`) loses access even if a stale assignment
  row remains, since the role check is re-verified live, not just the link's existence.
- The attendee id is verified to belong to a registration of the given event id before the
  update runs (an IDOR guard) — an attendee id from a different event is rejected as "not found"
  rather than silently checking in the wrong event's attendee.
- Sets or clears `checkedInAt` and writes an audit-log entry (`ATTENDEE_CHECKED_IN` /
  `ATTENDEE_CHECKED_OUT`), then revalidates both the staff and organiser check-in paths so either
  surface reflects the change.

### Edge cases

- The check-in list re-syncs from the server on every page load (new registrations, or check-ins
  made from another device) while preserving any toggle the current device still has in flight,
  so a concurrent scan from a second device at the door doesn't get clobbered by a stale refresh.
- A double-tap on the same attendee is ignored while a request for that attendee is already in
  flight, rather than firing two overlapping toggles.

## Configuration

No dedicated environment variables. QR scanning uses the device's camera through the browser and
requires no server-side configuration; the QR codes themselves are plain SVG paths rendered from
each registration's opaque token (see [Public Event Registration](/parishcrm/docs/public-event-registration/)), not an external QR service.
