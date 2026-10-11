---
title: "Scheduled Jobs"
description: "A few background tasks — event reminder emails, abandoned-checkout cleanup, birthday/anniversary emails, an optional monthly clearance-compliance digest, and an optional error digest — run in-app by default, or via HTTP…"
---

A few background tasks — event reminder emails, abandoned-checkout cleanup,
birthday/anniversary emails, an optional monthly clearance-compliance digest, and an
optional error digest — run inside the
app by default: an in-process timer starts at boot (`IN_APP_CRON`, on in
production, off in development unless `IN_APP_CRON=true`) and checks for due
jobs every 5 minutes. Nothing to schedule, as long as the app stays running.
The same jobs are also plain HTTP endpoints you can call from an external
scheduler.

## In-app scheduler

| Job | When it runs |
|---|---|
| Event reminders, abandoned-checkout cleanup | Every 30 minutes |
| Birthday/anniversary emails | Once per Sydney day, from 07:00 |
| Clearance compliance digest | Once per Sydney month, on the 1st from 07:00 (catches up through the 7th if the app was down; at most 3 attempts per day per process; the count resets when the app restarts). Opt-in: needs `CLEARANCE_DIGEST=true`. Emails ADMIN and PASTOR users about people with a ministry role; nothing is sent in a month where every clearance is in order. |
| Error digest | Once per Sydney week, from Monday 09:00. Opt-in: needs `ERROR_DIGEST=true` plus `GITHUB_TOKEN` and `GITHUB_REPO`. |

A period job that does not fully succeed is retried 30 minutes later, at most
3 times per day, week or month. The timer only fires while the process is up, so on a
host that scales to zero or sleeps idle apps, set `IN_APP_CRON=false` and use
the endpoints below instead. Run a single app replica: each replica runs its
own timer. **Do not run both** the in-app scheduler and an external cron —
overlapping runs can occasionally resend an email.

## Using the endpoints

Use these for a host that sleeps, or if you set `IN_APP_CRON=false`. Call them
with any scheduler you already run: system cron, a platform's
scheduled-job feature, or a CI schedule.

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
| `POST /api/cron/send-clearance-digest` | Sends the monthly clearance-compliance digest to ADMIN and PASTOR users. An explicit call, so it does not need `CLEARANCE_DIGEST`. It respects the once-per-month guard: if this month's digest already went out it returns `{"status":"already-sent","month":"YYYY-MM"}` (HTTP 200) and sends nothing, so daily or retrying schedulers are safe. Add `?force=1` to send again deliberately. | Monthly (1st) |
| `POST /api/cron/error-issues` | Optional — groups recent server errors by fingerprint and files one GitHub issue per new error group (deduplicated against already-open issues); also purges old error/analytics rows. Only useful if `GITHUB_TOKEN` / `GITHUB_REPO` are set. | Weekly |

All five require `CRON_SECRET` to be set — with it unset, each endpoint
returns `503` and logs a loud warning rather than silently doing nothing, so
a misconfigured deployment is easy to notice. Set `CRON_SECRET` to a random
value (`openssl rand -base64 32`) and use the identical value in both the app
environment and your scheduler's `Authorization: Bearer` header.

## How it works

- **Idempotent, not fire-and-forget.** A crash mid-run, or two overlapping
  invocations, must never double-send an email or double-process a record.
  `send-celebrations` uses a durable per-record claim (set atomically before
  sending, confirmed only after delivery succeeds) so a retried or
  overlapping run safely skips anything already sent or in-flight, and can
  reclaim a stale claim left by a crashed run. `send-reminders` claims at the
  event level instead: an event's reminder is marked sent once any recipient
  succeeds (and released only if every send fails), so a recipient whose send
  failed in a partly-successful run is not retried.
- **`sweep-checkouts`** simply expires any checkout session still `OPEN` past
  its expiry time and clears its staged payload — a plain, safe-to-repeat
  bulk update.
- **`error-issues`** reads the last 7 days of a server-side error log, groups
  by a stable fingerprint, and skips any group that already has an open
  GitHub issue (matched by a fingerprint marker in the issue body) before
  filing a new one. It also purges error-log and route-view rows older than
  90 days.
- **`send-clearance-digest`** records the Sydney month it last sent in an app setting (`clearanceDigestLastMonth`) and takes a short lease while sending, so a second tick or an overlapping manual call cannot send at the same time. If the app stops after sending but before it marks the month done, the lease expires after 30 minutes and a retry may send again. It also keeps the addresses recorded as sent this month (`clearanceDigestDelivered`, email addresses only; an ambiguous mail-server error counts as sent). If any send fails the month normally stays open and the job retries, emailing only addresses not yet recorded; once all are recorded the month is marked done. The exception: if that list cannot be saved, the month is marked done anyway and failed sends are not retried, to avoid repeat emails. `?force=1` emails everyone again and replaces that list.
- None of these endpoints require a session login — they authenticate only
  via the `CRON_SECRET` bearer token, so they're safe to call from an
  external scheduler with no browser session.
- The container runs as a **single replica** (the rate limiter is in-memory —
  see [Installation](/parishcrm/docs/installation/)), so there's no risk of two replicas racing each
  other's claims.

## Configuration

| Variable | Effect |
|---|---|
| `IN_APP_CRON` | `true`/`false` forces the in-app scheduler on/off. Unset = on in production only. |
| `ERROR_DIGEST` | `true` enables the weekly error digest (also needs `GITHUB_TOKEN`/`GITHUB_REPO`). |
| `CLEARANCE_DIGEST` | `true` enables the monthly clearance-compliance digest in the in-app scheduler. The manual endpoint ignores it. |
| `CRON_SECRET` | Required for all five endpoints to do anything. Unset = every call returns `503`. |
| `GITHUB_TOKEN`, `GITHUB_REPO` | Required for `error-issues` to file anything — otherwise it's a harmless no-op call. |

See [Environment Variables](/parishcrm/docs/environment-variables/) for the full reference.

## Related pages

- [Event Reminders](/parishcrm/docs/event-reminders/)
- [Birthdays and Celebrations](/parishcrm/docs/birthdays-and-celebrations/)
- [Card Payments (Stripe)](/parishcrm/docs/card-payments-stripe/)
- [Feedback Widget](/parishcrm/docs/feedback-widget/)
- [Operations Scripts](/parishcrm/docs/operations-scripts/)
