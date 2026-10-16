---
title: "Dashboard"
description: "The dashboard is the authenticated home page (/) — a role-aware overview that leads with what needs you today, then a stats strip, a money snapshot, and upcoming celebrations."
---

The dashboard is the authenticated home page (`/`) — a role-aware overview that leads with a **Needs attention** list (what needs you today), followed by a slim stats strip, a money snapshot (for roles that can see it) and upcoming celebrations. Every visitor sees a version of it scoped to what their role can access.

## Using it

**Nav:** the app's landing page after login — no separate menu entry needed.

What's shown, top to bottom:
- **Title + stats strip**: a "Welcome back" heading with one slim line of numbers — total families (and how many are active), total members, families/people added in the last 30 days, and upcoming events in the next 30 days. Member figures only show for roles that can view people; the events count shows for everyone.
- **Needs attention**: one row per pending item, each with a count and a link to the page that resolves it. Rows with a zero count are hidden, and when nothing is pending you see a calm "All caught up" line instead. Only items your role can see and act on appear:
  - *Family updates to review* → `/families/updates` (editors: Admin, Pastor, Office Admin)
  - *Membership applications to review* → `/memberships` (editors)
  - *Unreconciled transactions* → the Reconciliation page's pending view (roles that view accounting). Counts transactions since each account's opening balance; when they're all in one account the link opens that account directly.
  - *Open petty cash sessions* → `/accounting/petty-cash` (roles that view accounting)
  - *Birthdays in the next 7 days* → `/people/birthdays` (roles that view people)
- **Money** (accounting-viewing roles only): one primary figure — this month's giving so far, with the change against the same month last year — plus a tile per payment account showing its balance since the opening balance. Balance tiles are tinted green in credit and red when overdrawn, and the figure carries a `+`/`−` marker so the sign never relies on colour alone.
- **People** widgets: birthdays and wedding anniversaries in the next 7 days, plus every couple with an anniversary in the current calendar month.
- A **What's New** footer surfacing recent release notes.

`AUDITOR` sees the money section and the accounting rows of Needs attention but no member figures or people widgets — it's an accounting-only role. `VIEWER` sees the people side only. `EVENT_ORGANISER` doesn't reach the dashboard at all (redirected to their own `/my-events`).

## How it works

Implemented entirely as one server component (`src/app/(dashboard)/page.tsx`) that fires its data queries in parallel (`Promise.all`) and derives everything else in memory:

- **Timezone-correct "today"**: uses `sydneyToday()` (`src/lib/dates.ts` — despite the legacy name, it resolves the date in the configured `APP_TIMEZONE`) rather than the server's raw UTC clock — for timezones ahead of UTC the server's UTC date can be a day behind for part of the day, which would otherwise skew "last 30 days," "upcoming events," and the birthday/anniversary windows by a day.
- **Birthday/anniversary data reuses the same pure matchers** described in [Birthdays and Celebrations](/parishcrm/docs/birthdays-and-celebrations/) (`upcomingBirthdays`/`upcomingAnniversaries`) — the dashboard widgets are a display-only 7-day-window preview; sending emails happens on the dedicated Birthdays/Anniversaries pages, not here.
- **Fetch caps**: the birthday and anniversary source queries are capped (`PERSON_FETCH_CAP`, `src/lib/constants.ts`) so the widget query doesn't grow unbounded with membership size — one query fetches one row past the cap purely to detect truncation, and shows a "may be incomplete" note when hit. Both queries use a deterministic `orderBy: { id: "asc" }` so the truncated set is stable rather than an arbitrary database ordering.
- **Decrypt safety**: dates of birth and marriage-linked emails are decrypted with a safe wrapper that returns a sentinel on a corrupt/rotated-away ciphertext; a record that decrypts to an invalid date is dropped from the widget rather than poisoning the whole sort/window calculation for everyone else.
- **Needs attention**: built by a pure helper (`buildAttentionItems`, `src/lib/dashboardAttention.ts`) from counts the page already loads. Each row's role gate mirrors the guard on the page it links to, so a row never sends you somewhere that bounces you back. Counts are plain database counts — nothing is decrypted to produce them. Pending family updates reuse `countPendingFamilyUpdates()` (shared with the sidebar badge); pending membership applications are a `count` on `MembershipApplication`; the birthdays row reuses the birthday widget's 7-day list.
- **Giving figures and balances**: month-to-date and same-month-last-year income aggregates, plus per-payment-account balances derived from each account's configured opening balance — only computed at all when the viewer can see accounting. The per-account balance query is grouped by reconciled status too, so the same single query also yields the unreconciled-transactions count.

## Configuration

No dedicated environment variables. "Today" follows `APP_TIMEZONE` (see [Regional Configuration](/parishcrm/docs/regional-configuration/)); the person-fetch cap is a code-level constant.
