# ParishCRM review guide

Shared by the Gemini Code Assist and cubic reviewers. Focus on correctness, security and data
safety. Skip pure formatting nits — ESLint, Semgrep and SonarCloud already run in CI.

## Stack

Next.js 16 App Router + Server Actions, TypeScript, Prisma 7 over `@prisma/adapter-pg`, NextAuth v5
(JWT), Jest 30. Next.js 16 has breaking changes from earlier versions — do not suggest older APIs.

## Flag these

- **Public repo.** Any real member PII, church details, credentials or `.env` values in code, tests
  or fixtures. Demo data uses `admin@example.com`-style synthetic values only.
- **Authorization.** Every staff-facing mutation must be guarded in **both** the page and the Server
  Action using the helpers in `src/lib/roleGuard.ts`. Deliberately public flows (membership
  application, public feedback, event registration/waitlist, family self-update, event checkout) skip
  `roleGuard` and rely on rate limits, signed tokens and server-side validation instead — check those
  controls. Turnstile is optional (only active when configured) and covers only the membership,
  feedback and event registration/waitlist forms. Assigned-organiser (`EVENT_ORGANISER`) event flows
  such as attendee check-in and payment reminders are authorized per event via `canManageEvent` in
  `src/lib/eventManager.ts` (page and action), not a `roleGuard` helper — do not flag that. Accounting
  reads gate on `canViewAccounting`; creating and editing accounting entries needs
  `canAccessAccounting` (ADMIN/PASTOR), but these are ADMIN-only via `isAdmin`: transaction deletion,
  petty-cash deletion and import, account/account-group/fund/payment-account CRUD, and accounting
  settings — flag any widening of those to `canAccessAccounting`. Watch for IDOR (acting on an id the user
  does not own) and self-action bugs (e.g. a user demoting or deleting themselves).
- **Auth split.** `src/auth.config.ts` is the lean callbacks-only config imported by
  `src/middleware.ts`; the full config (Credentials, Prisma, bcrypt) lives in `src/auth.ts`. Middleware
  runs on the Node runtime (`config.runtime = "nodejs"`) but should keep importing `authConfig`, not
  `auth.ts`.
- **Encryption.** PII fields are AES-256-GCM encrypted via `src/lib/crypto.ts`, with HMAC blind
  indexes (`emailHash`/`mobileHash`) for lookups. Flag plaintext writes to encrypted columns,
  equality queries on ciphertext, or a missing blind-index update.
- **Money.** `Decimal(10,2)` columns. Amounts are regex-validated before a Prisma write — flag
  `parseFloat`/`Number()` used to compute or persist money. Converting for display or validation
  (e.g. `toFloat()` in `src/lib/utils.ts`) is fine.
- **Dates.** Church wall-clock is the configured `APP_TIMEZONE` (`src/lib/appConfig.ts`, default
  Australia/Sydney); the server runs in UTC. Flag day/month boundaries computed in server-local time
  or with a hard-coded zone.
- **CSV export.** Cells must go through the formula-injection guard.
- **Server Actions** that mutate data and report success/failure to a form return the `ActionResult`
  shape (or `ActionResultWithSuccess` from `src/lib/actions/types.ts` when the form shows a success
  message) and revalidate affected paths/tags. Actions with their own contract (e.g. `logout`, status
  reads, checkout/enrollment unions) are fine as-is.
- **Migrations.** A schema change needs a matching file in `prisma/migrations/`; flag destructive
  migrations (dropped columns/tables) without a data-preservation note.
- **Tests.** New logic should come with Jest tests; mocks follow existing NextAuth/Prisma patterns.
- **Docs.** A feature or behaviour change should update `website/src/content/docs/docs/` and any
  stale README claim in the same PR.
