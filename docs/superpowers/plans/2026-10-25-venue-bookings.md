# Venue Bookings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the part-1 venue usage log into full venue bookings: booking-request and cancellation emails, an approval-gated automatic monthly invoice request, and a no-login public calendar.

**Architecture:** Part 1 (commit `cb921d8`) already ships `VenueUsage`/`VenueUsageRequest`, the `venueUsage.*` settings, the admin page `/venue-usage`, and a manual invoice send in `src/lib/actions/venueUsage.ts`. This plan (a) adds schema fields, (b) moves invoice prepare/send into an auth-free lib so both the Server Action and the in-app scheduler job call it, (c) adds new Server Actions and UI panels, (d) adds a leased monthly job wired into `src/lib/scheduler.ts` + `schedulerRunner.ts`, (e) adds a token-gated public page `/venue/[token]`.

**Tech Stack:** Next.js 16 App Router, Server Actions, Prisma 7 (`@prisma/adapter-pg`), Zod v4 (`.issues`), Jest 30, Tailwind. Spec: `docs/superpowers/specs/2026-10-25-venue-bookings-design.md`.

## Global Constraints

- **Public repo (AGPL):** only synthetic values in code, tests, docs (`venue@example.com`, `Pat Example`, `Example Hall`, `office@example.com`). Never real names/emails/tokens.
- **JSDoc on every new or changed function**, exported or not (`docs/conventions.md`). Jest `it()` callbacks exempt.
- **Zod v4:** use `.issues`, not `.errors`. All Zod strings get `.max()`. `"use server"` files export only `async` functions (so shared sync helpers/types live in `src/lib/*.ts`).
- **No raw SQL** in app code (semgrep `crm-no-raw-sql`). The migration `.sql` file is hand-written and is the only SQL.
- **Dates:** calendar dates stored at UTC midnight (`@db.Date`); "today"/month boundaries via `src/lib/dates.ts` (`sydneyTodayYMD`, `sydneyClock`, `sydneyMonthKey`). Never `new Date(y, m, d)`.
- **Role gates at page AND action:** `canEdit` for bookings/requests/approval; `isAdmin` for settings and calendar-link reset. Feature must be enabled (`venueUsage.enabled === "true"`).
- **Counting rules:** invoice request and totals count CONFIRMED rows only. "Already booked" = CONFIRMED rows with `date >= today` (Sydney). A month is **complete** when every Sunday in it has >=1 CONFIRMED or CANCELLED row, no row in the month is REQUESTED, and >=1 row is CONFIRMED.
- **Emails:** `replyTo` = `replyToEmail` (fallback acting user; scheduler: `replyToEmail`, else none). Booking request / cancellation: To contact, CC booking CCs + reply-to. Invoice request: To contact, CC invoice CC + reply-to. Reminder / "sent" notice: all active canEdit users (ADMIN, PASTOR, OFFICE_ADMIN with `archivedAt: null`), no CC. All interpolated values HTML-escaped. Demo mode (`assertNotDemo()`) blocks every send.
- **Template vars:** `{venueName}`, `{contactName}`, `{churchName}`, `{month}`, `{dates}`, `{bookedDates}`, `{totalHours}`, `{senderName}`. Date line format: `Sunday, 6 September: 5:00 PM – 8:30 PM (3.5 hours)`.
- **Audit:** `logAudit` on every mutation, approval, approval-clear, send, link reset. Metadata holds ids/dates/counts only, never email addresses.
- **Test command shape:** `npm test -- --testPathPatterns=<basename>`. Tests are colocated in `__tests__/` next to the module. Action tests start with `/** @jest-environment node */`.
- **Commit** after each task; message in Conventional Commits, end with the attribution line from the session.

## Spec ambiguities resolved here (decisions, with why)

1. **Route/label:** keep route `/venue-usage` (existing links, middleware, tests); rename user-visible nav label and page heading to "Venue bookings".
2. **Template shape:** `EmailTemplate` rows have `subject/intro/body/signoff`. Date list is a generated `<ul>`; it renders where `{dates}` appears in `intro`/`body`/`signoff`, or, if no `{dates}` token exists in any field, right after `body`. Same for `{bookedDates}` (booking request only; section omitted when none). In plain text `{dates}` is newline-joined `- ` lines.
3. **Calendar token is not in `VENUE_USAGE_SETTING_KEYS`**: that list feeds the generic `upsertSetting` allowlist, which must not let a caller set the secret. The token has its own constant and only `resetVenueCalendarLink` writes it.
4. **Scheduler job** is not a `FeatureKey`: it is not wrapped in `gated()`; the job itself no-ops when venue usage is off. Retries follow the existing period-job rules (Sydney-month success key, 3 attempts/period). No `/api/cron` route (not in spec).
5. **Same-month cancellation of the "approval":** approval is per `VenueUsageRequest` row for the month being invoiced. Approving the *current* month creates the row if absent. Editing a row whose date falls in an approved, unsent month clears approval. Moving a row between months clears both months.
6. **`reminderSentAt` reuse:** set only after the job's work (send or reminder) completed; the job re-checks `sentAt` SUCCESS first so a re-run is a no-op.
7. **Booking CC list** is a comma-separated string setting; each address validated with `isValidEmail`, max 10 addresses, de-duplicated case-insensitively.

## File Structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma`, `prisma/migrations/20261026000000_venue_bookings/migration.sql` | New columns |
| `src/lib/venueBookings.ts` (new, pure) | Sundays, completeness, month math, Sydney job gate, address-list parsing, calendar month clamp |
| `src/lib/venueUsage.ts` (edit) | Existing pure helpers; `buildRequestEmail` gains template support |
| `src/lib/venueEmails.ts` (new, pure) | Template-driven builders: booking request, cancellation, invoice request, staff notices |
| `src/lib/venueUsageSettings.ts` (edit) | Read `bookingCcEmails`, `calendarToken` |
| `src/lib/venueCalendarToken.ts` (new, server) | Mint token |
| `src/lib/venueInvoice.ts` (new, server, auth-free) | `prepareInvoiceRequest`, `deliverInvoiceRequest` shared by action + job |
| `src/lib/venueApproval.ts` (new, server) | `clearApprovalForMonths(tx, months, actor)` |
| `src/lib/venueMonthlyJob.ts` (new, server) | Lease claim + `runVenueInvoiceSweep` |
| `src/lib/venueCalendar.ts` (new, server) | Token check + calendar data for public page |
| `src/lib/actions/venueUsage.ts` (edit) | Existing actions + new ones (kept `"use server"`) |
| `src/app/(public)/venue/[token]/page.tsx` (+ `VenueCalendar` component) | Public calendar |
| `src/components/venue-usage/*` | Admin UI panels |
| `website/src/content/docs/docs/venue-bookings.md`, `scheduled-jobs.md`, `README.md` | Docs |

---

### Task 1: Prisma schema + migration

**Files:**
- Modify: `prisma/schema.prisma` (`model VenueUsage`, `model VenueUsageRequest`, `model User`)
- Create: `prisma/migrations/20261026000000_venue_bookings/migration.sql`

