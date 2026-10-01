# Deploy on Railway

One-click deploy creates two things: the ParishCRM app and a PostgreSQL database.
Scheduled jobs (reminders, checkout sweeps, celebrations) run inside the app.

## 1. Deploy

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/parishcrm-oss)

> **Without the template** (e.g. a custom setup), deploy the release
> image: **New Project → Docker Image** → `ghcr.io/ginutgeorge-aus/parishcrm:vX.Y.Z`
> (latest tag on the Releases page; the container applies migrations on start),
> then **+ New → Database → PostgreSQL** and reference its `DATABASE_URL` from
> the app service. Don't deploy from the GitHub repo — that builds unreleased
> `main` and can't use image Auto Updates (see Upgrading). In the app
> service's **Settings → Deploy**, set **Healthcheck Path** to `/api/health` so
> Railway waits for migrations and startup before routing traffic. Generate
> `AUTH_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET` and `SETUP_TOKEN` yourself
> (`openssl rand -base64 32` each) and set `AUTH_URL` to the app's public URL.
> On a Hobby plan set `RESEND_API_KEY` and `MAIL_FROM` for email (see below).

With the template, click **Deploy on Railway** above. You'll be asked for:

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

## Scheduled jobs

Reminders, abandoned-checkout cleanup and celebration emails run inside the app
on a timer — nothing to set up. Keep the app always on (Railway's default; don't
enable **App Sleeping**) and at one replica. Celebrations go out from 07:00 Sydney
and retry every 30 minutes through the day if a send fails.

A late or repeated run normally won't send duplicates. The rare exception: if a
run is cut off mid-send, or a database write fails after emails went out, a later
run may send some of them again.

**Prefer an outside scheduler?** Set `IN_APP_CRON=false` on the app and call the
routes in `docs/self-hosting.md` (GitHub Actions `schedule`, cron-job.org, a
server's crontab) with `Authorization: Bearer $CRON_SECRET`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Free plan resource provision limit exceeded` when adding a service or project | Free plan caps services and projects per workspace | Delete unused services/projects, or upgrade to Hobby |
| App crash-loops: `Startup env validation failed: GMAIL_USER is not set … unless RESEND_API_KEY is used` | No mail provider configured | Set `RESEND_API_KEY` and `MAIL_FROM` on the app service, then apply |
| App URL returns `{"message":"Application not found"}` (404) | App has no running deployment (never deployed, or every deploy failed) | App service → **Deployments**: read the failed deploy's logs, fix, redeploy |
| Reminders/celebrations never send | App Sleeping is on, so the app (and its timer) is asleep | Turn App Sleeping off, or set `IN_APP_CRON=false` and use an outside scheduler |
| Gmail login codes time out | Railway blocks outbound SMTP below Pro | Use Resend (above) |
| Login code never arrives with `MAIL_FROM=onboarding@resend.dev` | Resend's test sender only delivers to your Resend signup address | Verify your own domain in Resend and use an address on it |

## Costs

Railway bills usage. A small parish instance (app + Postgres, low traffic) typically
fits a Hobby plan. Check the Railway dashboard's usage page after the first week.

## Upgrading

The app runs a pinned release image (`ghcr.io/<owner>/parishcrm:vX.Y.Z`).
Migrations run automatically when a new version starts.

**Automatic (recommended):** app service → **Settings → Source → Auto Updates**
→ **Minor and patch**, and pick a quiet maintenance window. The window is in **UTC** — e.g. 16:00–19:00
UTC is 2–5am in Sydney (AEST).
Railway checks GHCR, moves the tag to the newest `vX.Y.Z` in the same major
version and redeploys inside the window (downtime is typically under 2 minutes).
Major versions (`v2.0.0`) may contain breaking changes, so they are never
applied automatically — read the release notes, then change the tag yourself.

**Manual:** app service → **Settings → Source**, change the image tag, then
**Deploy**.

Every upgrade can run migrations, including unattended minor ones, so keep
backups current: turn on a backup schedule on the Postgres service
(**Backups**) if your plan offers one, and take a manual backup before any
manual or major upgrade.
