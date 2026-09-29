# Self-hosting

One deployment per church (single-tenant). The published container image is
config-agnostic — everything church-specific is environment variables
(`.env.example` is the full reference) plus in-app settings (branding, church
details, accounts) that an ADMIN edits after first login.

## What you need

- PostgreSQL 16 (any host; `sslmode=require` for a remote DB)
- A container runtime (Docker, or any platform that runs an OCI image)
- An SMTP-capable Gmail account + app password (sign-in codes, receipts)
- Node 24 on the machine you run admin scripts from (optional)

## 1. Check out the release

The container applies pending migrations itself on every start (set
`MIGRATE_ON_START=false` to run them yourself instead). A source checkout **at
the same tag as the image** is only needed for the admin/seed scripts below.
Keep `.env` in this checkout.

```bash
git clone <repo> && cd <repo> && git checkout vX.Y.Z
npm ci
```

## 2. Configure

```bash
cp .env.example .env
openssl rand -base64 32   # → AUTH_SECRET
openssl rand -base64 32   # → ENCRYPTION_KEY
```

Fill in the **Required** block of `.env`; uncomment optional features as
needed (never `DISABLE_OTP` — the app refuses to boot in production with it
set). Back up `ENCRYPTION_KEY` somewhere safe and separate from the database —
without it, encrypted member data is unrecoverable.

## 3. Create the schema

Automatic: the container runs `prisma migrate deploy` before the server starts.
The scripts below need the schema, so if you run them before first starting the
container, apply it manually first with `npx prisma migrate deploy`.

For the first administrator, either use the `/setup` page after starting the app
(step 5), **or** create one now with the script — not both, since `/setup` closes
once any user exists. The script reads `.env` as dotenv (no shell expansion, so a
`$` in a password is safe):

```bash
USER_EMAIL=you@example.org USER_PASSWORD='<strong password>' \
  npx tsx --env-file=.env scripts/create-admin-user.ts
```

Accounting starts empty. Optionally add a generic starter chart of accounts
(income/expense groups and categories) plus a "Main Bank Account" and
"Petty Cash" payment account — it creates no users, and each part is skipped
if that table already has rows. Preview first, then apply:

```bash
npx tsx --env-file=.env scripts/seed-starter-accounts.ts               # dry run
npx tsx --env-file=.env scripts/seed-starter-accounts.ts --apply --yes
```

Don't use `npm run db:push` or `npm run db:seed` here — they're for local
development. `db push` records no migration history, so later
`migrate deploy` upgrades would fail. The seed creates demo users whose
passwords are public in this repo (it refuses to run unless
`ALLOW_DEMO_SEED=true` is set — never set that here).

## 4. Run

`docker --env-file` keeps quotes as part of each value, so strip them first:

```bash
sed -E 's/^([A-Za-z0-9_]+)="(.*)"$/\1=\2/' .env > .env.docker
docker run -d --name church-crm --env-file .env.docker -p 3000:3000 \
  ghcr.io/<owner>/<repo>:vX.Y.Z
```

Put a TLS-terminating reverse proxy (Caddy, nginx, a platform ingress) in
front, and set `AUTH_URL` / `APP_URL` to the public `https://` URL — sign-in
redirects break if they don't match.

The container exposes `GET /api/health` and has a built-in `HEALTHCHECK`.
Run a **single replica**: the rate limiter is in-memory.

## 5. First login

Skipped the script in step 3? Add `SETUP_TOKEN=<long random value>` to `.env`,
then regenerate `.env.docker` and recreate the container (`docker rm -f church-crm`,
then re-run step 4) — a running container never sees `.env` changes. Open
`https://<your-host>/setup`, enter the token and create the first administrator.
The page only works while the database has no users; afterwards remove
`SETUP_TOKEN` from `.env` and recreate the container the same way.
(Alternatively use `scripts/create-admin-user.ts`, see `docs/operations.md`.)

Sign in as the admin you created, then:

- **Settings** — church details, branding (logo, letterhead), letters,
  membership, email templates, receipts
- **Accounting → Settings** — bank/cash accounts, opening balances, period lock
- **Accounting → Categories** — if you skipped the starter script, create a
  group (**Manage Groups**) and a category, and a payment account under
  **Acct. Settings → Payment Accounts**, before recording the first transaction

## Scheduled jobs (optional)

Event reminders, abandoned-checkout cleanup, and celebration emails are HTTP
endpoints called by any scheduler (cron, a CI schedule, a platform job) with
`Authorization: Bearer $CRON_SECRET`:

```bash
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://crm.example.org/api/cron/send-reminders
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://crm.example.org/api/cron/sweep-checkouts
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://crm.example.org/api/cron/send-celebrations
```

## Upgrading

1. Back up the database.
2. Restart the container on the new image tag — it applies new migrations on start
   (or run `npx prisma migrate deploy` from the new tag if `MIGRATE_ON_START=false`).

Keep `ENCRYPTION_KEY*` and `AUTH_SECRET` unchanged across upgrades.
