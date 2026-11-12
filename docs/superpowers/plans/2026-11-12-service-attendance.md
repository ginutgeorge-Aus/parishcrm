# Service Headcount Attendance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record adults/children headcount per service date + service type, and show weekly, monthly and year-over-year trends plus a dashboard tile.

**Architecture:** New `ServiceHeadcount` model keyed on the existing `ServiceType`. Pure aggregation functions in `src/lib/attendance.ts` (no DB, fully unit-tested) turn rows into chart series with gaps as `null`. Server Actions upsert/delete with role + audit guards. Mobile-first entry page, trends page (recharts), and a dashboard tile.

**Tech Stack:** Next.js 16 App Router, Server Actions, Prisma 7, zod, recharts, Jest.

**Spec:** `docs/superpowers/specs/2026-11-12-service-attendance-design.md` (issue #308)

## Global Constraints

- Read `node_modules/next/dist/docs/` before writing Next code; Prisma 7 client imported from `@/lib/generated/prisma/...` (`CLAUDE.md`).
- One headcount per (`serviceDate`, `serviceTypeId`); saving the same pair edits it (upsert).
- Roles: ADMIN, PASTOR, OFFICE_ADMIN enter/edit/delete (= `canEdit`). VIEWER views trends only. AUDITOR and EVENT_ORGANISER see nothing (view = `canViewPeople`).
- A week/month with no recorded headcount is a **gap** (`null`), never `0`. All-services view: gap only if no service type has a headcount in that period; otherwise the sum of what was recorded.
- Back-dating allowed; future dates rejected (compare to Sydney today). Dashboard tile uses latest by service date.
- Service date is a calendar date (church wall-clock Australia/Sydney, server UTC): store as UTC-midnight date via the venue-usage helpers (`ymdToUtcDate` / `utcDateToYmd` in `src/lib/venueUsage.ts`; confirm exports before use), never `new Date(string)` on server local time.
- Weeks are ISO weeks starting Monday (`sydneyWeekStartYMD` in `src/lib/dates.ts` is prior art).
- Deactivated service types are hidden in the entry form but keep history in charts.
- No CSV export. No per-person attendance.
- Every mutation guarded at page and Server Action. Writes audit-logged via `logAuditTx` / `logAudit` (`src/lib/audit.ts`). `assertNotDemo()` on mutations (see `src/lib/actions/serviceType.ts`).
- JSDoc on every new/changed function. Verify UI at 375px and ≥1920px. Counts: integers 0–100000.
- Migration under `prisma/migrations/`; PR body states rollback (revert commit + drop table down-migration). Feature PR updates `website/src/content/docs/docs/` and stale README claims.

## Review Focus

- Year boundary: 2026-12-28 to 2027-01-03 falls in one ISO week; it must not split or duplicate in the weekly chart.
- Year-over-year with week 53 (or a leap day in monthly view): last year has no matching bucket, so show a gap, not an error or zero.
- Only adults or only children entered as 0: 0 is a real recorded count and must plot as 0, distinct from a gap.
- No active service types (the petty cash admin page is gated by the petty cash feature): entry page shows an empty state, no crash.
- Saving the same date + type twice from two tabs: second save edits, never errors with a raw unique-violation.
- VIEWER opening the entry or edit URL directly, and a role-less session: redirected/blocked at page and action.

---

### Task 1: Schema, migration, role guards

**Files:**
- Modify: `prisma/schema.prisma` (add model after `ServiceType`, ~line 866; add `headcounts ServiceHeadcount[]` to `ServiceType`)
- Create: `prisma/migrations/20261112100000_service_headcount/migration.sql`
- Modify: `src/lib/roleGuard.ts`
- Test: `src/lib/__tests__/roleGuard.attendance.test.ts`

**Interfaces:**
- Produces: `canEditAttendance(role): boolean` (= `canEdit`), `canViewAttendance(role): boolean` (= `canViewPeople`); model `ServiceHeadcount { id Int, serviceDate DateTime @db.Date, serviceTypeId Int, adults Int, children Int, notes String?, createdById Int?, createdAt, updatedAt }` with `@@unique([serviceDate, serviceTypeId])` and `@@index([serviceDate])`.

- [ ] **Step 1: Write failing test** asserting for each of the six roles: `canEditAttendance` true only for ADMIN/PASTOR/OFFICE_ADMIN; `canViewAttendance` true for those plus VIEWER; false for AUDITOR, EVENT_ORGANISER, `undefined`.
- [ ] **Step 2: Run** `npm test -- --testPathPatterns="roleGuard.attendance"` — expect FAIL (not exported).
- [ ] **Step 3: Add the two helpers** with JSDoc to `src/lib/roleGuard.ts`, each delegating to the existing helper (separate names so rules can diverge, like `canManageGroups`).
- [ ] **Step 4: Add the model** to `schema.prisma`, `onDelete: Restrict` on the `ServiceType` relation. Hand-write the migration SQL (CREATE TABLE, unique index, date index, FK) matching the `groups` migration style; run `npx prisma generate` and `npx prisma validate`.
- [ ] **Step 5: Run** the test again — expect PASS. Commit `feat(attendance): headcount model and role guards`.

### Task 2: Aggregation library (pure)

**Files:**
- Create: `src/lib/attendance.ts`
- Test: `src/lib/__tests__/attendance.test.ts`

**Interfaces:**
- Consumes: `sydneyWeekStartYMD`, `sydneyMonthKey` patterns from `src/lib/dates.ts`.
- Produces:
  - `type HeadcountRow = { date: string /* YYYY-MM-DD */; serviceTypeId: number; adults: number; children: number }`
  - `type Point = { key: string; label: string; adults: number | null; children: number | null }`
  - `weekStartYMD(ymd: string): string` (Monday of that ISO week)
  - `buildWeekly(rows: HeadcountRow[], fromYMD: string, toYMD: string, serviceTypeId?: number): Point[]` — one point per week in range, `null` for weeks with no rows
  - `buildMonthly(rows, fromMonth: string, toMonth: string, serviceTypeId?): Point[]` — `key` is `YYYY-MM`
  - `buildYearOverYear(rows, year: number, granularity: "week" | "month", serviceTypeId?): { period: number; thisYear: number | null; lastYear: number | null }[]` — total (adults+children) per ISO week number (1–53) or month (1–12); `lastYear` null when no matching rows
  - `latestWithDelta(rows): { date: string; serviceTypeId: number; adults: number; children: number; previousTotal: number | null } | null` — latest by date; `previousTotal` = same service type's headcount exactly 7 days earlier, else `null`

- [ ] **Step 1: Write failing tests** (exact values): `weekStartYMD("2027-01-01") === "2026-12-28"`; a week with rows for two service types on different days sums both; a week with no rows gives `adults: null, children: null`; a row of `{adults: 0, children: 0}` gives `0`, not `null`; `serviceTypeId` filter excludes other types; YoY for a year with no week 53 in last year gives `lastYear: null` for period 53; `latestWithDelta([])` is `null`; delta null when no row 7 days earlier.
- [ ] **Step 2: Run** `npm test -- --testPathPatterns="attendance.test"` — expect FAIL.
- [ ] **Step 3: Implement** the functions above with JSDoc. Group by key into a `Map`; iterate the full range so empty buckets emit `null`. Do date math on `YYYY-MM-DD` strings in UTC (no local-time `Date` parsing).
- [ ] **Step 4: Run** — expect PASS. Commit `feat(attendance): aggregation helpers with gap handling`.

### Task 3: Server Actions and queries

**Files:**
- Create: `src/lib/actions/attendance.ts`, `src/lib/attendanceQueries.ts`
- Test: `src/lib/actions/__tests__/attendance.test.ts`

**Interfaces:**
- Consumes: `canEditAttendance`, `canViewAttendance` (Task 1); `HeadcountRow` (Task 2).
- Produces:
  - `saveHeadcount(input: { date: string; serviceTypeId: number; adults: number; children: number; notes?: string }): Promise<ActionResult>` — upsert on (`serviceDate`, `serviceTypeId`); audit `ATTENDANCE_SAVED`
  - `deleteHeadcount(id: number): Promise<ActionResult>` — audit `ATTENDANCE_DELETED`
  - `getHeadcountRows(fromYMD: string, toYMD: string): Promise<HeadcountRow[]>` (view-guarded by callers)
  - `getRecentHeadcounts(limit: number)` with service type name, for the edit list
  - `getActiveServiceTypes(): Promise<{ id: number; name: string }[]>`

- [ ] **Step 1: Write failing tests** (mock auth/prisma per `.claude/rules/testing.md`): VIEWER and AUDITOR get `{ error: "Unauthorized" }` from save and delete; future date returns an error; negative or non-integer count returns an error; valid save by OFFICE_ADMIN calls `upsert` with the unique key and writes an audit row; saving an inactive or unknown `serviceTypeId` returns an error; P2002 from a concurrent create is retried as an update, not surfaced; `deleteHeadcount` with invalid id returns `"Invalid ID"`.
- [ ] **Step 2: Run** `npm test -- --testPathPatterns="actions/__tests__/attendance"` — expect FAIL.
- [ ] **Step 3: Implement** with zod validation (date `YYYY-MM-DD` regex, not after `sydneyTodayYMD()`, counts `z.number().int().min(0).max(100000)`), `assertNotDemo()`, `isValidPgId`, `revalidatePath("/attendance")` and `"/"`. Use `prisma.serviceHeadcount.upsert`; catch `isP2002` (from `@/lib/validation`) and retry once as update. Queries select only needed columns and return dates via `utcDateToYmd`.
- [ ] **Step 4: Run** — expect PASS. Commit `feat(attendance): save/delete actions and queries`.

### Task 4: Entry page and recent list (mobile-first)

**Files:**
- Create: `src/app/(dashboard)/attendance/page.tsx`, `src/components/attendance/HeadcountForm.tsx`, `src/components/attendance/Counter.tsx`, `src/components/attendance/RecentHeadcounts.tsx`
- Test: `src/components/attendance/__tests__/Counter.test.tsx`, `src/components/attendance/__tests__/HeadcountForm.test.tsx`, `src/app/(dashboard)/attendance/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: `saveHeadcount`, `deleteHeadcount`, `getActiveServiceTypes`, `getRecentHeadcounts` (Task 3); `canEditAttendance`, `canViewAttendance`.
- Produces: route `/attendance` (entry form + recent list for editors; redirect to `/attendance/trends` for VIEWER); `Counter({ label, value, onChange })` client component with − / + buttons (min 44px tap targets), direct numeric input, never below 0.

- [ ] **Step 1: Write failing tests:** `Counter` + increments, − stops at 0, typing "12" sets 12, non-numeric input ignored; `HeadcountForm` shows live total (adults + children), defaults date to Sydney today, submits `saveHeadcount` with entered values, selecting a date+type that already has a row pre-fills its counts (edit mode), shows empty state when no active service types; page test: VIEWER redirected, AUDITOR redirected to `/`, ADMIN sees form.
- [ ] **Step 2: Run** the three suites — expect FAIL.
- [ ] **Step 3: Implement** the components following `docs/conventions.md` and an existing client form for pattern (e.g. `src/components/petty-cash/ServiceTypeForm.tsx`). Layout: single column below `md`, counters stacked and full width; sticky save button on mobile. Recent list: table at `md+`, cards below; edit loads row into form, delete asks confirm.
- [ ] **Step 4: Run** — expect PASS. Check 375px and ≥1920px in a browser. Commit `feat(attendance): mobile entry form and recent list`.

### Task 5: Trends page and charts

**Files:**
- Create: `src/app/(dashboard)/attendance/trends/page.tsx`, `src/components/attendance/AttendanceChart.tsx`, `src/components/attendance/YearOverYearChart.tsx`, `src/components/attendance/TrendsClient.tsx`
- Test: `src/components/attendance/__tests__/AttendanceChart.test.tsx`, `src/app/(dashboard)/attendance/trends/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: `buildWeekly`, `buildMonthly`, `buildYearOverYear` (Task 2), `getHeadcountRows`, `getActiveServiceTypes` (all types incl. inactive needed for filter: add `getAllServiceTypes()` to `attendanceQueries.ts`), `canViewAttendance`.
- Produces: route `/attendance/trends` with tabs Weekly (last 26 weeks) / Monthly (last 12 months) / Year; service type filter (default all combined).

- [ ] **Step 1: Write failing tests:** chart renders stacked adults+children and passes `null` points through (recharts `connectNulls={false}`); chart exposes an `aria-label` summarising range and total (as `GivingTrendChart` does); all-empty data renders an empty-state message, not an empty axis; page: AUDITOR and EVENT_ORGANISER redirected, VIEWER allowed.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** with recharts + `@/components/ui/chart` (`ChartContainer`), modelled on `src/components/accounting/GivingTrendChart.tsx`. Year view: two series (this year, last year) via `buildYearOverYear`, week/month toggle. Filter and tab state in URL search params so links are shareable.
- [ ] **Step 4: Run** — expect PASS. Check 375px and ≥1920px. Commit `feat(attendance): weekly, monthly and year-over-year trends`.

### Task 6: Dashboard tile and navigation

**Files:**
- Create: `src/components/dashboard/AttendanceTile.tsx`
- Modify: `src/app/(dashboard)/page.tsx` (add to the parallel query batch and render for `canViewAttendance`), `src/components/layout/sidebar/navData.ts` (add `/attendance` item near line 59, `show` for `canViewAttendance`)
- Test: `src/components/dashboard/__tests__/AttendanceTile.test.tsx`

**Interfaces:**
- Consumes: `latestWithDelta` (Task 2), `getHeadcountRows`.
- Produces: `AttendanceTile({ latest }: { latest: ReturnType<typeof latestWithDelta> })` — shows service name, date, adults, children, total, and `+N`/`−N` vs `previousTotal`; hidden delta when `previousTotal` is null; empty state ("No headcounts yet") linking to `/attendance` for editors; links to `/attendance/trends`.

- [ ] **Step 1: Write failing tests:** renders total and `+12` / `−5` delta; no delta text when `previousTotal` null; empty state for `latest = null`.
- [ ] **Step 2: Run** `npm test -- --testPathPatterns="AttendanceTile"` — expect FAIL.
- [ ] **Step 3: Implement** the tile and wire it into the dashboard (query rows for the last 14 days only) and sidebar (VIEWER sees Trends link only; editors see Attendance).
- [ ] **Step 4: Run** the tile test, then `npm test -- --testPathPatterns="dashboard|navData"` — expect PASS. Commit `feat(attendance): dashboard tile and nav entry`.

### Task 7: Docs and final checks

**Files:**
- Create/Modify: page under `website/src/content/docs/docs/` for attendance (follow an existing feature page's frontmatter), `README.md` feature list if it claims a feature set, `.claude/rules/data-model.md` schema map line.

- [ ] **Step 1: Write the docs page** (who can enter, mobile entry, gaps vs zero, trends, tile) and add the README/data-model line.
- [ ] **Step 2: Run** `npx tsc --noEmit`, `npm run lint`, and `npm test -- --testPathPatterns="attendance|AttendanceTile|roleGuard"` — expect no errors, all pass.
- [ ] **Step 3: Commit** `docs(attendance): website docs and data model`. Open PR titled `feat(attendance): service headcount attendance and trends`, body with rollback note (revert commit; down-migration drops `ServiceHeadcount`), then `/code-review high` once (migration = risky path).
