# Operations

> Generic, public operations reference. Monitoring/contact specifics are placeholders.
> (Private deployments: keep live production values in the gitignored `docs/private/operations.md`.)

## One-off ops scripts

Run via `npx tsx scripts/<name>.ts`. Backfills are **idempotent + dry-run by default** — pass the write flag only after a dry run looks right.

| Script | Purpose |
|--------|---------|
| `create-admin-user` | Create an ADMIN account |
| `encrypt-person-email`, `encrypt-family-location`, `encrypt-registration-contact`, `encrypt-family-update-payload`, `encrypt-petty-cash-fields`, `encrypt-petty-cash-transfer`, `encrypt-registration-customanswers`, `encrypt-transaction-notes`, `encrypt-person-notes` | Encryption backfills (idempotent, dry-run default). `encrypt-transaction-notes` encrypts historical plaintext `Transaction.notes` at rest; `encrypt-person-notes` does the same for `Person.notes` |
| `rotate-encryption-key` | Re-encrypt all fields under a new key (usage in the script header) |
| `set-default-monthly-dues` | One-time backfill: `Family.monthlyDues` for member families with no amount |
| `backfill-petty-cash-sundays` | Backfill the weekly petty-cash session for past Sundays that never had one auto-opened |
| `check-pettycash-importkey-dups` | **Read-only** pre-migration safety check — reports duplicate `PettyCashReceipt`/`Expense` `importKey` values before a `@unique` is added |
| `backfill-email-hash` | Populate `Person.emailHash` / `Registration.emailHash` blind index for pre-existing rows |
| `backfill-mobile-hash` | Populate `Person.mobileHash` / `MembershipApplication.mobileHash` blind index; also encrypts pre-existing plaintext `MembershipApplication.mobile` rows |
| `rehash-mobile` | Unconditionally recompute the mobile blind index after `hmacMobile` gained prefix normalisation |
| `audit-data-integrity` | **Read-only** diagnostic — scans encrypted-at-rest fields for plaintext leaks, checks `emailHash` completeness, verifies invariants FKs can't enforce. Exits non-zero on any finding; run against prod / a restored dump |
| `purge-registration-pii` | Retention purge — anonymises event-registration PII 6 months after the event ends, preserving financial aggregates. Also covers `Waitlist` and `CheckoutSession.payload`. Idempotent via each table's `anonymizedAt`; runs monthly via CI |
| `purge-membership-application-pii` | Retention purge — anonymises DECIDED `MembershipApplication` payload/signature/email/mobile/applicantName reviewed >24 months ago; PENDING untouched. Idempotent via `anonymizedAt`; runs monthly via CI |
| `set-church-name` | One-time/ad-hoc: set the `churchName` `AppSetting` row directly from the CLI (`CHURCH_FULL_NAME="…"`, dry-run unless `--apply --yes`) |
| `unlock-admins` | **Emergency** — clears password + OTP lockout on all ADMIN accounts. Only needed if a brute-force/DAST locks out *every* admin at once (a single lock auto-expires in 15 min; a non-locked admin can also unlock via the Users UI). Run `DATABASE_URL=<prod> npx tsx scripts/unlock-admins.ts` |
| `prep-release` | CI/release tooling — mechanical release prep (`CHANGELOG.md` rename, `whatsNew.ts` entry, test bump). Not a data script |
| `codebase-review` / `file-findings` | CI tooling — optional weekly full-codebase AI review that files findings as `weekly-review`-labelled issues. Not data scripts |

## Health Stack

- typecheck: `npx tsc --noEmit`
- lint: `npx eslint .`
- test: `npm test -- --no-coverage`
- deadcode: `npx knip`
- SBOM: `npm run sbom` (CycloneDX format)
- license check: `npm run license:check`

## Availability Monitoring

External uptime probe against `/api/health` — the one place that reports a real DB-backed readiness
signal (`SELECT 1` → 200, DB failure → 503, no info leak). An outage must page you before a user notices
. Use an **external** vantage point (independent of your CI runner and hosting region) so the probe
still fires when the region/network/runner is down — a runner-hosted cron shares the same failure domain
and goes blind in exactly the outage it exists to catch.

### Configure (one-time, in your uptime monitor)

| Setting | Value |
|---------|-------|
| Monitor type | HTTP(s) |
| URL | `<APP_URL>/api/health` |
| Interval | 5 min |
| Keyword monitoring | Keyword **exists**, keyword `"status":"ok"` — catches a 200 with a broken body |
| Timeout | 30 s |
| Alert contacts | your on-call email / push |
| Alert threshold | Alert after **2** consecutive failures (≈10 min) — absorbs a single transient blip |

## Security Cadence

Lightweight recurring security routine. Match effort to risk + low change rate — no daily scans.

| Check | Cadence | Trigger | Tool |
|-------|---------|---------|------|
| Diff security review | Per PR | Every branch before merge | `/security-review` |
| Dependency CVE audit | Weekly + per PR | CI on dep changes | `npm audit` |
| Dependabot | Continuous | Automated, set once | GitHub |
| Health (tsc+lint+test) | Weekly | Before release | `/health` |
| Web DAST | Monthly | After big feature (auth/events/public pages) | OWASP ZAP on the prod URL |
| Secret/key audit | Quarterly | + suspected leak | manual review of `ENCRYPTION_KEY`, `AUTH_SECRET`, mail creds |

Tracked in GitHub under label `security-cadence`. Reminders fire via scheduled cron.