**Interfaces:**
- Produces: `VenueUsage.bookingRequestedAt: Date | null`; `VenueUsageRequest.approvedAt: Date | null`, `.approvedById: number | null`, `.approvedBy` relation, `.autoSent: boolean` (default false). `User.venueUsageRequestsApproved`.

- [ ] **Step 1: Edit `schema.prisma`.** In `model VenueUsage` add after `notes`: `bookingRequestedAt DateTime?`. In `model VenueUsageRequest` add after `reminderClaimedAt`:

```prisma
  approvedAt        DateTime?
  approvedById      Int?
  approvedBy        User?     @relation("VenueUsageRequestApprovedBy", fields: [approvedById], references: [id], onDelete: SetNull)
  autoSent          Boolean   @default(false)
```
and add `@@index([approvedById])`. In `model User`, below `venueUsageRequestsSent`, add `venueUsageRequestsApproved VenueUsageRequest[] @relation("VenueUsageRequestApprovedBy")`. Update the model comment on `VenueUsageRequest` to mention approval for the automatic send. Add `@@index([status, date])` is NOT needed (existing `@@index([date])` suffices).

- [ ] **Step 2: Write the migration** (additive only, safe on prod data):

```sql
-- AlterTable
ALTER TABLE "VenueUsage" ADD COLUMN "bookingRequestedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "VenueUsageRequest" ADD COLUMN "approvedAt" TIMESTAMP(3),
ADD COLUMN "approvedById" INTEGER,
ADD COLUMN "autoSent" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "VenueUsageRequest_approvedById_idx" ON "VenueUsageRequest"("approvedById");

-- AddForeignKey
ALTER TABLE "VenueUsageRequest" ADD CONSTRAINT "VenueUsageRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 3: Validate.** Run `npx prisma validate` -> `The schema at prisma/schema.prisma is valid`. Run `npx prisma generate` -> `Generated Prisma Client`. Do NOT `git add` anything under `src/lib/generated`.
- [ ] **Step 4: Type check** `npx tsc --noEmit` -> exit 0 (nothing consumes the new fields yet).
- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261026000000_venue_bookings
git commit -m "feat(venue): schema for booking requests and invoice approval"
```

**Passing:** `prisma validate` ok, `tsc` exit 0. (If the folder name sorts before `20261025000000_venue_usage`, rename it; it must sort after.)

---

### Task 2: Pure booking helpers (`venueBookings.ts`)

**Files:**
- Create: `src/lib/venueBookings.ts`
- Test: `src/lib/__tests__/venueBookings.test.ts`

**Interfaces:**
- Consumes (from `@/lib/venueUsage`): `monthRange`, `isValidMonth`, `ymdToUtcDate`, `utcDateToYmd`, `isValidYMD`, `VenueBookingStatusValue`.
- Produces:
  - `sundaysInMonth(month: string): string[]` ("YYYY-MM-DD", ascending)
  - `type CompletenessRow = { date: Date; status: VenueBookingStatusValue }`
  - `monthCompleteness(month: string, rows: readonly CompletenessRow[]): { complete: boolean; missingSundays: string[]; requestedCount: number; confirmedCount: number }`
  - `nextMonth(month: string): string`; `addMonths(month: string, n: number): string`
  - `invoiceJobTarget(now: Date): { run: boolean; month: string }` — run only when Sydney date is the 1st and hour >= 9; `month` = previous Sydney month.
  - `parseEmailList(raw: string, max?: number): { emails: string[]; error: string | null }` (split on `,`/`;`/whitespace, trim, validate with `isValidEmail` from `@/lib/validation`, case-insensitive dedupe, default `max` 10)
  - `clampCalendarMonth(requested: string | undefined, todayYMD: string): string` (range today-12 to today+6 months; invalid -> current month)
  - `alreadyBooked<T extends {date: Date; status: VenueBookingStatusValue}>(rows: readonly T[], todayYMD: string): T[]` (CONFIRMED and `date >= today`)

- [ ] **Step 1: Write failing tests** covering: `sundaysInMonth("2026-09")` equals `["2026-09-06","2026-09-13","2026-09-20","2026-09-27"]`; 5-Sunday month (`"2026-11"` -> 5 entries, first `2026-11-01`); `monthCompleteness` complete when each Sunday has CONFIRMED/CANCELLED and one CONFIRMED; incomplete with a REQUESTED row (`requestedCount: 1`); incomplete with a missing Sunday (listed in `missingSundays`); incomplete with zero CONFIRMED (all CANCELLED); `addMonths("2026-12", 1) === "2027-01"`, `addMonths("2026-01", -1) === "2025-12"`; `invoiceJobTarget`: `new Date("2026-10-31T22:00:00Z")` (09:00 AEDT on 1 Nov) -> `{run:true, month:"2026-10"}`; `new Date("2026-10-31T21:59:00Z")` -> `run:false`; `new Date("2027-01-01T00:30:00Z")` is 11:30 AEDT on 1 Jan -> `{run:true, month:"2026-12"}`; 2 Nov -> `run:false`; `parseEmailList("a@example.com, A@example.com; b@example.com")` -> two emails; invalid entry -> error string; 11 addresses -> error; `clampCalendarMonth` out-of-range and garbage inputs.
- [ ] **Step 2: Run** `npm test -- --testPathPatterns=venueBookings` -> FAIL (module not found).
- [ ] **Step 3: Implement** (all pure, UTC arithmetic only):

```ts
export function sundaysInMonth(month: string): string[] {
  const { start, end } = monthRange(month)
  const out: string[] = []
  const d = new Date(start)
  d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7))
  for (; d <= end; d.setUTCDate(d.getUTCDate() + 7)) out.push(utcDateToYmd(d))
  return out
}
```
`monthCompleteness`: build a `Set` of `utcDateToYmd(r.date)` for rows with status CONFIRMED/CANCELLED; `missingSundays = sundaysInMonth(month).filter(s => !set.has(s))`; `complete = missing.length===0 && requestedCount===0 && confirmedCount>0`. `invoiceJobTarget` uses `sydneyClock(now)` (`ymd`, `hour`) from `@/lib/dates`: `run = ymd.endsWith("-01") && hour >= 9`; `month = previousMonth(ymd)`. `addMonths` via `Date.UTC(y, m-1+n, 1)`.
- [ ] **Step 4: Run** the same command -> all PASS.
- [ ] **Step 5: Commit** `git add src/lib/venueBookings.ts src/lib/__tests__/venueBookings.test.ts && git commit -m "feat(venue): pure booking helpers (sundays, completeness, job gate)"`.

**Passing:** suite green, every function has JSDoc.

---

### Task 3: Settings — booking CCs, calendar token, reset link

