---
title: "Help & What's New"
description: "Two small, low-friction in-app reference pages: a static Help page explaining the basics, and a What's New release-notes history. Neither has a…"
---

Two small, low-friction in-app reference pages: a static **Help** page explaining the basics, and a **What's New** release-notes history. Neither has a database-backed workflow — both are plain content pages. See [Feedback-Widget](/parishcrm/docs/feedback-widget/) for how staff report a problem instead of asking for help, and [Membership-Applications](/parishcrm/docs/membership-applications/) for the membership-specific items the Help page points at.

## Using it

### Help

1. Open **Help** in the sidebar (`/help`) — available to every authenticated role.
2. The page adapts to what the signed-in user can actually do:
   - Everyone sees **Login & password** (how the one-time email code works, "remember this device" for 14 days, "Forgot password", and where to manage trusted devices/sign-outs) and **Feedback & bug reports** (how to use the Feedback button and where to check status).
   - Anyone with edit access (`ADMIN`/`PASTOR`/`OFFICE_ADMIN`) additionally sees **People & Families** (adding a family/members, editing, sending a self-update link) and the "create events" line under **Events**.
   - Anyone who can view accounting (`ADMIN`/`PASTOR`/`AUDITOR`/`OFFICE_ADMIN`) additionally sees an **Accounting** section pointing at the Accounting area.
   - `VIEWER` and `EVENT_ORGANISER` see only the always-visible sections.
3. There are no interactive controls on this page — it's pure reference text with no forms or actions.

### What's New

1. Open **What's New** in the sidebar (`/whats-new`), or click the "See all updates" link at the bottom of a home-page footer widget that already shows the current release's highlights inline.
2. The page lists every released version, newest first, each with its release date and a short bullet list of plain-English, user-facing highlights (what changed for staff, not internal engineering detail).
3. Available to every authenticated role — no role gating, since it's product news with nothing sensitive in it.

## How it works

- **Help page**: `src/app/(dashboard)/help/page.tsx` — a server component that reads the session role once and conditionally renders sections using the same role helpers used throughout the app (`canEdit`, `canViewAccounting` from `src/lib/roleGuard.ts`). No database reads, no client interactivity.
- **What's New data**: `src/lib/whatsNew.ts` exports a single hand-maintained array (`WHATS_NEW`) of `{ version, date, highlights[] }` entries, newest first — this is the one source of truth for both the `/whats-new` page and the home-page footer widget. A helper (`findEntry`) looks up the entry matching the currently-running build's version (from the `NEXT_PUBLIC_APP_VERSION` build-time env var) so the footer widget can show just that release's highlights; it degrades gracefully to a link-only footer if the running version has no matching entry (e.g. a build between tagged releases). A unit test fails on the release PR until the top entry matches the new `package.json` version, so every release ships with an entry.
- **Content discipline**: entries are meant to describe user-facing behavior changes only — internal refactors, dependency bumps, and security-fix specifics are deliberately left out of this list (they belong in the project's engineering changelog instead), so the page stays readable as a plain product-history log for non-technical staff.

## Configuration

Neither page has runtime configuration. The version shown by the footer widget and used to select the matching `WHATS_NEW` entry comes from the `NEXT_PUBLIC_APP_VERSION` build-time variable, set automatically by the CI/CD pipeline from the release git tag — it is not something an admin edits at runtime.
