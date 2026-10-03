# Live demo — design

Date: 2026-10-02
Status: approved (brainstorming), pending implementation plan

## Goal

A free, public, always-available ParishCRM demo that lets **other churches evaluating the
project** (treasurers, secretaries, pastors) try every role against realistic parish data,
without signing up and without any risk of real data, real email, or real payments.

Hosting (decided earlier): Render free web service running the published Docker image +
Neon free Postgres + a scheduled GitHub Actions workflow that resets and reseeds nightly.
$0, no card. A 30–60 s cold start is accepted.

## Non-goals

- Per-visitor isolated sandboxes. One shared database; visitors may see each other's edits
  until the nightly reset.
- Demoing email delivery, Stripe checkout, website sync, or 2FA enrolment.
- Any change to behaviour when `DEMO_MODE` is unset.

## Approach

A single `DEMO_MODE` env flag, read through one helper, plus an explicit
`assertNotDemo()` guard inside each blocked Server Action / route.

Rejected alternatives:
- **Middleware-level write blocking** — middleware cannot reliably identify which Server
  Action a POST targets, so the blocklist would be fragile.
- **Separate demo branch/fork** — drifts from tagged releases; the demo should show exactly
  what self-hosters get.

## 1. Flag and safety

- `src/lib/demoMode.ts` exports `isDemoMode(): boolean` (`process.env.DEMO_MODE === "true"`)
  and `assertNotDemo(): ActionResult | null` returning the standard error
  `"Disabled in the live demo"`.
