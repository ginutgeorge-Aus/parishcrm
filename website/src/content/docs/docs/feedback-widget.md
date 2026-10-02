---
title: "Feedback & Bug Reports"
description: "The app has two separate \"report something\" widgets — one for logged-in staff, one for anonymous visitors on the public pages — that both file directly into…"
---

The app has two separate "report something" widgets — one for logged-in staff, one for anonymous visitors on the public pages — that both file directly into GitHub Issues rather than a custom ticket table. See [Help-and-Whats-New](/parishcrm/docs/help-and-whats-new/) for where staff track their own reports, and [Email-Notifications](/parishcrm/docs/email-notifications/) for the mail module these widgets also use.

## Using it

### Staff (logged-in) feedback

1. Click **Feedback** at the bottom of the sidebar (any authenticated role).
2. Choose a type — **Bug**, **Feature**, or **Idea** — and fill in the guided prompts (for a bug: what you were doing / what you expected / what happened; for feature or idea: your request, and optionally why it helps).
3. Submit. On success you're told which GitHub issue number it became.
4. Track your own submissions and their live status (Open / Resolved / Won't-fix) under **My Reports** (`/reports`), reachable from the Help page or directly.

### Public (unauthenticated) feedback

1. On any public page (the membership form, an event's public page, etc.) a floating feedback button opens the same style of dialog, offering **Bug** or **Feedback**.
2. An optional "your email" field lets the visitor ask for a reply — this is **only** used to notify the parish office by email; it is never written into the GitHub issue.
3. If Turnstile is configured, the widget verifies it before submitting.
4. Submit — the visitor sees a generic thank-you message, not an issue number (issue numbers are an internal detail for staff).

## How it works

- **Staff path**: `submitFeedback` (`src/lib/actions/feedback.ts`) — Zod-validates a discriminated union (bug vs feature/suggestion), rate-limits 5 reports per 10 minutes per user (in-memory, per-replica), then builds a GitHub issue title/body and calls `createIssue`. The reporter line in the issue body is `"<name> (<role>, user #<id>)"` — **never the reporter's email address**, because GitHub issues are visible to every repo collaborator and a staff email there would be a PII leak. A `Report` row is created locally (type, title, summary, the GitHub issue number, page URL) and an audit log entry (`FEEDBACK_SUBMITTED`) is written.
- **Public path**: `submitPublicFeedback` (`src/lib/actions/publicFeedback.ts`) — honeypot field, Zod validation, Turnstile verification, and a per-IP rate limit (5/hour, DB-backed so it survives across replicas). The reporter line in the GitHub issue body is always the literal string `"Public visitor"` — a real identity is never put there, matching the staff path's PII rule. If the visitor supplied a contact email, it is passed only to `notifyChurch()`, which emails the parish's `ownerNotificationEmail` (if configured) with the visitor's contact address, page URL, and the raw (non-markdown-escaped) details — this email is separate from, and never becomes part of, the GitHub issue. No local `Report` row is created for public submissions (there's no session to own one), and there is no audit-log entry (no authenticated actor).
- **Shared issue-body builder**: `src/lib/feedbackIssue.ts` (`buildIssueTitle`, `buildIssueBody`, `escapeMarkdown`) — escapes user text for safe markdown, restricts the accepted `pageUrl` to a strict app-relative-path pattern (blocks markdown/URL injection into the issue body's **Page:** line), and appends a captured client context block (user agent, language, viewport/screen size, device pixel ratio) plus a localized timestamp.
- **GitHub API**: `src/lib/github.ts::createIssue` posts to the GitHub REST API with a fine-grained PAT, labelling bug/feature/suggestion issues respectively `bug` / `enhancement` / `suggestion`, and public-sourced issues additionally get a `public` label. A 5-second timeout guards against a hung GitHub API stalling the submitting action. If `GITHUB_TOKEN`/`GITHUB_REPO` aren't configured, issue creation throws and the widget shows a generic "could not send" error — the caught error text is never shown to the user, since it can include API/token detail.
- **Status sync**: `syncMyReports()` runs on every load of `/reports` (the app has no scheduler, so this is a lazy poll) and refreshes any of the current user's `OPEN` reports whose status hasn't been checked in the last minute, capped to 20 GitHub calls per page load, oldest-synced first. A GitHub failure here is swallowed — the list just shows the last-known status.

## Configuration

| Env var | Purpose |
|---|---|
| `GITHUB_TOKEN` | Fine-grained GitHub PAT with Issues: write on `GITHUB_REPO`. Unset = both feedback widgets fail closed with a generic error when submitted (the widgets themselves still render). |
| `GITHUB_REPO` | `owner/repo` the issues are filed against. |

The parish office notification address for the *public* widget is the same **Settings → App Settings → Owner notification email** used for the email-delivery-failure alert described in [Email-Notifications](/parishcrm/docs/email-notifications/) — there's no separate setting for it.
