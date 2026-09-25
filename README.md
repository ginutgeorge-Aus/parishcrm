# ParishCRM

A free, self-hosted **church management system** — families & members, accounting,
event ticketing, petty cash, membership, and receipts, in one app your church runs itself.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
[![CI](https://github.com/ginutgeorge-Aus/parishcrm/actions/workflows/ci.yml/badge.svg)](https://github.com/ginutgeorge-Aus/parishcrm/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/ginutgeorge-Aus/parishcrm/graph/badge.svg)](https://codecov.io/gh/ginutgeorge-Aus/parishcrm)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/ginutgeorge-Aus/parishcrm/badge)](https://scorecard.dev/viewer/?uri=github.com/ginutgeorge-Aus/parishcrm)

📖 **[Documentation wiki](https://github.com/ginutgeorge-Aus/parishcrm/wiki)** — every feature in detail: how to use it, how it works, and how to configure it.

> **Single-tenant by design.** One deployment per church, driven by settings a church
> types in — not a multi-tenant SaaS. Your data stays on your server, encrypted at rest.

ParishCRM began as the in-house CRM for one church and is being generalised into a product
any church can run. Church identity (name, address, contacts, branding) is configuration;
region-specific behaviour (fiscal year, currency, tax receipts, bank import) is moving behind
config presets.

## Stack

- **Frontend:** Next.js 16 App Router, React 19, TypeScript
- **Backend:** Next.js Server Actions + API routes
- **Database:** Prisma 7 + PostgreSQL
- **Auth:** NextAuth v5 / Auth.js (JWT, email OTP 2FA, trusted devices)
- **UI:** shadcn/ui + Tailwind CSS v4
- **Testing:** Jest 30 + React Testing Library (unit)

> Requires **Node ≥ 24** (`engines.node` in `package.json`). `postinstall` runs `prisma generate` automatically.

## Getting started

### 1. Setup

```bash
npm install
cp .env.example .env.local   # then fill in values
```

Minimum `.env.local` for local dev:

```
DATABASE_URL="postgresql://postgres:postgres@localhost:51214/template1?sslmode=disable"
AUTH_SECRET="<generate: openssl rand -base64 32>"
AUTH_URL="http://localhost:3000"
ENCRYPTION_KEY="<generate: openssl rand -base64 32>"
GMAIL_USER="church@gmail.com"
GMAIL_APP_PASSWORD="xxxx xxxx xxxx"
CHURCH_NAME="Your Church Name"
CHURCH_ADDRESS="123 Example St, ..."
DISABLE_OTP=true   # local only — never set in production
```

See `.env.example` for the full list including the encryption keyring (`ENCRYPTION_KEY_V1/_V2…` + `ENCRYPTION_KEY_ID`).

### 2. Start local database

```bash
npx prisma dev --detach   # local PostgreSQL daemon at port 51214 (once per session)
npm run db:push           # sync schema to the DB
```

### 3. Seed & run

```bash
ALLOW_DEMO_SEED=true npm run db:seed   # demo users + chart of accounts (opt-in: demo passwords are public)
npm run dev       # http://localhost:3000
```

**Seed login credentials (development only — change before any real use):**

| Email | Password | Role |
|---|---|---|
| admin@example.com | admin123 | ADMIN |
| pastor@example.com | pastor123 | PASTOR |
| secretary@example.com | viewer123 | VIEWER |

> No AUDITOR or OFFICE_ADMIN user is seeded — create one via `/users` if you need to test those roles.

## Commands

```bash
# Dev
npm run dev                              # Next.js at http://localhost:3000

# Database — Prisma (primary)
npx prisma dev --detach                  # start local PostgreSQL daemon
npx prisma dev ls                        # show daemon status / URLs
npx prisma dev stop default              # stop daemon
npm run db:push                          # sync schema (prisma db push)
npx prisma generate                      # regen client after schema change
ALLOW_DEMO_SEED=true npm run db:seed     # seed demo users + chart of accounts
npm run db:studio                        # Prisma Studio GUI

# Database — Docker Compose (alt)
npm run db:start / npm run db:stop

# Build / lint / test
npm run build                            # production build
npm run lint                             # ESLint
npm run knip                             # find unused files, deps, exports
npm test                                 # Jest unit tests
npm test -- --no-coverage                # faster
npm test -- --testPathPatterns="auth"    # single suite (Jest 30 flag)
npm run test:watch                       # watch mode
```

**Schema change workflow:** edit `prisma/schema.prisma` → `npm run db:push` → `npx prisma generate`.

## Project structure

```
src/
  app/                  Next.js App Router
    (auth)/             /login, /forgot-password, /reset-password — unauthenticated
    (dashboard)/        /, families, people, users, accounting/*, events/* — auth + sidebar
    (public)/           /e/[slug], /privacy, /membershipform — public, no auth
    (print)/            print layouts
    api/                API routes
  components/           React components
    ui/                 shadcn/ui (generated — do not edit)
    layout/             sidebar, nav
    accounting/ auth/ dashboard/ events/ families/ people/ petty-cash/ ...
  lib/
    actions/            Server Actions (mutations)
    generated/prisma/   Prisma client (generated — not in node_modules)
    reports/            pure P&L / ledger calculation helpers
    crypto.ts           AES-256-GCM field encryption
    prisma.ts           Prisma client singleton
  auth.ts               NextAuth full config (Node runtime, Prisma)
  auth.config.ts        Edge-safe auth config (used by middleware)
  middleware.ts         route protection & redirects

prisma/                 schema.prisma, migrations, seed.ts
docs/                   topic docs + specs/plans
```

## Core features

- **Families & members** — family + person records with member numbers, email-consent tracking, soft-archive, role-gated pastoral notes.
- **Accounting** — chart of accounts, transaction ledger, bank-statement import with member auto-match, budgets, P&L + trial balance / cash flow / general ledger reports, annual giving summary, receipt emails.
- **Events** — public registration pages (`/e/[slug]`), ticketed events with custom questions, tiered pricing, optional Stripe card payments, check-in, CSV export.
- **Petty cash** — multiple concurrent sessions, cash-in / cash-out / bank-transfer entries, running balance, close-with-variance.
- **Membership** — public application form, approval workflow, letters/receipts.
- **Family self-update** — secure tokenised links let families review and update their own details.
- **Ops** — in-app bug/feature reporting, "What's New" changelog, audit log, admin-customisable email templates.

Full per-feature guides (usage by role, internals, configuration) live in the **[wiki](https://github.com/ginutgeorge-Aus/parishcrm/wiki)**.

## Architecture

### Roles & permissions

| Role | Access |
|---|---|
| `ADMIN` | Full CRUD, user management, accounting admin |
| `PASTOR` | Full CRUD + pastoral notes + accounting view/entry |
| `OFFICE_ADMIN` | People/family/event edit, read-only accounting, user management (not ADMIN accounts), no pastoral notes |
| `AUDITOR` | Read-only accounting (transactions, reports, petty cash, CSV export) — no member PII, no mutations |
| `VIEWER` | Read-only people/families/events — no pastoral notes, no accounting |
| `EVENT_ORGANISER` | No dashboard — own managed events only (registrations, check-in) |

Role helpers live in `src/lib/roleGuard.ts`. Accounting **read** paths gate on `canViewAccounting`; accounting **mutations** require `canAccessAccounting` (ADMIN | PASTOR only). All DB mutations are guarded at **both** the page and the action.

### Authentication

- **Server Components/Actions:** `auth()` from `@/auth`. **Client Components:** `useSession()`.
- **2FA:** email OTP after password. Password and OTP each lock after 5 wrong attempts (15-min cooldown; ADMIN can unlock).
- **Trusted devices:** "remember this device" skips OTP for 14 days; MFA still required on new devices.
- **Session:** JWT, 60-minute idle timeout.

### Database access

All queries via Prisma (`@prisma/adapter-pg`) — no raw SQL.

```typescript
import { prisma } from "@/lib/prisma"
```

Generated client at `src/lib/generated/prisma/`; enums from `@/lib/generated/prisma/enums`.

### Encryption

Sensitive fields are encrypted at rest with **AES-256-GCM**, automatically on read/write through the Server Actions layer — family contact/location, person contact + date of birth, pastoral notes, transaction descriptions, receipt destinations, and registration contact details. Email fields carry a blind-index `emailHash` for lookups without decryption. A versioned keyring supports rotation.

### Audit logging

All mutations write to the `AuditLog` table with `VERB_NOUN` action strings (e.g. `FAMILY_CREATED`, `TRANSACTION_RECONCILED`). Privacy-sensitive exports log `PERSON_EXPORTED`.

## Deployment

ParishCRM is a standard Next.js app backed by PostgreSQL. Run the published container
image against your own Postgres: set the required secrets (`AUTH_SECRET`, `ENCRYPTION_KEY`,
`DATABASE_URL`, mail credentials), run `prisma migrate deploy`, and start the container.
Step-by-step guide: [docs/self-hosting.md](docs/self-hosting.md).

## Contributing

Contributions are welcome — see **[CONTRIBUTING.md](CONTRIBUTING.md)** for the branch/PR
workflow, coding conventions, and the schema-change process, and
**[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)** for community expectations.

To report a security vulnerability, follow **[SECURITY.md](SECURITY.md)** — do **not** open a
public issue.

## License

Licensed under the **[GNU Affero General Public License v3.0](LICENSE)** (AGPL-3.0-or-later).
You may run, study, share, and modify it freely; if you run a modified version as a network
service, you must offer that service's users the corresponding source. Churches self-hosting
an unmodified copy have no additional obligations.
