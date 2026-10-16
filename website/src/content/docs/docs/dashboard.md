---
title: "Dashboard"
description: "The dashboard is the authenticated home page (/) — a role-aware overview with a stats strip, what needs you today, a money snapshot, and upcoming celebrations."
---

The dashboard is the authenticated home page (`/`) — a role-aware overview with a welcome heading and slim stats strip, then a **Needs attention** list (what needs you today), a money snapshot (for roles that can see it) and upcoming celebrations. Every visitor sees a version of it scoped to what their role can access.

## Using it

**Nav:** the app's landing page after login — no separate menu entry needed.

What's shown, top to bottom:
- **Title + stats strip**: a "Welcome back" heading with one slim line of numbers — total families (and how many are active), total members, families/people added in the last 30 days, and upcoming events in the next 30 days. Member figures only show for roles that can view people; the events count shows for everyone.
- **Needs attention**: one row per pending item, each with a count and a link to the page that resolves it. Rows with a zero count are hidden, and when nothing is pending you see a calm "All caught up" line instead. Only items your role can see and act on appear:
  - *Family updates to review* → `/families/updates` (editors: Admin, Pastor, Office Admin)
  - *Membership applications to review* → `/memberships` (editors)
  - *Unreconciled transactions* → the Reconciliation page's pending view (Admin, Pastor — the roles that can reconcile). Counts every unreconciled transaction up to today across all payment accounts, i.e. the scope the Reconciliation page works through (that page lists at most 1,000 rows per view, so a very large backlog is cleared in batches). The link opens the account with the most pending transactions, starting from its oldest one.
  - *Open petty cash sessions* → `/accounting/petty-cash` (Admin, Pastor — the roles that can close a session)
  - *Birthdays in the next 7 days* → `/people/birthdays` (roles that view people). Shown as "N+" when the birthday source list hit its fetch cap, since the true number may be higher.
- **Money** (accounting-viewing roles only): one primary figure — this month's giving so far, with the change against the same month last year — plus a tile per payment account showing its balance since the opening balance. Balance tiles are tinted green in credit and red when overdrawn, and the figure carries a `+`/`−` marker so the sign never relies on colour alone.
- **People** widgets: birthdays and wedding anniversaries in the next 7 days, plus every couple with an anniversary in the current calendar month.
- A **What's New** footer surfacing recent release notes.

`AUDITOR` and `OFFICE_ADMIN` see the money section but not the accounting rows of Needs attention — they can view accounting but not reconcile or close petty cash. `AUDITOR` also gets no member figures or people widgets (those queries aren't even run) — it's an accounting-only role. `VIEWER` sees the people side only. `EVENT_ORGANISER` doesn't reach the dashboard at all (redirected to their own `/my-events`).

## How it works

Implemented entirely as one server component (`src/app/(dashboard)/page.tsx`) that fires its data queries in parallel (`Promise.all`) and derives everything else in memory:

- **Timezone-correct "today"**: uses `sydneyToday()` (`src/lib/dates.ts` — despite the legacy name, it resolves the date in the configured `APP_TIMEZONE`) rather than the server's raw UTC clock — for timezones ahead of UTC the server's UTC date can be a day behind for part of the day, which would otherwise skew "last 30 days," "upcoming events," and the birthday/anniversary windows by a day.
- **Birthday/anniversary data reuses the same pure matchers** described in [Birthdays and Celebrations](/parishcrm/docs/birthdays-and-celebrations/) (`upcomingBirthdays`/`upcomingAnniversaries`) — the dashboard widgets are a display-only 7-day-window preview; sending emails happens on the dedicated Birthdays/Anniversaries pages, not here.
- **Fetch caps**: the birthday and anniversary source queries are capped (`PERSON_FETCH_CAP`, `src/lib/constants.ts`) so the widget query doesn't grow unbounded with membership size — one query fetches one row past the cap purely to detect truncation, and shows a "may be incomplete" note when hit. Both queries use a deterministic `orderBy: { id: "asc" }` so the truncated set is stable rather than an arbitrary database ordering.
- **Decrypt safety**: dates of birth and marriage-linked emails are decrypted with a safe wrapper that returns a sentinel on a corrupt/rotated-away ciphertext; a record that decrypts to an invalid date is dropped from the widget rather than poisoning the whole sort/window calculation for everyone else.
- **Needs attention**: built by a pure helper (`buildAttentionItems`, `src/lib/dashboardAttention.ts`) from data the page loads; the same file builds the unreconciled deep link. Each row's role gate matches who can act on it. The review-queue and accounting counts are plain database counts — nothing is decrypted to produce them (except the birthdays row, described at the end of this bullet). Pending family updates and membership applications use React-cached helpers in `src/lib/pendingUpdates.ts`, shared with the sidebar badges so each runs once per page load. The birthdays row reuses the birthday widget's 7-day list, which is built from decrypted dates of birth (the same capped fetch the widget already needs).
- **Giving figures and balances**: month-to-date and same-month-last-year income aggregates, plus per-payment-account balances derived from each account's configured opening balance — only computed at all when the viewer can see accounting. Unreconciled transactions come from one separate per-account `groupBy` (count + oldest date), run only for Admin/Pastor.

## Configuration

No dedicated environment variables. "Today" follows `APP_TIMEZONE` (see [Regional Configuration](/parishcrm/docs/regional-configuration/)); the person-fetch cap is a code-level constant.
