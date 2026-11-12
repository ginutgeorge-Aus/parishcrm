# Service headcount attendance and trends (OSS-308, issue #308)

## Intent and why

Churches count heads at each service and want to see whether attendance is growing. Today ParishCRM
has no place to record this. ChurchCRM, Jethro and Rock all offer it. The secretary or admin counts
people on paper during the service, then types the totals in afterwards. They want to see weekly,
monthly and year-over-year trends, and a headcount tile on the dashboard.

## Goals

- Record one headcount per **date + service type**, split into **adults** and **children**.
- Entry form that works well on a phone (many users are on phones) and on desktop.
- Tap counters (− / +) for adults and children, plus typing a number directly. Live total.
- Trends page: weekly chart, monthly chart, year-over-year comparison. Adults and children shown
  together (builder's call: stacked bars/areas).
- Dashboard tile: latest headcount, with a small change versus the same service one week earlier.
- Reuse the existing `ServiceType` model (key headcounts on it), so attendance and offering per
  service can be compared later.

## Non-goals

- CSV export (explicitly not wanted).
- Per-person attendance / check-in (this is headcount only).
- Live counting on the day from a phone as people arrive (entry is after the fact from paper).
- Linking headcounts to petty cash offerings now (only keep the key compatible).

## Anti-goals (a failure even if it works)

- A missing service must never be shown as zero. A week with no service for a service type is a
  **gap** in the chart (no point, no bar), not a drop to 0.
- Duplicate headcounts for the same date + service type.
- Exposing entry to roles that should only view.

## Decisions made with the product owner

- Roles (confirmed): ADMIN, PASTOR, OFFICE_ADMIN enter, edit and delete. VIEWER sees trends only.
  AUDITOR and EVENT_ORGANISER see nothing.
- One headcount per date + service type (confirmed). No second service of the same type on a day.
- Saving a date + service type that already exists **edits** it (upsert), never creates a second row.
- Mobile-first entry form, desktop must also work.
- Trends: weekly, monthly, year. No export. Dashboard tile.
- Gaps are gaps, not zeros.

## Constraints

- Next.js 16 App Router, Server Actions for mutations, Prisma 7 (see `CLAUDE.md` and
  `.claude/rules/`). Read `node_modules/next/dist/docs/` before writing Next code.
- New model needs a migration in `prisma/migrations/` (prod uses `migrate deploy`). Risky-PR rules
  apply: state the rollback (migration down / revert) in the PR body.
- Dates: church wall-clock is Australia/Sydney, server is UTC (`.claude/rules/database.md`). The
  service date is a calendar date, not a timestamp.
- Every mutation guarded at both the page and the Server Action (`src/lib/roleGuard.ts`).
- Recharts is already installed; `src/components/accounting/GivingTrendChart.tsx` is prior art.
- Feature PR must update website docs (`website/src/content/docs/docs/`) and stale README claims.
- Tests: Jest, follow `.claude/rules/testing.md`. JSDoc on every new or changed function.
- Verify at 375px and at ≥1920px (`xl:`/`2xl:` scoping for desktop-only tweaks).

## Data shape (builder may refine)

New model `ServiceHeadcount`: `id`, `serviceDate` (date only), `serviceTypeId` → `ServiceType`,
`adults` (int ≥ 0), `children` (int ≥ 0), optional `notes`, `createdAt`, `updatedAt`, entered-by
person/user. Unique on (`serviceDate`, `serviceTypeId`). `ServiceType` gets the back-relation.
Deactivated service types keep their history in the charts.

## Calls made by the assistant (not yet reviewed by the product owner)

- Combined view with a service type filter of "all": a week or month is a gap only if **no** service
  type has a headcount in it; otherwise it shows the sum of what was recorded.
- Year-over-year: same period (week or month) of this year versus last year, on the same chart
  filter, one line/series per year.
- Dates: back-dating allowed; future dates rejected. Dashboard tile uses the latest by **service
  date**, not by entry time.
- Edit and delete: a list of recent headcounts with edit and delete, for the same roles that can
  enter. Delete removes the row (that week becomes a gap). Writes go to the audit log.
- Deactivated service types are hidden in the entry form but keep their history in charts.

## Left to the builder

- Exact page routes and nav placement (e.g. under a new Attendance area or Reports).
- Week definition for grouping (builder's call; suggest ISO week starting Monday, in
  Australia/Sydney).
- Chart layout, empty states, which service type(s) the trend shows by default (suggest a service
  type filter, default all combined).
- Whether the tile compares to "same service last week" or "previous recorded headcount".
- Validation upper bounds, audit logging, whether to allow back-dating, edit and delete UI.