**Files:**
- Modify: `src/lib/venueUsage.ts` (add `VENUE_CALENDAR_TOKEN_KEY = "venueUsage.calendarToken"`; add `"venueUsage.bookingCcEmails"` to `VENUE_USAGE_SETTING_KEYS`)
- Modify: `src/lib/venueUsageSettings.ts` (type + reader gain `bookingCcEmails: string`, `calendarToken: string`)
- Create: `src/lib/venueCalendarToken.ts`
- Modify: `src/lib/actions/venueUsage.ts` (`updateVenueUsageSettings`, new `resetVenueCalendarLink`)
- Modify: `src/lib/actions/settings.ts` (generic `validateSettingValue`: `venueUsage.bookingCcEmails` must pass `parseEmailList`)
- Modify: `src/components/settings/VenueUsageSettingsForm.tsx` (new field "Booking request CC emails")
- Test: `src/lib/actions/__tests__/venueUsage.test.ts` (extend), `src/lib/__tests__/venueCalendarToken.test.ts` (new)

**Interfaces:**
- Consumes: `parseEmailList` (Task 2), `isAdmin`, `assertNotDemo`, `logAudit`.
- Produces: `generateCalendarToken(): string` (`randomBytes(24).toString("base64url")`, 32 chars); action `resetVenueCalendarLink(): Promise<ActionResultWithSuccess & { token?: never }>` — returns `{ success }` and the page re-reads the token (never return the token from the action, so it is not in an RPC response log); `VenueUsageSettings.bookingCcEmails`, `.calendarToken`.

- [ ] **Step 1: Failing tests.** In the action test file add: (a) `updateVenueUsageSettings` rejects an invalid booking CC entry ("Enter valid booking CC emails"), accepts `"a@example.com, b@example.com"` and upserts `venueUsage.bookingCcEmails` as the normalised comma+space string; (b) `resetVenueCalendarLink` returns `{error:"Unauthorized"}` for PASTOR, `assertNotDemo` error in demo, and for ADMIN upserts `venueUsage.calendarToken` with a 32-char string different from the previous value and calls `logAudit(..., "VENUE_CALENDAR_LINK_RESET", "AppSetting", undefined, {})` with no token in metadata. `venueCalendarToken.test.ts`: two calls differ, match `/^[A-Za-z0-9_-]{32}$/`.
- [ ] **Step 2: Run** `npm test -- --testPathPatterns="venueUsage|venueCalendarToken"` -> new cases FAIL.
- [ ] **Step 3: Implement.** Settings form posts `bookingCcEmails` (text input, `maxLength={600}`, placeholder `committee@example.com, treasurer@example.com`). `SettingsSchema` gets `bookingCcEmails: z.string().max(600)`; parse with `parseEmailList`, store `emails.join(", ")`. `resetVenueCalendarLink`: demo guard -> `auth()` -> `isAdmin` -> read `readVenueUsageSettings`, enabled required -> upsert new token -> `logAudit` -> `revalidatePath("/venue-usage")`. The reader must not be touched by `ALLOWED_KEYS` for the token (it is not in `VENUE_USAGE_SETTING_KEYS`).
- [ ] **Step 4: Run** the same command -> PASS. Also run `npm test -- --testPathPatterns="settings"` to confirm generic settings tests stay green.
- [ ] **Step 5: Commit** `feat(venue): booking CC emails and calendar token settings`.

**Passing:** the three suites green; `grep -n calendarToken src/lib/actions/settings.ts` returns nothing.

---

### Task 4: Email templates + builders (`venueEmails.ts`)

**Files:**
- Modify: `src/lib/emailTemplates.ts` (keys `venueBookingRequest`, `venueInvoiceRequest`; labels, vars, defaults; `visibleEmailTemplateKeys(enabled, extra?: { venueUsage?: boolean })`)
- Create: `src/lib/venueEmails.ts`
- Modify: `src/lib/venueUsage.ts` (`buildRequestEmail` becomes a thin wrapper over `buildInvoiceRequestEmail` using `DEFAULT_EMAIL_TEMPLATES.venueInvoiceRequest`, keep its signature and all existing tests green)
- Modify: `src/lib/actions/emailTemplates.ts` (`sampleVars` + `renderTemplate` handle the two venue keys, else they fall through to the receipt branch)
- Modify: `src/app/(dashboard)/settings/email/page.tsx` (pass `venueUsage: await isVenueUsageEnabled()`)
- Test: `src/lib/__tests__/venueEmails.test.ts` (new); existing `emailTemplates.test.ts`, `venueUsage.test.ts`, `settings/email/__tests__/page.test.tsx` must stay green.

**Interfaces:**
- Consumes: `formatUsageLine`, `formatHours`, `totalHours`, `formatMonthLabel`, `escapeHtml`, `confirmedOnly` (`venueUsage.ts`); `applyVars`, `EmailTemplateFields` (`emailTemplates.ts`); `alreadyBooked` (Task 2).
- Produces (all pure, return `{ subject: string; text: string; html: string }`):
  - `type VenueEmailBase = { churchName: string; venueName: string; contactName: string; senderName?: string | null; template: EmailTemplateFields }`
  - `buildBookingRequestEmail(i: VenueEmailBase & { month: string; rows: readonly VenueUsageLine[]; booked: readonly VenueUsageLine[] })`
  - `buildInvoiceRequestEmail(i: VenueEmailBase & { month: string; rows: readonly VenueUsageLine[] })`
  - `buildCancellationEmail(i: Omit<VenueEmailBase,"template"> & { rows: readonly VenueUsageLine[] })` (fixed wording, no template)
  - `buildStaffNotice(i: { churchName: string; subject: string; lines: string[]; link: string }): { subject; text; html }`
  - Default templates: booking request subject `Venue booking request ({churchName})`, intro `Dear {contactName},`, body `We would like to book {venueName} on the dates below.`, signoff `Kind regards,\n{senderName}\n{churchName}`; invoice request default text reproduces part-1 wording (subject `Invoice request: {month} venue usage ({churchName})`, intro `Hello,`/`Dear {contactName},` handled by builder: if `contactName` blank, `{contactName}` becomes `team` so "Dear team,"... keep part-1 snapshot tests green by adjusting defaults to match them exactly).

- [ ] **Step 1: Failing tests** (`venueEmails.test.ts`): booking request lists only the given `rows` as `- Sunday, 6 September: 5:00 PM – 8:30 PM (3.5 hours)` and appends an "Already booked" section from `booked` (omitted when empty); the list appears after `body` when no `{dates}` token, and in place when `{dates}` is in `body`; `{totalHours}`, `{month}`, `{senderName}` substituted; a venue name `<b>x</b>` and a purpose containing `<script>` are escaped in `html` but raw in `text`; unknown token `{nope}` left verbatim; invoice request counts CONFIRMED only and shows `Total: 7 hours`; cancellation email lists cancelled dates; staff notice includes the link. Extend `emailTemplates.test.ts` expectations: `visibleEmailTemplateKeys(new Set())` excludes venue keys, `visibleEmailTemplateKeys(new Set(), {venueUsage:true})` includes them; every key in `EMAIL_TEMPLATE_KEYS` has label, vars, default.
- [ ] **Step 2: Run** `npm test -- --testPathPatterns="venueEmails|emailTemplates|venueUsage.test"` -> FAIL.
- [ ] **Step 3: Implement** `venueEmails.ts` with one internal `renderVenueTemplate(template, vars, lists)` that does `applyVars` over each field with `vars` (plain strings), pre-placing list tokens: before `applyVars`, replace `{dates}`/`{bookedDates}` with sentinel strings `\u0000DATES\u0000` etc., run `applyVars`, split HTML on sentinels, and emit `<ul>` there. HTML-escape every field AFTER substitution (`escapeHtml`), convert newlines to `<br>`. Add `venue` keys to `EMAIL_TEMPLATE_KEYS`; the `Record<EmailTemplateKey, …>` maps will fail `tsc` until each has an entry — add all.
- [ ] **Step 4: Run** same command, plus `npm test -- --testPathPatterns="EmailTemplatesSection|email/__tests__"` -> PASS. Run `npx tsc --noEmit` -> exit 0.
- [ ] **Step 5: Commit** `feat(venue): editable booking and invoice email templates`.

