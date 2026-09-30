# Deploy on Railway

One-click deploy creates two things: the ParishCRM app and a PostgreSQL database,
plus three small cron services for reminders, checkout sweeps and celebrations.

## 1. Deploy

> The one-click template is not published yet. Until it is, deploy from the repo:
> **New Project → Deploy from GitHub repo** (Railway builds the Dockerfile; the
> container applies migrations on start), then **+ New → Database →
> PostgreSQL** and reference its `DATABASE_URL` from the app service. In the app
> service's **Settings → Deploy**, set **Healthcheck Path** to `/api/health` so
> Railway waits for migrations and startup before routing traffic. Generate
> `AUTH_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET` and `SETUP_TOKEN` yourself
> (`openssl rand -base64 32` each) and set `AUTH_URL` to the app's public URL.
> On a Hobby plan set `RESEND_API_KEY` and `MAIL_FROM` for email (see below).
> Cron services are optional — see "Scheduled jobs" in `docs/self-hosting.md`.

With the template, click **Deploy on Railway**. You'll be asked for:

| Variable | What to enter |
|---|---|
| `CHURCH_NAME` | Your church's name (can be changed later in Settings) |
| `RESEND_API_KEY` | A [Resend](https://resend.com) API key — [setup](../self-hosting.md#resend-instead-of-gmail) |
| `MAIL_FROM` | Sender address on your Resend-verified domain, e.g. `noreply@yourchurch.org` |

> **Why not Gmail?** Railway blocks outbound SMTP on its Free, Trial and Hobby
> plans, so Gmail sends time out and nobody can receive a login code. On a Pro
> plan you can use `GMAIL_USER` + `GMAIL_APP_PASSWORD` instead
> ([setup](../self-hosting.md#gmail-app-password)) and leave `RESEND_API_KEY` unset.

Everything else (`AUTH_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET`, `SETUP_TOKEN`,
`DATABASE_URL`, `AUTH_URL`) is generated for you. Migrations run automatically
when the app starts.

> **Back up `ENCRYPTION_KEY`.** Member contact details are encrypted with it. If it is
> lost, that data cannot be recovered. Copy it from the app service's **Variables** tab
> into a password manager now.

## 2. Create your admin

1. Open the app service's **Variables** tab and copy `SETUP_TOKEN`.
2. Visit `https://<your-app>.up.railway.app/setup`, paste the token and create your account.
3. Delete the `SETUP_TOKEN` variable (the page already stopped working, this is tidy-up).

Sign in — a login code is emailed to you (from `MAIL_FROM`).

## 3. Custom domain (optional)

App service → **Settings → Networking → Custom Domain**. Then update `AUTH_URL` to
`https://your.domain`.

## Costs

Railway bills usage. A small parish instance (app + Postgres, low traffic) typically
fits a Hobby plan. Check the Railway dashboard's usage page after the first week.

## Upgrading

The app runs a pinned release image (`ghcr.io/<owner>/parishcrm:vX.Y.Z`).
Migrations run automatically when a new version starts.

**Automatic (recommended):** app service → **Settings → Source → Auto Updates**
→ **Minor and patch**, and pick a quiet maintenance window (e.g. 2–5am local).
Railway checks GHCR, moves the tag to the newest `vX.Y.Z` in the same major
version and redeploys inside the window, with under 2 minutes of downtime.
Major versions (`v2.0.0`) may contain breaking changes, so they are never
applied automatically — read the release notes, then change the tag yourself.

**Manual:** app service → **Settings → Source**, change the image tag, then
**Deploy**.

Before a major upgrade, take a database backup (Postgres service →
**Backups**).
