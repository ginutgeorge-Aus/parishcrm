---
title: "Dashboard"
description: "The dashboard is the authenticated home page (/) — a role-aware overview combining people/family stats, upcoming celebrations, \"needs attention\" tiles, and…"
---

The dashboard is the authenticated home page (`/`) — a role-aware overview combining people/family stats, upcoming celebrations, "needs attention" tiles, and (for roles that can see it) a giving snapshot. Every visitor sees a version of it scoped to what their role can access.

## Using it

**Nav:** the app's landing page after login — no separate menu entry needed.

What's shown:
- **Headline stats**: total families, active families, total members, and how many families/people were added in the last 30 days.
- **Birthday widget**: members with a birthday in the next 7 days (name, family, age turning).
- **Anniversary widget**: couples with a wedding anniversary in the next 7 days.
- **Marriage anniversary widget**: every couple with an anniversary in the current calendar month.
- **Needs-attention tiles** (only shown/actionable for roles that can act on them): pending family self-update submissions awaiting review (editors), open petty cash sessions (roles that view accounting), upcoming events in the next 30 days (everyone).
- **Giving snapshot** (accounting-viewing roles only): this month's giving so far, compared against the same month last year, plus per-account balances.
- A **What's New** footer surfacing recent release notes.

All the people/family widgets are visible to any role with `canViewPeople`; the giving figures only render for roles with `canViewAccounting`. `AUDITOR` sees the giving numbers but not the people widgets (opposite of most roles) — it's an accounting-only role. `EVENT_ORGANISER` doesn't reach the dashboard at all (redirected to their own `/my-events`).

## How it works

Implemented entirely as one server component (`src/app/(dashboard)/page.tsx`) that fires its data queries in parallel (`Promise.all`) and derives everything else in memory:

- **Timezone-correct "today"**: uses `sydneyToday()` (`src/lib/dates.ts` — despite the legacy name, it resolves the date in the configured `APP_TIMEZONE`) rather than the server's raw UTC clock — for timezones ahead of UTC the server's UTC date can be a day behind for part of the day, which would otherwise skew "last 30 days," "upcoming events," and the birthday/anniversary windows by a day.
- **Birthday/anniversary data reuses the same pure matchers** described in [Birthdays and Celebrations](/parishcrm/docs/birthdays-and-celebrations/) (`upcomingBirthdays`/`upcomingAnniversaries`) — the dashboard widgets are a display-only 7-day-window preview; sending emails happens on the dedicated Birthdays/Anniversaries pages, not here.
- **Fetch caps**: the birthday and anniversary source queries are capped (`PERSON_FETCH_CAP`, `src/lib/constants.ts`) so the widget query doesn't grow unbounded with membership size — one query fetches one row past the cap purely to detect truncation, and shows a "may be incomplete" note when hit. Both queries use a deterministic `orderBy: { id: "asc" }` so the truncated set is stable rather than an arbitrary database ordering.
- **Decrypt safety**: dates of birth and marriage-linked emails are decrypted with a safe wrapper that returns a sentinel on a corrupt/rotated-away ciphertext; a record that decrypts to an invalid date is dropped from the widget rather than poisoning the whole sort/window calculation for everyone else.
- **Pending family updates**: `countPendingFamilyUpdates()` powers the "Family updates to review" tile, gated to editors only.
- **Giving figures**: month-to-date and same-month-last-year income aggregates, plus per-payment-account balances derived from each account's configured opening balance — only computed at all when the viewer can see accounting, to avoid the extra queries for roles that can't use the numbers.

## Configuration

No dedicated environment variables. "Today" follows `APP_TIMEZONE` (see [Regional Configuration](/parishcrm/docs/regional-configuration/)); the person-fetch cap is a code-level constant.