**Passing:** all listed suites green; part-1 invoice email tests untouched and green.

---

### Task 5: Approval invalidation helper + wrap row mutations

**Files:**
- Create: `src/lib/venueApproval.ts`
- Modify: `src/lib/actions/venueUsage.ts` (`createVenueUsage`, `updateVenueUsage`, `deleteVenueUsage`)
- Test: `src/lib/__tests__/venueApproval.test.ts` (new), `src/lib/actions/__tests__/venueUsage.test.ts` (extend)

**Interfaces:**
- Consumes: `logAuditTx(tx, userId, action, resourceType, resourceId?, metadata?)` from `@/lib/audit`; `Prisma` tx client type from `@/lib/prisma`.
- Produces: `clearApprovalForMonths(tx: Prisma.TransactionClient, months: readonly string[], userId: number | null): Promise<string[]>` — for each distinct month, `updateMany({ where: { month, approvedAt: { not: null }, sentAt: null }, data: { approvedAt: null, approvedById: null } })`; for each month with `count > 0`, `logAuditTx(tx, userId, "VENUE_APPROVAL_CLEARED", "VenueUsageRequest", undefined, { month })`; returns the months cleared. Also `monthOfDate(d: Date): string` (`"YYYY-MM"` from UTC parts).
- Also produce: `createVenueUsage` etc. return `{ success: string; approvalCleared?: boolean }` — update `ActionResultWithSuccess` consumers only if needed (use a local return type `ActionResultWithSuccess & { approvalCleared?: boolean }` ).

- [ ] **Step 1: Failing tests.** Helper: with a mock tx whose `venueUsageRequest.updateMany` returns `{count:1}` for `"2026-11"` and `{count:0}` for `"2026-10"`, result is `["2026-11"]`, audit written once; duplicate months deduped. Actions: `createVenueUsage` for a date in `2026-11` runs inside `prisma.$transaction` (mock it to invoke the callback with the tx mock) and calls `clearApprovalForMonths` semantics (assert `tx.venueUsageRequest.updateMany` called with `where` including `sentAt: null`); `updateVenueUsage` moving a row from `2026-10-25` to `2026-11-01` clears both months; `deleteVenueUsage` clears the row's month; returned `approvalCleared: true` when cleared.
- [ ] **Step 2: Run** `npm test -- --testPathPatterns="venueApproval|actions/__tests__/venueUsage"` -> FAIL.
- [ ] **Step 3: Implement.** Convert each of the three actions to `prisma.$transaction(async (tx) => { …mutation…; const cleared = await clearApprovalForMonths(tx, [...], userId); … })`; keep the existing `logAudit` for the mutation itself (outside tx is fine, existing pattern). Unsent-only: an already-sent month (`sentAt` set) is never touched.
- [ ] **Step 4: Run** the same command -> PASS (all part-1 action tests still pass; update their prisma mocks to include `$transaction` if they fail with "is not a function").
- [ ] **Step 5: Commit** `feat(venue): clear invoice approval when dates change`.

**Passing:** both suites green.

---

### Task 6: Add all Sundays + bulk status actions

**Files:**
- Modify: `src/lib/actions/venueUsage.ts`
- Test: `src/lib/actions/__tests__/venueUsage.test.ts` (extend)

**Interfaces:**
- Consumes: `sundaysInMonth` (Task 2), `clearApprovalForMonths`, `monthOfDate` (Task 5), `defaultStatusForDate`, `sydneyTodayYMD`.
- Produces:
  - `addAllSundays(input: { month: string; startTime: string; endTime: string; purpose?: string }): Promise<ActionResultWithSuccess & { added?: number; skipped?: number }>` — creates REQUESTED rows (even for past Sundays? No: spec says REQUESTED; use REQUESTED for all) for every Sunday in `month`, skipping dates that already have a non-cancelled row. `createMany` inside a transaction; cap `MAX_ROWS_PER_MONTH` (200).
  - `setVenueUsageStatus(ids: number[], status: "CONFIRMED" | "CANCELLED"): Promise<ActionResultWithSuccess & { approvalCleared?: boolean }>` — `ids` capped `z.array(z.number().int().positive()).min(1).max(100)`; verifies all ids exist (IDOR/existence `findMany`), `updateMany`, clears approval for affected months, audits `VENUE_USAGE_STATUS_CHANGED` with `{ ids, status }`.

- [ ] **Step 1: Failing tests:** role gate (VIEWER -> Unauthorized), feature off -> error, invalid month -> error, bad times -> error; `addAllSundays("2026-09", 17:00–20:00)` calls `createMany` with 4 rows all `status:"REQUESTED"`, `createdById` set, dates `2026-09-06…27` at UTC midnight; with existing non-cancelled row on 13 Sep -> 3 created, `skipped: 1`; an existing CANCELLED row on a date does NOT block it; `setVenueUsageStatus` unknown id -> `{error:"Booking not found"}` with no update; 101 ids -> validation error; success audits once.
- [ ] **Step 2: Run** `npm test -- --testPathPatterns="actions/__tests__/venueUsage"` -> FAIL.
- [ ] **Step 3: Implement** both with JSDoc, role gate -> feature gate -> Zod -> existence check -> transaction -> audit -> `revalidatePath("/venue-usage")`.
- [ ] **Step 4: Run** same -> PASS.
- [ ] **Step 5: Commit** `feat(venue): add all Sundays and bulk status actions`.

**Passing:** suite green.

---

### Task 7: Extract invoice prepare/send into an auth-free lib

**Files:**
- Create: `src/lib/venueInvoice.ts`
- Modify: `src/lib/actions/venueUsage.ts` (`prepareRequest`, `getVenueRequestPreview`, `sendVenueUsageRequest` delegate to the lib; behaviour unchanged)
- Test: `src/lib/__tests__/venueInvoice.test.ts` (new); existing action tests must stay green unchanged.

