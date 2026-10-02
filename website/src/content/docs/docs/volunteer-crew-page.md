---
title: "Volunteer Crew Page"
description: "For a helper who just needs a quick look at how an event is filling up — without a full user account or the ability to see personal contact details — an event…"
---

For a helper who just needs a quick look at how an event is filling up — without a full user
account or the ability to see personal contact details — an event can expose a **volunteer view**:
a single, no-login, shareable link showing fill rate and the list of bookings by name only. This
is a lighter alternative to giving someone a full [EVENT_ORGANISER account](/parishcrm/docs/event-organisers/)
when all they need is visibility, not the ability to check people in or send reminders.

## Using it

### For staff

On an event's registrations page (`/events/[id]/registrations`), editors see a **Volunteer view**
panel with a **Turn on** button. Turning it on mints a unique link
(`/e/<slug>/crew/<token>`) and shows a copy button. Turning it off again clears the token, so the
previously-shared link immediately stops working — useful once the event is over or the link was
shared more widely than intended. **Regenerate** mints a fresh token (invalidating the old link)
without disabling the feature, for recovering from a link that leaked or was shared too broadly.

### For the volunteer

The link needs no login. Opening it shows:

- The event's title and date.
- Fill-rate per ticket type (sold vs capacity).
- The list of bookings — attendee's first/last name, payment status, total amount, and which
  ticket type(s) they booked — with **no email, phone, or custom-question answers**.

The page has no controls to check anyone in, change payment status, or export anything — it is
strictly a read-only status board.

## How it works

### Token (`src/lib/volunteerToken.ts`, `Event.volunteerToken`)

`Event.volunteerToken` is a nullable, unique column: `null` means the volunteer view is off. When
turned on, a fresh 144-bit random token (base64url-encoded, URL-safe) is generated and stored;
turning it back on later (without ever disabling it) reuses the existing token rather than
rotating it, so a previously-shared link keeps working across an admin toggling the panel. The
public page (`/e/[slug]/crew/[token]`) resolves the event purely by looking up this token — the
token **is** the credential, there is no session or role check — and additionally verifies the
`slug` in the URL matches the event the token belongs to, so a token can't be relocated under an
arbitrary path.

### Privacy

The page's database query explicitly selects a reduced set of fields (`firstName`, `lastName`,
`paymentStatus`, `totalAmount`, ticket type names) — it never fetches or decrypts email, phone,
or custom-question answers. Names, payment status and amounts are still personal data, so treat
the link as sensitive and share it only with the crew who need it. Cancelled registrations are excluded from both the booking list and the fill-rate
calculation, the same rule used everywhere else capacity is shown.

### Security

- The page sets `robots: { index: false, follow: false }` and is always rendered dynamically
  (never cached/pre-rendered), so a leaked link can't end up indexed or served stale by a search
  engine or CDN cache.
- Regenerating the token is the recovery path for a leaked link — the old token stops resolving
  to anything immediately.
- Turning the feature off (rather than just not sharing the link) is the only way to fully
  guarantee a previously-issued link stops working, since the token itself has no expiry while
  the feature stays on.

## Configuration

No dedicated environment variables. Availability is purely the per-event on/off toggle described
above; the feature has no global enable/disable switch.
