# Real-database integration tests

`__tests__/integration/` holds race tests that need a real Postgres. The mocked suites prove the
code *asks* for a safe behaviour (atomic increment, Serializable isolation, unique key); these prove
Postgres *delivers* it under parallel load.

| File | Race |
|---|---|
| `invoice-account-races.test.ts` | invoice write vs account retype/delete (Serializable) |
| `registration-last-seat-race.test.ts` | parallel registrations for the last seat: exactly one wins |
| `stripe-webhook-race.test.ts` | same signed Stripe event delivered in parallel: one paid registration |
| `bank-import-race.test.ts` | same bank statement confirmed in parallel: no duplicate transactions |
| `db-rate-limit-race.test.ts` | `dbRateLimit` burst: exactly `limit` allowed, never more |
| `login-lockout-race.test.ts` | parallel wrong passwords: exactly 5 compare, account locks, no lost counter |
| `sunday-school-enrolment-race.test.ts` | first enrolment of one child into several classes at once: exactly one row, no raw error (#960/#961) |

## Opt-in

Every file is skipped unless `INTEGRATION_DB=1`, so plain `npm test` (and CI's coverage run) never
touches a database. CI runs them in the `migrations` job against its disposable Postgres service.

## Run locally

Use a **disposable** database: the tests create rows (tagged, and cleaned up best-effort) and are
not safe against a database holding real data. Needs Node >= 24.9 and a real Postgres server.

```bash
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/parishcrm_test
export ENCRYPTION_KEY="$(openssl rand -base64 32)"
npx prisma migrate deploy
INTEGRATION_DB=1 npm test -- --testPathPatterns="__tests__/integration/"
```

`npx prisma dev` (PGlite) is **not** enough: it serves one connection at a time, so parallel
queries fail with "Server has closed the connection" and nothing actually races. Use Docker
(`docker run -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16`) or a native Postgres.

A failing race test has found a real bug: file it, do not loosen the assertion.