**Interfaces:**
- Consumes: `buildInvoiceRequestEmail` (Task 4), `getEmailTemplate("venueInvoiceRequest")` (`@/lib/emailTemplateStore`), `readVenueUsageSettings`, `sendVenueUsageRequestEmail`, `encrypt`, `logAudit`, `monthCompleteness` (Task 2).
- Produces (plain server module, no `"use server"`, no `auth()`):
  - `type InvoiceActor = { id: number | null; name: string; email: string | null }`
  - `prepareInvoiceRequest(month: string, actor: InvoiceActor | null): Promise<{ settings; rows; subject; text; html; to; cc: string[]; replyTo: string; last; completeness: ReturnType<typeof monthCompleteness>; approval: { approvedAt: Date | null; autoSent: boolean } | null }>` (rows = CONFIRMED only; completeness computed from ALL non-deleted rows of the month, so query all rows once and filter).
  - `deliverInvoiceRequest(args: { month: string; actor: InvoiceActor | null; resend: boolean; autoSent: boolean }): Promise<{ ok: true; rowCount: number } | { ok: false; code: "disabled" | "no-contact" | "no-rows" | "already-sent" | "send-failed"; message: string }>` — does the guard checks currently inline in `sendVenueUsageRequest`, sends, upserts `VenueUsageRequest` (`sentAt`, `sentTo` encrypted, `status`, `errorMessage`, `sentById: actor?.id ?? null`, `autoSent`), audits `VENUE_USAGE_REQUEST_SENT` / `_FAILED` with `{ month, rows, resend, autoSent }`. Reply-To: `settings.replyToEmail || actor?.email || ""`; CC: dedupe `[ccEmail, replyTo, actor?.email]` excluding `to` (move `dedupeAddresses` here).

- [ ] **Step 1: Failing tests** for `deliverInvoiceRequest`: disabled -> `code:"disabled"` no send; no contact; no confirmed rows; prior SUCCESS without `resend` -> `already-sent`; success upserts with `autoSent:true` when passed, `sentById:null` for `actor:null`; send throws -> `ok:false, code:"send-failed"`, row still upserted with `status:"FAILED"` and truncated `errorMessage`; `actor:null` with blank `replyToEmail` -> `sendVenueUsageRequestEmail` called without `replyTo`; audit metadata contains no email.
- [ ] **Step 2: Run** `npm test -- --testPathPatterns="venueInvoice"` -> FAIL.
- [ ] **Step 3: Implement** by moving code out of the action file (not copying); action keeps role gate + demo guard + `loadActor` and maps `code` to the existing error strings (`"Venue usage is not enabled"`, `"Set the venue contact email in Settings first"`, `"No confirmed bookings in this month"`, the already-sent sentence, `"Could not send the email. Check email settings and try again."`).
- [ ] **Step 4: Run** `npm test -- --testPathPatterns="venueInvoice|actions/__tests__/venueUsage"` -> PASS.
- [ ] **Step 5: Commit** `refactor(venue): shared auth-free invoice send core`.

**Passing:** both suites green with no edits to part-1 assertions.

---

### Task 8: Invoice preview warnings + approve / withdraw actions

**Files:**
- Modify: `src/lib/actions/venueUsage.ts` (`VenueRequestPreview` gains fields; `getVenueRequestPreview` fills them; new `approveVenueInvoice`, `withdrawVenueInvoiceApproval`)
- Test: `src/lib/actions/__tests__/venueUsage.test.ts` (extend)

**Interfaces:**
- Consumes: `prepareInvoiceRequest` (Task 7), `monthCompleteness`, `addMonths`, `sydneyTodayYMD`.
- Produces:
  - `VenueRequestPreview` additions: `warnings: string[]` (e.g. `"1 booking is still Requested"`, `"Sunday 13 September has no booking"`, `"No bookings in this month"`), `complete: boolean`, `approvedAt: string | null`, `autoSent: boolean`, `autoSendDate: string` (human label "1 November, 9:00 AM").
  - `approveVenueInvoice(month: string): Promise<ActionResultWithSuccess>` — `canEdit`, demo guard NOT needed (no send) but feature enabled; month must equal the current Sydney month (`sydneyTodayYMD().slice(0,7)`); refuses unless `complete`; refuses if `sentAt` already SUCCESS; refuses when no contact email; upserts `VenueUsageRequest` `{ approvedAt: now, approvedById }`; `logAudit("VENUE_INVOICE_APPROVED", …, { month })`.
  - `withdrawVenueInvoiceApproval(month: string): Promise<ActionResultWithSuccess>` — only while unsent; clears `approvedAt/By`; audits `VENUE_INVOICE_APPROVAL_WITHDRAWN`.

- [ ] **Step 1: Failing tests:** warnings text for a REQUESTED row / missing Sunday / empty month; approve refuses an incomplete month ("Month is not complete yet"), a non-current month, a sent month, VIEWER role, missing contact; approve success upserts and audits; withdraw on a sent month errors; withdraw success clears.
- [ ] **Step 2: Run** `npm test -- --testPathPatterns="actions/__tests__/venueUsage"` -> FAIL.
- [ ] **Step 3: Implement** (JSDoc each; `revalidatePath("/venue-usage")`).
- [ ] **Step 4: Run** same -> PASS.
- [ ] **Step 5: Commit** `feat(venue): invoice approval and warnings`.

**Passing:** suite green.

---

### Task 9: Booking request + cancellation notice actions

**Files:**
- Modify: `src/lib/actions/venueUsage.ts`
- Test: `src/lib/actions/__tests__/venueUsage.test.ts` (extend)

**Interfaces:**
- Consumes: `buildBookingRequestEmail`, `buildCancellationEmail` (Task 4), `alreadyBooked` (Task 2), `parseEmailList`, `getEmailTemplate`, `sendVenueUsageRequestEmail`, `loadActor`, `dedupeAddresses` (re-export from `venueInvoice.ts` or move to a small shared module `src/lib/venueAddresses.ts`; if moved, update Task 7 imports).
- Produces:
  - `type VenueBookingPreview = { subject: string; text: string; to: string; cc: string; replyTo: string; newRows: { id: number; date: string; startTime: string; endTime: string; askedOn: string | null }[]; booked: { date: string; startTime: string; endTime: string }[]; blockedReason: string | null }`
  - `getVenueBookingPreview(ids?: number[]): Promise<VenueBookingPreview | { error: string }>` — candidates = REQUESTED rows with `bookingRequestedAt = null` (or the ticked subset `ids`, which must all be REQUESTED), future-first; `booked` = CONFIRMED with `date >= today` Sydney.
  - `sendVenueBookingRequest(ids: number[]): Promise<ActionResultWithSuccess>` — demo guard, `canEdit`, `ids` 1–100 all REQUESTED rows, contact email required; sends To contact / CC booking CCs + reply-to; **only on success** `updateMany({ id in ids }, { bookingRequestedAt: now })` + audit `VENUE_BOOKING_REQUEST_SENT` `{ ids, count }`; on failure audit `VENUE_BOOKING_REQUEST_FAILED`, no marking, error returned.
  - `sendVenueCancellationNotice(ids: number[]): Promise<ActionResultWithSuccess>` — same gates; rows must be CANCELLED; To contact, CC booking CCs + reply-to; audit `VENUE_CANCELLATION_SENT`. The UI calls it right after `setVenueUsageStatus(ids, "CANCELLED")` when the user answers "Yes".

