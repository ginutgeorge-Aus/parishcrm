---
title: "Environment Variables"
description: "The canonical, up-to-date list of every variable the app reads lives in .env.example in the repository — this page mirrors it, grouped by purpose. Copy it to…"
---

The canonical, up-to-date list of every variable the app reads lives in
[`.env.example`](https://github.com/ginutgeorge-Aus/parishcrm/blob/main/.env.example)
in the repository — this page mirrors it, grouped by purpose. Copy it to
`.env.local` for local development (see [Installation](/parishcrm/docs/installation/)) or `.env` for a
deployment.

A missing or invalid **required** value fails the app at boot with a clear
error (`src/lib/envCheck.ts`), rather than a confusing runtime failure later.

Church identity, branding, letters, receipts, and accounts are configured
**in-app** (Settings), not through environment variables — see
[Settings and Branding](/parishcrm/docs/settings-and-branding/). A few of these also have env
fallbacks used until an admin fills in the Settings form (see below).

> **No trailing comments after any value**, active or commented out —
> `docker --env-file` keeps them as part of the value once a line is
> uncommented.

## Required

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string. Add `?sslmode=require` for a remote database. |
| `AUTH_SECRET` | Signs sessions and sign-in codes. Generate with `openssl rand -base64 32`. |
| `AUTH_URL` | Public `https://` URL in production. Must exactly match the URL used to reach the app, or sign-in redirects break. |
| `ENCRYPTION_KEY` | Field-level encryption key. Generate with `openssl rand -base64 32`. Back it up separately from the database — losing it makes encrypted member data unrecoverable. |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | Gmail SMTP credentials (or use `RESEND_API_KEY` + `MAIL_FROM` instead) for sign-in codes (OTP), receipts, and notification emails. Required at boot unless `DISABLE_OTP` is set (local dev only); every other email feature still needs them regardless. The password is a Gmail **app password**, not the account login — see [Gmail Setup](/parishcrm/docs/gmail-setup/). |
| `RESEND_API_KEY`, `MAIL_FROM` | Alternative to Gmail: Resend HTTPS API key + sender address on a verified domain. Setting the key switches all mail to Resend (use where SMTP is blocked, e.g. Railway Hobby). See [Gmail Setup](/parishcrm/docs/gmail-setup/). |

## Setup and startup (optional)

| Variable | Purpose |
|---|---|
| `SETUP_TOKEN` | Enables `/setup` (create the first ADMIN) while the database has zero users. The page disables itself once any user exists; unset it after setup. |
| `MIGRATE_ON_START` | Default `true`: the container runs `prisma migrate deploy` before starting. Set `false` to manage migrations yourself (e.g. a separate pre-deploy job). |

## Church identity (fallbacks)

Used until an ADMIN fills in **Settings → Church Information**, which then
takes precedence.

| Variable | Purpose |
|---|---|
| `CHURCH_NAME` | Church name shown in the UI, emails, and documents before Settings is configured. |
| `CHURCH_ADDRESS` | Postal address for receipts and letters. |
| `CHURCH_ABN` | Tax / charity registration number (region-specific name — Australian Business Number by default). |
| `CHURCH_WEBSITE` | Public website URL, linked from public pages. |

## Regional (defaults = Australia)

See [Regional Configuration](/parishcrm/docs/regional-configuration/) for full detail.

| Variable | Purpose |
|---|---|
| `APP_FY_START_MONTH` | Financial-year start month, `1`–`12` (default `7` = July). |
| `APP_TIMEZONE` | IANA timezone (default `Australia/Sydney`). |
| `APP_LOCALE` | BCP-47 locale for money/date formatting (default `en-AU`). |
| `APP_CURRENCY` | ISO-4217 currency code, also the Stripe checkout currency (default `AUD`). |

## Theme (optional)

Applies to the UI, PDFs, emails, print pages, and the mobile browser status
bar. See [Settings and Branding](/parishcrm/docs/settings-and-branding/).

| Variable | Purpose |
|---|---|
| `THEME_PRIMARY` | Primary brand colour, hex `#RRGGBB`. Unset = neutral slate. |
| `THEME_PRIMARY_DARK` | Deeper primary shade (section bands, buttons). Falls back to `THEME_PRIMARY` when unset. |
| `THEME_ACCENT` | Accent colour for emphasis / rule lines. |

## Scheduled jobs (optional)

See [Scheduled Jobs](/parishcrm/docs/scheduled-jobs/).

| Variable | Purpose |
|---|---|
| `IN_APP_CRON` | `true`/`false` forces the in-app scheduler on or off. Unset = on in production only. Set `false` on a host that sleeps/scales to zero and call the endpoints below instead; don't run both. |
| `CLEARANCE_DIGEST` | `true` enables the monthly clearance-compliance digest (1st of the month, 07:00 Sydney) in the in-app scheduler. The manual `POST /api/cron/send-clearance-digest` endpoint does not need it. |
| `ERROR_DIGEST` | `true` enables the weekly error digest in the in-app scheduler. Also needs `GITHUB_TOKEN` and `GITHUB_REPO`. |
| `CRON_SECRET` | Bearer secret required by `POST /api/cron/{send-reminders,sweep-checkouts,send-celebrations,error-issues}`. Unset = those endpoints refuse every call, disabling reminders, celebration emails, the abandoned-checkout cleanup sweep, and (if configured) the error digest. |

## Card payments (optional)

OFF unless **both** are set — otherwise event registrations fall back to
bank transfer (pending). Register a Stripe webhook pointed at
`<AUTH_URL>/api/stripe/webhook`.

| Variable | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe secret API key. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for the Stripe webhook endpoint. |

## CAPTCHA on public forms (optional)

Cloudflare Turnstile. Set both or neither — the server demands a token
whenever the secret is set, and the widget only renders when the site key is
present.

| Variable | Purpose |
|---|---|
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret key. |
| `TURNSTILE_SITE_KEY` | Cloudflare Turnstile site key (public). `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is still accepted as a deprecated alias. |

## Membership applications (optional)

| Variable | Purpose |
|---|---|
| `MEMBERSHIP_SECRETARY_EMAIL` | Where public membership-form alerts go. Precedence: Settings → App Settings field, then this variable, then `GMAIL_USER`. |

## Event website sync (optional)

Pushes an HMAC-signed webhook to an external site on event
create/update/publish/delete. Off unless both are set. See
[Event Website Webhook](/parishcrm/docs/event-website-webhook/).

| Variable | Purpose |
|---|---|
| `WEBSITE_SYNC_URL` | Receiver endpoint (must be a public `https://` URL). |
| `WEBSITE_SYNC_SECRET` | Shared HMAC key, e.g. `openssl rand -base64 32`. |

## In-app bug reports (optional)

Powers the [Feedback Widget](/parishcrm/docs/feedback-widget/) and the optional weekly
prod-error digest cron.

| Variable | Purpose |
|---|---|
| `GITHUB_TOKEN` | Fine-grained personal access token with Issues: write on `GITHUB_REPO`. Unset = the feedback widget is disabled. |
| `GITHUB_REPO` | Target repository, `owner/repo` form. |

## Observability (optional)

| Variable | Purpose |
|---|---|
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | OpenTelemetry connection string (Azure Application Insights or any OTLP-compatible collector). Unset = no telemetry. |

## Encryption key rotation

`ENCRYPTION_KEY` alone acts as key v1. To rotate to a new key, in order:

1. Promote it: set `ENCRYPTION_KEY_V1` to the **same value** as
   `ENCRYPTION_KEY` (boot refuses a non-v1 `ENCRYPTION_KEY_ID` while v1 still
   only exists as the `ENCRYPTION_KEY` alias).
2. Add `ENCRYPTION_KEY_V2=<new key>` and set `ENCRYPTION_KEY_ID=v2`.
3. Run `npx tsx scripts/rotate-encryption-key.ts --apply --yes` (see
   [Operations Scripts](/parishcrm/docs/operations-scripts/)).

**Keep the v1 key permanently** — the email/mobile lookup hashes are derived
from it, and it decrypts any value not yet rotated. Losing it is
unrecoverable.

| Variable | Purpose |
|---|---|
| `ENCRYPTION_KEY_V1`, `ENCRYPTION_KEY_V2`, … | Versioned keyring entries. |
| `ENCRYPTION_KEY_ID` | Which version new writes encrypt under, e.g. `v2`. |

## Migrations

| Variable | Purpose |
|---|---|
| `DIRECT_URL` | Direct (non-pooled) database connection for `prisma migrate`, if `DATABASE_URL` goes through a connection pooler. Defaults to `DATABASE_URL`. |

## Legacy aliases

- `NEXTAUTH_SECRET` / `NEXTAUTH_URL` are read as fallbacks for `AUTH_SECRET` /
  `AUTH_URL`. If both the new and legacy secret are set, they must be
  identical or boot fails.
- `APP_URL` is a fallback base URL for Stripe redirects (unused once
  `AUTH_URL` is set, which is required) and is the base URL an external
  scheduler uses when calling the cron endpoints.

## Set by the platform / build — do not set by hand

| Variable | Purpose |
|---|---|
| `CONTAINER_APP_REPLICA_COUNT` | Replica count reported by the hosting platform. Above `1` logs a warning — the rate limiter is in-memory, so run a single replica. |
| `NEXT_PUBLIC_APP_VERSION`, `NEXT_PUBLIC_GIT_SHA` | Version and commit SHA shown in Settings and the sidebar. Baked into the image at build time from the Docker build args `APP_VERSION` / `GIT_SHA`. |

## Local development only — never in production

| Variable | Purpose |
|---|---|
| `DISABLE_OTP` | Skips the emailed sign-in code. The app refuses to boot with this set in production. |
| `ALLOW_DEMO_SEED` | Required to let `npm run db:seed` create demo users — their passwords are public in this repository. |
| `PERF_QUERY_LOG`, `PERF_QUERY_LOG_FILE` | Optional JSONL query log for performance debugging. Set both or neither. |

## Related pages

- [Installation](/parishcrm/docs/installation/)
- [Settings and Branding](/parishcrm/docs/settings-and-branding/)
- [Regional Configuration](/parishcrm/docs/regional-configuration/)
- [Scheduled Jobs](/parishcrm/docs/scheduled-jobs/)
- [Data Encryption](/parishcrm/docs/data-encryption/)
