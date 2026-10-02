---
title: "Operations: Scripts, Health & Maintenance Mode"
description: "Reference for the one-off scripts/*.ts catalogue, the health check endpoint, maintenance mode, and PWA installability."
---

Reference for the one-off `scripts/*.ts` catalogue, the health check
endpoint, maintenance mode, and PWA installability.

## Ops scripts

Run any script with `npx tsx scripts/<name>.ts` from a checkout at the
same tag as your running deployment, with `DATABASE_URL` (and other needed
env vars) available — e.g. `npx tsx --env-file=.env scripts/<name>.ts`.

Backfill and encryption scripts are **idempotent and dry-run by default** —
review the dry-run output, then pass the script's write flag (commonly
`--apply`, sometimes with `--yes` to skip a confirmation prompt) to actually
write.

| Script | Purpose |
|---|---|
| `create-admin-user` | Create an account with a given role (default `ADMIN`) from `USER_EMAIL` / `USER_PASSWORD` / `USER_ROLE`. The normal way to bootstrap a real deployment — see [Installation](/parishcrm/docs/installation/). |
| `set-church-name` | One-time/ad-hoc: set the church name directly from the CLI (`CHURCH_FULL_NAME="…"`), dry-run unless `--apply --yes`. |
| `set-maintenance` | Turn [maintenance mode](/parishcrm/docs/operations-scripts/#maintenance-mode) on or off: `npx tsx scripts/set-maintenance.ts <on\|off> [--eta-minutes N]` (default 6 minutes). Also the manual escape hatch if the flag ever gets stuck on. |
| `set-default-monthly-dues` | One-time backfill: sets `Family.monthlyDues` for member families that have no amount set. |
| `backfill-petty-cash-sundays` | Backfill the weekly petty-cash session for past Sundays that never had one auto-opened. |
| `check-pettycash-importkey-dups` | **Read-only** pre-migration safety check — reports duplicate import keys before a uniqueness constraint is added. |
| `backfill-email-hash` | Populate the email blind-index (used for lookups without decryption) for rows that predate it. |
| `backfill-mobile-hash` | Populate the mobile-number blind index for pre-existing rows; also encrypts any pre-existing plaintext mobile numbers. |
| `rehash-mobile` | Unconditionally recompute the mobile blind index — needed after a change to how mobile numbers are normalised before hashing. |
| `encrypt-person-email`, `encrypt-family-location`, `encrypt-registration-contact`, `encrypt-family-update-payload`, `encrypt-petty-cash-fields`, `encrypt-petty-cash-transfer`, `encrypt-registration-customanswers`, `encrypt-transaction-notes`, `encrypt-person-notes` | Encryption backfills — encrypt historical plaintext values in a given field after that field is moved behind field-level encryption. See [Data Encryption](/parishcrm/docs/data-encryption/). |
| `rotate-encryption-key` | Re-encrypt all encrypted fields under a newly-added key version. Usage documented in the script's own header comment. See [Environment Variables](/parishcrm/docs/environment-variables/) → Encryption key rotation. |
| `audit-data-integrity` | **Read-only** diagnostic — scans encrypted-at-rest fields for plaintext leaks, checks blind-index completeness, and verifies invariants the database schema can't enforce on its own. Exits non-zero on any finding. Safe to run against a restored backup. |
| `purge-registration-pii` | Retention purge — anonymises event-registration personal data a set period after the event ends, while preserving financial aggregates (ticket counts, revenue). Idempotent. |
| `purge-membership-application-pii` | Retention purge — anonymises decided (approved/declined) membership applications a set period after the decision, leaving pending applications untouched. Idempotent. |
| `unlock-admins` | **Emergency only** — clears password and sign-in-code lockout on every `ADMIN` account. A single locked-out admin can be unlocked from the Users UI by another admin, or waits out the automatic cooldown; this script is for the rare case where every admin account is locked at once. |

## Health endpoint

`GET /api/health` is a public, unauthenticated liveness/readiness probe —
it's excluded from the login-redirect middleware so external monitors can
reach it without a session.

- Runs a trivial `SELECT 1` against the database.
- Returns `200 {"status":"ok"}` when the database answers.
- Returns `503 {"status":"error"}` when it doesn't — the body never leaks
  error detail (avoids fingerprinting).
- The container image has a built-in Docker `HEALTHCHECK` that calls this
  endpoint every 30 seconds.

Point an external uptime monitor at `<your-url>/api/health` — use a vantage
point independent of wherever the app itself runs, so the monitor still
fires if the whole hosting region goes down. Suggested monitor settings:
5-minute interval, keyword-match `"status":"ok"` (catches a `200` with a
broken body), 30 s timeout, alert after 2 consecutive failures.

## Maintenance mode

A site-wide "we'll be back shortly" page, useful while running a schema
migration or a risky deploy step.

- Toggle it with `npx tsx scripts/set-maintenance.ts on --eta-minutes 6` /
  `... off`.
- While enabled, every request gets a branded (de-identified if the database
  itself is down) static maintenance page instead of the app, with an
  auto-refresh every 30 seconds.
- A handful of paths always bypass maintenance mode so in-flight
  payments/crons/health checks aren't disrupted: `/api/health`,
  `/favicon.ico`, static assets, the Stripe webhook, and the
  `send-reminders` / `sweep-checkouts` cron endpoints.
- The maintenance flag is read from the database with a short cache, and
  **fails open** — if the database itself is unreachable, the app serves
  normally (or 500s normally) rather than getting stuck showing maintenance
  forever.

## PWA install

ParishCRM serves a web app manifest (`/manifest.webmanifest`) so it can be
installed as a standalone app ("Add to Home Screen") on Android and desktop
browsers; iOS uses Apple's own touch-icon meta tags for the same effect. The
manifest is generated per request (not baked into the build) and reflects
whatever church name and icon are currently configured in
[Settings and Branding](/parishcrm/docs/settings-and-branding/) — a rebrand takes effect
immediately, including for already-installed PWA icons that get refreshed by
the OS.

## Related pages

- [Installation](/parishcrm/docs/installation/)
- [Environment Variables](/parishcrm/docs/environment-variables/)
- [Data Encryption](/parishcrm/docs/data-encryption/)
- [Privacy and Audit Log](/parishcrm/docs/privacy-and-audit-log/)
- [Scheduled Jobs](/parishcrm/docs/scheduled-jobs/)
- [Upgrading](/parishcrm/docs/upgrading/)
