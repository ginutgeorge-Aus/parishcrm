---
title: "Scheduled Jobs"
description: "A few background tasks — event reminder emails, abandoned-checkout cleanup, birthday/anniversary emails, and an optional error digest — are plain HTTP…"
---

A few background tasks — event reminder emails, abandoned-checkout cleanup,
birthday/anniversary emails, and an optional error digest — are plain HTTP
endpoints, not a built-in scheduler process. Call them with any scheduler you
already run: system cron, a platform's scheduled-job feature, or a CI
schedule.

## Using it

Each endpoint is a `POST` guarded by a bearer secret:

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://crm.example.org/api/cron/send-reminders
```

| Endpoint | Purpose | Suggested schedule |
|---|---|---|
| `POST /api/cron/send-reminders` | Sends event reminder emails to registrants for events with a reminder due. | Hourly |
| `POST /api/cron/sweep-checkouts` | Expires abandoned card-payment checkout sessions and scrubs their (already-encrypted) staged PII payload. | Hourly |
| `POST /api/cron/send-celebrations` | Sends birthday and wedding-anniversary emails, if enabled in Settings. | Daily |
| `POST /api/cron/error-issues` | Optional — groups recent server errors by fingerprint and files one GitHub issue per new error group (deduplicated against already-open issues); also purges old error/analytics rows. Only useful if `GITHUB_TOKEN` / `GITHUB_REPO` are set. | Weekly |

All four require `CRON_SECRET` to be set — with it unset, each endpoint
returns `503` and logs a loud warning rather than silently doing nothing, so
a misconfigured deployment is easy to notice. Set `CRON_SECRET` to a random
value (`openssl rand -base64 32`) and use the identical value in both the app
environment and your scheduler's `Authorization: Bearer` header.

## How it works

- **Idempotent, not fire-and-forget.** A crash mid-run, or two overlapping
  invocations, must never double-send an email or double-process a record.
  `send-reminders` and `send-celebrations` use a durable per-record claim
  (set atomically before sending, confirmed only after delivery succeeds) so
  a retried or overlapping run safely skips anything already sent or
  in-flight, and can reclaim a stale claim left by a crashed run.
- **`sweep-checkouts`** simply expires any checkout session still `OPEN` past
  its expiry time and clears its staged payload — a plain, safe-to-repeat
  bulk update.
- **`error-issues`** reads the last 7 days of a server-side error log, groups
  by a stable fingerprint, and skips any group that already has an open
  GitHub issue (matched by a fingerprint marker in the issue body) before
  filing a new one. It also purges error-log and route-view rows older than
  90 days.
- None of these endpoints require a session login — they authenticate only
  via the `CRON_SECRET` bearer token, so they're safe to call from an
  external scheduler with no browser session.
- The container runs as a **single replica** (the rate limiter is in-memory —
  see [Installation](/parishcrm/docs/installation/)), so there's no risk of two replicas racing each
  other's claims.

## Configuration

| Variable | Effect |
|---|---|
| `CRON_SECRET` | Required for all four endpoints to do anything. Unset = every call returns `503`. |
| `GITHUB_TOKEN`, `GITHUB_REPO` | Required for `error-issues` to file anything — otherwise it's a harmless no-op call. |

See [Environment Variables](/parishcrm/docs/environment-variables/) for the full reference.

## Related pages

- [Event Reminders](/parishcrm/docs/event-reminders/)
- [Birthdays and Celebrations](/parishcrm/docs/birthdays-and-celebrations/)
- [Card Payments (Stripe)](/parishcrm/docs/card-payments-stripe/)
- [Feedback Widget](/parishcrm/docs/feedback-widget/)
- [Operations Scripts](/parishcrm/docs/operations-scripts/)
