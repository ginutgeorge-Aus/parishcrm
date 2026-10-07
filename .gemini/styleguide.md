# ParishCRM review guide

Shared by the Gemini Code Assist and cubic reviewers. Focus on correctness, security and data
safety. Skip pure formatting nits — ESLint, Prettier, Semgrep and SonarCloud already run in CI.

## Stack

Next.js 16 App Router + Server Actions, TypeScript, Prisma 7 over `@prisma/adapter-pg`, NextAuth v5
(JWT), Jest 30. Next.js 16 has breaking changes from earlier versions — do not suggest older APIs.

## Flag these

- **Public repo.** Any real member PII, church details, credentials or `.env` values in code, tests
  or fixtures. Demo data uses `admin@example.com`-style synthetic values only.
- **Authorization.** Every mutation must be guarded in **both** the page and the Server Action using
  the helpers in `src/lib/roleGuard.ts`. Accounting reads gate on `canViewAccounting`; accounting
  mutations need `canAccessAccounting` (ADMIN/PASTOR only). Watch for IDOR (acting on an id the user
  does not own) and self-action bugs (e.g. a user demoting or deleting themselves).
- **Auth split.** `src/auth.config.ts` and `src/middleware.ts` run on the Edge runtime — no Node-only
  imports (Prisma, crypto, `server-only` modules) there.
- **Encryption.** PII fields are AES-256-GCM encrypted via `src/lib/crypto.ts`, with HMAC blind
  indexes (`emailHash`/`mobileHash`) for lookups. Flag plaintext writes to encrypted columns,
  equality queries on ciphertext, or a missing blind-index update.
- **Money.** `Decimal(10,2)` columns. Amounts are regex-validated before a Prisma write — never
  `parseFloat`/`Number()` on money.
- **Dates.** Church wall-clock is Australia/Sydney, server is UTC. Flag day/month boundaries computed
  in server-local time.
- **CSV export.** Cells must go through the formula-injection guard.
- **Server Actions** return the `ActionResult` shape and revalidate affected paths/tags.
- **Migrations.** A schema change needs a matching file in `prisma/migrations/`; flag destructive
  migrations (dropped columns/tables) without a data-preservation note.
- **Tests.** New logic should come with Jest tests; mocks follow existing NextAuth/Prisma patterns.
- **Docs.** A feature or behaviour change should update `website/src/content/docs/docs/` and any
  stale README claim in the same PR.
