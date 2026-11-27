# Self-hosting

One deployment per church (single-tenant). The published container image is
config-agnostic — everything church-specific is environment variables
(`.env.example` is the full reference) plus in-app settings (branding, church
details, accounts) that an ADMIN edits after first login.

## What you need

- PostgreSQL 16 (any host; `sslmode=require` for a remote DB)
- A container runtime (Docker, or any platform that runs an OCI image)
- An SMTP-capable Gmail account + app password (sign-in codes, receipts) — see
  [Gmail app password](#gmail-app-password) — **or** a Resend account if your
  host blocks SMTP, see [Resend instead of Gmail](#resend-instead-of-gmail)
- Node 24 on the machine you run admin scripts from (optional)

## Gmail app password

Any Gmail or Google Workspace account that can create an app password works
(exceptions below). Google rejects SMTP sign-in with the account's normal
password — you need an **app password**:

1. Turn on **2-Step Verification** (Google Account → Security).
2. Open <https://myaccount.google.com/apppasswords>, create one named
   `ParishCRM` and copy the 16 characters.
3. Set `GMAIL_USER` to the address and `GMAIL_APP_PASSWORD` to those 16
   characters (no spaces).

- Prefer a dedicated church account over a personal one — members see it as the
  sender, and the app password grants full mailbox access.
- App passwords are unavailable for Advanced Protection accounts, accounts whose
  2-Step Verification uses only security keys, and Workspace accounts whose admin
  disabled them. If the page says "not available", use another account.
- Sending limits: roughly 500 emails/day on consumer Gmail, ~2,000 on Workspace.
  Large reminder or celebration batches can hit them.
- Revoke at the same page if it leaks; nothing else needs rotating.
- Gmail uses SMTP, which some hosts block — Railway blocks outbound SMTP on
  its Free, Trial and Hobby plans (sends time out). Use Resend there (below).

## Resend instead of Gmail

[Resend](https://resend.com) sends over HTTPS (port 443), which no host blocks.
Setting `RESEND_API_KEY` switches **all** mail to Resend; the `GMAIL_*` pair is
then optional.

1. Create a Resend account and **add your domain** (Domains → Add). Add the
   SPF and DKIM DNS records it shows at your DNS provider, then wait for
   **Verified**.
2. Create an API key (API Keys → Create, permission **Sending access**).
3. Set `RESEND_API_KEY` to the key and `MAIL_FROM` to a bare address on the
   verified domain, e.g. `noreply@yourchurch.org`. The church name from
   Settings is used as the display name.

- Without a verified domain Resend only allows `onboarding@resend.dev` as
  `MAIL_FROM`, and it only delivers to your own Resend account address — fine
  for a first login test, not for real use.
- Free tier: 100 emails/day, 3,000/month.
- `MAIL_FROM` is also the fallback church contact address and
  membership-notification destination (as `GMAIL_USER` is for Gmail). A
  send-only address like `noreply@` receives nothing, so either use a monitored
  mailbox or, after first login, set **Settings → Church Information → email**
  and **Settings → App Settings → Secretary email address(es)** to addresses
  someone reads.

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

In production the app refuses to start if `AUTH_SECRET` (or `CRON_SECRET` / `SETUP_TOKEN`, when set) is shorter than 32 characters or is still the placeholder from `.env.example`.

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
`$` in a password is safe). Put `USER_EMAIL` and `USER_PASSWORD` in `.env`
temporarily rather than on the command line, so the password never lands in shell
history or the process list, and delete both lines straight afterwards (before you
build `.env.docker` below, which is copied from `.env`). If a password contains `#`, wrap the value in double quotes, e.g.
`USER_PASSWORD="abc#def"`; unquoted, dotenv reads `#def` as a comment and the
account gets the password `abc`. Inside double quotes use `\"` for a literal quote.

```bash
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

Note for local dev: the case-insensitive unique index `User_email_lower_key` is
raw SQL, so it only exists after `prisma migrate deploy`. A database built with
`npm run db:push` lacks it, so case-variant duplicate emails can exist there and
login lookups may pick either row. The same goes for the partial unique index
`SundaySchoolExam_active_unique` (one live exam per class, name and date): a
`db:push` database has no DB backstop for it, so only the action's own check
blocks duplicate live exams there.

## 4. Run

Release tags are mutable in a registry, so pin the image by digest and verify its signed
build provenance **before** running it with your secrets:

`gh attestation verify` on a GHCR image needs a registry login first: run `gh auth login`, then `echo "$GITHUB_TOKEN" | docker login ghcr.io -u <user> --password-stdin` with a token that can read packages (a public image may verify without it).

Replace `<owner>/<repo>` in image references with the **lowercase** GitHub owner/repo (the publish workflow lowercases it; `--repo` keeps the original casing).

```bash
docker buildx imagetools inspect ghcr.io/<owner>/<repo>:vX.Y.Z   # note the Digest: sha256:<digest>
gh attestation verify oci://ghcr.io/<owner>/<repo>@sha256:<digest> --repo <owner>/<repo>
```

Then run that same digest (not the tag). `docker --env-file` keeps quotes as part of
each value, so strip them first:

```bash
sed -E 's/^([A-Za-z0-9_]+)="(.*)"$/\1=\2/' .env > .env.docker
docker run -d --restart unless-stopped --name church-crm --env-file .env.docker -p 3000:3000 \
  ghcr.io/<owner>/<repo>@sha256:<digest>
```

Put a TLS-terminating reverse proxy (Caddy, nginx, a platform ingress) in
front, and set `AUTH_URL` / `APP_URL` to the public `https://` URL — sign-in
redirects break if they don't match.

The container exposes `GET /api/health` and has a built-in `HEALTHCHECK`.
Run a **single replica**: the rate limiter is in-memory.

### Recovery: failed publish (maintainer)

A released version is immutable: the publish workflow refuses to build a tag that already exists in GHCR. If a publish fails **after** the push (for example the attestation step), a re-run is blocked by that check. Recovery (maintainer): first confirm no newer release exists (a retry re-points `:latest` at the retried tag; if a newer one exists, do not retry, or re-point `:latest` at the newest release's digest afterwards). Then delete that version of the `parishcrm` package in GHCR (Package settings → Manage versions) and, on the **original** Release workflow run, choose **Re-run failed jobs** (not "Re-run all jobs": that re-runs release-please, which reports `release_created: false` for the existing release and skips publish). Deployments already pinned to the deleted digest must be updated to the verified replacement digest. Verify the result with `gh attestation verify` as below.

## 5. First login

Skipped the script in step 3? Add `SETUP_TOKEN=<long random value>` to `.env`,
then regenerate `.env.docker` and recreate the container (`docker rm -f church-crm`,
then re-run step 4) — a running container never sees `.env` changes. Open
`https://<your-host>/setup`, enter the token and create the first administrator.
The page only works while the database has no users; afterwards remove
`SETUP_TOKEN` from `.env` and recreate the container the same way.
(Alternatively use `scripts/create-admin-user.ts`, see `docs/operations.md`.)
`/setup` rate-limits attempts per client IP from `X-Forwarded-For`. Without a
reverse proxy setting it (e.g. a bare `docker run`), all visitors share one
bucket and anyone can block setup for 15 minutes; the app logs a warning. Use
the proxy from step 4, or create the admin with the script instead.

An admin created through `/setup` is first taken to **Settings → Features** to
pick which features the church uses (Save, or **Keep defaults** for everything
on); after that the dashboard opens as normal. Admins created with the script,
and existing installs, skip this prompt.

Sign in as the admin you created, then:

- **Settings** — church details, branding (logo, letterhead), letters,
  membership, email templates, receipts
- **Accounting → Accounting settings** — bank/cash accounts, opening balances, period lock
- **Accounting → Categories** — if you skipped the starter script, create a
  group (**Manage groups**) and a category, and a payment account under
  **Accounting settings → Payment Accounts**, before recording the first transaction

### Passkeys

Users can add passkeys on **My Account** and sign in with fingerprint, face or
device PIN. They need `AUTH_URL` to be `https://` on a domain name, not an IP
address (or `http://localhost` for development); otherwise adding one is disabled and passkey sign-in reports
"not available".
A passkey is bound to the `AUTH_URL` hostname: **changing the domain invalidates
every registered passkey**. Users then sign in with password + code and add new
ones. An admin can remove a user's passkeys (and trusted devices) with **Revoke
passkeys** on **Users**. Password reset also removes them.

## Scheduled jobs

Event reminders, abandoned-checkout cleanup, celebration emails and the optional
monthly clearance-compliance and weekly error digests run inside the app by default (`IN_APP_CRON`, see `.env.example`).
Nothing to schedule — as long as the app stays running.
Run a single app replica: each replica runs its own timer. The weekly error digest is opt-in (`ERROR_DIGEST=true`), as is the monthly
clearance digest (`CLEARANCE_DIGEST=true`). `POST /api/cron/send-clearance-digest`
works without the flag and skips if this month's digest was already sent
(`?force=1` resends).

**Upgrading from external crons?** Remove them when you deploy this version, or
set `IN_APP_CRON=false` to keep them — don't run both. Jobs normally skip work
already done, but two schedulers overlapping can occasionally resend an email
(e.g. a run cut off mid-send).

On a host that scales to zero or sleeps idle apps, set `IN_APP_CRON=false` and
call these endpoints from any scheduler (cron, a CI schedule, a platform job)
with `Authorization: Bearer $CRON_SECRET`:

| Route | Suggested schedule |
|---|---|
| `send-reminders` | every 30 min |
| `sweep-checkouts` | every 30 min |
| `send-celebrations` | 07:00 **and** 07:30 Sydney (`0,30 21 * * *` UTC in winter, `0,30 20 * * *` in summer) — the second call retries failed sends; a later day can't, since only that day's birthdays are due |
| `send-clearance-digest` | daily at 07:00 Sydney (`0 21 * * *` UTC in winter, `0 20 * * *` in summer). It sends once, on the first call of each Sydney month, and skips the rest — unless an email failed, in which case the next daily call retries only addresses not recorded as sent. If the sent list could not be saved in that run, the month is closed instead and the failed address waits for next month (this avoids repeats) |
| `send-group-messages` | every 5 min, only with `IN_APP_CRON=false` (retries queued/failed group emails) |
| `error-issues` | weekly, Monday 09:00 Sydney — only if you want the GitHub error digest |

```bash
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://crm.example.org/api/cron/send-reminders
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://crm.example.org/api/cron/sweep-checkouts
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://crm.example.org/api/cron/send-celebrations
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://crm.example.org/api/cron/send-group-messages
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://crm.example.org/api/cron/send-clearance-digest
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://crm.example.org/api/cron/error-issues
```

## Behind a proxy that adds hops (Render and similar)

If your platform appends its own internal hop to `x-forwarded-for`, set `CLIENT_IP_HEADER` so login
throttling and audit IPs see the real client. This is security-sensitive: see
[`docs/environment.md`](environment.md#client_ip_header) for the full explanation.

## Scale and limits

ParishCRM is built for one parish: typically 500–2,000 members, a few thousand transactions a year.
That size needs no tuning. Contact fields are encrypted, so lists decrypt rows in the app, and some
screens cap how many rows they load to keep memory bounded. List pages show a notice when they hit
a cap; narrow the search or filter to see the rest. CSV exports stop at their cap, so filter the
export (for example by date range) if you ever get close to it.

| Area | Cap |
|------|-----|
| People list, family list (incl. suburb filter) | 500 rows per view |
| Person pickers (receipts, petty cash, settings, import) | 2,000 active members |
| Birthday / anniversary widgets | 5,000 people scanned |
| Transaction search | 5,000 most recent transactions scanned; 50 per page |
| Event registrations page | 2,000 registrations per event |
| CSV exports (people, event registrations, general ledger) | 10,000 rows |
| Bank statement import | 1,000 rows per file |
| Family/person CSV import | 5,000 rows per file |
| Group member list (display only; group emails reach every member) | 5,000 members |

These caps sit well above a single parish. Expect slower list pages from around 5,000 people,
because each page decrypts its rows. Measured timings for larger data sets are not published yet.

## Upgrading

1. Back up the database.
2. Restart the container on the new image tag — it applies new migrations on start
   (or run `npx prisma migrate deploy` from the new tag if `MIGRATE_ON_START=false`).

Keep `ENCRYPTION_KEY*` and `AUTH_SECRET` unchanged across upgrades.

### Migrations in production

By default the container runs `prisma migrate deploy` on boot with the same database
role the app uses, so that role needs DDL rights. For production, prefer a separate
migration role: set `MIGRATE_ON_START=false`, give the app a least-privilege role
(read/write on the tables, no DDL), and run `npx prisma migrate deploy` from the
release checkout with the migration role's URL before starting the new image. The
Prisma config reads `DIRECT_URL` before `DATABASE_URL`, so if `DIRECT_URL` is set in
your environment, point that one at the migration role (or unset it).

Tables added by later migrations are owned by the migration role, so grant the app
role access to them automatically, once:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO <app_role>;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO <app_role>;
ALTER DEFAULT PRIVILEGES FOR ROLE <migration_role> IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO <app_role>;
ALTER DEFAULT PRIVILEGES FOR ROLE <migration_role> IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO <app_role>;
```

**Existing deployments:** tables already created by the app role are still owned by
that role, and grants do not move ownership, so the migration role cannot `ALTER` them.
Either use the current owner as the migration role, or transfer ownership once
(as a superuser or the owner): `ALTER TABLE <table> OWNER TO <migration_role>;` for each
table (also sequences and enums created by migrations, plus `_prisma_migrations`), then
run the grants above so the app role keeps read/write access without DDL rights.

**Recovery from a failed migration.** A failed migration makes a
`MIGRATE_ON_START=true` container exit and restart in a loop. To recover:

1. Stop the container (or set `MIGRATE_ON_START=false`) so it stops retrying.
2. Choose one branch:
   - **Restore:** restore the pre-upgrade backup. It predates the failed migration, so
     no failed record remains: skip `migrate status` and `migrate resolve`. Fix the
     original cause, then go to step 5.
   - **Fix in place:** the failed record remains. Continue with steps 3 and 4.
3. Run `npx prisma migrate status` to see which migration is marked failed.
4. Undo any objects the migration created before it failed (a retry will try to create
   them again), then run `npx prisma migrate resolve --rolled-back <migration_name>`.
   Use `--applied <migration_name>` only after you have run the migration's remaining SQL
   by hand and verified the schema: `--applied` skips that SQL on every later deploy.
5. Run `npx prisma migrate deploy`, then start the container.
