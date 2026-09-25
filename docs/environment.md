# Environment & Local Setup

> This is the generic, public configuration reference. Values shown are placeholders.
> (Private deployments: keep live production values in the gitignored `docs/private/environment.md`.)

## App environment

**`.env.example` is the canonical list** of every variable the app reads —
grouped, with defaults and behaviour. Copy it to `.env.local` for local dev
(README → Getting started) or `.env` for a deployment (`docs/self-hosting.md`).
Local dev typically adds `DISABLE_OTP=true` (never in production).

## CI-only secrets (GitHub Actions, not read by the app)

```
APP_URL="https://app.example.com"   # base URL the scheduled cron workflows curl
CRON_SECRET="..."                   # same value as the app's CRON_SECRET
OPENROUTER_API_KEY="sk-or-..."      # optional weekly AI reviewer (weekly-review.yml); repo variable OPENROUTER_MODEL overrides the model
```

> **Stripe webhook endpoint**: prod needs a Stripe webhook endpoint registered (Stripe Dashboard → Developers → Webhooks) pointing at `<APP_URL>/api/stripe/webhook`, subscribed to `checkout.session.completed`. Copy its signing secret into `STRIPE_WEBHOOK_SECRET`.

> **Event → website sync (optional)**: the CRM is the source of truth for events. When `WEBSITE_SYNC_URL` is set, `src/lib/websiteSync.ts` pushes an HMAC-signed webhook to an external site on create/update/publish/delete so it can mirror events into a public calendar. Best-effort and awaited (errors never fail the action, but a slow receiver can delay a save up to the 8 s timeout); an ADMIN "Resync website" button on `/events` is the backstop. `registerUrl` is set only when an event has ticket types → the site shows a Register button linking back to CRM `/e/[slug]`. Leave `WEBSITE_SYNC_URL` unset to disable (the Resync button is then hidden). Receiver contract → `docs/event-webhook.md`.

## Build-time (Docker ARG/ENV, CI injects automatically)

```
NEXT_PUBLIC_APP_VERSION   # git tag shown in sidebar
NEXT_PUBLIC_GIT_SHA       # commit SHA shown in Settings
```

## Seed Credentials

| Email | Password | Role |
|-------|----------|------|
| admin@example.com | admin123 | ADMIN |
| pastor@example.com | pastor123 | PASTOR |
| secretary@example.com | viewer123 | VIEWER |

AUDITOR role has no seeded user — create one manually via `/users` if needed for testing.
