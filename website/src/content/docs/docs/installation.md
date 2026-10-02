---
title: "Installation (Self-Hosting)"
description: "ParishCRM ships as a single container image plus a PostgreSQL database — no other services required. This is one deployment per church (single-tenant);…"
---

ParishCRM ships as a single container image plus a PostgreSQL database — no
other services required. This is one deployment per church (single-tenant);
everything church-specific is configuration, not code.

> **Railway?** Follow the one-click guide in the repo,
> [`docs/deploy/railway.md`](https://github.com/ginutgeorge-Aus/parishcrm/blob/main/docs/deploy/railway.md),
> instead of the steps below.

## What you need

- **PostgreSQL 16** (any host; add `sslmode=require` for a remote database)
- A **container runtime** (Docker, or any platform that runs an OCI image)
- A **Gmail account + app password**, or a **Resend API key + `MAIL_FROM`**
  sender address (sign-in codes, receipts, notifications) — see
  [Gmail Setup](/parishcrm/docs/gmail-setup/)
- **Node.js 24** on the machine you run admin scripts from (optional — the
  image applies migrations itself)

## 1. Check out the release

Migrations are run from a source checkout **at the same tag as the image
you're about to run** — keep your `.env` file in this checkout.

```bash
git clone https://github.com/ginutgeorge-Aus/parishcrm.git
cd parishcrm
git checkout vX.Y.Z
npm ci
```

## 2. Configure

```bash
cp .env.example .env
openssl rand -base64 32   # → AUTH_SECRET
openssl rand -base64 32   # → ENCRYPTION_KEY
```

Fill in the **Required** block of `.env` (see [Environment Variables](/parishcrm/docs/environment-variables/)
for the full reference) and uncomment optional features as needed.

- **Never set `DISABLE_OTP` in production** — the app refuses to boot with it set.
- **Back up `ENCRYPTION_KEY` somewhere safe, separate from the database.**
  Without it, encrypted member data (contact details, dates of birth,
  pastoral notes, transaction descriptions) is permanently unrecoverable.

## 3. Create the schema

The container runs `prisma migrate deploy` on every start (set
`MIGRATE_ON_START=false` to run it yourself instead). If you run the admin
script below *before* first starting the container, apply the schema manually
first with `npx prisma migrate deploy`.

For the first administrator, either use the `/setup` page after starting the
app (step 5), **or** create one now with the script — not both, since `/setup`
closes once any user exists. The script reads `.env` via dotenv (no shell
expansion, so a `$` in a password is safe):

```bash
USER_EMAIL=you@example.org USER_PASSWORD='<a strong password>' \
  npx tsx --env-file=.env scripts/create-admin-user.ts
```

`create-admin-user.ts` reads `USER_EMAIL` / `USER_PASSWORD` and an optional
`USER_ROLE` (defaults to `ADMIN`; any role in the app's role enum is
accepted). It's a no-op if a user with that email already exists.

New releases apply their migrations automatically when the container
restarts on the new image — see [Upgrading](/parishcrm/docs/upgrading/).

> **Don't use `npm run db:push` or `npm run db:seed` on a real deployment** —
> those are for local development only. `db push` records no migration
> history, so a later `migrate deploy` would fail. The seed script creates
> demo users whose passwords are public in this repository, and it refuses to
> run at all unless `ALLOW_DEMO_SEED=true` is set — never set that on a real
> install.

## 4. Run the container

`docker --env-file` keeps quotes as part of each value, so strip them first:

```bash
sed -E 's/^([A-Za-z0-9_]+)="(.*)"$/\1=\2/' .env > .env.docker

docker run -d --name parishcrm --env-file .env.docker -p 3000:3000 \
  ghcr.io/<owner>/<repo>:vX.Y.Z
```

- Put a TLS-terminating reverse proxy (Caddy, nginx, a platform's ingress) in
  front, and set `AUTH_URL` (and `APP_URL` if used) to the public `https://`
  URL — sign-in redirects break if it doesn't match exactly.
- The container exposes `GET /api/health` and ships a built-in Docker
  `HEALTHCHECK` against it — see [Operations Scripts](/parishcrm/docs/operations-scripts/) /
  the health endpoint section below.
- **Run a single replica.** The in-app rate limiter is in-memory; running
  more than one instance would let it be bypassed. If the platform sets
  `CONTAINER_APP_REPLICA_COUNT` and it's above 1, the app logs a warning.

## 5. First login

Skipped the script in step 3? Add `SETUP_TOKEN=<long random value>` to
`.env`, regenerate `.env.docker` and recreate the container (a running
container never sees `.env` changes). Open `https://<your-host>/setup`, enter
the token and create the first administrator. The page only works while the
database has no users; afterwards remove `SETUP_TOKEN` and recreate the
container again.

Sign in as the admin account you created, then configure:

- **Settings** — church details, branding (logo, letterhead, colours),
  welcome letter, membership form options, email templates, receipts. See
  [Settings and Branding](/parishcrm/docs/settings-and-branding/).
- **Accounting → Settings** — bank/cash accounts, opening balances, period
  lock.

Optional next steps: [Regional Configuration](/parishcrm/docs/regional-configuration/) (fiscal
year, timezone, currency) and [Scheduled Jobs](/parishcrm/docs/scheduled-jobs/) (reminders,
cleanup sweeps).

## Local development (not for production)

For running the app from source for development/testing:

```bash
npm install
cp .env.example .env.local   # fill in values; add DISABLE_OTP=true for local dev only

npx prisma dev --detach      # local PostgreSQL daemon (once per session)
npm run db:push              # sync schema

ALLOW_DEMO_SEED=true npm run db:seed   # demo users + chart of accounts
npm run dev                            # http://localhost:3000
```

Seed login credentials (development only — change or discard before any real
use):

| Email | Password | Role |
|---|---|---|
| admin@example.com | admin123 | ADMIN |
| pastor@example.com | pastor123 | PASTOR |
| secretary@example.com | viewer123 | VIEWER |

No `AUDITOR` or `OFFICE_ADMIN` user is seeded — create one via the Users page
if you need to test those roles. See [Roles and Permissions](/parishcrm/docs/roles-and-permissions/).

An alternative to `npx prisma dev` is `docker compose up -d` (`npm run
db:start`), which starts a plain PostgreSQL 16 container on port 5432 —
update `DATABASE_URL` accordingly if you switch.

## Related pages

- [Environment Variables](/parishcrm/docs/environment-variables/)
- [Upgrading](/parishcrm/docs/upgrading/)
- [Operations Scripts](/parishcrm/docs/operations-scripts/)
- [Scheduled Jobs](/parishcrm/docs/scheduled-jobs/)
- [Gmail Setup](/parishcrm/docs/gmail-setup/)