- [ ] **Step 1: Failing tests:** preview excludes rows already asked and CONFIRMED-in-past; includes `askedOn` for ticked already-asked rows; send marks `bookingRequestedAt` only on success; failure leaves rows unmarked and returns an error; non-REQUESTED id rejected; cancellation notice rejects a non-CANCELLED id; CC includes booking CCs + reply-to deduped and excludes `to`; demo mode blocks both sends; VIEWER blocked.
- [ ] **Step 2: Run** `npm test -- --testPathPatterns="actions/__tests__/venueUsage"` -> FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** same -> PASS.
- [ ] **Step 5: Commit** `feat(venue): booking request and cancellation emails`.

**Passing:** suite green.

---

### Task 10: Monthly job (lease claim + sweep)

**Files:**
- Create: `src/lib/venueMonthlyJob.ts`
- Test: `src/lib/__tests__/venueMonthlyJob.test.ts` (new)

**Interfaces:**
- Consumes: `invoiceJobTarget`, `monthCompleteness`, `formatMonthLabel`, `deliverInvoiceRequest` (Task 7), `buildStaffNotice` (Task 4), `sendEmail`, `readVenueUsageSettings`, `isP2002` (`@/lib/validation`), `logAudit`, `logger`.
- Produces:
  - `claimVenueMonth(month: string): Promise<boolean>` — copy the `claimCelebrationSend` shape: `create({ data: { month, reminderClaimedAt: now } })`, catch P2002, else `updateMany({ where: { month, reminderSentAt: null, OR: [{ reminderClaimedAt: null }, { reminderClaimedAt: { lt: staleBefore } }] }, data: { reminderClaimedAt: now } })` (`VENUE_LEASE_MS = 10 * 60 * 1000`); `count > 0` = won.
  - `releaseVenueMonth(month: string): Promise<void>` — `updateMany({ where: { month, reminderSentAt: null }, data: { reminderClaimedAt: null } })`.
  - `runVenueInvoiceSweep(now: Date): Promise<{ sent: number; reminded: number; skipped: number; failed: number; inFlight?: number }>` — the counters use names the scheduler recognises (`failed`, `inFlight` -> retry).
  Flow (spec): `invoiceJobTarget(now)`; `!run` -> all zeros; settings disabled or no contact -> `skipped: 1`; `claimVenueMonth` lost -> `inFlight: 1`; existing row `status === "SUCCESS"` (or `reminderSentAt` set) -> release, `skipped: 1`; load `prepareInvoiceRequest(month, null)`; if `approvedAt` set AND `completeness.complete` -> `deliverInvoiceRequest({ month, actor: null, resend: false, autoSent: true })`, on success email staff "Invoice request for <Month Year> sent"; else email staff the reminder (what's missing: requested count, missing Sundays, zero confirmed, not approved) with link `${process.env.AUTH_URL ?? ""}/venue-usage?month=<month>`; staff = `prisma.user.findMany({ where: { role: { in: ["ADMIN","PASTOR","OFFICE_ADMIN"] }, archivedAt: null }, select: { email: true } })` (decrypt not needed; `email` is plain on User per `clearanceDigest.ts`); send one email per recipient with per-recipient try/catch counting `failed`; set `reminderSentAt = now` (and clear `reminderClaimedAt`) **only after** all work completes with `failed === 0`; any failure -> release lease, return `failed > 0`. A failed invoice send (`ok:false`) counts `failed: 1` and releases.

- [ ] **Step 1: Failing tests** (mock prisma, `@/lib/venueInvoice`, `@/lib/email`): not the 1st / before 09:00 Sydney -> no DB write; concurrent double call (`Promise.all` with a `create` mock that resolves once then rejects P2002, and `updateMany` count 0) -> exactly one sends; stale lease (`reminderClaimedAt` 11 min old) reclaimed (`updateMany` called with `lt`); fresh lease not reclaimed; approved + complete -> `deliverInvoiceRequest` called with `autoSent:true`, staff "sent" notice, `reminderSentAt` set after; approved but incomplete (a row edited into REQUESTED) -> reminder not send; not approved -> reminder; already SUCCESS -> release + no email; send failure -> `reminderSentAt` NOT set and `failed:1`; Dec->Jan target month `2026-12`; no staff addresses -> `logger.error` (no PII), returns `skipped: 1`, `failed: 0` (mirrors clearanceDigest), keeps `reminderSentAt` unset and releases the lease.
- [ ] **Step 2: Run** `npm test -- --testPathPatterns="venueMonthlyJob"` -> FAIL.
- [ ] **Step 3: Implement** with JSDoc on all functions; no PII in `logger`.
- [ ] **Step 4: Run** same -> PASS.
- [ ] **Step 5: Commit** `feat(venue): leased monthly invoice job`.

**Passing:** suite green; the concurrency test asserts a single send.

---

### Task 11: Wire job into the in-app scheduler

**Files:**
- Modify: `src/lib/scheduler.ts` (`JobName`, `JOB_NAMES`, `initialState`, `successKey`, `windowOpen`)
- Modify: `src/lib/schedulerRunner.ts` (`DEFAULT_JOBS`)
- Test: `src/lib/__tests__/scheduler.test.ts`, `src/lib/__tests__/schedulerRunner.test.ts` (extend)

**Interfaces:**
- Consumes: `runVenueInvoiceSweep` (Task 10), `sydneyMonthKey`.
- Produces: `JobName` gains `"venueInvoice"`; `successKey("venueInvoice", now) === sydneyMonthKey(now)`; `windowOpen("venueInvoice")` = Sydney day 1 and hour >= 9 (open until end of that day, so a retry after a failed attempt works; 3 attempts per period). The sweep's own gate (`invoiceJobTarget`) is identical, so the two never disagree.
- `DEFAULT_JOBS.venueInvoice = async (now) => (await import("@/lib/venueMonthlyJob")).runVenueInvoiceSweep(now)` (not gated).

- [ ] **Step 1: Failing tests** in `scheduler.test.ts`: at `2026-10-31T21:00:00Z` (08:00 AEDT 1 Nov) `dueJobs` excludes `venueInvoice`; at `2026-10-31T22:05:00Z` includes it; on 2 Nov excludes; after a recorded success for the month it is not due again; attempt cap 3 per Sydney month-day. Runner test: result with `failed:1` leaves the period open (existing behaviour), result with all-zero counts marks success; `initialState()` has the new key.
- [ ] **Step 2: Run** `npm test -- --testPathPatterns="scheduler"` -> FAIL.
- [ ] **Step 3: Implement.** Update the header comment in `scheduler.ts`. Run `grep -rn "clearanceDigest" src --include=*.ts` to find any other exhaustive `JobName` maps (e.g. tests enumerating jobs) and extend them.
- [ ] **Step 4: Run** `npm test -- --testPathPatterns="scheduler"` -> PASS; `npx tsc --noEmit` -> exit 0.
- [ ] **Step 5: Commit** `feat(venue): schedule the monthly invoice job`.

**Passing:** scheduler suites green, tsc clean.

---

### Task 12: Public calendar data + route allowlist

**Files:**
- Create: `src/lib/venueCalendar.ts`
- Modify: `src/lib/csp.ts` (add `PUBLIC_VENUE_CALENDAR = /^\/venue\/[^/]+$/` into `isPublicPath`)
- Test: `src/lib/__tests__/venueCalendar.test.ts` (new); extend the existing csp/middleware public-path test (find with `grep -rln isPublicPath src __tests__`).

**Interfaces:**
- Consumes: `safeEqual` (`@/lib/safeEqual`), `VENUE_CALENDAR_TOKEN_KEY`, `readVenueUsageSettings`, `clampCalendarMonth`, `monthRange`, `utcDateToYmd`.
- Produces:
  - `checkCalendarToken(provided: string, settings: Pick<VenueUsageSettings,"enabled"|"calendarToken">): boolean` — false when disabled, token unset/empty, or mismatch; uses `safeEqual`.
  - `type CalendarEntry = { date: string; startTime: string; endTime: string; purpose: string | null; confirmed: boolean }` (no notes, no ids, no names)
  - `loadCalendar(month: string): Promise<{ venueName: string; month: string; entries: CalendarEntry[] }>` — `prisma.venueUsage.findMany({ where: { date range, status: { in: ["REQUESTED","CONFIRMED"] } }, select: { date, startTime, endTime, status, purpose } })` — **`notes` is never selected**.

- [ ] **Step 1: Failing tests:** valid token true; wrong token false; unset token false for provided `""`; disabled false; `loadCalendar` mock asserts the Prisma `select` has no `notes`/`createdById` key and that CANCELLED is excluded in `where`; `isPublicPath("/venue/abc123")` true, `"/venue"` false, `"/venue/abc/extra"` false, `"/venue-usage"` false.
- [ ] **Step 2: Run** `npm test -- --testPathPatterns="venueCalendar|csp"` -> FAIL.
- [ ] **Step 3: Implement.** Comment next to the regex explaining the token-scoped exposure (like `PUBLIC_FAMILY_UPDATE`).
- [ ] **Step 4: Run** same -> PASS.
- [ ] **Step 5: Commit** `feat(venue): public calendar data layer`.

**Passing:** suites green.

---

### Task 13: Public calendar page `/venue/[token]`

**Files:**
- Create: `src/app/(public)/venue/[token]/page.tsx`, `src/components/venue-usage/VenueCalendar.tsx` (server-safe presentational component)
- Test: `src/app/(public)/venue/[token]/__tests__/page.test.tsx` (new)

**Interfaces:**
- Consumes: `checkCalendarToken`, `loadCalendar` (Task 12), `readVenueUsageSettings`, `clampCalendarMonth`, `rateLimit` (`@/lib/rateLimit`), `getClientIp` is request-based — use `headers()` from `next/headers` and a local helper reading the rightmost `x-forwarded-for` (copy the logic, or reuse `getClientIpFromHeaders` if `clientIp.ts` exports one — check line ~21).
- Produces: default-export async Server Component with `props: { params: Promise<{ token: string }>; searchParams: Promise<{ month?: string }> }`; `export const metadata = { robots: { index: false, follow: false } }`.

- [ ] **Step 1: Failing tests** (RTL `render`, mock `next/navigation` `notFound` to throw `NEXT_NOT_FOUND`, mock `@/lib/venueUsageSettings`, `@/lib/venueCalendar`, `@/lib/rateLimit`, `next/headers`): valid token renders venue name, "Confirmed" and "Pending" labels, purpose text; invalid token -> `NEXT_NOT_FOUND`; disabled -> not found; reset token (settings token differs) -> not found; rate-limited (`rateLimit` false) -> not found; output never contains `notes` text (give the mock row a `notes: "SECRET"` field and assert absent); `metadata.robots.index === false`; prev/next links `?month=` clamped (no "next" beyond +6 months).
- [ ] **Step 2: Run** `npm test -- --testPathPatterns="venue.*token"` -> FAIL.
- [ ] **Step 3: Implement.** Order: rate-limit (`rateLimit("venue-cal:"+ip, 60, 60_000)`) -> settings -> `checkCalendarToken` -> `loadCalendar`. Month grid (7-column, Sunday-first, confirmed green / pending amber via existing Tailwind tokens, text label not colour-only for accessibility) + list below (date, time via `formatTime12`, purpose, status). Mobile-first; grid cells compact at 375px. Shows venue name only. No `auth()` call.
- [ ] **Step 4: Run** same -> PASS. Manual (note result in commit body): view at 375px and >=1920px.
- [ ] **Step 5: Commit** `feat(venue): public read-only calendar page`.

**Passing:** page suite green; the SECRET assertion passes.

---

### Task 14: Admin UI — nav label, bookings table, add-all, bulk, cancel prompt

**Files:**
- Modify: `src/components/layout/sidebar/navData.ts` (label "Venue bookings"), `src/app/(dashboard)/venue-usage/page.tsx` (heading + description + pass new props), `src/components/venue-usage/VenueUsageClient.tsx` (or split new pieces into `VenueBookingsTable.tsx`, `AddSundaysForm.tsx` in the same folder to keep files focused)
- Modify: any test asserting the old label (`grep -rn "Venue Usage" src __tests__`), plus the settings form copy ("Adds a Venue bookings page…")
- Test: `src/components/venue-usage/__tests__/VenueBookingsTable.test.tsx` (new)

**Interfaces:**
- Consumes: actions `addAllSundays`, `setVenueUsageStatus`, `sendVenueCancellationNotice` (Tasks 6, 9), existing `createVenueUsage/updateVenueUsage/deleteVenueUsage`; `formatHours`, `durationHours`, `defaultStatusForDate`, `nextSundayYMD`.
- Produces: table rows (cards under `md`) with status badge, date, time, hours, purpose, edit/cancel; confirmed-hours total; checkbox per row + "Mark confirmed" / "Cancel" bulk buttons; "Add all Sundays in <month>" with time inputs (defaults `17:00`–`20:00`); single-add prefill next Sunday 17:00–20:00; on Cancel a `window.confirm`-free inline dialog (use the project's existing dialog component; `grep -rln "AlertDialog\|ConfirmDialog" src/components`) asking "Email venue about this cancellation?" with Yes/No -> on Yes call `sendVenueCancellationNotice(ids)` after `setVenueUsageStatus`; when a result carries `approvalCleared`, show "Approval cleared — dates changed, please re-approve". Scope desktop-only tweaks to `xl:`/`2xl:`.

- [ ] **Step 1: Failing test** (RTL, mock the actions): renders hours total of CONFIRMED rows only; selecting two rows and clicking "Cancel" opens the dialog; "Yes" calls `setVenueUsageStatus` then `sendVenueCancellationNotice` with the same ids; "No" calls only `setVenueUsageStatus`; "Add all Sundays" calls `addAllSundays` with the month + times; approval-cleared banner appears when an action returns `approvalCleared: true`.
- [ ] **Step 2: Run** `npm test -- --testPathPatterns="VenueBookingsTable"` -> FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** same, then `npm test -- --testPathPatterns="navData|Sidebar|settings"` -> PASS.
- [ ] **Step 5: Commit** `feat(venue): bookings table with bulk actions`.

**Passing:** suites green. Manual: 375px card layout and >=1920px table layout checked.

---

### Task 15: Admin UI — booking request panel

**Files:**
- Create: `src/components/venue-usage/BookingRequestPanel.tsx`
- Modify: `src/components/venue-usage/VenueUsageClient.tsx` (render the panel), page props if needed
- Test: `src/components/venue-usage/__tests__/BookingRequestPanel.test.tsx` (new)

**Interfaces:**
- Consumes: `getVenueBookingPreview`, `sendVenueBookingRequest`, type `VenueBookingPreview` (Task 9).
- Produces: panel "Send booking request": REQUESTED rows with `bookingRequestedAt = null` ticked by default; already-asked rows listed unticked with "asked on <date>"; preview of email text with an "Already booked" list; To / CC / "Replies go to" lines; Send disabled with `blockedReason` or when nothing ticked; success/error `FormFeedback`.

- [ ] **Step 1: Failing test:** loads preview on mount; ticked defaults; untick removes id from `sendVenueBookingRequest` call; asked-on label; blocked reason disables Send; error message shown on `{error}`.
- [ ] **Step 2: Run** `npm test -- --testPathPatterns="BookingRequestPanel"` -> FAIL.
- [ ] **Step 3: Implement** (JSDoc; mobile-first).
- [ ] **Step 4: Run** same -> PASS.
- [ ] **Step 5: Commit** `feat(venue): booking request panel`.

**Passing:** suite green.

---

### Task 16: Admin UI — invoice approval panel + calendar link box

**Files:**
- Create: `src/components/venue-usage/CalendarLinkBox.tsx`
- Modify: `src/components/venue-usage/VenueUsageClient.tsx` (invoice panel: warnings, approve/withdraw), `src/app/(dashboard)/venue-usage/page.tsx` (pass `isAdmin`, `calendarUrl`)
- Test: `src/components/venue-usage/__tests__/InvoicePanel.test.tsx`, `CalendarLinkBox.test.tsx` (new)

**Interfaces:**
- Consumes: `VenueRequestPreview` new fields (Task 8), `approveVenueInvoice`, `withdrawVenueInvoiceApproval`, `resetVenueCalendarLink` (Task 3).
- Produces: invoice panel (default previous month) listing `warnings`; for the **current** month a button "Approve automatic send on 1 <next month>, 9:00 AM" enabled only when `complete`, confirm dialog showing the email preview, "Withdraw approval" while unsent, "Approved by … on …" line; Send / Resend stays explicit. Calendar link box: shows `${origin}/venue/${token}` (page builds it from `AUTH_URL` or request headers; when token unset show "Calendar link is off" + ADMIN-only "Create link"), Copy button, ADMIN-only "Reset link" with confirm ("The old link will stop working").

- [ ] **Step 1: Failing tests:** approve button disabled when `complete:false`; enabled and calls `approveVenueInvoice(month)` after confirming; withdraw visible only when `approvedAt` set; non-ADMIN sees no reset button; reset calls `resetVenueCalendarLink` after confirm; copy button writes the URL to `navigator.clipboard`.
- [ ] **Step 2: Run** `npm test -- --testPathPatterns="InvoicePanel|CalendarLinkBox"` -> FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** same -> PASS; `npm test -- --testPathPatterns="venue-usage"` -> PASS (page tests, if any).
- [ ] **Step 5: Commit** `feat(venue): invoice approval panel and calendar link`.

**Passing:** suites green. Manual: 375px and >=1920px.

---

### Task 17: Website docs + README

**Files:**
- Create: `website/src/content/docs/docs/venue-bookings.md` (front-matter `title`, `description` like `invoices.md`)
- Modify: `website/src/content/docs/docs/scheduled-jobs.md` (add the in-app monthly venue invoice job: 1st at 09:00 Sydney, only when approved and complete, otherwise a reminder to editors; not an external cron route), `website/src/content/docs/docs/email-notifications.md` (two new templates + vars), `website/src/content/docs/docs/roles-and-permissions.md` (who may do what), sidebar/index list if docs index enumerates pages (check `website/astro.config.*` and `docs/index.md`), `README.md` (feature list: venue bookings + monthly invoice request + public calendar; fix any stale claim)
- Test: none (docs). Check command: `grep -rn "venue-bookings" website README.md` finds the page, and `cd website && npm run build` if the site builds offline (skip and say "untested" if deps are not installed).

- [ ] **Step 1: Write the docs page** covering: enabling in Settings (venue name, contact, CCs, reply-to); statuses; adding single dates and all Sundays; bulk confirm/cancel; cancellation notice; booking request (what is sent, "already booked" list, `asked on`); invoice request (confirmed only, resend); approval rules (complete month definition, approval cleared on any change, withdraw); automatic send behaviour and reminder; public calendar (secret link, what is shown, reset, noindex); template variables table; limits (one venue, no `.ics`). Use only synthetic names (`Example Hall`, `Pat Example`, `venue@example.com`).
- [ ] **Step 2: Update the other docs and README** as listed.
- [ ] **Step 3: Verify** links and front-matter with the grep above; no real emails: `grep -rnE "@(gmail|outlook|yahoo|hotmail)\." website/src/content/docs/docs/venue-bookings.md` returns nothing.
- [ ] **Step 4: Commit** `docs(venue): website docs and README for venue bookings`.

**Passing:** grep checks as above.

---

### Task 18: Final verification

**Files:** none changed unless a check fails (fix in the owning task's files and re-run).

- [ ] **Step 1: Type check:** `npx tsc --noEmit` -> exit 0, no output.
- [ ] **Step 2: Lint:** `npm run lint` -> exit 0 (0 errors).
- [ ] **Step 3: Touched suites** (basename patterns because tests live in two trees):
  `npm test -- --testPathPatterns="venueBookings|venueEmails|venueInvoice|venueApproval|venueMonthlyJob|venueCalendar|venueCalendarToken|venueUsage|emailTemplates|scheduler|schedulerRunner|VenueBookingsTable|BookingRequestPanel|InvoicePanel|CalendarLinkBox|featureGuards|resendTransport|csp|settings|navData"`
  -> all suites PASS, 0 failed.
- [ ] **Step 4: Coverage floor:** `npm test -- --coverage` -> exit 0 (floor in `jest.config.ts` not breached by the new files).
- [ ] **Step 5: Hygiene:** `git status -s` shows no `src/lib/generated`; `git diff main --stat -- src/lib/generated` empty; `grep -rniE "TODO|FIXME" $(git diff --name-only main | grep -E '\.(ts|tsx|md)$')` shows nothing new; `npx prisma validate` ok.
- [ ] **Step 6: Manual checks to report** (cannot be automated): admin page and public calendar at 375px and >=1920px; one real send in a non-demo dev env with `DISABLE_OTP=true` using a throwaway inbox is NOT done on prod. Mark as "untested" if skipped.
- [ ] **Step 7: PR gate note:** this PR is the "risky" class (migration + public route + concurrency) — open it, add to the All Projects board, wait for a real CodeRabbit review of head, post the disposition table, then merge decision per `CLAUDE.md`.

**Passing:** every command above exits 0 with the stated result; quote the outputs in the PR description.
