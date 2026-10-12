---
title: "Event Organisers"
description: "A dedicated EVENT_ORGANISER role lets a parish delegate day-to-day running of a specific event — viewing its registrations, exporting, sending payment…"
---

A dedicated `EVENT_ORGANISER` role lets a parish delegate day-to-day running of a specific
event — viewing its registrations, exporting, sending payment reminders, and checking attendees
in — to a volunteer who should not have general dashboard access to the rest of the CRM (people,
families, accounting, other events). Multiple organisers can be assigned to the same event. See
[Events Overview](/parishcrm/docs/events-overview/) for how an admin assigns an organiser, [Registrations Management](/parishcrm/docs/registrations-management/) and
[Check In](/parishcrm/docs/check-in/) for what an organiser can do once assigned, and [Volunteer Crew Page](/parishcrm/docs/volunteer-crew-page/) for a
lighter-weight, no-login alternative for sharing read-only booking info.

## Using it

### For admins

On an event's registrations page (`/events/[id]/registrations`), editors see an **Event
managers** panel listing every `EVENT_ORGANISER` user account currently assigned, with an
add/remove control drawing from the pool of all `EVENT_ORGANISER` accounts in the system (create
the user account itself from **Users**, same as any other staff account, with the role set to
Event Organiser). Assigning is idempotent — assigning someone already assigned is a no-op, not
an error — and removing is a plain unassign, not a delete of their user account.

### For organisers

An `EVENT_ORGANISER` account has no access to the main dashboard at all — logging in takes them
straight to **My Events** (`/my-events`), a simple list of the events they're assigned to, each
showing its date and current registration count. From there:

- **Registrations** (`/my-events/[id]/registrations`) — the same registration list, stats, and
  payment-reminder tooling an editor sees for that one event (see [Registrations Management](/parishcrm/docs/registrations-management/)),
  scoped to that event only.
- **Check-in** (`/my-events/[id]/check-in`) — the same search/scan check-in screen an editor
  uses (see [Check In](/parishcrm/docs/check-in/)).

An organiser cannot see, edit, or export data for any event they are not assigned to, cannot
create or edit events, and has no access to the People, Families or accounting areas of the app.

The same login can also be assigned to Sunday School classes as a **roll marker**; they then see
**Classes** (`/my-classes`) and can take those classes' rolls only. This is the one place an
organiser sees member data: the children's **names and their Present/Late/Absent marks** (including
earlier rolls) for those classes, with no contact details, dates of birth or notes. See [Sunday School](/parishcrm/docs/sunday-school/).

### Roles

| Role | Access |
|------|--------|
| ADMIN / PASTOR / OFFICE_ADMIN | Can assign/unassign organisers on any event; can also open `/my-events` themselves (mainly useful for testing) since editors are always allowed through |
| AUDITOR / VIEWER | No organiser-assignment access |
| EVENT_ORGANISER | Sees only `/my-events` and their assigned events' registrations/check-in, plus `/my-classes` rolls for classes they're assigned to; redirected away from every other authenticated route |

## How it works

### Data model

`EventManager` (`prisma/schema.prisma`) is a join row: `eventId` + `userId`, unique per pair, so
one user can be assigned to many events and one event can have many organisers. It cascades on
either the event or the user being deleted, but **not** on a role change — if an organiser's
account is later demoted to a different role, their `EventManager` rows are left in place but
become inert.

### Access gate (`src/lib/eventManager.ts::canManageEvent`)

Every organiser-reachable action or page calls `canManageEvent(userId, eventId, role)`, which:

1. Grants access immediately to any editor role (`ADMIN`/`PASTOR`/`OFFICE_ADMIN`).
2. Otherwise requires the role to currently be `EVENT_ORGANISER` **and** an `EventManager` row
   to exist linking that user to that event.

Requiring the *current* role (not just the link row) closes a gap where a downgraded organiser
(now e.g. `VIEWER`) could otherwise keep reaching event data through a stale assignment that was
never explicitly cleaned up.

The `(organiser)` route group's layout (`src/app/(organiser)/layout.tsx`) additionally bounces
anyone who is neither an `EVENT_ORGANISER` nor an editor straight back to the dashboard, as a
belt-and-braces check on top of the per-action gate — the app's routing middleware separately
confines a logged-in `EVENT_ORGANISER` session to `/my-events` in the first place.

Server actions reachable from organiser pages (`sendPaymentReminders`,
`lastRemindedAtByRegistration`, `toggleAttendeeCheckIn`, `getRegistrationDetail`, the CSV export
route) all independently re-check `canManageEvent` rather than trusting that only an authorized
page could have called them — since a "use server" export is itself a callable network endpoint.

### Edge cases

- Assigning a user who isn't currently an `EVENT_ORGANISER`, or an archived (soft-deleted) user,
  is rejected server-side even if such an id is submitted directly.
- Listing assignable organisers (for the admin picker) excludes archived accounts.

## Configuration

No dedicated environment variables — access is entirely role- and assignment-driven. Create an
`EVENT_ORGANISER` account from **Users** the same way as any other staff account.