- `src/lib/envCheck.ts` gains demo rules. When `DEMO_MODE=true`, startup **fails** if any of
  these are set: `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `RESEND_API_KEY`, a Stripe secret key
  starting `sk_live_`, website-sync config, `APPLICATIONINSIGHTS_CONNECTION_STRING`, the
  GitHub token used by the error digest. This makes "separate secrets, outbound off" a
  startup invariant rather than a convention. Mail-credential requirements are skipped in
  demo mode (as they are for `DISABLE_OTP`).
- Accidental-enable defence: demo login (section 2) only signs into users whose email ends
  with the reserved domain `@demo.invalid`. A real deployment that sets `DEMO_MODE` by
  mistake has no such users, so the role buttons fail closed. Startup also logs a prominent
  warning when demo mode is on.
- The in-process scheduler (`schedulerEnabled()`) returns false in demo mode regardless of
  `IN_APP_CRON`.

## 2. Login

- In demo mode, `/login` (`LoginForm.tsx`) shows six "Try as …" buttons above the normal
  form: Admin, Pastor, Office Admin, Auditor, Viewer, Event Organiser.
- Each button calls `signIn("credentials", { mode: "demo", role })`.
- `authorize()` in `src/auth.ts` handles `mode: "demo"` only when `isDemoMode()` is true;
  otherwise it rejects. It maps the role to `<role-slug>@demo.invalid`, loads that user,
  rejects if missing / inactive / not on the reserved domain, and returns the session user.
  Password, email OTP, and TOTP are skipped. No trusted-device grant is created.
- `/forgot-password`, `/reset-password`, and first-run `/setup` return `notFound()` in demo mode.

## 3. Write guards

`assertNotDemo()` is the first check (after auth) in:

| Area | Actions |
|---|---|
| User management (`actions/user.ts`) | `createUser`, `updateUser`, `unlockUser`, `resetUserTotp`, `deleteUser`, `resendWelcome` |
| TOTP (`actions/totp.ts`) | `startTotpEnrolment`, `confirmTotpEnrolment`, `cancelTotpEnrolment`, `regenerateBackupCodes`, `disableTotp` |
| Trusted devices (`actions/trustedDevice.ts`) | `trustDevice`, `revokeTrustedDevice` |
| Password reset (`actions/auth.ts`) | `requestPasswordReset`, `resetPassword` |
| First run (`actions/setup.ts`) | `createFirstAdmin` |
| Church config | all mutating actions in `actions/settings.ts`, `actions/branding.ts`, `actions/emailTemplates.ts` |
| Uploads | transaction attachments, petty-cash receipts, event images |

Imports (`src/app/api/import/bank-statement`, `.../families`) stay available in demo mode
because they are key evaluation features, but are **preview-only**: file size capped at
200 KB, parsing and the preview/match UI work, and the commit step is blocked with the
demo error.

Everything else (people, families, events, registrations, check-in, transactions, petty
cash entries, reports, CSV export) stays fully writable.

UI: controls for blocked features are hidden or disabled with a "Disabled in the live demo"
tooltip when `isDemoMode()`. The server guard is the enforcement; UI changes are cosmetic.

Email: `sendEmail` in `src/lib/email.ts` is a no-op in demo mode — it logs that a send was
skipped (never recipient or body) and returns success, so registration, receipt, and similar
flows complete normally.

## 4. Banner

A thin, non-dismissable bar rendered from the root layout (`src/app/layout.tsx`) when
`isDemoMode()`: "Live demo — shared sandbox, resets nightly. Don't enter real data."
Visible on dashboard, public, auth, and organiser layouts. Print layout excluded.

## 5. Demo data generator

`scripts/demo/seed-demo.ts`, run after `prisma/seed.ts`.

- Deterministic: fixed-seed PRNG (no faker dependency). Dates are generated relative to the
  run date so the dashboard always looks current.
- Refuses to run unless `DEMO_MODE=true` **and** `ALLOW_DEMO_SEED=true`.
- Writes PII through the normal encryption path (`src/lib/crypto.ts`), including blind
  indexes, so the demo exercises the real storage format.
- Contents:
  - Six role users on `@demo.invalid` (one per role); the event-organiser user manages one
    upcoming event.
  - ~40 families / ~150 people with synthetic names, emails (`@example.com`), and phone
    numbers; a mix of membership states.
  - 12 months of transactions across the seeded chart of accounts with plausible
    seasonal patterns (weekly offertory, festival spikes, monthly operating expenses).
  - Petty cash entries for the last few months.
  - 3 past events and 2 upcoming events, with registrations and some check-ins.
  - A handful of pastoral notes (visible to Pastor/Admin only).
  - Birthdays and anniversaries falling in the current week.
- Size target: well under 50 MB in Postgres.

## 6. Hosting and reset

- **App:** Render free web service pulling `ghcr.io/<owner>/parishcrm:latest` (published by
  `publish-image.yml` on each release). Env: `DEMO_MODE=true`, demo-only `AUTH_SECRET`,
  `ENCRYPTION_KEY`, `DATABASE_URL`, `AUTH_URL`. Container migrations on start stay enabled.
- **DB:** Neon free Postgres, dedicated to the demo.
- **Reset:** `.github/workflows/demo-reset.yml` in this repo, nightly at 17:00 UTC
  (03:00 AEST / 04:00 AEDT) plus `workflow_dispatch`. Runs only when
  `github.repository` is the upstream repo, so forks skip it.
  1. Resolve the latest release tag and check it out (so schema and seed code match the
     image Render runs).
  2. `prisma migrate reset --force` against `DEMO_DATABASE_URL`.
  3. `ALLOW_DEMO_SEED=true npm run db:seed`, then `seed-demo`.
  4. Call the Render deploy hook (`RENDER_DEPLOY_HOOK` secret) so the app picks up the
     latest image and drops any cached state.
- Secrets (repo-level): `DEMO_DATABASE_URL`, `DEMO_ENCRYPTION_KEY`, `RENDER_DEPLOY_HOOK`.
  None are shared with any real deployment.

## 7. Website

"Try the live demo" button in `website/src/components/landing/Hero.astro` and the nav CTA
in `Nav.astro`, with a short note that the first load may take ~30 s while the demo wakes.

## 8. Testing

- `isDemoMode` / `assertNotDemo` unit tests.
- `envCheck` demo rules: each forbidden variable fails startup in demo mode; nothing changes
  when demo mode is off.
- `authorize()` demo branch: rejected when demo mode is off; rejected for a non-reserved
  email; rejected for a missing user; succeeds for each role when on.
- Each guarded action returns the demo error in demo mode (table-driven test).
- Import routes: commit blocked, preview allowed, >200 KB rejected in demo mode.
- `sendEmail` no-op in demo mode (transport never called).
- Generator: same seed produces the same row counts; refuses without both flags.

## Delivery

1. **PR 1 — `feat/demo-mode`:** sections 1–5 and 8.
2. **PR 2 — demo reset workflow** (section 6).
3. **Owner (manual):** create the Render service and Neon DB, set repo secrets, run the reset
   workflow once.
4. **PR 3 — website button** (section 7), once the demo URL is live.
