# Self-hosting

One deployment per church (single-tenant). The published container image is
config-agnostic — everything church-specific is environment variables
(`.env.example` is the full reference) plus in-app settings (branding, church
details, accounts) that an ADMIN edits after first login.

## What you need

- PostgreSQL 16 (any host; `sslmode=require` for a remote DB)
- A container runtime (Docker, or any platform that runs an OCI image)
- An SMTP-capable Gmail account + app password (sign-in codes, receipts)
- Node 24 on the machine you run migrations from

## 1. Check out the release

The runtime image ships only the compiled app (no Prisma CLI), so migrations
run from a source checkout **at the same tag as the image**. Keep `.env` in
this checkout.

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

Both commands read `.env` as dotenv (no shell expansion, so a `$` in a password
is safe):

```bash
npx prisma migrate deploy
USER_EMAIL=you@example.org USER_PASSWORD='<strong password>' \
  npx tsx --env-file=.env scripts/create-admin-user.ts
```

Repeat `npx prisma migrate deploy` (from the new tag) before every upgrade.

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
2. `npx prisma migrate deploy` from a checkout of the new tag.
3. Restart the container on the new image tag.

Keep `ENCRYPTION_KEY*` and `AUTH_SECRET` unchanged across upgrades.
