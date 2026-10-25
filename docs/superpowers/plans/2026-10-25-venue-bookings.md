# Venue Bookings (parts 2 + 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the part 1 venue usage log (commit `cb921d8`) into full venue bookings: booking-request and cancellation emails, an admin approval that lets the in-app scheduler send the monthly invoice request on the 1st at 09:00 Sydney, editable email templates, and a secret no-login committee calendar at `/venue/[token]`.

**Architecture:** Pure helpers in `src/lib/venueUsage.ts` (Sundays, completeness, email rendering) and `src/lib/venueSchedule.ts` (Sydney gate) stay client-safe. Server-only logic lives in plain modules (`venueInvoice.ts` shared by the manual action and the job, `venueApproval.ts` for approval invalidation, `venueInvoiceJob.ts` for the scheduler job) so `"use server"` action files only export async actions. The job registers as a new `venueInvoice` period job in `scheduler.ts`, claimed per month with a lease on `VenueUsageRequest.reminderClaimedAt`. The public calendar is a server-rendered route in the `(public)` group, gated by a CSPRNG token in `AppSetting`, rate-limited per IP.

**Tech Stack:** Next.js 16 App Router (Server Components + Server Actions), React 19, TypeScript, Prisma 7 + PostgreSQL, Zod 4, Tailwind + shadcn, Jest 30 + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-25-venue-bookings-design.md` (approved; part 1 shipped in `cb921d8`).

## Global Constraints

- Public repo (AGPL): no real names, emails, church details or credentials anywhere (code, tests, docs, fixtures). Use `venue@example.com`, `Pat Example`, `Example Hall`, `Example Church`.
- JSDoc (`/** ... */`) on every new or changed named function, exported or not (`docs/conventions.md`). Jest `it(...)` callbacks are exempt.
- Prisma: `select` over `include`, always. Never `findMany` without `take` on a user-driven list.
- Dates: `@db.Date` columns hold **UTC-midnight** calendar dates; read/format them in UTC (`getUTC*`, `utcDateToYmd`). "Today" and the 09:00 gate use the **Sydney wall clock** from `src/lib/dates.ts` (`sydneyTodayYMD`, `sydneyClock`, `sydneyMonthKey`), never the server clock (the server runs UTC). Hours are decimal numbers rounded to 2 dp; there is no money in this feature (no `parseFloat` on amounts to worry about).
- Role gates at the page AND the action: `canEdit` for everything on the admin page; `isAdmin` for settings and the calendar-link reset. A new action file must be classified in `CORE_ACTIONS` in `src/lib/__tests__/featureGuards.test.ts` (the feature is gated by `venueUsage.enabled`, not a `FEATURES` flag). Sends are blocked in demo mode (`assertNotDemo`).
- `logAudit` (or `logAuditTx` inside a transaction) on every mutation, approval, approval-clear, send and link reset. Audit metadata holds ids, counts and month keys only: never email addresses, notes or the calendar token.
- HTML-escape every interpolated value in email HTML (`escapeHtml` from `src/lib/venueUsage.ts`); email subjects collapse whitespace so a value cannot inject a header line.
- Never commit `src/lib/generated/`, `.claude/`, `CLAUDE.md`, `AGENTS.md`. Run `git status -s` before every commit and stage files by explicit path (no `git add -A`). Branch stays `feat/venue-usage`.
- Commit messages are Conventional Commits and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Check commands (per task, touched suites by basename): `npm test -- --testPathPatterns="<basename>"`, `npx tsc --noEmit`, `npm run lint`, `npx prisma validate`. Tests exist under both `src/**/__tests__/` and root `__tests__/`: use basename patterns. No local `npm run build` (CI builds).
- Many users are on phones: UI tasks verify 375px and >=1920px by hand (screenshot) in addition to tests.
- Feature PR: update the website docs page and any stale README claim in the same PR (Task 14). The PR is "risky" (migration + public route): it waits for a real CodeRabbit review of head before merge.

## Scheduler cadence (read before Tasks 7 and 8)

`schedulerRunner.ts`: one timer per process, `TICK_MS = 5 min` (first tick 60 s after boot). `scheduler.ts`: interval jobs run every 30 min (`EVERY_MS`); **period jobs** (celebrations, errorDigest, clearanceDigest) are due when their Sydney window is open, `lastSuccessKey !== successKey(now)`, at least 30 min since the last start, and fewer than 3 attempts in the attempt period (in-memory only; resets on restart). So the spec's "runs daily, acts only on the 1st at >= 09:00 Sydney" is realised as: a monthly period job (success key = Sydney month) whose window is `Sydney date is the 1st AND hour >= 9`. The first tick after 09:00 (so 09:00 to 09:05) picks it up; a failed run retries every 30 min, at most 3 times, all on the 1st. If the app is down for the whole of the 1st the job never runs and nothing is sent or reminded (see the "Spec gaps" section; the manual send always works). The job's own DB claim (`reminderSentAt`) is what prevents a repeat after a restart.

## Spec gaps found and how this plan resolves them

1. **`sentAt` is stamped on FAILED sends** (part 1 `sendVenueUsageRequest` writes `sentAt` for failures). So "sent" everywhere in this plan means `status === "SUCCESS"`, never `sentAt != null`. "Approved, unsent" = `approvedAt != null AND (status IS NULL OR status != 'SUCCESS')` (Task 5 `UNSENT_FILTER`; note SQL `!=` skips NULLs so the OR is required).
2. **A failed manual resend overwrites a prior SUCCESS** (part 1 upsert). That would let the job auto-send a duplicate. Task 4 changes `deliverInvoiceRequest` so a FAILED attempt after a SUCCESS only records `errorMessage` and leaves `status`/`sentAt` alone.
3. **Window strictness:** spec says only on the 1st. Implemented as specified (`VENUE_JOB_LAST_DAY = 1` in `venueSchedule.ts`). Raising that one constant (e.g. 7, like the clearance digest) would add outage catch-up; flagged for the PO, not done unilaterally.
4. **Calendar token and the settings allowlist:** spec says "calendarToken allowlist". Adding it to `ALLOWED_KEYS` would let the generic `upsertSetting` write a weak, admin-typed value. The token is therefore **not** in `VENUE_USAGE_SETTING_KEYS`; it has its own constant and is only written by the dedicated `resetVenueCalendarLink` action (CSPRNG). `bookingCcEmails` **is** allowlisted (validated list).
5. **Email template keys visibility:** `visibleEmailTemplateKeys` is feature-flag driven; venue is an AppSetting. Task 3 adds an optional second argument so venue templates show only while `venueUsage.enabled`, and guards the template actions the same way.
6. **Spec says the add-all button yields REQUESTED always** (even past Sundays in the month). Implemented as specified.
7. **No cron route** for the venue job (spec lists none; the manual "Send" button is the manual trigger).
8. **Calendar link visibility:** spec says "(ADMIN)" on the box. Interpreted as: any `canEdit` user can see and copy the link; only ADMIN can create/reset it.
9. **Notice failures:** the job treats "every recipient failed" as a failed run (retried), but a partial failure is logged and not retried, to avoid re-emailing recipients who already got the notice.

## File Structure

**New**
- `prisma/migrations/20261026000000_venue_bookings/migration.sql`
- `src/lib/venueSchedule.ts`: Sydney 1st-at-09:00 gate, invoice month, auto-send label.
- `src/lib/venueInvoice.ts`: shared prepare/deliver of the invoice request, recipients, actor lookup.
- `src/lib/venueApproval.ts`: `UNSENT_FILTER`, `clearApprovalTx`.
- `src/lib/venueNotices.ts`: staff reminder and "sent" notice builders.
- `src/lib/venueInvoiceJob.ts`: the monthly job.
- `src/lib/venueCalendar.ts`: pure month grid + month clamp + token constant.
- `src/lib/venueCalendarToken.ts`: token mint/compare/read/url (server).
- `src/lib/actions/venueBookings.ts`: booking request + approval actions.
- `src/lib/actions/venueCalendar.ts`: `resetVenueCalendarLink`.
- `src/components/venue-usage/{BookingList,BookingRequestPanel,InvoiceRequestPanel,CalendarLinkBox}.tsx`
- `src/components/venue-usage/VenueCalendarView.tsx` (server component, no client JS)
- `src/app/(public)/venue/[token]/page.tsx`
- `website/src/content/docs/docs/venue-bookings.md`
- Tests beside each (`__tests__/`).

**Modified**
- `prisma/schema.prisma`, `src/lib/venueUsage.ts`, `src/lib/venueUsageSettings.ts`, `src/lib/actions/venueUsage.ts`, `src/lib/actions/settings.ts`, `src/lib/emailTemplates.ts`, `src/lib/actions/emailTemplates.ts`, `src/app/(dashboard)/settings/email/page.tsx`, `src/lib/email.ts` (JSDoc only), `src/lib/scheduler.ts`, `src/lib/schedulerRunner.ts`, `src/lib/csp.ts`, `src/lib/clientIp.ts`, `src/app/(dashboard)/venue-usage/page.tsx`, `src/components/venue-usage/VenueUsageClient.tsx`, `src/components/settings/VenueUsageSettingsForm.tsx`, `src/components/layout/sidebar/navData.ts`, `src/lib/__tests__/featureGuards.test.ts`, website docs (`scheduled-jobs.md`, `roles-and-permissions.md`, `email-notifications.md`, `src/sidebar.mjs`), `README.md`.

## Task Order and Dependencies

1 migration + settings -> 2 pure lib -> 3 templates + builders -> 4 invoice module -> 5 row-mutation actions -> 6 booking-request + approval actions -> 7 notices + job -> 8 scheduler registration -> 9 admin list/bulk/add-all/cancel UI + rename -> 10 admin panels UI -> 11 calendar lib + token -> 12 public route -> 13 admin link box -> 14 docs. Each task leaves `tsc`, lint and its suites green; any single task can be reviewed (and rejected) alone.

---

## Task 1: Schema migration and settings keys (size M)

New columns, a NEW migration directory (part 1's migration is untouched), the `bookingCcEmails` setting (allowlisted + validated), and the settings form field.

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261026000000_venue_bookings/migration.sql`
- Modify: `src/lib/venueUsage.ts` (key list, `parseCcList`), `src/lib/venueUsageSettings.ts`, `src/lib/actions/venueUsage.ts` (`updateVenueUsageSettings`), `src/lib/actions/settings.ts` (generic validation), `src/components/settings/VenueUsageSettingsForm.tsx`
- Test: `src/lib/__tests__/venueUsage.test.ts`, `src/lib/actions/__tests__/venueUsage.test.ts`, `src/lib/actions/__tests__/settings.test.ts`

**Interfaces**
- Consumes: `isValidEmail(email: string): boolean` (`src/lib/validation.ts`).
- Produces:
  - `VENUE_USAGE_SETTING_KEYS` gains `"venueUsage.bookingCcEmails"`.
  - `MAX_BOOKING_CC = 10`
  - `parseCcList(value: string): { ok: true; list: string[] } | { ok: false; error: string }` (splits on `,` `;` newline, trims, drops blanks, case-insensitive de-dupe, validates each, max 10)
  - `VenueUsageSettings.bookingCcEmails: string` (comma-joined, may be `""`)
  - Prisma: `VenueUsage.bookingRequestedAt DateTime?`; `VenueUsageRequest.approvedAt DateTime?`, `approvedById Int?` + relation `approvedBy User?` (`SetNull`), `autoSent Boolean @default(false)`.

- [ ] **Step 1: Write failing tests for `parseCcList`** in `src/lib/__tests__/venueUsage.test.ts` (add `parseCcList, MAX_BOOKING_CC` to the existing import):

```ts
describe("parseCcList", () => {
  it("splits on comma, semicolon and newline, trims and de-duplicates case-insensitively", () => {
    expect(parseCcList("a@example.com; B@example.com,\n a@EXAMPLE.com , ")).toEqual({
      ok: true,
      list: ["a@example.com", "B@example.com"],
    })
  })
  it("accepts an empty value", () => {
    expect(parseCcList("  ")).toEqual({ ok: true, list: [] })
  })
  it("rejects an invalid address and names it", () => {
    expect(parseCcList("a@example.com, nope")).toEqual({ ok: false, error: '"nope" is not a valid email address' })
  })
  it("rejects more than the maximum", () => {
    const many = Array.from({ length: MAX_BOOKING_CC + 1 }, (_, i) => `u${i}@example.com`).join(",")
    expect(parseCcList(many)).toEqual({ ok: false, error: `Add at most ${MAX_BOOKING_CC} booking CC addresses` })
  })
})
```

- [ ] **Step 2: Run, expect FAIL** (`parseCcList` not exported): `npm test -- --testPathPatterns="venueUsage.test"`.

- [ ] **Step 3: Implement** in `src/lib/venueUsage.ts`. Add `"venueUsage.bookingCcEmails",` as the last entry of `VENUE_USAGE_SETTING_KEYS`, add `import { isValidEmail } from "@/lib/validation"` at the top, and append:

```ts
/** Most extra booking-request / cancellation CC addresses an admin may configure. */
export const MAX_BOOKING_CC = 10

/**
 * Parse and validate a comma/semicolon/newline separated CC list (blank entries ignored,
 * duplicates dropped case-insensitively, original casing of the first occurrence kept).
 * @param value raw text from the settings form
 * @returns the clean list, or the first validation error
 */
export function parseCcList(value: string): { ok: true; list: string[] } | { ok: false; error: string } {
  const seen = new Set<string>()
  const list: string[] = []
  for (const raw of value.split(/[,;\n]/)) {
    const address = raw.trim()
    if (!address) continue
    if (!isValidEmail(address)) return { ok: false, error: `"${address}" is not a valid email address` }
    const key = address.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    list.push(address)
  }
  if (list.length > MAX_BOOKING_CC) return { ok: false, error: `Add at most ${MAX_BOOKING_CC} booking CC addresses` }
  return { ok: true, list }
}
```

- [ ] **Step 4: Schema + migration.** In `prisma/schema.prisma`:
  - In `model User`, under `venueUsageRequestsSent`, add `venueUsageRequestsApproved   VenueUsageRequest[]      @relation("VenueUsageRequestApprovedBy")`.
  - In `model VenueUsage`, after `notes String?` add `bookingRequestedAt DateTime?` (comment: set when the date was included in a sent booking request).
  - In `model VenueUsageRequest`, after `reminderClaimedAt` add:

```prisma
  approvedAt        DateTime?
  approvedById      Int?
  approvedBy        User?     @relation("VenueUsageRequestApprovedBy", fields: [approvedById], references: [id], onDelete: SetNull)
  autoSent          Boolean   @default(false)
```
  and add `@@index([approvedById])` next to the existing index.
  Create `prisma/migrations/20261026000000_venue_bookings/migration.sql`:

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

- [ ] **Step 5: Verify the migration matches the schema (no DB needed).** Diff the pre-change datamodel against the new one and compare the SQL by eye:

```bash
S=/tmp/claude-1000/-home-ggeorge-workspace-Projects-parishcrm/0aed3ceb-961a-4acf-8cb7-1aa61b2bf7ae/scratchpad
git show HEAD:prisma/schema.prisma > "$S/old.prisma"
npx prisma validate && npx prisma generate
npx prisma migrate diff --from-schema-datamodel "$S/old.prisma" --to-schema-datamodel prisma/schema.prisma --script
```
Expected: `validate` passes; the diff script contains exactly the `ADD COLUMN` x4, the index and the FK in the migration above (column order may differ). Do not run `migrate dev` (it can reset a DB).

- [ ] **Step 6: Settings reader.** In `src/lib/venueUsageSettings.ts` add `bookingCcEmails: string` to `VenueUsageSettings` and `bookingCcEmails: get("venueUsage.bookingCcEmails"),` to the return of `readVenueUsageSettings`.

- [ ] **Step 7: Failing tests for the action and generic setting validation.**
  In `src/lib/actions/__tests__/venueUsage.test.ts`: add `bookingCcEmails: ""` to the `settings` fixture; add a test (use the file's existing `updateVenueUsageSettings` FormData helper style; if none, build `new FormData()`):

```ts
it("saves bookingCcEmails normalised and rejects a bad address", async () => {
  asRole("ADMIN")
  const fd = new FormData()
  fd.set("enabled", "on"); fd.set("venueName", "Example Hall"); fd.set("contactName", "Pat Example")
  fd.set("contactEmail", "venue@example.com"); fd.set("ccEmail", ""); fd.set("replyToEmail", "")
  fd.set("bookingCcEmails", "a@example.com; A@example.com, b@example.com")
  expect(await updateVenueUsageSettings(undefined, fd)).toEqual({ success: "Venue usage settings saved" })
  const calls = (prisma.appSetting.upsert as jest.Mock).mock.calls.map((c) => c[0])
  expect(calls).toContainEqual(expect.objectContaining({
    where: { key: "venueUsage.bookingCcEmails" },
    update: { value: "a@example.com, b@example.com" },
  }))
  fd.set("bookingCcEmails", "a@example.com, nope")
  expect(await updateVenueUsageSettings(undefined, fd)).toEqual({ error: '"nope" is not a valid email address' })
})
```
  In `src/lib/actions/__tests__/settings.test.ts` (uses `fd(key, value)` + `upsertSetting`; copy the admin `mockAuth` setup used by neighbouring tests):

```ts
it("validates venueUsage.bookingCcEmails as a list and allows it past 254 chars", async () => {
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  const ok = Array.from({ length: 8 }, (_, i) => `person${i}.with.a.long.name@example.com`).join(", ")
  expect(ok.length).toBeGreaterThan(254)
  expect(await upsertSetting(undefined, fd("venueUsage.bookingCcEmails", ok))).toEqual({ success: expect.any(String) })
  expect(await upsertSetting(undefined, fd("venueUsage.bookingCcEmails", "a@example.com, nope")))
    .toEqual({ error: '"nope" is not a valid email address' })
})
it("does not allow the calendar token through the generic setting action", async () => {
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  const r = await upsertSetting(undefined, fd("venueUsage.calendarToken", "weak"))
  expect(r).toEqual({ error: expect.any(String) })
  expect(mockUpsert).not.toHaveBeenCalled()
})
```
  (Check the exact success shape returned by `upsertSetting` in the file and match it; the second test relies on the key not being in `ALLOWED_KEYS`, which this plan deliberately preserves.)

- [ ] **Step 8: Implement.** `src/lib/actions/venueUsage.ts`: import `parseCcList`; in `SettingsSchema` add

```ts
  bookingCcEmails: z
    .string()
    .max(1000, "Booking CC list is too long")
    .superRefine((v, ctx) => {
      const r = parseCcList(v)
      if (!r.ok) ctx.addIssue({ code: "custom", message: r.error })
    })
    .default(""),
```
  and in `entries` add `{ key: "venueUsage.bookingCcEmails", value: (parseCcList(v.bookingCcEmails) as { ok: true; list: string[] }).list.join(", ") },` (the schema already proved `ok`). Update the JSDoc of `updateVenueUsageSettings` to mention the booking CC list.
  `src/lib/actions/settings.ts`: import `parseCcList` from `@/lib/venueUsage`; replace the line `if (key.startsWith("venueUsage.") && value.length > 254) return { error: "Value is too long" }` with:

```ts
  if (key === "venueUsage.bookingCcEmails") {
    if (value.length > 1000) return { error: "Value is too long" }
    const list = parseCcList(value)
    if (!list.ok) return { error: list.error }
    return { value: list.list.join(", ") }
  }
  if (key.startsWith("venueUsage.") && value.length > 254) return { error: "Value is too long" }
```
  (confirm the function's success return shape `{ value }` by reading the end of `validateSettingValue`; keep that shape, and do not add the new key to `EMAIL_KEYS`.)
  `VenueUsageSettingsForm.tsx`: add after the CC row:

```tsx
        <SettingsRow
          label="Booking request CCs (optional)"
          htmlFor="venue-booking-cc"
          description="Extra addresses copied on booking requests and cancellation notices. Separate with commas. The reply-to address is always copied."
        >
          {(descId) => (
            <Input id="venue-booking-cc" aria-describedby={descId} name="bookingCcEmails" defaultValue={keep("bookingCcEmails", settings.bookingCcEmails)} placeholder="secretary@example.com, treasurer@example.com" className="md:w-80" maxLength={1000} />
          )}
        </SettingsRow>
```

- [ ] **Step 9: Run** `npm test -- --testPathPatterns="venueUsage|settings"` (PASS), `npx tsc --noEmit`, `npm run lint`, `npx prisma validate`.

- [ ] **Step 10: Commit**

```bash
git status -s   # only the files above; src/lib/generated stays untracked/ignored
git add prisma/schema.prisma prisma/migrations/20261026000000_venue_bookings src/lib/venueUsage.ts src/lib/venueUsageSettings.ts src/lib/actions/venueUsage.ts src/lib/actions/settings.ts src/components/settings/VenueUsageSettingsForm.tsx src/lib/__tests__/venueUsage.test.ts src/lib/actions/__tests__/venueUsage.test.ts src/lib/actions/__tests__/settings.test.ts
git commit -m "feat(venue): booking-request columns, approval fields and booking CC setting" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 2: Sunday enumeration, month completeness, Sydney gate (size M)

Pure helpers only. No DB, no email.

**Files:**
- Modify: `src/lib/venueUsage.ts`
- Create: `src/lib/venueSchedule.ts`
- Test: `src/lib/__tests__/venueUsage.test.ts`, `src/lib/__tests__/venueSchedule.test.ts`

**Interfaces**
- Consumes: `monthRange`, `utcDateToYmd`, `ymdToUtcDate`, `formatUsageDate`, `formatMonthLabel`, `previousMonth` (`venueUsage.ts`); `sydneyClock(at: Date): { ymd: string; hour: number; weekday: number }` (`dates.ts`).
- Produces (`venueUsage.ts`):
  - `sundaysInMonth(month: string): string[]` ("YYYY-MM-DD", ascending)
  - `addMonths(month: string, delta: number): string`
  - `type CompletenessRow = { date: Date; status: VenueBookingStatusValue }`
  - `type MonthCompleteness = { complete: boolean; missingSundays: string[]; requestedCount: number; confirmedCount: number }`
  - `monthCompleteness(month: string, rows: readonly CompletenessRow[]): MonthCompleteness`
  - `describeIncomplete(c: MonthCompleteness): string[]` (human reasons, `[]` when complete)
- Produces (`venueSchedule.ts`):
  - `VENUE_JOB_FROM_HOUR = 9`, `VENUE_JOB_LAST_DAY = 1`
  - `venueJobWindowOpen(now: Date): boolean`
  - `venueInvoiceMonth(now: Date): string` (the month before the Sydney month of `now`)
  - `autoSendLabel(month: string): string` (e.g. `"1 November, 9:00 AM"` for `"2026-10"`)

- [ ] **Step 1: Failing tests** in `src/lib/__tests__/venueUsage.test.ts` (extend the import):

```ts
describe("sundaysInMonth / addMonths", () => {
  it("lists every Sunday of a month", () => {
    expect(sundaysInMonth("2026-09")).toEqual(["2026-09-06", "2026-09-13", "2026-09-20", "2026-09-27"])
    expect(sundaysInMonth("2026-11")).toEqual(["2026-11-01", "2026-11-08", "2026-11-15", "2026-11-22", "2026-11-29"])
    expect(sundaysInMonth("2027-01")).toEqual(["2027-01-03", "2027-01-10", "2027-01-17", "2027-01-24", "2027-01-31"])
  })
  it("handles a leap February", () => {
    expect(sundaysInMonth("2028-02")).toEqual(["2028-02-06", "2028-02-13", "2028-02-20", "2028-02-27"])
  })
  it("rejects a malformed month", () => {
    expect(() => sundaysInMonth("2026-13")).toThrow(RangeError)
  })
  it("adds months across year boundaries", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01")
    expect(addMonths("2026-01", -1)).toBe("2025-12")
    expect(addMonths("2026-10", -12)).toBe("2025-10")
    expect(addMonths("2026-10", 6)).toBe("2027-04")
  })
})

describe("monthCompleteness", () => {
  const d = (ymd: string) => new Date(`${ymd}T00:00:00Z`)
  const sep = (day: string, status: "REQUESTED" | "CONFIRMED" | "CANCELLED") => ({ date: d(`2026-09-${day}`), status })
  it("is complete when every Sunday is confirmed or cancelled and one is confirmed", () => {
    const c = monthCompleteness("2026-09", [sep("06", "CONFIRMED"), sep("13", "CANCELLED"), sep("20", "CONFIRMED"), sep("27", "CONFIRMED")])
    expect(c).toEqual({ complete: true, missingSundays: [], requestedCount: 0, confirmedCount: 3 })
    expect(describeIncomplete(c)).toEqual([])
  })
  it("is incomplete with a Sunday that has no row", () => {
    const c = monthCompleteness("2026-09", [sep("06", "CONFIRMED"), sep("20", "CONFIRMED"), sep("27", "CONFIRMED")])
    expect(c.complete).toBe(false)
    expect(c.missingSundays).toEqual(["2026-09-13"])
    expect(describeIncomplete(c)).toEqual(["No confirmed or cancelled booking for: Sunday, 13 September"])
  })
  it("is incomplete while any row is still REQUESTED (even on a non-Sunday)", () => {
    const c = monthCompleteness("2026-09", [
      sep("06", "CONFIRMED"), sep("13", "CONFIRMED"), sep("20", "CONFIRMED"), sep("27", "CONFIRMED"), sep("10", "REQUESTED"),
    ])
    expect(c.complete).toBe(false)
    expect(describeIncomplete(c)).toEqual(["1 date is still marked Requested"])
  })
  it("is incomplete with nothing confirmed", () => {
    const c = monthCompleteness("2026-09", ["06", "13", "20", "27"].map((x) => sep(x, "CANCELLED")))
    expect(c.complete).toBe(false)
    expect(describeIncomplete(c)).toEqual(["No confirmed bookings in this month"])
  })
  it("ignores rows outside the month and counts a Sunday settled by a second row", () => {
    const c = monthCompleteness("2026-09", [
      { date: d("2026-08-30"), status: "REQUESTED" },
      sep("06", "CANCELLED"), sep("06", "CONFIRMED"), sep("13", "CONFIRMED"), sep("20", "CONFIRMED"), sep("27", "CONFIRMED"),
    ])
    expect(c.complete).toBe(true)
  })
})
```

- [ ] **Step 2: Run, expect FAIL** (`npm test -- --testPathPatterns="venueUsage.test"`).

- [ ] **Step 3: Implement** (append to `src/lib/venueUsage.ts`):

```ts
/**
 * Every Sunday in a month as "YYYY-MM-DD", ascending (UTC calendar arithmetic, server-timezone independent).
 * @param month "YYYY-MM"
 * @throws RangeError when malformed
 */
export function sundaysInMonth(month: string): string[] {
  const { start, end } = monthRange(month)
  const d = new Date(start)
  d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7))
  const out: string[] = []
  for (; d.getTime() <= end.getTime(); d.setUTCDate(d.getUTCDate() + 7)) out.push(utcDateToYmd(d))
  return out
}

/**
 * Shift a month key by whole months (negative goes back; crosses year boundaries).
 * @param month "YYYY-MM"
 * @param delta months to add
 * @throws RangeError when malformed
 */
export function addMonths(month: string, delta: number): string {
  const m = MONTH_RE.exec(month)
  if (!m) throw new RangeError("Invalid month")
  const index = Number(m[1]) * 12 + (Number(m[2]) - 1) + delta
  const year = Math.floor(index / 12)
  const mo = (((index % 12) + 12) % 12) + 1
  return `${year}-${String(mo).padStart(2, "0")}`
}

/** A usage row reduced to what the completeness check needs. */
export type CompletenessRow = { date: Date; status: VenueBookingStatusValue }

/** Result of {@link monthCompleteness}. */
export type MonthCompleteness = {
  complete: boolean
  /** Sundays ("YYYY-MM-DD") with no CONFIRMED or CANCELLED row. */
  missingSundays: string[]
  requestedCount: number
  confirmedCount: number
}

/**
 * Whether a month is ready for the automatic invoice request: every Sunday has at least one
 * CONFIRMED or CANCELLED row, no row in the month is REQUESTED, and at least one row is CONFIRMED.
 * Rows outside `month` are ignored.
 * @param month "YYYY-MM"
 * @param rows usage rows (any month)
 */
export function monthCompleteness(month: string, rows: readonly CompletenessRow[]): MonthCompleteness {
  const inMonth = rows.filter((r) => utcDateToYmd(r.date).startsWith(`${month}-`))
  const requestedCount = inMonth.filter((r) => r.status === "REQUESTED").length
  const confirmedCount = inMonth.filter((r) => r.status === "CONFIRMED").length
  const settled = new Set(inMonth.filter((r) => r.status !== "REQUESTED").map((r) => utcDateToYmd(r.date)))
  const missingSundays = sundaysInMonth(month).filter((s) => !settled.has(s))
  return {
    complete: requestedCount === 0 && confirmedCount > 0 && missingSundays.length === 0,
    missingSundays,
    requestedCount,
    confirmedCount,
  }
}

/**
 * Human reasons a month is not complete, in a stable order; `[]` when it is complete.
 * Shared by the admin warnings and the scheduler's reminder email.
 * @param c result of {@link monthCompleteness}
 */
export function describeIncomplete(c: MonthCompleteness): string[] {
  const reasons: string[] = []
  if (c.requestedCount > 0) {
    reasons.push(`${c.requestedCount} ${c.requestedCount === 1 ? "date is" : "dates are"} still marked Requested`)
  }
  if (c.missingSundays.length > 0) {
    reasons.push(
      `No confirmed or cancelled booking for: ${c.missingSundays.map((s) => formatUsageDate(ymdToUtcDate(s))).join("; ")}`,
    )
  }
  if (c.confirmedCount === 0) reasons.push("No confirmed bookings in this month")
  return reasons
}
```

- [ ] **Step 4: Failing tests** `src/lib/__tests__/venueSchedule.test.ts` (`/** @jest-environment node */`). AEDT = UTC+11 (from first Sunday of October), AEST = UTC+10:

```ts
/** @jest-environment node */
import { autoSendLabel, venueInvoiceMonth, venueJobWindowOpen } from "@/lib/venueSchedule"

describe("venueJobWindowOpen (Sydney 1st, from 09:00)", () => {
  it("is closed at 08:59 and open at 09:00 on the 1st (AEDT)", () => {
    expect(venueJobWindowOpen(new Date("2026-10-31T21:59:00Z"))).toBe(false) // 1 Nov 08:59 AEDT
    expect(venueJobWindowOpen(new Date("2026-10-31T22:00:00Z"))).toBe(true) // 1 Nov 09:00 AEDT
  })
  it("uses AEST in winter", () => {
    expect(venueJobWindowOpen(new Date("2026-06-30T22:59:00Z"))).toBe(false) // 1 Jul 08:59 AEST
    expect(venueJobWindowOpen(new Date("2026-06-30T23:00:00Z"))).toBe(true) // 1 Jul 09:00 AEST
  })
  it("is open until the end of the Sydney 1st and closed on the 2nd", () => {
    expect(venueJobWindowOpen(new Date("2026-11-01T12:59:00Z"))).toBe(true) // 1 Nov 23:59 AEDT
    expect(venueJobWindowOpen(new Date("2026-11-01T13:00:00Z"))).toBe(false) // 2 Nov 00:00 AEDT
  })
  it("is closed on other days", () => {
    expect(venueJobWindowOpen(new Date("2026-10-25T00:00:00Z"))).toBe(false)
  })
  it("keys off the Sydney date, not the UTC date", () => {
    // 31 Oct 23:30 UTC is already 1 Nov 10:30 in Sydney: open although the UTC date is the 31st.
    expect(venueJobWindowOpen(new Date("2026-10-31T23:30:00Z"))).toBe(true)
  })
})

describe("venueInvoiceMonth", () => {
  it("is the previous Sydney month, including Dec -> Jan", () => {
    expect(venueInvoiceMonth(new Date("2026-10-31T22:00:00Z"))).toBe("2026-10") // 1 Nov Sydney
    expect(venueInvoiceMonth(new Date("2026-12-31T22:00:00Z"))).toBe("2026-12") // 1 Jan 2027 Sydney
  })
})

describe("autoSendLabel", () => {
  it("names the 1st of the following month", () => {
    expect(autoSendLabel("2026-10")).toBe("1 November, 9:00 AM")
    expect(autoSendLabel("2026-12")).toBe("1 January, 9:00 AM")
  })
})
```

- [ ] **Step 5: Run, expect FAIL**; implement `src/lib/venueSchedule.ts`:

```ts
import { sydneyClock } from "@/lib/dates"
import { addMonths, formatMonthLabel, previousMonth } from "@/lib/venueUsage"

/** The scheduled invoice job opens at this Sydney hour on the 1st. */
export const VENUE_JOB_FROM_HOUR = 9
/** Last Sydney day-of-month the job may act on (spec: only the 1st). Raise to add outage catch-up. */
export const VENUE_JOB_LAST_DAY = 1

/**
 * True when the monthly venue job may act: the Sydney date is within the job window
 * (the 1st) and the Sydney hour is at least 09:00.
 * @param now current instant
 */
export function venueJobWindowOpen(now: Date): boolean {
  const c = sydneyClock(now)
  const day = Number(c.ymd.slice(8, 10))
  return day <= VENUE_JOB_LAST_DAY && c.hour >= VENUE_JOB_FROM_HOUR
}

/**
 * The month the job invoices when it runs at `now`: the month before the Sydney month of `now`.
 * @param now current instant
 */
export function venueInvoiceMonth(now: Date): string {
  return previousMonth(sydneyClock(now).ymd)
}

/**
 * Admin-facing label of when an approved month is sent, e.g. "1 November, 9:00 AM" for "2026-10".
 * @param month the month being approved, "YYYY-MM"
 */
export function autoSendLabel(month: string): string {
  const monthName = formatMonthLabel(addMonths(month, 1)).split(" ")[0]
  return `1 ${monthName}, 9:00 AM`
}
```
(The label hard-codes "9:00 AM" to match `VENUE_JOB_FROM_HOUR = 9`; if that constant ever changes, change the label with it. The test pins both.)

- [ ] **Step 6: Run** `npm test -- --testPathPatterns="venueUsage.test|venueSchedule"` (PASS), `npx tsc --noEmit`, `npm run lint`.

- [ ] **Step 7: Commit**

```bash
git status -s
git add src/lib/venueUsage.ts src/lib/venueSchedule.ts src/lib/__tests__/venueUsage.test.ts src/lib/__tests__/venueSchedule.test.ts
git commit -m "feat(venue): sunday enumeration, month completeness and sydney job gate" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 3: Email templates, rendering engine, booking/cancellation builders (size L)

Adds `venueBookingRequest` and `venueInvoiceRequest` to `EmailTemplate` (defaults + vars), a shared pure renderer, the new booking-request and cancellation builders, and rewires `buildRequestEmail` to render through the template. Settings visibility and the admin preview/test-send for the new keys.

**Files:**
- Modify: `src/lib/emailTemplates.ts`, `src/lib/venueUsage.ts`, `src/lib/actions/emailTemplates.ts`, `src/app/(dashboard)/settings/email/page.tsx`
- Test: `src/lib/__tests__/venueUsage.test.ts`, `src/lib/__tests__/emailTemplates.test.ts`, `src/components/settings/__tests__/EmailTemplatesSection.test.tsx`, `src/app/(dashboard)/settings/email/__tests__/page.test.tsx`, `src/lib/actions/__tests__/emailTemplates.test.ts`

**Interfaces**
- Consumes: `applyVars(text, vars)`, `DEFAULT_EMAIL_TEMPLATES`, `EmailTemplateFields` (`emailTemplates.ts`); `formatUsageLine`, `formatHours`, `durationHours`, `escapeHtml`, `confirmedOnly`, `formatMonthLabel` (`venueUsage.ts`); `isVenueUsageEnabled()` (`venueUsageSettings.ts`).
- Produces:
  - `EMAIL_TEMPLATE_KEYS` adds `"venueBookingRequest" | "venueInvoiceRequest"`; labels `"Venue booking request"`, `"Venue invoice request"`; both use vars `{venueName} {contactName} {churchName} {month} {dates} {bookedDates} {totalHours} {senderName}`.
  - `visibleEmailTemplateKeys(enabled: ReadonlySet<FeatureKey>, extra?: { venueUsage?: boolean }): EmailTemplateKey[]` (venue keys only when `extra.venueUsage`)
  - `renderVenueEmail(template: EmailTemplateFields, vars: Record<string, string>): { subject: string; text: string; html: string }`
  - `buildRequestEmail(input: { churchName; venueName; contactName; month; rows; senderName?; template?: EmailTemplateFields })` (signature extended, output shape unchanged)
  - `buildBookingRequestEmail(input: { churchName: string; venueName: string; contactName: string; requested: readonly VenueUsageLine[]; booked: readonly VenueUsageLine[]; senderName?: string | null; template?: EmailTemplateFields }): { subject: string; text: string; html: string }`
  - `buildCancellationEmail(input: { churchName: string; venueName: string; contactName: string; cancelled: readonly VenueUsageLine[]; senderName?: string | null }): { subject: string; text: string; html: string }`
  - `VenueEmailTemplateKey = "venueBookingRequest" | "venueInvoiceRequest"`

**Design notes**
- Template fields map to the email as `intro` + `body` + `signoff`, filled with `applyVars`, then escaped. `{dates}` and `{bookedDates}` expand to `- <line>` lines (one per row); a block of only `- ` lines renders as a `<ul>`. Empty lists expand to `None`. The signoff drops blank lines, so an empty `{senderName}` leaves no gap.
- A blank contact name replaces the intro with `Hello,` (an admin's custom intro with `{contactName}` would otherwise read "Dear ,").
- `{month}` for a booking request is the distinct month labels of the requested dates joined with " and ". `{totalHours}` for a booking request is the sum over the requested dates; for the invoice it is confirmed rows only (existing `totalHours`).

- [ ] **Step 1: Failing tests** (`venueUsage.test.ts`, extend imports with `buildBookingRequestEmail, buildCancellationEmail, renderVenueEmail`):

```ts
describe("renderVenueEmail", () => {
  const t = { subject: "Hi {venueName}\r\nBcc: x", intro: "Hello {contactName},", body: "Dates:\n\n{dates}\n\nTotal: {totalHours}", signoff: "Kind regards,\n{senderName}\n{churchName}" }
  const vars = { venueName: "Example Hall", contactName: "Pat <b>", dates: "- A\n- B", totalHours: "2 hours", senderName: "", churchName: "Example Church" }
  it("fills vars, escapes html, renders bullet blocks as a list and drops a blank sender line", () => {
    const { subject, text, html } = renderVenueEmail(t, vars)
    expect(subject).toBe("Hi Example Hall Bcc: x")
    expect(text).toBe("Hello Pat <b>,\n\nDates:\n\n- A\n- B\n\nTotal: 2 hours\n\nKind regards,\nExample Church")
    expect(html).toContain("<p>Hello Pat &lt;b&gt;,</p>")
    expect(html).toContain("<ul><li>A</li><li>B</li></ul>")
    expect(html).toContain("<p>Kind regards,<br>Example Church</p>")
    expect(html).not.toContain("<b>")
  })
  it("leaves unknown tokens verbatim", () => {
    expect(renderVenueEmail({ ...t, body: "{nope}" }, vars).text).toContain("{nope}")
  })
})

describe("buildBookingRequestEmail", () => {
  const requested = [
    { date: new Date("2026-10-11T00:00:00Z"), startTime: "17:00", endTime: "20:00", status: "REQUESTED" as const },
    { date: new Date("2026-09-27T00:00:00Z"), startTime: "17:00", endTime: "20:30", status: "REQUESTED" as const },
  ]
  const booked = [{ date: new Date("2026-10-04T00:00:00Z"), startTime: "17:00", endTime: "20:00", status: "CONFIRMED" as const }]
  const base = { churchName: "Example Church", venueName: "Example Hall", contactName: "Pat Example", senderName: "Sam Admin" }
  it("lists new dates sorted, already-booked dates, month labels and total", () => {
    const { subject, text } = buildBookingRequestEmail({ ...base, requested, booked })
    expect(subject).toBe("Booking request: September 2026 and October 2026 (Example Church)")
    expect(text.indexOf("Sunday, 27 September")).toBeLessThan(text.indexOf("Sunday, 11 October"))
    expect(text).toContain("- Sunday, 4 October: 5:00 PM – 8:00 PM (3 hours)")
    expect(text).toContain("Hello Pat Example,")
    expect(text.trimEnd().endsWith("Kind regards,\nSam Admin\nExample Church")).toBe(true)
  })
  it("says None when nothing is already booked and escapes values in html", () => {
    const { text, html } = buildBookingRequestEmail({ ...base, venueName: "Hall <script>", requested, booked: [] })
    expect(text).toContain("None")
    expect(html).toContain("Hall &lt;script&gt;")
    expect(html).not.toContain("<script>")
  })
  it("uses the supplied template", () => {
    const template = { subject: "S {month}", intro: "I", body: "B {totalHours}", signoff: "" }
    const { subject, text } = buildBookingRequestEmail({ ...base, requested, booked, template })
    expect(subject).toBe("S September 2026 and October 2026")
    expect(text).toBe("I\n\nB 6.5 hours")
  })
})

describe("buildCancellationEmail", () => {
  it("lists the cancelled dates with a fixed wording", () => {
    const { subject, text, html } = buildCancellationEmail({
      churchName: "Example Church", venueName: "Example Hall", contactName: "", senderName: "Sam Admin",
      cancelled: [{ date: new Date("2026-10-11T00:00:00Z"), startTime: "17:00", endTime: "20:00", status: "CANCELLED" }],
    })
    expect(subject).toBe("Booking cancellation (Example Church)")
    expect(text.startsWith("Hello,")).toBe(true)
    expect(text).toContain("cancel our booking of Example Hall")
    expect(text).toContain("- Sunday, 11 October: 5:00 PM – 8:00 PM (3 hours)")
    expect(html).toContain("<li>Sunday, 11 October: 5:00 PM – 8:00 PM (3 hours)</li>")
  })
})
```
Existing `buildRequestEmail` tests must keep passing unchanged (default invoice template reproduces the "Dear ...", `Total: 3.5 hours`, `<li>` and `Kind regards,\nExample Church` assertions). Add one more: custom `template` is honoured, and `{totalHours}` counts confirmed rows only.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Template keys, defaults, vars** in `src/lib/emailTemplates.ts`:

```ts
export const EMAIL_TEMPLATE_KEYS = ["welcome", "familyUpdate", "receipt", "dgrReceipt", "venueBookingRequest", "venueInvoiceRequest"] as const
```
  - `EMAIL_TEMPLATE_LABELS`: `venueBookingRequest: "Venue booking request"`, `venueInvoiceRequest: "Venue invoice request"`.
  - Add `const VENUE_VARS = ["{venueName}", "{contactName}", "{churchName}", "{month}", "{dates}", "{bookedDates}", "{totalHours}", "{senderName}"]` and use it for both keys in `EMAIL_TEMPLATE_VARS`.
  - Defaults:

```ts
  venueBookingRequest: {
    subject: "Booking request: {month} ({churchName})",
    intro: "Dear {contactName},",
    body:
      "We would like to book {venueName} on the following dates:\n\n{dates}\n\nFor reference, these dates are already booked with you:\n\n{bookedDates}\n\nCould you please confirm the new dates? Thank you for your help.",
    signoff: "Kind regards,\n{senderName}\n{churchName}",
  },
  venueInvoiceRequest: {
    subject: "Invoice request: {month} venue usage ({churchName})",
    intro: "Dear {contactName},",
    body:
      "We hope you are well. Could you please send us an invoice for our use of {venueName} during {month}? The dates and times we used are listed below.\n\n{dates}\n\nTotal: {totalHours}\n\nPlease let us know if any of these details differ from your records. Thank you for your help.",
    signoff: "Kind regards,\n{senderName}\n{churchName}",
  },
```
  - Add `export type VenueEmailTemplateKey = "venueBookingRequest" | "venueInvoiceRequest"`, and an `isVenueTemplateKey(key: string): key is VenueEmailTemplateKey` (JSDoc'd). Change `visibleEmailTemplateKeys` to:

```ts
export function visibleEmailTemplateKeys(
  enabled: ReadonlySet<FeatureKey>,
  extra: { venueUsage?: boolean } = {},
): EmailTemplateKey[] {
  return EMAIL_TEMPLATE_KEYS.filter((k) => {
    if (isVenueTemplateKey(k)) return !!extra.venueUsage
    const feature = EMAIL_TEMPLATE_FEATURE[k]
    return !feature || enabled.has(feature)
  })
}
```
  Update existing assertions that now differ: `EmailTemplatesSection.test.tsx` line 69 becomes `.toEqual(EMAIL_TEMPLATE_KEYS.filter((k) => !k.startsWith("venue")))`; add `expect(visibleEmailTemplateKeys(new Set(), { venueUsage: true })).toEqual(["welcome", "venueBookingRequest", "venueInvoiceRequest"])`. Run `npm test -- --testPathPatterns="emailTemplates|EmailTemplatesSection|settings/email"` and fix only expectations that enumerate the key list.

- [ ] **Step 4: Implement renderer + builders** in `src/lib/venueUsage.ts`. Add imports `import { applyVars, DEFAULT_EMAIL_TEMPLATES, type EmailTemplateFields } from "@/lib/emailTemplates"`. Replace the body of `buildRequestEmail` and add the rest:

```ts
/**
 * Fill a template with variables and render plain text + HTML. Every value is substituted first and
 * HTML-escaped afterwards; the subject has its whitespace collapsed so a value cannot add a header line.
 * A paragraph made only of "- " lines becomes a list. The signoff drops blank lines.
 * @param template subject/intro/body/signoff with {vars}
 * @param vars values for the {vars}; unknown tokens stay visible
 */
export function renderVenueEmail(
  template: EmailTemplateFields,
  vars: Record<string, string>,
): { subject: string; text: string; html: string } {
  const fill = (s: string) => applyVars(s, vars)
  const signoff = fill(template.signoff).split("\n").map((l) => l.trim()).filter(Boolean).join("\n")
  const blocks = [fill(template.intro), fill(template.body), signoff].map((b) => b.trim()).filter(Boolean)
  const paragraphs = blocks.flatMap((b) => b.split(/\n{2,}/)).map((p) => p.trim()).filter(Boolean)
  const html = paragraphs
    .map((p) => {
      const lines = p.split("\n")
      if (lines.every((l) => l.startsWith("- "))) {
        return `<ul>${lines.map((l) => `<li>${escapeHtml(l.slice(2))}</li>`).join("")}</ul>`
      }
      return `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`
    })
    .join("\n")
  return { subject: fill(template.subject).replace(/\s+/g, " ").trim(), text: blocks.join("\n\n"), html }
}

/** Lines sorted by date, then start time (does not mutate the input). */
function sortLines<T extends VenueUsageLine>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.date.getTime() - b.date.getTime() || a.startTime.localeCompare(b.startTime))
}

/** "- <line>" per row, or "None" for an empty list. */
function bulletLines(rows: readonly VenueUsageLine[]): string {
  return rows.length ? sortLines(rows).map((r) => `- ${formatUsageLine(r)}`).join("\n") : "None"
}

/** Decimal hours across lines regardless of status (callers pre-filter). */
function sumHours(rows: readonly VenueUsageLine[]): number {
  return Math.round(rows.reduce((sum, r) => sum + durationHours(r.startTime, r.endTime), 0) * 100) / 100
}

/** Distinct month labels of the lines in date order, joined with " and " ("September 2026 and October 2026"). */
function monthsLabel(rows: readonly VenueUsageLine[]): string {
  const keys = Array.from(new Set(sortLines(rows).map((r) => utcDateToYmd(r.date).slice(0, 7))))
  return keys.map(formatMonthLabel).join(" and ")
}

/** Variables shared by every venue email. A blank contact name is handled by the callers. */
function commonVars(i: { churchName: string; venueName: string; contactName: string; senderName?: string | null }) {
  return {
    churchName: i.churchName.trim(),
    venueName: i.venueName.trim() || "your venue",
    contactName: i.contactName.trim(),
    senderName: i.senderName?.trim() ?? "",
  }
}

/** Replace the template intro with a neutral greeting when there is no contact name. */
function withGreeting(template: EmailTemplateFields, contactName: string): EmailTemplateFields {
  return contactName ? template : { ...template, intro: "Hello," }
}

/**
 * Build the monthly invoice-request email (subject + plain text + HTML) from the
 * `venueInvoiceRequest` template. Only CONFIRMED rows are listed and totalled, sorted by date then start time.
 * @param input church/venue/contact names, month key, usage rows, sender name and an optional template override
 */
export function buildRequestEmail(input: {
  churchName: string
  venueName: string
  contactName: string
  month: string
  rows: readonly VenueUsageLine[]
  senderName?: string | null
  template?: EmailTemplateFields
}): { subject: string; text: string; html: string } {
  const confirmed = confirmedOnly(input.rows)
  const common = commonVars(input)
  const vars = {
    ...common,
    month: formatMonthLabel(input.month),
    dates: bulletLines(confirmed),
    bookedDates: "",
    totalHours: formatHours(totalHours(confirmed)),
  }
  return renderVenueEmail(withGreeting(input.template ?? DEFAULT_EMAIL_TEMPLATES.venueInvoiceRequest, common.contactName), vars)
}

/**
 * Build the booking-request email for new (REQUESTED) dates, with already-booked dates for reference.
 * @param input names, the requested rows, the already-booked (CONFIRMED, today or later) rows, sender and optional template override
 */
export function buildBookingRequestEmail(input: {
  churchName: string
  venueName: string
  contactName: string
  requested: readonly VenueUsageLine[]
  booked: readonly VenueUsageLine[]
  senderName?: string | null
  template?: EmailTemplateFields
}): { subject: string; text: string; html: string } {
  const common = commonVars(input)
  const vars = {
    ...common,
    month: monthsLabel(input.requested),
    dates: bulletLines(input.requested),
    bookedDates: bulletLines(input.booked),
    totalHours: formatHours(sumHours(input.requested)),
  }
  return renderVenueEmail(withGreeting(input.template ?? DEFAULT_EMAIL_TEMPLATES.venueBookingRequest, common.contactName), vars)
}

const CANCELLATION_TEMPLATE: EmailTemplateFields = {
  subject: "Booking cancellation ({churchName})",
  intro: "Dear {contactName},",
  body:
    "Unfortunately we need to cancel our booking of {venueName} on the following dates:\n\n{dates}\n\nWe are sorry for any inconvenience this causes. Please let us know if you have any questions.",
  signoff: "Kind regards,\n{senderName}\n{churchName}",
}

/**
 * Build the cancellation notice for cancelled booking dates (fixed wording, not an editable template).
 * @param input names, the cancelled rows and the sender name
 */
export function buildCancellationEmail(input: {
  churchName: string
  venueName: string
  contactName: string
  cancelled: readonly VenueUsageLine[]
  senderName?: string | null
}): { subject: string; text: string; html: string } {
  const common = commonVars(input)
  const vars = { ...common, dates: bulletLines(input.cancelled) }
  return renderVenueEmail(withGreeting(CANCELLATION_TEMPLATE, common.contactName), vars)
}
```
Delete the old inline `greeting`/`intro`/`outro` code. `totalHours(rows)` already filters to confirmed.

- [ ] **Step 5: Settings visibility + template actions.**
  `src/app/(dashboard)/settings/email/page.tsx`: import `isVenueUsageEnabled` and pass `visibleEmailTemplateKeys(features, { venueUsage: await isVenueUsageEnabled() })` (read it inside the existing `Promise.all` if one exists). Update `page.test.tsx` (it already asserts `visibleEmailTemplateKeys(features)`) to mock `@/lib/venueUsageSettings` (`isVenueUsageEnabled: jest.fn(async () => false)`) and add a case with `true` that expects the venue keys.
  `src/lib/actions/emailTemplates.ts`: in `templateFeatureGuard`, before the feature lookup:

```ts
  if (typeof key === "string" && isVenueTemplateKey(key) && !(await isVenueUsageEnabled())) {
    return { error: "Venue usage is not enabled" }
  }
```
  (import `isVenueTemplateKey` from `@/lib/emailTemplates`, `isVenueUsageEnabled` from `@/lib/venueUsageSettings`; update the JSDoc: "...or the venue feature for venue templates"). In `sampleVars` add `if (isVenueTemplateKey(key)) return {}` is unnecessary: handle venue keys in `renderTemplate` before the receipt fallthrough:

```ts
  if (isVenueTemplateKey(key)) {
    const sample = [
      { date: new Date("2026-09-06T00:00:00Z"), startTime: "17:00", endTime: "20:30", status: "CONFIRMED" as const },
      { date: new Date("2026-09-13T00:00:00Z"), startTime: "17:00", endTime: "20:30", status: "CONFIRMED" as const },
    ]
    const common = { churchName, venueName: "Example Hall", contactName: "Pat Example", senderName: "Sam Admin" }
    return key === "venueInvoiceRequest"
      ? buildRequestEmail({ ...common, month: "2026-09", rows: sample, template: f }).html
      : buildBookingRequestEmail({ ...common, requested: sample, booked: [{ ...sample[0], date: new Date("2026-08-30T00:00:00Z") }], template: f }).html
  }
```
  (`renderTemplate` returns a string of HTML; the venue builders already return escaped HTML, so no React render.) Check `sendTestEmail` also routes through `renderTemplate` (it does per the existing structure); if it builds its own subject via `applyVars(draft.subject, sampleVars(...))`, pass sample venue vars there too (`venueName: "Example Hall"`, `month: "September 2026"`, etc.) so the test email subject is not left with raw `{tokens}`.
  Add tests to `src/lib/actions/__tests__/emailTemplates.test.ts`: `updateEmailTemplate` for `venueInvoiceRequest` returns `{ error: "Venue usage is not enabled" }` when `isVenueUsageEnabled` resolves false and saves when true; `previewEmailTemplate("venueBookingRequest", draft)` returns `{ html }` containing `Example Hall`. (Mock `@/lib/venueUsageSettings` in that file.)

- [ ] **Step 6: Run** `npm test -- --testPathPatterns="venueUsage|emailTemplates|EmailTemplatesSection|settings/email|email-dgr"`, `npx tsc --noEmit`, `npm run lint`. Expected: PASS; existing `buildRequestEmail` tests pass unmodified.

- [ ] **Step 7: Commit**

```bash
git status -s
git add src/lib/emailTemplates.ts src/lib/venueUsage.ts src/lib/actions/emailTemplates.ts "src/app/(dashboard)/settings/email" src/lib/__tests__ src/components/settings/__tests__/EmailTemplatesSection.test.tsx src/lib/actions/__tests__/emailTemplates.test.ts
git commit -m "feat(venue): editable booking and invoice email templates" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 4: Shared invoice module (size M)

Extract the prepare/send core out of the `"use server"` action file so the manual action (Task 6) and the scheduler job (Task 7) share one implementation. Adds template use, completeness, scheduler-safe recipients and the failed-resend guard (spec gap 2).

**Files:**
- Create: `src/lib/venueInvoice.ts`
- Modify: `src/lib/actions/venueUsage.ts` (use the module; keep exports and behaviour), `src/lib/email.ts` (JSDoc only)
- Test: `src/lib/__tests__/venueInvoice.test.ts`, `src/lib/actions/__tests__/venueUsage.test.ts`

**Interfaces**
- Consumes: `readVenueUsageSettings`, `getEmailTemplate("venueInvoiceRequest")` (`emailTemplateStore.ts`), `getChurchSettings`, `encrypt`, `logAudit`, `sendVenueUsageRequestEmail`, `buildRequestEmail`, `monthCompleteness`, `parseCcList`, `confirmedOnly`.
- Produces:
  - `MAX_ROWS_PER_MONTH = 200`
  - `type ActorInfo = { name: string; email: string | null }`
  - `loadActor(userId: number): Promise<ActorInfo>`
  - `dedupeAddresses(list: (string | null | undefined)[], exclude: string): string[]`
  - `type Recipients = { to: string; cc: string[]; replyTo: string }`
  - `invoiceRecipients(settings: VenueUsageSettings, actor: ActorInfo | null): Recipients`
  - `bookingRecipients(settings: VenueUsageSettings, actor: ActorInfo | null): Recipients` (CC = booking CCs + effective reply-to)
  - `type InvoicePrep = { settings: VenueUsageSettings; rows: VenueUsageLine[] /* CONFIRMED only */; completeness: MonthCompleteness; subject: string; text: string; html: string; to: string; cc: string[]; replyTo: string; last: { status: string | null; sentAt: Date | null; errorMessage: string | null; approvedAt: Date | null; approvedByName: string | null; autoSent: boolean } | null }`
  - `prepareInvoiceRequest(month: string, actor: ActorInfo | null): Promise<InvoicePrep>`
  - `deliverInvoiceRequest(p: InvoicePrep, ctx: { month: string; userId: number | null; autoSent: boolean; resend: boolean }): Promise<{ status: "SUCCESS" | "FAILED"; errorMessage: string | null }>`

- [ ] **Step 1: Failing tests** `src/lib/__tests__/venueInvoice.test.ts` (`/** @jest-environment node */`; mock `@/lib/prisma` with `venueUsage.findMany`, `venueUsageRequest.findUnique/upsert/update`, `user.findUnique`; `@/lib/crypto` (`encrypt: v => "enc:"+v`); `@/lib/audit`; `@/lib/email`; `@/lib/churchSettings`; `@/lib/venueUsageSettings`; `@/lib/emailTemplateStore` (`getEmailTemplate` returns the default)):

```ts
const settings = { enabled: true, venueName: "Example Hall", contactName: "Pat Example", contactEmail: "venue@example.com",
  ccEmail: "treasurer@example.com", replyToEmail: "", bookingCcEmails: "sec@example.com, venue@example.com" }

it("invoiceRecipients: reply-to falls back to the actor, CC is de-duplicated and excludes the To address", () => {
  expect(invoiceRecipients(settings, { name: "Sam", email: "sam@example.com" })).toEqual({
    to: "venue@example.com", replyTo: "sam@example.com", cc: ["treasurer@example.com", "sam@example.com"],
  })
})
it("invoiceRecipients: scheduler (no actor) uses only the configured reply-to", () => {
  expect(invoiceRecipients({ ...settings, replyToEmail: "office@example.com" }, null))
    .toEqual({ to: "venue@example.com", replyTo: "office@example.com", cc: ["treasurer@example.com", "office@example.com"] })
  expect(invoiceRecipients(settings, null).replyTo).toBe("")
})
it("bookingRecipients: booking CCs plus the reply-to, never the To address", () => {
  expect(bookingRecipients(settings, { name: "Sam", email: "sam@example.com" }))
    .toEqual({ to: "venue@example.com", replyTo: "sam@example.com", cc: ["sec@example.com", "sam@example.com"] })
})
it("prepareInvoiceRequest lists CONFIRMED rows only but computes completeness from all rows", async () => {
  ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue([
    { date: new Date("2026-09-06T00:00:00Z"), startTime: "17:00", endTime: "20:30", status: "CONFIRMED" },
    { date: new Date("2026-09-13T00:00:00Z"), startTime: "17:00", endTime: "20:30", status: "REQUESTED" },
  ])
  ;(prisma.venueUsageRequest.findUnique as jest.Mock).mockResolvedValue(null)
  const p = await prepareInvoiceRequest("2026-09", null)
  expect(p.rows).toHaveLength(1)
  expect(p.completeness.complete).toBe(false)
  expect(p.text).toContain("Sunday, 6 September")
  expect(p.text).not.toContain("13 September")
  expect(p.last).toBeNull()
})
it("deliver SUCCESS stamps the request row with autoSent and audits with a null user for the scheduler", async () => {
  const p = await prepare()   // helper: prepareInvoiceRequest with one confirmed row
  expect(await deliverInvoiceRequest(p, { month: "2026-09", userId: null, autoSent: true, resend: false }))
    .toEqual({ status: "SUCCESS", errorMessage: null })
  const upsert = (prisma.venueUsageRequest.upsert as jest.Mock).mock.calls[0][0]
  expect(upsert.update).toMatchObject({ status: "SUCCESS", sentTo: "enc:venue@example.com", sentById: null, autoSent: true })
  expect(logAudit).toHaveBeenCalledWith(null, "VENUE_USAGE_REQUEST_SENT", "VenueUsageRequest", undefined, expect.objectContaining({ month: "2026-09", autoSent: true }))
})
it("deliver FAILED records the error", async () => {
  ;(sendVenueUsageRequestEmail as jest.Mock).mockRejectedValue(new Error("smtp down"))
  const r = await deliverInvoiceRequest(await prepare(), { month: "2026-09", userId: 7, autoSent: false, resend: false })
  expect(r).toEqual({ status: "FAILED", errorMessage: "smtp down" })
  expect((prisma.venueUsageRequest.upsert as jest.Mock).mock.calls[0][0].update).toMatchObject({ status: "FAILED", errorMessage: "smtp down" })
})
it("a failed RESEND after a SUCCESS keeps status SUCCESS (only errorMessage is recorded)", async () => {
  ;(sendVenueUsageRequestEmail as jest.Mock).mockRejectedValue(new Error("smtp down"))
  ;(prisma.venueUsageRequest.findUnique as jest.Mock).mockResolvedValue({ status: "SUCCESS", sentAt: new Date(), errorMessage: null, approvedAt: null, approvedBy: null, autoSent: false })
  const p = await prepare()
  expect((await deliverInvoiceRequest(p, { month: "2026-09", userId: 7, autoSent: false, resend: true })).status).toBe("FAILED")
  expect(prisma.venueUsageRequest.upsert).not.toHaveBeenCalled()
  expect((prisma.venueUsageRequest.update as jest.Mock).mock.calls[0][0]).toEqual({ where: { month: "2026-09" }, data: { errorMessage: "smtp down" } })
})
```

- [ ] **Step 2: Run, expect FAIL** (`npm test -- --testPathPatterns="venueInvoice"`).

- [ ] **Step 3: Implement** `src/lib/venueInvoice.ts` (plain server module, no `"use server"`):

```ts
import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { encrypt } from "@/lib/crypto"
import { sendVenueUsageRequestEmail } from "@/lib/email"
import { getChurchSettings } from "@/lib/churchSettings"
import { getEmailTemplate } from "@/lib/emailTemplateStore"
import { readVenueUsageSettings, type VenueUsageSettings } from "@/lib/venueUsageSettings"
import {
  buildRequestEmail, confirmedOnly, monthCompleteness, monthRange, parseCcList,
  type MonthCompleteness, type VenueUsageLine,
} from "@/lib/venueUsage"

export const MAX_ROWS_PER_MONTH = 200

export type ActorInfo = { name: string; email: string | null }
export type Recipients = { to: string; cc: string[]; replyTo: string }

/**
 * Look up a user's display name and email (the session never carries the email).
 * @param userId acting user id
 */
export async function loadActor(userId: number): Promise<ActorInfo> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } })
  return { name: user?.name ?? "", email: user?.email || null }
}

/**
 * Case-insensitive de-duplicated list of non-blank addresses, excluding `exclude`.
 * @param list candidate addresses
 * @param exclude an address to leave out (the To address)
 */
export function dedupeAddresses(list: (string | null | undefined)[], exclude: string): string[] {
  const seen = new Set([exclude.toLowerCase()])
  const out: string[] = []
  for (const a of list) {
    const v = a?.trim()
    if (!v || seen.has(v.toLowerCase())) continue
    seen.add(v.toLowerCase())
    out.push(v)
  }
  return out
}

/**
 * To / CC / Reply-To for the invoice request. Reply-To is the configured address, else the acting
 * user's email; the scheduler (no actor) uses the configured address or none.
 * @param settings venue settings
 * @param actor the acting user, or null for the scheduler
 */
export function invoiceRecipients(settings: VenueUsageSettings, actor: ActorInfo | null): Recipients {
  const replyTo = settings.replyToEmail || actor?.email || ""
  return { to: settings.contactEmail, replyTo, cc: dedupeAddresses([settings.ccEmail, replyTo, actor?.email], settings.contactEmail) }
}

/**
 * To / CC / Reply-To for booking requests and cancellation notices: the booking CC list plus the effective reply-to.
 * @param settings venue settings
 * @param actor the acting user
 */
export function bookingRecipients(settings: VenueUsageSettings, actor: ActorInfo | null): Recipients {
  const replyTo = settings.replyToEmail || actor?.email || ""
  const parsed = parseCcList(settings.bookingCcEmails)
  return { to: settings.contactEmail, replyTo, cc: dedupeAddresses([...(parsed.ok ? parsed.list : []), replyTo], settings.contactEmail) }
}

export type InvoicePrep = {
  settings: VenueUsageSettings
  rows: VenueUsageLine[]
  completeness: MonthCompleteness
  subject: string
  text: string
  html: string
  to: string
  cc: string[]
  replyTo: string
  last: {
    status: string | null; sentAt: Date | null; errorMessage: string | null
    approvedAt: Date | null; approvedByName: string | null; autoSent: boolean
  } | null
}

/**
 * Load the month, build the invoice-request email (template-driven) and resolve recipients. Callers gate first.
 * @param month "YYYY-MM"
 * @param actor the acting user, or null for the scheduler
 */
export async function prepareInvoiceRequest(month: string, actor: ActorInfo | null): Promise<InvoicePrep> {
  const settings = await readVenueUsageSettings()
  const { start, end } = monthRange(month)
  const [all, churchSettings, template, last] = await Promise.all([
    prisma.venueUsage.findMany({
      where: { date: { gte: start, lte: end } },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
      take: MAX_ROWS_PER_MONTH,
      select: { date: true, startTime: true, endTime: true, status: true },
    }),
    getChurchSettings(),
    getEmailTemplate("venueInvoiceRequest"),
    prisma.venueUsageRequest.findUnique({
      where: { month },
      select: {
        status: true, sentAt: true, errorMessage: true, approvedAt: true, autoSent: true,
        approvedBy: { select: { name: true } },
      },
    }),
  ])
  const rows = confirmedOnly(all)
  const { subject, text, html } = buildRequestEmail({
    churchName: churchSettings.name, venueName: settings.venueName, contactName: settings.contactName,
    month, rows, senderName: actor?.name ?? null, template,
  })
  const { to, cc, replyTo } = invoiceRecipients(settings, actor)
  return {
    settings, rows, completeness: monthCompleteness(month, all), subject, text, html, to, cc, replyTo,
    last: last
      ? {
          status: last.status, sentAt: last.sentAt, errorMessage: last.errorMessage,
          approvedAt: last.approvedAt, approvedByName: last.approvedBy?.name ?? null, autoSent: last.autoSent,
        }
      : null,
  }
}

/**
 * Send the prepared invoice request and record the outcome (also on failure). A failed RESEND after an
 * earlier SUCCESS records only the error, so the month still reads as sent and the job cannot send a duplicate.
 * @param p result of {@link prepareInvoiceRequest}
 * @param ctx month, acting user (null = scheduler), whether the scheduler sent it, whether it is an explicit resend
 */
export async function deliverInvoiceRequest(
  p: InvoicePrep,
  ctx: { month: string; userId: number | null; autoSent: boolean; resend: boolean },
): Promise<{ status: "SUCCESS" | "FAILED"; errorMessage: string | null }> {
  let status: "SUCCESS" | "FAILED" = "SUCCESS"
  let errorMessage: string | null = null
  try {
    await sendVenueUsageRequestEmail({
      to: p.to, cc: p.cc.length ? p.cc.join(", ") : undefined, replyTo: p.replyTo || undefined,
      subject: p.subject, html: p.html, text: p.text,
    })
  } catch (err) {
    status = "FAILED"
    errorMessage = (err instanceof Error ? err.message : "Send failed").slice(0, 500)
  }
  if (status === "FAILED" && p.last?.status === "SUCCESS") {
    await prisma.venueUsageRequest.update({ where: { month: ctx.month }, data: { errorMessage } })
  } else {
    const data = { sentAt: new Date(), sentTo: encrypt(p.to), status, errorMessage, sentById: ctx.userId, autoSent: ctx.autoSent }
    await prisma.venueUsageRequest.upsert({ where: { month: ctx.month }, create: { month: ctx.month, ...data }, update: data })
  }
  await logAudit(ctx.userId, status === "SUCCESS" ? "VENUE_USAGE_REQUEST_SENT" : "VENUE_USAGE_REQUEST_FAILED", "VenueUsageRequest", undefined, {
    month: ctx.month, rows: p.rows.length, resend: ctx.resend, autoSent: ctx.autoSent,
  })
  return { status, errorMessage }
}
```

- [ ] **Step 4: Rewire the action file** `src/lib/actions/venueUsage.ts`: delete the local `ActorInfo`, `loadActor`, `dedupeAddresses`, `MAX_ROWS_PER_MONTH`, `prepareRequest`. `getVenueRequestPreview` and `sendVenueUsageRequest` call `prepareInvoiceRequest(month, await loadActor(actorId(session)))` and map `p.last` (`status`, `sentAt`, `errorMessage` only, as today); `sendVenueUsageRequest` replaces its try/catch + upsert + audit with `deliverInvoiceRequest(p, { month, userId, autoSent: false, resend })`. Keep every guard, message and return value. `getVenueRequestPreview` still computes `p.rows.length`/`totalHours(p.rows)`. Update the JSDoc of `sendVenueUsageRequestEmail` in `src/lib/email.ts` to "Send a pre-rendered venue email (invoice request, booking request or cancellation)".

- [ ] **Step 5: Update `venueUsage.test.ts` (actions)** mocks: add `emailTemplate: { findUnique: jest.fn() }` to the prisma mock, `venueUsageRequest.update: jest.fn()`, and `bookingCcEmails: ""` in the settings fixture. Existing assertions must still pass (CC order `[ccEmail, replyTo, actor.email]` unchanged).

- [ ] **Step 6: Run** `npm test -- --testPathPatterns="venueInvoice|venueUsage"`, `npx tsc --noEmit`, `npm run lint`. PASS.

- [ ] **Step 7: Commit**

```bash
git status -s
git add src/lib/venueInvoice.ts src/lib/actions/venueUsage.ts src/lib/email.ts src/lib/__tests__/venueInvoice.test.ts src/lib/actions/__tests__/venueUsage.test.ts
git commit -m "refactor(venue): share invoice prepare/deliver between action and job" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 5: Row mutations with approval invalidation, add-all-Sundays, bulk status, cancellation email (size L)

**Files:**
- Create: `src/lib/venueApproval.ts`
- Modify: `src/lib/actions/venueUsage.ts`
- Test: `src/lib/__tests__/venueApproval.test.ts`, `src/lib/actions/__tests__/venueUsage.test.ts`

**Interfaces**
- Consumes: `logAuditTx`, `logAuditManyTx(tx, entries: AuditEntry[])` (`audit.ts`), `bookingRecipients`, `loadActor` (Task 4), `buildCancellationEmail`, `sundaysInMonth`, `parseCcList`, `sendVenueUsageRequestEmail`.
- Produces:
  - `UNSENT_FILTER` (Prisma where fragment: `status` null or not `"SUCCESS"`)
  - `monthOfDate(d: Date): string` ("YYYY-MM", UTC)
  - `clearApprovalTx(tx: Prisma.TransactionClient, months: readonly string[], userId: number | null): Promise<string[]>` (months actually cleared; audits `VENUE_APPROVAL_CLEARED` per cleared month)
  - `type VenueMutationResult = { success: string; approvalCleared?: boolean; warning?: string } | { error: string }` (exported from `actions/venueUsage.ts` via `export type`)
  - `createVenueUsage(input): Promise<VenueMutationResult>`, `updateVenueUsage(id, input): Promise<VenueMutationResult>`, `deleteVenueUsage(id): Promise<VenueMutationResult>` (same inputs as today)
  - `addAllSundays(input: { month: string; startTime: string; endTime: string; purpose?: string }): Promise<VenueMutationResult>`
  - `setVenueUsageStatus(ids: number[], status: "CONFIRMED" | "CANCELLED", opts?: { emailVenue?: boolean }): Promise<VenueMutationResult>`

**Behaviour rules**
- Every create/update/delete/status change runs in `prisma.$transaction(async (tx) => ...)`: the row write, `clearApprovalTx` for every month touched (for an update that moves a date: old AND new month), and the audit rows (`logAuditTx`). A cleared approval returns `approvalCleared: true`.
- `addAllSundays`: gates (`canEdit`, enabled, valid month, `validateTimeRange`); Sundays of the month minus dates that already have a non-CANCELLED row; `createMany` with status `REQUESTED`; one audit `VENUE_USAGE_BULK_ADDED` `{ month, added, skipped }`; returns `{ success: "Added 3 Sundays (1 skipped: already booked)" }`, or `{ success: "Nothing to add: every Sunday already has a booking" }` when zero.
- `setVenueUsageStatus`: 1 to 200 valid ids; skips rows already in the target status; audit `VENUE_USAGE_STATUS_CHANGED` per changed row (`logAuditManyTx`). With `emailVenue` and status CANCELLED: `assertNotDemo` first (return its error), then after the transaction commits send `buildCancellationEmail` for the rows that changed to the contact, CC from `bookingRecipients`; a send failure does not undo the cancellation: return `{ success: "Cancelled 2 dates", warning: "Could not email the venue. ..." }`. Audit `VENUE_CANCELLATION_EMAILED` or `..._FAILED` with the count.

- [ ] **Step 1: Failing tests** `src/lib/__tests__/venueApproval.test.ts` (mock `@/lib/audit` `logAuditTx`; `tx` is a hand-made object):

```ts
/** @jest-environment node */
jest.mock("@/lib/audit", () => ({ logAuditTx: jest.fn() }))
import { logAuditTx } from "@/lib/audit"
import { clearApprovalTx, monthOfDate, UNSENT_FILTER } from "@/lib/venueApproval"

const makeTx = (approved: { id: number; month: string }[]) => ({
  venueUsageRequest: { findMany: jest.fn().mockResolvedValue(approved), updateMany: jest.fn().mockResolvedValue({ count: approved.length }) },
}) as never

beforeEach(() => jest.clearAllMocks())

it("monthOfDate reads the UTC calendar month", () => {
  expect(monthOfDate(new Date("2026-09-30T00:00:00Z"))).toBe("2026-09")
})
it("UNSENT_FILTER treats null and non-SUCCESS statuses as unsent", () => {
  expect(UNSENT_FILTER).toEqual({ OR: [{ status: null }, { status: { not: "SUCCESS" } }] })
})
it("clears approved unsent months once each and audits them", async () => {
  const tx = makeTx([{ id: 4, month: "2026-10" }])
  const cleared = await clearApprovalTx(tx, ["2026-10", "2026-10", "2026-11"], 7)
  expect(cleared).toEqual(["2026-10"])
  const where = (tx as any).venueUsageRequest.findMany.mock.calls[0][0].where
  expect(where.month).toEqual({ in: ["2026-10", "2026-11"] })
  expect(where.approvedAt).toEqual({ not: null })
  expect((tx as any).venueUsageRequest.updateMany).toHaveBeenCalledWith({ where: { id: { in: [4] } }, data: { approvedAt: null, approvedById: null } })
  expect(logAuditTx).toHaveBeenCalledWith(tx, 7, "VENUE_APPROVAL_CLEARED", "VenueUsageRequest", 4, { month: "2026-10", reason: "dates changed" })
})
it("does nothing when no month is approved", async () => {
  const tx = makeTx([])
  expect(await clearApprovalTx(tx, ["2026-10"], 7)).toEqual([])
  expect((tx as any).venueUsageRequest.updateMany).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Implement** `src/lib/venueApproval.ts`:

```ts
import type { Prisma } from "@/lib/generated/prisma/client"
import { logAuditTx } from "@/lib/audit"
import { utcDateToYmd } from "@/lib/venueUsage"

/** Requests that have not been successfully sent. `status` can be null (never sent) or FAILED; SQL `!=` skips NULLs, hence the OR. */
export const UNSENT_FILTER = {
  OR: [{ status: null }, { status: { not: "SUCCESS" } }],
} satisfies Prisma.VenueUsageRequestWhereInput

/**
 * "YYYY-MM" of a UTC-midnight `@db.Date` value.
 * @param d the date
 */
export function monthOfDate(d: Date): string {
  return utcDateToYmd(d).slice(0, 7)
}

/**
 * Clear the automatic-send approval of every approved, unsent month in `months` (inside the caller's
 * transaction, so the row change and the clear commit or roll back together) and audit each one.
 * @param tx interactive transaction client
 * @param months month keys touched by the row change (duplicates ignored)
 * @param userId acting user, or null for system actions
 * @returns the months whose approval was cleared
 */
export async function clearApprovalTx(tx: Prisma.TransactionClient, months: readonly string[], userId: number | null): Promise<string[]> {
  const unique = Array.from(new Set(months))
  if (unique.length === 0) return []
  const approved = await tx.venueUsageRequest.findMany({
    where: { month: { in: unique }, approvedAt: { not: null }, ...UNSENT_FILTER },
    select: { id: true, month: true },
  })
  if (approved.length === 0) return []
  await tx.venueUsageRequest.updateMany({ where: { id: { in: approved.map((a) => a.id) } }, data: { approvedAt: null, approvedById: null } })
  for (const a of approved) {
    await logAuditTx(tx, userId, "VENUE_APPROVAL_CLEARED", "VenueUsageRequest", a.id, { month: a.month, reason: "dates changed" })
  }
  return approved.map((a) => a.month)
}
```

- [ ] **Step 3: Update the action test harness first.** In `src/lib/actions/__tests__/venueUsage.test.ts`: the prisma mock gains `$transaction: jest.fn(), venueUsage.createMany/updateMany`, `venueUsageRequest.findMany/updateMany`; mock `@/lib/audit` as `{ logAudit: jest.fn(), logAuditTx: jest.fn(), logAuditManyTx: jest.fn() }`; in `beforeEach` (after `resetAllMocks`) add `;(prisma.$transaction as jest.Mock).mockImplementation(async (cb) => cb(prisma))` and `;(prisma.venueUsageRequest.findMany as jest.Mock).mockResolvedValue([])`; add `jest.mock("@/lib/venueInvoice", ...)` only if needed (the module is real, built on the same mocks). Existing audit assertions change from `logAudit(7, "VENUE_USAGE_CREATED", ...)` to `logAuditTx(prisma, 7, "VENUE_USAGE_CREATED", "VenueUsage", 5, expect.any(Object))`, likewise `UPDATED`/`DELETED`.

- [ ] **Step 4: New failing tests** (same file):

```ts
describe("approval invalidation", () => {
  it("create clears an approved unsent month in the same transaction", async () => {
    asRole("PASTOR")
    ;(prisma.venueUsageRequest.findMany as jest.Mock).mockResolvedValue([{ id: 9, month: "2026-09" }])
    const r = await createVenueUsage(validInput)
    expect(r).toEqual({ success: "Booking added", approvalCleared: true })
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.venueUsageRequest.updateMany).toHaveBeenCalledWith({ where: { id: { in: [9] } }, data: { approvedAt: null, approvedById: null } })
    expect(logAuditTx).toHaveBeenCalledWith(prisma, 7, "VENUE_APPROVAL_CLEARED", "VenueUsageRequest", 9, expect.any(Object))
  })
  it("a date move clears both the old and the new month", async () => {
    asRole("PASTOR")
    ;(prisma.venueUsage.findUnique as jest.Mock).mockResolvedValue({ id: 5, date: new Date("2026-08-30T00:00:00Z") })
    await updateVenueUsage(5, validInput) // 2026-09-06
    expect((prisma.venueUsageRequest.findMany as jest.Mock).mock.calls[0][0].where.month).toEqual({ in: ["2026-08", "2026-09"] })
  })
  it("delete clears the row's month", async () => {
    asRole("ADMIN")
    await deleteVenueUsage(5)
    expect((prisma.venueUsageRequest.findMany as jest.Mock).mock.calls[0][0].where.month).toEqual({ in: ["2026-09"] })
  })
  it("rolls back (no audit outside the tx) when the clear throws", async () => {
    asRole("PASTOR")
    ;(prisma.venueUsageRequest.findMany as jest.Mock).mockRejectedValue(new Error("boom"))
    await expect(createVenueUsage(validInput)).rejects.toThrow("boom")
  })
})

describe("addAllSundays", () => {
  const input = { month: "2026-09", startTime: "17:00", endTime: "20:00", purpose: "Sunday service" }
  it("gates role, feature and input", async () => {
    asRole("VIEWER"); expect(await addAllSundays(input)).toEqual({ error: "Unauthorized" })
    asRole("PASTOR"); expect(await addAllSundays({ ...input, month: "2026-13" })).toEqual({ error: "Invalid month" })
    expect(await addAllSundays({ ...input, endTime: "16:00" })).toEqual({ error: "End time must be after the start time" })
    ;(readVenueUsageSettings as jest.Mock).mockResolvedValue({ ...settings, enabled: false })
    expect(await addAllSundays(input)).toEqual({ error: "Venue usage is not enabled" })
  })
  it("creates REQUESTED rows for Sundays without a non-cancelled row and reports skips", async () => {
    asRole("PASTOR")
    ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue([{ date: new Date("2026-09-13T00:00:00Z") }])
    ;(prisma.venueUsage.createMany as jest.Mock).mockResolvedValue({ count: 3 })
    const r = await addAllSundays(input)
    expect(r).toEqual({ success: "Added 3 Sundays (1 skipped: already booked)" })
    const where = (prisma.venueUsage.findMany as jest.Mock).mock.calls[0][0].where
    expect(where.status).toEqual({ not: "CANCELLED" })
    const data = (prisma.venueUsage.createMany as jest.Mock).mock.calls[0][0].data
    expect(data.map((d: { date: Date }) => d.date.toISOString().slice(0, 10))).toEqual(["2026-09-06", "2026-09-20", "2026-09-27"])
    expect(data.every((d: { status: string; createdById: number }) => d.status === "REQUESTED" && d.createdById === 7)).toBe(true)
    expect(logAuditTx).toHaveBeenCalledWith(prisma, 7, "VENUE_USAGE_BULK_ADDED", "VenueUsage", undefined, { month: "2026-09", added: 3, skipped: 1 })
  })
  it("adds nothing when every Sunday is taken", async () => {
    asRole("PASTOR")
    ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue(["06", "13", "20", "27"].map((d) => ({ date: new Date(`2026-09-${d}T00:00:00Z`) })))
    expect(await addAllSundays(input)).toEqual({ success: "Nothing to add: every Sunday already has a booking" })
    expect(prisma.venueUsage.createMany).not.toHaveBeenCalled()
  })
  it("clears approval for the month it adds to", async () => {
    asRole("PASTOR")
    ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue([])
    ;(prisma.venueUsage.createMany as jest.Mock).mockResolvedValue({ count: 4 })
    ;(prisma.venueUsageRequest.findMany as jest.Mock).mockResolvedValue([{ id: 2, month: "2026-09" }])
    expect(await addAllSundays(input)).toMatchObject({ approvalCleared: true })
  })
})

describe("setVenueUsageStatus", () => {
  const rows = [
    { id: 1, date: new Date("2026-09-06T00:00:00Z"), startTime: "17:00", endTime: "20:00", status: "REQUESTED" },
    { id: 2, date: new Date("2026-09-13T00:00:00Z"), startTime: "17:00", endTime: "20:00", status: "CANCELLED" },
  ]
  it("gates role and validates ids", async () => {
    asRole("AUDITOR"); expect(await setVenueUsageStatus([1], "CONFIRMED")).toEqual({ error: "Unauthorized" })
    asRole("PASTOR")
    expect(await setVenueUsageStatus([], "CONFIRMED")).toEqual({ error: "Select at least one booking" })
    expect(await setVenueUsageStatus([0], "CONFIRMED")).toEqual({ error: "Invalid booking" })
    expect(await setVenueUsageStatus(Array.from({ length: 201 }, (_, i) => i + 1), "CONFIRMED")).toEqual({ error: "Too many bookings selected" })
  })
  it("updates only rows not already in the target status, audits each and clears approval", async () => {
    asRole("PASTOR")
    ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue(rows)
    ;(prisma.venueUsageRequest.findMany as jest.Mock).mockResolvedValue([{ id: 3, month: "2026-09" }])
    const r = await setVenueUsageStatus([1, 2], "CANCELLED")
    expect(r).toEqual({ success: "Cancelled 1 date", approvalCleared: true })
    expect(prisma.venueUsage.updateMany).toHaveBeenCalledWith({ where: { id: { in: [1] } }, data: { status: "CANCELLED" } })
    expect(logAuditManyTx).toHaveBeenCalledWith(prisma, [expect.objectContaining({ userId: 7, action: "VENUE_USAGE_STATUS_CHANGED", resourceId: 1 })])
  })
  it("emails the venue about cancelled dates when asked, CC booking CCs and reply-to", async () => {
    asRole("PASTOR")
    ;(readVenueUsageSettings as jest.Mock).mockResolvedValue({ ...settings, bookingCcEmails: "sec@example.com" })
    ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue([rows[0]])
    await setVenueUsageStatus([1], "CANCELLED", { emailVenue: true })
    const mail = (sendVenueUsageRequestEmail as jest.Mock).mock.calls[0][0]
    expect(mail.to).toBe("venue@example.com")
    expect(mail.cc).toBe("sec@example.com, sam@example.com")
    expect(mail.replyTo).toBe("sam@example.com")
    expect(mail.subject).toBe("Booking cancellation (Example Church)")
    expect(mail.text).toContain("Sunday, 6 September")
    expect(logAudit).toHaveBeenCalledWith(7, "VENUE_CANCELLATION_EMAILED", "VenueUsage", undefined, { count: 1 })
  })
  it("keeps the cancellation and warns when the email fails", async () => {
    asRole("PASTOR")
    ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue([rows[0]])
    ;(sendVenueUsageRequestEmail as jest.Mock).mockRejectedValue(new Error("smtp"))
    const r = await setVenueUsageStatus([1], "CANCELLED", { emailVenue: true })
    expect(r).toMatchObject({ success: "Cancelled 1 date", warning: expect.stringContaining("Could not email the venue") })
    expect(prisma.venueUsage.updateMany).toHaveBeenCalled()
    expect(logAudit).toHaveBeenCalledWith(7, "VENUE_CANCELLATION_EMAIL_FAILED", "VenueUsage", undefined, { count: 1 })
  })
  it("blocks the cancellation email in demo mode without changing anything", async () => {
    asRole("PASTOR")
    ;(assertNotDemo as jest.Mock).mockReturnValue({ error: "Not available in demo mode" })
    expect(await setVenueUsageStatus([1], "CANCELLED", { emailVenue: true })).toEqual({ error: "Not available in demo mode" })
    expect(prisma.venueUsage.updateMany).not.toHaveBeenCalled()
  })
  it("does not email for CONFIRMED", async () => {
    asRole("PASTOR")
    ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue([rows[0]])
    await setVenueUsageStatus([1], "CONFIRMED", { emailVenue: true })
    expect(sendVenueUsageRequestEmail).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 5: Run, expect FAIL**: `npm test -- --testPathPatterns="venueApproval|venueUsage"`.

- [ ] **Step 6: Implement.** In `src/lib/actions/venueUsage.ts` add imports (`logAuditTx`, `logAuditManyTx`, `clearApprovalTx`, `monthOfDate`, `loadActor`/`bookingRecipients` from `@/lib/venueInvoice`, `buildCancellationEmail`, `sundaysInMonth`, `formatMonthLabel` etc.), export the result type and rewrite the three row actions:

```ts
/** Result of a booking mutation; `approvalCleared` tells the UI to show the re-approve notice, `warning` a non-fatal problem. */
export type VenueMutationResult = { success: string; approvalCleared?: boolean; warning?: string } | { error: string }

/** Success result carrying the approval-cleared flag only when it applies. */
function mutationOk(success: string, cleared: string[]): VenueMutationResult {
  return cleared.length ? { success, approvalCleared: true } : { success }
}
```
  `createVenueUsage` (after validation):

```ts
  const userId = actorId(session)
  const cleared = await prisma.$transaction(async (tx) => {
    const row = await tx.venueUsage.create({ data: { ...rest, date: ymdToUtcDate(date), createdById: userId }, select: { id: true } })
    const months = await clearApprovalTx(tx, [date.slice(0, 7)], userId)
    await logAuditTx(tx, userId, "VENUE_USAGE_CREATED", "VenueUsage", row.id, { date, status: rest.status })
    return months
  })
  revalidatePath("/venue-usage")
  return mutationOk("Booking added", cleared)
```
  `updateVenueUsage`: `existing` now selects `{ id: true, date: true }`; transaction: `tx.venueUsage.update`, `clearApprovalTx(tx, [monthOfDate(existing.date), date.slice(0, 7)], userId)`, `logAuditTx(... "VENUE_USAGE_UPDATED" ...)`. `deleteVenueUsage`: transaction: `tx.venueUsage.delete`, `clearApprovalTx(tx, [monthOfDate(existing.date)], userId)`, `logAuditTx(... "VENUE_USAGE_DELETED", { date })`. Change the three return types to `Promise<VenueMutationResult>`.

```ts
const AddAllSchema = z.object({
  month: z.string().refine(isValidMonth, "Invalid month"),
  startTime: z.string(),
  endTime: z.string(),
  purpose: emptyToNull(200),
})

/**
 * Add a REQUESTED booking for every Sunday of a month that has no non-cancelled booking yet (`canEdit`).
 * @param input month "YYYY-MM", shared start/end time and optional public purpose
 */
export async function addAllSundays(input: { month: string; startTime: string; endTime: string; purpose?: string }): Promise<VenueMutationResult> {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" }
  const settings = await readVenueUsageSettings()
  if (!settings.enabled) return { error: "Venue usage is not enabled" }
  const parsed = AddAllSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const { month, startTime, endTime, purpose } = parsed.data
  const timeError = validateTimeRange(startTime, endTime)
  if (timeError) return { error: timeError }

  const userId = actorId(session)
  const sundays = sundaysInMonth(month)
  const { added, cleared } = await prisma.$transaction(async (tx) => {
    const existing = await tx.venueUsage.findMany({
      where: { date: { in: sundays.map(ymdToUtcDate) }, status: { not: "CANCELLED" } },
      select: { date: true },
      take: MAX_ROWS_PER_MONTH,
    })
    const taken = new Set(existing.map((e) => utcDateToYmd(e.date)))
    const free = sundays.filter((s) => !taken.has(s))
    if (free.length === 0) return { added: 0, cleared: [] as string[] }
    await tx.venueUsage.createMany({
      data: free.map((s) => ({ date: ymdToUtcDate(s), startTime, endTime, status: "REQUESTED" as const, purpose, createdById: userId })),
    })
    const months = await clearApprovalTx(tx, [month], userId)
    await logAuditTx(tx, userId, "VENUE_USAGE_BULK_ADDED", "VenueUsage", undefined, { month, added: free.length, skipped: sundays.length - free.length })
    return { added: free.length, cleared: months }
  })
  revalidatePath("/venue-usage")
  if (added === 0) return { success: "Nothing to add: every Sunday already has a booking" }
  const skipped = sundays.length - added
  const label = `Added ${added} ${added === 1 ? "Sunday" : "Sundays"}${skipped ? ` (${skipped} skipped: already booked)` : ""}`
  return mutationOk(label, cleared)
}
```
  (`MAX_ROWS_PER_MONTH` imported from `@/lib/venueInvoice`; `utcDateToYmd` from `venueUsage.ts`. The `taken` filtering uses the date list, so the `where.date.in` runs against `@db.Date`; the existing test mocks return `{ date }` rows.)

```ts
/**
 * Mark bookings CONFIRMED or CANCELLED in bulk (`canEdit`). Rows already in the target status are skipped.
 * Cancelling can also email the venue a cancellation notice (not undone if the email fails).
 * @param ids VenueUsage ids (1 to 200)
 * @param status target status
 * @param opts `emailVenue`: send the cancellation notice (CANCELLED only)
 */
export async function setVenueUsageStatus(ids: number[], status: "CONFIRMED" | "CANCELLED", opts: { emailVenue?: boolean } = {}): Promise<VenueMutationResult> {
  const emailVenue = status === "CANCELLED" && !!opts.emailVenue
  if (emailVenue) {
    const demo = assertNotDemo()
    if (demo) return demo
  }
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" }
  if (ids.length === 0) return { error: "Select at least one booking" }
  if (ids.length > MAX_ROWS_PER_MONTH) return { error: "Too many bookings selected" }
  if (!ids.every(isValidPgId)) return { error: "Invalid booking" }
  const settings = await readVenueUsageSettings()
  if (!settings.enabled) return { error: "Venue usage is not enabled" }

  const userId = actorId(session)
  const { changed, cleared } = await prisma.$transaction(async (tx) => {
    const rows = await tx.venueUsage.findMany({
      where: { id: { in: ids } },
      select: { id: true, date: true, startTime: true, endTime: true, status: true },
    })
    const toChange = rows.filter((r) => r.status !== status)
    if (toChange.length === 0) return { changed: [] as typeof rows, cleared: [] as string[] }
    await tx.venueUsage.updateMany({ where: { id: { in: toChange.map((r) => r.id) } }, data: { status } })
    const months = await clearApprovalTx(tx, toChange.map((r) => monthOfDate(r.date)), userId)
    await logAuditManyTx(tx, toChange.map((r) => ({
      userId, action: "VENUE_USAGE_STATUS_CHANGED", resourceType: "VenueUsage", resourceId: r.id,
      metadata: { date: utcDateToYmd(r.date), from: r.status, to: status },
    })))
    return { changed: toChange, cleared: months }
  })
  revalidatePath("/venue-usage")
  if (changed.length === 0) return { error: "No bookings to change" }
  const noun = changed.length === 1 ? "date" : "dates"
  const base = mutationOk(`${status === "CANCELLED" ? "Cancelled" : "Confirmed"} ${changed.length} ${noun}`, cleared) as Extract<VenueMutationResult, { success: string }>
  if (!emailVenue) return base
  return { ...base, ...(await emailCancellation(settings, changed, userId)) }
}
```
  with a private helper (JSDoc'd) in the same file:

```ts
/** Send the cancellation notice; returns a `warning` on failure (the cancellation itself stands). */
async function emailCancellation(settings: VenueUsageSettings, rows: VenueUsageLine[], userId: number): Promise<{ warning?: string }> {
  const [actor, church] = await Promise.all([loadActor(userId), getChurchSettings()])
  const { to, cc, replyTo } = bookingRecipients(settings, actor)
  if (!to) return { warning: "Could not email the venue: no contact email is set." }
  const mail = buildCancellationEmail({ churchName: church.name, venueName: settings.venueName, contactName: settings.contactName, cancelled: rows, senderName: actor.name })
  try {
    await sendVenueUsageRequestEmail({ to, cc: cc.length ? cc.join(", ") : undefined, replyTo: replyTo || undefined, ...mail })
    await logAudit(userId, "VENUE_CANCELLATION_EMAILED", "VenueUsage", undefined, { count: rows.length })
    return {}
  } catch {
    await logAudit(userId, "VENUE_CANCELLATION_EMAIL_FAILED", "VenueUsage", undefined, { count: rows.length })
    return { warning: "Could not email the venue. The dates are cancelled; let them know another way." }
  }
}
```
  The `changed` rows have `status` set to the old value; `buildCancellationEmail` ignores status.

- [ ] **Step 7: Run** `npm test -- --testPathPatterns="venueApproval|venueUsage|featureGuards"`, `npx tsc --noEmit`, `npm run lint`. PASS.

- [ ] **Step 8: Commit**

```bash
git status -s
git add src/lib/venueApproval.ts src/lib/actions/venueUsage.ts src/lib/__tests__/venueApproval.test.ts src/lib/actions/__tests__/venueUsage.test.ts
git commit -m "feat(venue): add all Sundays, bulk confirm/cancel, cancellation email, approval invalidation" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 6: Booking request, approval actions, richer invoice preview (size L)

**Files:**
- Create: `src/lib/actions/venueBookings.ts`
- Modify: `src/lib/actions/venueUsage.ts` (`VenueRequestPreview` + `getVenueRequestPreview`), `src/lib/__tests__/featureGuards.test.ts` (add `"venueBookings.ts"` to `CORE_ACTIONS` with the same comment)
- Test: `src/lib/actions/__tests__/venueBookings.test.ts`, `src/lib/actions/__tests__/venueUsage.test.ts`

**Interfaces**
- Consumes: `prepareInvoiceRequest`, `bookingRecipients`, `loadActor`, `MAX_ROWS_PER_MONTH` (Task 4); `UNSENT_FILTER` (Task 5); `buildBookingRequestEmail`, `monthCompleteness`, `describeIncomplete`; `autoSendLabel`; `sydneyToday`, `sydneyTodayYMD` (`dates.ts`); `getEmailTemplate("venueBookingRequest")`.
- Produces (`venueBookings.ts`, `"use server"`):
  - `type BookingCandidate = { id: number; date: string; startTime: string; endTime: string; purpose: string | null }`
  - `type BookingRequestPreview = { candidates: BookingCandidate[]; selectedIds: number[]; asked: { id: number; date: string; askedOn: string }[]; booked: string[]; subject: string; text: string; to: string; cc: string; replyTo: string; blockedReason: string | null }`
  - `getBookingRequestPreview(ids?: number[]): Promise<BookingRequestPreview | { error: string }>` (no `ids` = all candidates ticked)
  - `sendBookingRequest(ids: number[]): Promise<{ success: string } | { error: string }>`
  - `approveVenueMonth(month: string): Promise<{ success: string } | { error: string }>`
  - `withdrawVenueApproval(month: string): Promise<{ success: string } | { error: string }>`
- Produces (`venueUsage.ts`): `VenueRequestPreview` gains `isCurrentMonth: boolean; autoSendLabel: string; approval: { approvedAt: string; approvedBy: string | null } | null; canApprove: boolean; warnings: string[]; autoSent: boolean`.

**Behaviour rules**
- Candidates: `status = REQUESTED AND bookingRequestedAt IS NULL`, ordered by date, `take 200`. "Asked" rows: `REQUESTED AND bookingRequestedAt IS NOT NULL` (date >= today Sydney). "Already booked": `CONFIRMED AND date >= sydneyToday()`.
- `sendBookingRequest` claims first: `updateMany({ where: { id in ids, status: REQUESTED, bookingRequestedAt: null }, data: { bookingRequestedAt: claimAt } })`; the claimed count must equal the matching rows or it releases and returns an error; then it sends; on failure it releases only rows stamped with exactly `claimAt` (back to null). A double-click cannot email twice.
- `approveVenueMonth`: only the current Sydney month (`month === sydneyTodayYMD().slice(0, 7)`); `canEdit`; feature enabled; contact email set; month must be complete (`monthCompleteness`); refuses when `status === "SUCCESS"`. Upserts `approvedAt = now`, `approvedById`. Audit `VENUE_MONTH_APPROVED`. (The job re-checks completeness at send time, so a mutation racing the approval cannot cause an incomplete month to auto-send.)
- `withdrawVenueApproval`: `updateMany` where approved and unsent; audit `VENUE_APPROVAL_WITHDRAWN`.
- `canApprove` in the preview = `isCurrentMonth && completeness.complete && !!to && last.status !== "SUCCESS"`.

- [ ] **Step 1: Failing tests** `src/lib/actions/__tests__/venueBookings.test.ts` (mocks as in `venueUsage.test.ts`: `@/auth`, `@/lib/prisma` with `venueUsage.findMany/updateMany`, `venueUsageRequest.upsert/updateMany/findUnique`, `user.findUnique`, `@/lib/audit`, `next/cache`, `@/lib/demoMode`, `@/lib/email`, `@/lib/churchSettings`, `@/lib/venueUsageSettings`, `@/lib/emailTemplateStore`; fake time with `jest.useFakeTimers().setSystemTime(new Date("2026-10-25T02:00:00Z"))` so Sydney today = 2026-10-25):

```ts
describe("getBookingRequestPreview", () => {
  it("gates role and feature", async () => {
    asRole("VIEWER"); expect(await getBookingRequestPreview()).toEqual({ error: "Unauthorized" })
    asRole("PASTOR"); (readVenueUsageSettings as jest.Mock).mockResolvedValue({ ...settings, enabled: false })
    expect(await getBookingRequestPreview()).toEqual({ error: "Venue usage is not enabled" })
  })
  it("ticks every candidate by default and lists asked + already-booked dates", async () => {
    asRole("PASTOR")
    ;(prisma.venueUsage.findMany as jest.Mock)
      .mockResolvedValueOnce([{ id: 1, date: new Date("2026-11-01T00:00:00Z"), startTime: "17:00", endTime: "20:00", purpose: null },
                              { id: 2, date: new Date("2026-11-08T00:00:00Z"), startTime: "17:00", endTime: "20:00", purpose: "Service" }]) // candidates
      .mockResolvedValueOnce([{ id: 3, date: new Date("2026-10-25T00:00:00Z"), bookingRequestedAt: new Date("2026-10-20T00:00:00Z") }]) // asked
      .mockResolvedValueOnce([{ date: new Date("2026-11-15T00:00:00Z"), startTime: "17:00", endTime: "20:00", status: "CONFIRMED" }]) // booked
    const p = await getBookingRequestPreview()
    if ("error" in p) throw new Error(p.error)
    expect(p.selectedIds).toEqual([1, 2])
    expect(p.asked).toEqual([{ id: 3, date: "2026-10-25", askedOn: "2026-10-20" }])
    expect(p.booked).toEqual(["Sunday, 15 November: 5:00 PM – 8:00 PM (3 hours)"])
    expect(p.text).toContain("Sunday, 1 November")
    expect(p.text).toContain("Sunday, 15 November")
    expect(p.to).toBe("venue@example.com")
  })
  it("builds the email for only the ticked ids and blocks when none are ticked", async () => {
    asRole("PASTOR")
    // findMany mocks: same three Once-values as the previous test
    const p = await getBookingRequestPreview([2])
    if ("error" in p) throw new Error(p.error)
    expect(p.selectedIds).toEqual([2]); expect(p.text).not.toContain("Sunday, 1 November")
    const none = await getBookingRequestPreview([])
    if ("error" in none) throw new Error(none.error)
    expect(none.blockedReason).toBe("Tick at least one date")
  })
})

const candidateRows = [
  { id: 1, date: new Date("2026-11-01T00:00:00Z"), startTime: "17:00", endTime: "20:00", status: "REQUESTED" },
  { id: 2, date: new Date("2026-11-08T00:00:00Z"), startTime: "17:00", endTime: "20:00", status: "REQUESTED" },
]
const bookedRows = [{ date: new Date("2026-11-15T00:00:00Z"), startTime: "17:00", endTime: "20:00", status: "CONFIRMED" }]
// settings fixture for this file: { enabled: true, venueName: "Example Hall", contactName: "Pat Example",
//   contactEmail: "venue@example.com", ccEmail: "", replyToEmail: "", bookingCcEmails: "sec@example.com" }
// user.findUnique -> { name: "Sam Admin", email: "sam@example.com" }; asRole as in venueUsage.test.ts

describe("sendBookingRequest", () => {
  it("gates role, demo, ids and venue contact", async () => {
    asRole("VIEWER"); expect(await sendBookingRequest([1])).toEqual({ error: "Unauthorized" })
    asRole("PASTOR")
    expect(await sendBookingRequest([])).toEqual({ error: "Tick at least one date" })
    expect(await sendBookingRequest([0])).toEqual({ error: "Invalid booking" })
    ;(readVenueUsageSettings as jest.Mock).mockResolvedValue({ ...settings, contactEmail: "" })
    expect(await sendBookingRequest([1])).toEqual({ error: "Set the venue contact email in Settings first" })
  })
  it("claims the rows, sends once with booking CCs, audits", async () => {
    asRole("PASTOR")
    ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValueOnce(candidateRows).mockResolvedValueOnce(bookedRows)
    ;(prisma.venueUsage.updateMany as jest.Mock).mockResolvedValue({ count: 2 })
    expect(await sendBookingRequest([1, 2])).toEqual({ success: "Booking request sent for 2 dates" })
    const claim = (prisma.venueUsage.updateMany as jest.Mock).mock.calls[0][0]
    expect(claim.where).toMatchObject({ id: { in: [1, 2] }, status: "REQUESTED", bookingRequestedAt: null })
    expect(claim.data.bookingRequestedAt).toBeInstanceOf(Date)
    expect(sendVenueUsageRequestEmail).toHaveBeenCalledTimes(1)
    expect((sendVenueUsageRequestEmail as jest.Mock).mock.calls[0][0].cc).toBe("sec@example.com, sam@example.com")
    expect(logAudit).toHaveBeenCalledWith(7, "VENUE_BOOKING_REQUEST_SENT", "VenueUsage", undefined, { count: 2, ids: [1, 2] })
  })
  it("sends nothing when another request already claimed the rows (double click)", async () => {
    asRole("PASTOR")
    ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValueOnce(candidateRows)
    ;(prisma.venueUsage.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
    expect(await sendBookingRequest([1, 2])).toEqual({ error: "Those dates were already requested. Refresh the page." })
    expect(sendVenueUsageRequestEmail).not.toHaveBeenCalled()
  })
  it("releases the claim and reports an error when the send fails", async () => {
    asRole("PASTOR")
    ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValueOnce(candidateRows).mockResolvedValueOnce(bookedRows)
    ;(prisma.venueUsage.updateMany as jest.Mock).mockResolvedValue({ count: 2 })
    ;(sendVenueUsageRequestEmail as jest.Mock).mockRejectedValue(new Error("smtp"))
    expect(await sendBookingRequest([1, 2])).toEqual({ error: "Could not send the email. Check email settings and try again." })
    const release = (prisma.venueUsage.updateMany as jest.Mock).mock.calls[1][0]
    expect(release.data).toEqual({ bookingRequestedAt: null })
    expect(release.where.bookingRequestedAt).toBeInstanceOf(Date)
    expect(logAudit).toHaveBeenCalledWith(7, "VENUE_BOOKING_REQUEST_FAILED", "VenueUsage", undefined, { count: 2, ids: [1, 2] })
  })
})

describe("approveVenueMonth / withdrawVenueApproval", () => {
  const completeRows = ["04", "11", "18", "25"].map((d) => ({ date: new Date(`2026-10-${d}T00:00:00Z`), status: "CONFIRMED" }))
  it("only the current Sydney month can be approved", async () => {
    asRole("PASTOR")
    expect(await approveVenueMonth("2026-09")).toEqual({ error: "Only the current month can be approved" })
    expect(await approveVenueMonth("nope")).toEqual({ error: "Invalid month" })
  })
  it("refuses an incomplete month, a missing contact email and an already-sent month", async () => {
    asRole("PASTOR")
    ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue(completeRows.slice(1))
    expect(await approveVenueMonth("2026-10")).toEqual({ error: "The month is not complete yet" })
    ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue(completeRows)
    ;(prisma.venueUsageRequest.findUnique as jest.Mock).mockResolvedValue({ status: "SUCCESS" })
    expect(await approveVenueMonth("2026-10")).toEqual({ error: "The invoice request for this month was already sent" })
    ;(readVenueUsageSettings as jest.Mock).mockResolvedValue({ ...settings, contactEmail: "" })
    expect(await approveVenueMonth("2026-10")).toEqual({ error: "Set the venue contact email in Settings first" })
  })
  it("records approver and time and audits", async () => {
    asRole("PASTOR")
    ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue(completeRows)
    ;(prisma.venueUsageRequest.findUnique as jest.Mock).mockResolvedValue(null)
    expect(await approveVenueMonth("2026-10")).toEqual({ success: "Approved: the invoice request will be sent on 1 November, 9:00 AM" })
    const call = (prisma.venueUsageRequest.upsert as jest.Mock).mock.calls[0][0]
    expect(call.update).toMatchObject({ approvedById: 7 }); expect(call.update.approvedAt).toBeInstanceOf(Date)
    expect(logAudit).toHaveBeenCalledWith(7, "VENUE_MONTH_APPROVED", "VenueUsageRequest", undefined, { month: "2026-10" })
  })
  it("withdraw clears an unsent approval and audits; AUDITOR is refused", async () => {
    asRole("AUDITOR"); expect(await withdrawVenueApproval("2026-10")).toEqual({ error: "Unauthorized" })
    asRole("PASTOR")
    ;(prisma.venueUsageRequest.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
    expect(await withdrawVenueApproval("2026-10")).toEqual({ success: "Approval withdrawn" })
    expect((prisma.venueUsageRequest.updateMany as jest.Mock).mock.calls[0][0].data).toEqual({ approvedAt: null, approvedById: null })
    ;(prisma.venueUsageRequest.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
    expect(await withdrawVenueApproval("2026-10")).toEqual({ error: "There is no approval to withdraw" })
  })
})
```
  Add to `venueUsage.test.ts`: `getVenueRequestPreview` returns `isCurrentMonth`, `autoSendLabel` (`"1 November, 9:00 AM"` for `2026-10`), `warnings` from `describeIncomplete`, `approval`, `canApprove`.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** `src/lib/actions/venueBookings.ts`:

```ts
"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { actorId } from "@/lib/actor"
import { canEdit } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { assertNotDemo } from "@/lib/demoMode"
import { isValidPgId } from "@/lib/validation"
import { sendVenueUsageRequestEmail } from "@/lib/email"
import { getChurchSettings } from "@/lib/churchSettings"
import { getEmailTemplate } from "@/lib/emailTemplateStore"
import { sydneyToday, sydneyTodayYMD } from "@/lib/dates"
import { readVenueUsageSettings } from "@/lib/venueUsageSettings"
import { MAX_ROWS_PER_MONTH, bookingRecipients, loadActor } from "@/lib/venueInvoice"
import { UNSENT_FILTER } from "@/lib/venueApproval"
import { autoSendLabel } from "@/lib/venueSchedule"
import {
  buildBookingRequestEmail, formatUsageLine, isValidMonth, monthCompleteness, monthRange, utcDateToYmd,
} from "@/lib/venueUsage"
```

```ts
export type BookingCandidate = { id: number; date: string; startTime: string; endTime: string; purpose: string | null }
export type BookingRequestPreview = {
  candidates: BookingCandidate[]
  selectedIds: number[]
  asked: { id: number; date: string; askedOn: string }[]
  booked: string[]
  subject: string
  text: string
  to: string
  cc: string
  replyTo: string
  blockedReason: string | null
}

/** Shared gate for the booking actions: role + feature. Returns the settings or an error. */
async function gate() { /* auth(), canEdit, readVenueUsageSettings().enabled */ }
```
  Write `gate()` concretely:

```ts
/**
 * Role + feature gate shared by the booking actions.
 * @returns the session, venue settings and acting user id, or `{ error }`
 */
async function gate() {
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" } as const
  const settings = await readVenueUsageSettings()
  if (!settings.enabled) return { error: "Venue usage is not enabled" } as const
  return { session, settings, userId: actorId(session) } as const
}

/** REQUESTED, not-yet-asked rows (all months), oldest first. */
function loadCandidates() {
  return prisma.venueUsage.findMany({
    where: { status: "REQUESTED", bookingRequestedAt: null },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
    take: MAX_ROWS_PER_MONTH,
    select: { id: true, date: true, startTime: true, endTime: true, purpose: true },
  })
}

/** CONFIRMED rows from today (Sydney) on: "already booked", for reference in the request. */
function loadBooked() {
  return prisma.venueUsage.findMany({
    where: { status: "CONFIRMED", date: { gte: sydneyToday() } },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
    take: MAX_ROWS_PER_MONTH,
    select: { date: true, startTime: true, endTime: true, status: true },
  })
}
```
  `getBookingRequestPreview(ids?)`: gate; candidates + asked + booked in `Promise.all` (asked: `where { status: "REQUESTED", bookingRequestedAt: { not: null }, date: { gte: sydneyToday() } }`, select `id,date,bookingRequestedAt`); `selected = ids ? candidates.filter(c => ids.includes(c.id)) : candidates`; build the email with `getEmailTemplate("venueBookingRequest")`, `getChurchSettings()`, `loadActor`; recipients from `bookingRecipients`; `blockedReason`: no `to` -> "Set the venue contact email in Settings first"; none selected -> "Tick at least one date"; else null. Map dates with `utcDateToYmd`; `askedOn` is the Sydney calendar date of the stamp (`sydneyTodayYMD(row.bookingRequestedAt)`), not the UTC date.
  `sendBookingRequest(ids)`:

```ts
export async function sendBookingRequest(ids: number[]): Promise<{ success: string } | { error: string }> {
  const demo = assertNotDemo()
  if (demo) return demo
  const g = await gate()
  if ("error" in g) return g
  if (ids.length === 0) return { error: "Tick at least one date" }
  if (ids.length > MAX_ROWS_PER_MONTH || !ids.every(isValidPgId)) return { error: "Invalid booking" }
  if (!g.settings.contactEmail) return { error: "Set the venue contact email in Settings first" }

  const [candidates, booked, actor, church, template] = await Promise.all([
    prisma.venueUsage.findMany({
      where: { id: { in: ids }, status: "REQUESTED", bookingRequestedAt: null },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
      select: { id: true, date: true, startTime: true, endTime: true, status: true },
    }),
    loadBooked(), loadActor(g.userId), getChurchSettings(), getEmailTemplate("venueBookingRequest"),
  ])
  if (candidates.length === 0) return { error: "Those dates were already requested. Refresh the page." }
  const claimedIds = candidates.map((c) => c.id)
  const claimAt = new Date()
  const claim = await prisma.venueUsage.updateMany({
    where: { id: { in: claimedIds }, status: "REQUESTED", bookingRequestedAt: null },
    data: { bookingRequestedAt: claimAt },
  })
  if (claim.count !== claimedIds.length) {
    if (claim.count > 0) await releaseClaim(claimedIds, claimAt)
    return { error: "Those dates were already requested. Refresh the page." }
  }
  const { to, cc, replyTo } = bookingRecipients(g.settings, actor)
  const mail = buildBookingRequestEmail({
    churchName: church.name, venueName: g.settings.venueName, contactName: g.settings.contactName,
    requested: candidates, booked, senderName: actor.name, template,
  })
  try {
    await sendVenueUsageRequestEmail({ to, cc: cc.length ? cc.join(", ") : undefined, replyTo: replyTo || undefined, ...mail })
  } catch {
    await releaseClaim(claimedIds, claimAt)
    await logAudit(g.userId, "VENUE_BOOKING_REQUEST_FAILED", "VenueUsage", undefined, { count: claimedIds.length, ids: claimedIds })
    return { error: "Could not send the email. Check email settings and try again." }
  }
  await logAudit(g.userId, "VENUE_BOOKING_REQUEST_SENT", "VenueUsage", undefined, { count: claimedIds.length, ids: claimedIds })
  revalidatePath("/venue-usage")
  return { success: `Booking request sent for ${claimedIds.length} ${claimedIds.length === 1 ? "date" : "dates"}` }
}

/** Put claimed rows back to "not yet asked" (only rows still stamped with this run's claim time). */
async function releaseClaim(ids: number[], claimAt: Date): Promise<void> {
  await prisma.venueUsage.updateMany({ where: { id: { in: ids }, bookingRequestedAt: claimAt }, data: { bookingRequestedAt: null } })
}
```
  (In the "double click" test the first `findMany` returns rows but the claim count is 0, matching the code. In the other tests `findMany` is called by `loadBooked` second.) `approveVenueMonth` and `withdrawVenueApproval`:

```ts
export async function approveVenueMonth(month: string): Promise<{ success: string } | { error: string }> {
  const g = await gate()
  if ("error" in g) return g
  if (!isValidMonth(month)) return { error: "Invalid month" }
  if (month !== sydneyTodayYMD().slice(0, 7)) return { error: "Only the current month can be approved" }
  if (!g.settings.contactEmail) return { error: "Set the venue contact email in Settings first" }
  const { start, end } = monthRange(month)
  const [rows, request] = await Promise.all([
    prisma.venueUsage.findMany({ where: { date: { gte: start, lte: end } }, take: MAX_ROWS_PER_MONTH, select: { date: true, status: true } }),
    prisma.venueUsageRequest.findUnique({ where: { month }, select: { status: true } }),
  ])
  if (request?.status === "SUCCESS") return { error: "The invoice request for this month was already sent" }
  if (!monthCompleteness(month, rows).complete) return { error: "The month is not complete yet" }
  const data = { approvedAt: new Date(), approvedById: g.userId }
  await prisma.venueUsageRequest.upsert({ where: { month }, create: { month, ...data }, update: data })
  await logAudit(g.userId, "VENUE_MONTH_APPROVED", "VenueUsageRequest", undefined, { month })
  revalidatePath("/venue-usage")
  return { success: `Approved: the invoice request will be sent on ${autoSendLabel(month)}` }
}

export async function withdrawVenueApproval(month: string): Promise<{ success: string } | { error: string }> {
  const g = await gate()
  if ("error" in g) return g
  if (!isValidMonth(month)) return { error: "Invalid month" }
  const { count } = await prisma.venueUsageRequest.updateMany({
    where: { month, approvedAt: { not: null }, ...UNSENT_FILTER },
    data: { approvedAt: null, approvedById: null },
  })
  if (count === 0) return { error: "There is no approval to withdraw" }
  await logAudit(g.userId, "VENUE_APPROVAL_WITHDRAWN", "VenueUsageRequest", undefined, { month })
  revalidatePath("/venue-usage")
  return { success: "Approval withdrawn" }
}
```
  Add JSDoc to each exported action (what, gates, params). In the test the AUDITOR gate returns `Unauthorized` before settings are read.

- [ ] **Step 4: Extend the invoice preview.** In `src/lib/actions/venueUsage.ts` add the new fields to `VenueRequestPreview` and in `getVenueRequestPreview` (after `blockedReason`):

```ts
  const isCurrentMonth = month === sydneyTodayYMD().slice(0, 7)
  const warnings = describeIncomplete(p.completeness)
  const sent = p.last?.status === "SUCCESS"
  return {
    ...existingFields,
    isCurrentMonth,
    autoSendLabel: autoSendLabel(month),
    approval: p.last?.approvedAt ? { approvedAt: p.last.approvedAt.toISOString(), approvedBy: p.last.approvedByName } : null,
    canApprove: isCurrentMonth && p.completeness.complete && !!p.to && !sent,
    warnings,
    autoSent: p.last?.autoSent ?? false,
  }
```
  (Extend the return object literal rather than spreading a name that does not exist.) `getVenueRequestPreview` previously passed `loadActor` through `prepareRequest`; it already uses `prepareInvoiceRequest` after Task 4.

- [ ] **Step 5: Register the new action file** in `CORE_ACTIONS` (`featureGuards.test.ts`): `"venueBookings.ts",` under the venue comment.

- [ ] **Step 6: Run** `npm test -- --testPathPatterns="venueBookings|venueUsage|featureGuards"`, `npx tsc --noEmit`, `npm run lint`. PASS.

- [ ] **Step 7: Commit**

```bash
git status -s
git add src/lib/actions/venueBookings.ts src/lib/actions/venueUsage.ts src/lib/__tests__/featureGuards.test.ts src/lib/actions/__tests__/venueBookings.test.ts src/lib/actions/__tests__/venueUsage.test.ts
git commit -m "feat(venue): booking request, month approval and richer invoice preview" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 7: Staff notices and the monthly job (size L)

**Files:**
- Create: `src/lib/venueNotices.ts`, `src/lib/venueInvoiceJob.ts`
- Test: `src/lib/__tests__/venueNotices.test.ts`, `src/lib/__tests__/venueInvoiceJob.test.ts`

**Interfaces**
- Consumes: `venueJobWindowOpen`, `venueInvoiceMonth` (Task 2); `prepareInvoiceRequest`, `deliverInvoiceRequest` (Task 4); `monthCompleteness`, `describeIncomplete`, `formatMonthLabel`, `formatHours`, `totalHours`, `escapeHtml`, `monthRange`; `readVenueUsageSettings`; `sendEmail(to, subject, html, text)`; `getChurchName()` (`emailTemplateStore.ts`); `FEATURE_OFF_SKIP` (`features.ts`); `logAudit`; `isP2002`; `UserRole`.
- Produces:
  - `buildReminderEmail(input: { churchName: string; month: string; problems: string[]; url: string | null }): { subject: string; text: string; html: string }`
  - `buildAutoSentEmail(input: { churchName: string; month: string; rowCount: number; totalHoursLabel: string }): { subject: string; text: string; html: string }` (subject `Invoice request for <Month Year> sent`)
  - `venuePageUrl(month: string): string | null` (absolute `/venue-usage?month=` from `AUTH_URL`, `null` when invalid)
  - `VENUE_JOB_LEASE_MS = 10 * 60_000`
  - `type VenueJobResult = { sent: number; notified: number; failed: number; inFlight: number }`
  - `runVenueInvoiceJob(now?: Date): Promise<VenueJobResult | typeof FEATURE_OFF_SKIP>`

**Job algorithm (spec "Monthly job")**
1. Window closed (`!venueJobWindowOpen(now)`) -> all-zero result (acts only on the 1st at >= 09:00 Sydney).
2. Feature disabled or no contact email -> `FEATURE_OFF_SKIP` (the runner then leaves the month open and does not spend an attempt, so enabling it later on the 1st still works).
3. `month = venueInvoiceMonth(now)`; ensure the `VenueUsageRequest` row exists (`upsert`, tolerating `P2002` from a racing instance).
4. Claim: `updateMany({ where: { month, reminderSentAt: null, OR: [{ reminderClaimedAt: null }, { reminderClaimedAt: { lt: now - 10 min } }] }, data: { reminderClaimedAt: claimAt } })`. Lost claim: `reminderSentAt` set -> all-zero (done); otherwise `inFlight: 1` (the runner retries on `inFlight > 0`). The lease is not renewed: the work is a handful of emails, far under 10 minutes, and an expired lease only lets a later tick resume.
5. `status === "SUCCESS"` -> release the claim, all-zero (no-op).
6. Approved AND still complete -> `prepareInvoiceRequest(month, null)` + `deliverInvoiceRequest(..., { userId: null, autoSent: true })`; FAILED -> release claim, `failed: 1`. SUCCESS -> staff notice "Invoice request for <month> sent".
7. Otherwise -> staff reminder listing what is missing (or "everything is recorded but not approved") with a link to the page.
8. Notices go to every active ADMIN/PASTOR/OFFICE_ADMIN (`archivedAt: null`), sequentially. If **every** send failed (`notified === 0 && failed > 0`) -> release the claim and report `failed` (retry). A partial failure is logged, not retried (spec gap 9).
9. Only then set `reminderSentAt = now` (`updateMany` fenced on `reminderClaimedAt = claimAt`). Any thrown error releases the claim (fenced) and rethrows.

- [ ] **Step 1: Failing tests** `src/lib/__tests__/venueNotices.test.ts`:

```ts
/** @jest-environment node */
import { buildAutoSentEmail, buildReminderEmail, venuePageUrl } from "@/lib/venueNotices"

describe("buildReminderEmail", () => {
  it("lists the problems, links to the page and escapes values", () => {
    const { subject, text, html } = buildReminderEmail({
      churchName: "Example <Church>", month: "2026-10",
      problems: ["1 date is still marked Requested", "No confirmed or cancelled booking for: Sunday, 4 October"],
      url: "https://app.example.com/venue-usage?month=2026-10",
    })
    expect(subject).toBe("Venue invoice request for October 2026 needs attention")
    expect(text).toContain("- 1 date is still marked Requested")
    expect(text).toContain("https://app.example.com/venue-usage?month=2026-10")
    expect(html).toContain("Example &lt;Church&gt;")
    expect(html).toContain('<a href="https://app.example.com/venue-usage?month=2026-10">')
  })
  it("omits the link when there is no URL", () => {
    expect(buildReminderEmail({ churchName: "Example Church", month: "2026-10", problems: ["x"], url: null }).html).not.toContain("<a ")
  })
})
describe("buildAutoSentEmail", () => {
  it("names the month, count and hours", () => {
    const { subject, text } = buildAutoSentEmail({ churchName: "Example Church", month: "2026-10", rowCount: 4, totalHoursLabel: "12 hours" })
    expect(subject).toBe("Invoice request for October 2026 sent")
    expect(text).toContain("4 confirmed dates, 12 hours")
  })
})
describe("venuePageUrl", () => {
  const old = process.env.AUTH_URL
  afterEach(() => { process.env.AUTH_URL = old })
  it("builds an absolute link and returns null for a bad base", () => {
    process.env.AUTH_URL = "https://app.example.com"
    expect(venuePageUrl("2026-10")).toBe("https://app.example.com/venue-usage?month=2026-10")
    process.env.AUTH_URL = "not a url"
    expect(venuePageUrl("2026-10")).toBeNull()
  })
})
```

- [ ] **Step 2: Implement** `src/lib/venueNotices.ts`:

```ts
import { escapeHtml, formatMonthLabel } from "@/lib/venueUsage"

/**
 * Absolute link to the venue bookings page for a month (base from AUTH_URL).
 * @param month "YYYY-MM"
 * @returns the URL, or null when AUTH_URL is not a valid URL
 */
export function venuePageUrl(month: string): string | null {
  try {
    const url = new URL("/venue-usage", process.env.AUTH_URL ?? "http://localhost:3000")
    url.searchParams.set("month", month)
    return url.toString()
  } catch {
    return null
  }
}

/**
 * Reminder to staff that last month's invoice request was NOT sent automatically, and why.
 * @param input church name, the month, human problems and the page link (or null)
 */
export function buildReminderEmail(input: { churchName: string; month: string; problems: string[]; url: string | null }): { subject: string; text: string; html: string } {
  const label = formatMonthLabel(input.month)
  const subject = `Venue invoice request for ${label} needs attention`
  const intro = `The invoice request to the venue for ${label} was not sent automatically. Please check the bookings and send it from the Venue bookings page.`
  const text = [intro, "", ...input.problems.map((p) => `- ${p}`), ...(input.url ? ["", input.url] : []), "", input.churchName].join("\n")
  const html = [
    `<p>${escapeHtml(intro)}</p>`,
    `<ul>${input.problems.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>`,
    ...(input.url ? [`<p><a href="${escapeHtml(input.url)}">Open Venue bookings</a></p>`] : []),
    `<p>${escapeHtml(input.churchName)}</p>`,
  ].join("\n")
  return { subject, text, html }
}

/**
 * Notice to staff that the invoice request went out automatically.
 * @param input church name, month, confirmed-date count and the total hours label (e.g. "12 hours")
 */
export function buildAutoSentEmail(input: { churchName: string; month: string; rowCount: number; totalHoursLabel: string }): { subject: string; text: string; html: string } {
  const label = formatMonthLabel(input.month)
  const subject = `Invoice request for ${label} sent`
  const body = `The invoice request for ${label} was sent to the venue automatically: ${input.rowCount} confirmed ${input.rowCount === 1 ? "date" : "dates"}, ${input.totalHoursLabel}.`
  return {
    subject,
    text: [body, "", input.churchName].join("\n"),
    html: `<p>${escapeHtml(body)}</p>\n<p>${escapeHtml(input.churchName)}</p>`,
  }
}
```
  Fix the reminder test's text assertion to match: `"4 confirmed dates, 12 hours"` appears in the sent notice body as written.

- [ ] **Step 3: Failing tests** `src/lib/__tests__/venueInvoiceJob.test.ts` (`/** @jest-environment node */`; mock `@/lib/prisma` (`venueUsageRequest.upsert/updateMany/findUnique`, `venueUsage.findMany`, `user.findMany`), `@/lib/venueUsageSettings`, `@/lib/venueInvoice` (`prepareInvoiceRequest`, `deliverInvoiceRequest`), `@/lib/email` (`sendEmail`), `@/lib/emailTemplateStore` (`getChurchName`), `@/lib/audit`). Instants: `OPEN = new Date("2026-10-31T22:00:00Z")` (1 Nov 09:00 AEDT, invoices October), `CLOSED = new Date("2026-10-31T21:00:00Z")`:

```ts
const ZERO = { sent: 0, notified: 0, failed: 0, inFlight: 0 }
const complete = ["04", "11", "18", "25"].map((d) => ({ date: new Date(`2026-10-${d}T00:00:00Z`), status: "CONFIRMED" }))
const staff = [{ email: "a@example.com" }, { email: "b@example.com" }]

beforeEach(() => {
  jest.resetAllMocks()
  ;(readVenueUsageSettings as jest.Mock).mockResolvedValue({ enabled: true, contactEmail: "venue@example.com", venueName: "Example Hall" })
  ;(prisma.venueUsageRequest.upsert as jest.Mock).mockResolvedValue({})
  ;(prisma.venueUsageRequest.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
  ;(prisma.venueUsageRequest.findUnique as jest.Mock).mockResolvedValue({ id: 3, status: null, approvedAt: null })
  ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue(complete)
  ;(prisma.user.findMany as jest.Mock).mockResolvedValue(staff)
  ;(getChurchName as jest.Mock).mockResolvedValue("Example Church")
  ;(prepareInvoiceRequest as jest.Mock).mockResolvedValue({ rows: complete })
  ;(deliverInvoiceRequest as jest.Mock).mockResolvedValue({ status: "SUCCESS", errorMessage: null })
})

it("does nothing outside the Sydney 1st >= 09:00 window", async () => {
  expect(await runVenueInvoiceJob(CLOSED)).toEqual(ZERO)
  expect(prisma.venueUsageRequest.updateMany).not.toHaveBeenCalled()
})
it("returns the feature-off skip (period stays open) when disabled or no contact email", async () => {
  ;(readVenueUsageSettings as jest.Mock).mockResolvedValue({ enabled: false, contactEmail: "x@example.com" })
  expect(await runVenueInvoiceJob(OPEN)).toEqual(FEATURE_OFF_SKIP)
  ;(readVenueUsageSettings as jest.Mock).mockResolvedValue({ enabled: true, contactEmail: "" })
  expect(await runVenueInvoiceJob(OPEN)).toEqual(FEATURE_OFF_SKIP)
})
it("claims the previous month with a stale-lease WHERE", async () => {
  await runVenueInvoiceJob(OPEN)
  const claim = (prisma.venueUsageRequest.updateMany as jest.Mock).mock.calls[0][0]
  expect(claim.where.month).toBe("2026-10")
  expect(claim.where.reminderSentAt).toBeNull()
  expect(claim.where.OR).toEqual([{ reminderClaimedAt: null }, { reminderClaimedAt: { lt: expect.any(Date) } }])
  const staleBefore: Date = claim.where.OR[1].reminderClaimedAt.lt
  expect(claim.data.reminderClaimedAt.getTime() - staleBefore.getTime()).toBe(VENUE_JOB_LEASE_MS)
})
it("a lost claim sends nothing and reports in-flight; an already-notified month is done", async () => {
  ;(prisma.venueUsageRequest.updateMany as jest.Mock).mockResolvedValueOnce({ count: 0 })
  ;(prisma.venueUsageRequest.findUnique as jest.Mock).mockResolvedValueOnce({ reminderSentAt: null })
  expect(await runVenueInvoiceJob(OPEN)).toEqual({ ...ZERO, inFlight: 1 })
  ;(prisma.venueUsageRequest.updateMany as jest.Mock).mockResolvedValueOnce({ count: 0 })
  ;(prisma.venueUsageRequest.findUnique as jest.Mock).mockResolvedValueOnce({ reminderSentAt: new Date() })
  expect(await runVenueInvoiceJob(OPEN)).toEqual(ZERO)
  expect(sendEmail).not.toHaveBeenCalled(); expect(deliverInvoiceRequest).not.toHaveBeenCalled()
})
it("two concurrent runs: only the claim winner works", async () => {
  ;(prisma.venueUsageRequest.updateMany as jest.Mock).mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 })
  ;(prisma.venueUsageRequest.findUnique as jest.Mock)
    .mockResolvedValueOnce({ id: 3, status: null, approvedAt: new Date() }) // winner's load
    .mockResolvedValueOnce({ reminderSentAt: null })                         // loser's check
  const [a, b] = await Promise.all([runVenueInvoiceJob(OPEN), runVenueInvoiceJob(OPEN)])
  expect(deliverInvoiceRequest).toHaveBeenCalledTimes(1)
  expect([a, b].filter((r) => (r as { inFlight: number }).inFlight === 1)).toHaveLength(1)
})
it("approved + complete: sends with autoSent, notifies staff, then sets reminderSentAt", async () => {
  ;(prisma.venueUsageRequest.findUnique as jest.Mock).mockResolvedValue({ id: 3, status: null, approvedAt: new Date() })
  const r = await runVenueInvoiceJob(OPEN)
  expect(r).toEqual({ sent: 1, notified: 2, failed: 0, inFlight: 0 })
  expect(deliverInvoiceRequest).toHaveBeenCalledWith(expect.anything(), { month: "2026-10", userId: null, autoSent: true, resend: false })
  expect((sendEmail as jest.Mock).mock.calls[0][1]).toBe("Invoice request for October 2026 sent")
  const calls = (prisma.venueUsageRequest.updateMany as jest.Mock).mock.calls
  const doneIdx = calls.findIndex((c) => c[0].data.reminderSentAt instanceof Date)
  expect(doneIdx).toBeGreaterThan(0)
  expect(calls[doneIdx][0].where.reminderClaimedAt).toBeInstanceOf(Date) // fenced on our claim
  expect((sendEmail as jest.Mock).mock.invocationCallOrder[1]).toBeLessThan((prisma.venueUsageRequest.updateMany as jest.Mock).mock.invocationCallOrder[doneIdx])
})
it("not approved: sends the reminder (what is missing / not approved), never the invoice", async () => {
  const r = await runVenueInvoiceJob(OPEN)
  expect(deliverInvoiceRequest).not.toHaveBeenCalled()
  expect(r).toEqual({ sent: 0, notified: 2, failed: 0, inFlight: 0 })
  expect((sendEmail as jest.Mock).mock.calls[0][1]).toBe("Venue invoice request for October 2026 needs attention")
  expect((sendEmail as jest.Mock).mock.calls[0][3]).toContain("not been approved")
})
it("approved but no longer complete: reminder lists the gap, no invoice", async () => {
  ;(prisma.venueUsageRequest.findUnique as jest.Mock).mockResolvedValue({ id: 3, status: null, approvedAt: new Date() })
  ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue(complete.slice(1))
  await runVenueInvoiceJob(OPEN)
  expect(deliverInvoiceRequest).not.toHaveBeenCalled()
  expect((sendEmail as jest.Mock).mock.calls[0][3]).toContain("Sunday, 4 October")
})
it("already sent (SUCCESS): releases the claim and does nothing", async () => {
  ;(prisma.venueUsageRequest.findUnique as jest.Mock).mockResolvedValue({ id: 3, status: "SUCCESS", approvedAt: new Date() })
  expect(await runVenueInvoiceJob(OPEN)).toEqual(ZERO)
  expect(sendEmail).not.toHaveBeenCalled()
  expect((prisma.venueUsageRequest.updateMany as jest.Mock).mock.calls.at(-1)[0].data).toEqual({ reminderClaimedAt: null })
})
it("a failed invoice send releases the claim, reports failed, and never sets reminderSentAt", async () => {
  ;(prisma.venueUsageRequest.findUnique as jest.Mock).mockResolvedValue({ id: 3, status: null, approvedAt: new Date() })
  ;(deliverInvoiceRequest as jest.Mock).mockResolvedValue({ status: "FAILED", errorMessage: "smtp" })
  expect(await runVenueInvoiceJob(OPEN)).toEqual({ sent: 0, notified: 0, failed: 1, inFlight: 0 })
  const datas = (prisma.venueUsageRequest.updateMany as jest.Mock).mock.calls.map((c) => c[0].data)
  expect(datas.some((d) => d.reminderSentAt)).toBe(false)
  expect(datas.at(-1)).toEqual({ reminderClaimedAt: null })
})
it("all notices failing keeps the month open; a partial failure does not", async () => {
  ;(sendEmail as jest.Mock).mockRejectedValue(new Error("smtp"))
  expect(await runVenueInvoiceJob(OPEN)).toMatchObject({ notified: 0, failed: 2 })
  ;(sendEmail as jest.Mock).mockReset().mockRejectedValueOnce(new Error("smtp")).mockResolvedValueOnce(undefined)
  expect(await runVenueInvoiceJob(OPEN)).toMatchObject({ notified: 1, failed: 0 })
})
it("a thrown error releases the claim and rethrows", async () => {
  ;(prisma.venueUsage.findMany as jest.Mock).mockRejectedValue(new Error("db"))
  await expect(runVenueInvoiceJob(OPEN)).rejects.toThrow("db")
  expect((prisma.venueUsageRequest.updateMany as jest.Mock).mock.calls.at(-1)[0].data).toEqual({ reminderClaimedAt: null })
})
```

- [ ] **Step 4: Run, expect FAIL**, then implement `src/lib/venueInvoiceJob.ts`:

```ts
import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { logger } from "@/lib/logger"
import { sendEmail } from "@/lib/email"
import { getChurchName } from "@/lib/emailTemplateStore"
import { FEATURE_OFF_SKIP } from "@/lib/features"
import { UserRole } from "@/lib/generated/prisma/enums"
import { isP2002 } from "@/lib/validation"
import { readVenueUsageSettings } from "@/lib/venueUsageSettings"
import { deliverInvoiceRequest, prepareInvoiceRequest, MAX_ROWS_PER_MONTH } from "@/lib/venueInvoice"
import { buildAutoSentEmail, buildReminderEmail, venuePageUrl } from "@/lib/venueNotices"
import { venueInvoiceMonth, venueJobWindowOpen } from "@/lib/venueSchedule"
import { describeIncomplete, formatHours, monthCompleteness, monthRange, totalHours } from "@/lib/venueUsage"

/** A claim older than this is treated as abandoned (the work is a few emails, so a live run never gets near it). */
export const VENUE_JOB_LEASE_MS = 10 * 60_000

/** `failed` and `inFlight` are what the scheduler retries on; `sent` = invoice requests emailed, `notified` = staff notices sent. */
export type VenueJobResult = { sent: number; notified: number; failed: number; inFlight: number }
const ZERO: VenueJobResult = { sent: 0, notified: 0, failed: 0, inFlight: 0 }

/** Create the month's request row if missing; a racing instance creating it first is fine. */
async function ensureRequestRow(month: string): Promise<void> {
  try {
    await prisma.venueUsageRequest.upsert({ where: { month }, create: { month }, update: {} })
  } catch (e) {
    if (!isP2002(e)) throw e
  }
}

/** Give the claim back (only if it is still ours) so a later tick can retry. */
async function releaseClaim(month: string, claimAt: Date): Promise<void> {
  await prisma.venueUsageRequest.updateMany({ where: { month, reminderClaimedAt: claimAt }, data: { reminderClaimedAt: null } })
}

/** Send one notice to every active editor, sequentially; counts only (never addresses in logs). */
async function notifyEditors(mail: { subject: string; html: string; text: string }): Promise<{ notified: number; failed: number }> {
  const users = await prisma.user.findMany({
    where: { role: { in: [UserRole.ADMIN, UserRole.PASTOR, UserRole.OFFICE_ADMIN] }, archivedAt: null },
    select: { email: true },
  })
  let notified = 0
  let failed = 0
  for (const to of Array.from(new Set(users.map((u) => u.email.trim().toLowerCase())))) {
    try {
      await sendEmail(to, mail.subject, mail.html, mail.text)
      notified++
    } catch {
      failed++
      logger.error("[venueInvoiceJob] notice send failed for one recipient")
    }
  }
  return { notified, failed }
}

/**
 * Monthly venue job, called by the scheduler. On the 1st (Sydney) from 09:00 it handles the previous month:
 * sends the invoice request when an admin approved it and the month is still complete, otherwise emails
 * the editors a reminder. Idempotent per month through a lease on `reminderClaimedAt` and a final `reminderSentAt`.
 * @param now run time
 */
export async function runVenueInvoiceJob(now: Date = new Date()): Promise<VenueJobResult | typeof FEATURE_OFF_SKIP> {
  if (!venueJobWindowOpen(now)) return ZERO
  const settings = await readVenueUsageSettings()
  if (!settings.enabled || !settings.contactEmail) return FEATURE_OFF_SKIP
  const month = venueInvoiceMonth(now)
  await ensureRequestRow(month)

  const claimAt = new Date(Math.max(Date.now(), now.getTime()))
  const staleBefore = new Date(claimAt.getTime() - VENUE_JOB_LEASE_MS)
  const claim = await prisma.venueUsageRequest.updateMany({
    where: { month, reminderSentAt: null, OR: [{ reminderClaimedAt: null }, { reminderClaimedAt: { lt: staleBefore } }] },
    data: { reminderClaimedAt: claimAt },
  })
  if (claim.count === 0) {
    const row = await prisma.venueUsageRequest.findUnique({ where: { month }, select: { reminderSentAt: true } })
    return row?.reminderSentAt ? ZERO : { ...ZERO, inFlight: 1 }
  }
  try {
    return await work(month, claimAt)
  } catch (e) {
    await releaseClaim(month, claimAt)
    throw e
  }
}

/** Steps 5 to 9 of the algorithm, run under a held claim. */
async function work(month: string, claimAt: Date): Promise<VenueJobResult> {
  const request = await prisma.venueUsageRequest.findUnique({ where: { month }, select: { id: true, status: true, approvedAt: true } })
  if (request?.status === "SUCCESS") {
    await releaseClaim(month, claimAt)
    return ZERO
  }
  const { start, end } = monthRange(month)
  const rows = await prisma.venueUsage.findMany({
    where: { date: { gte: start, lte: end } }, take: MAX_ROWS_PER_MONTH, select: { date: true, status: true },
  })
  const completeness = monthCompleteness(month, rows)
  const churchName = await getChurchName()

  let sent = 0
  let mail: { subject: string; html: string; text: string }
  if (request?.approvedAt && completeness.complete) {
    const prep = await prepareInvoiceRequest(month, null)
    const result = await deliverInvoiceRequest(prep, { month, userId: null, autoSent: true, resend: false })
    if (result.status === "FAILED") {
      await releaseClaim(month, claimAt)
      return { ...ZERO, failed: 1 }
    }
    sent = 1
    mail = buildAutoSentEmail({ churchName, month, rowCount: prep.rows.length, totalHoursLabel: formatHours(totalHours(prep.rows)) })
  } else {
    const problems = completeness.complete
      ? ["Everything is recorded, but the invoice request has not been approved for automatic sending."]
      : describeIncomplete(completeness)
    mail = buildReminderEmail({ churchName, month, problems, url: venuePageUrl(month) })
  }

  const { notified, failed } = await notifyEditors(mail)
  if (notified === 0 && failed > 0) {
    await releaseClaim(month, claimAt)
    return { sent, notified, failed, inFlight: 0 }
  }
  if (failed > 0) logger.error(`[venueInvoiceJob] ${failed} notice(s) failed; not retried to avoid repeats`)
  await prisma.venueUsageRequest.updateMany({ where: { month, reminderClaimedAt: claimAt }, data: { reminderSentAt: new Date() } })
  await logAudit(null, sent ? "VENUE_INVOICE_NOTICE_SENT" : "VENUE_REMINDER_SENT", "VenueUsageRequest", request?.id, { month, notified, failed })
  return { sent, notified, failed: 0, inFlight: 0 }
}
```
  Note the tests mock `prisma.user.findMany` only and `@/lib/logger` can be real. The "all notices failing" test expects `failed: 2` (two unique staff).

- [ ] **Step 5: Run** `npm test -- --testPathPatterns="venueNotices|venueInvoiceJob"`, `npx tsc --noEmit`, `npm run lint`. PASS.

- [ ] **Step 6: Commit**

```bash
git status -s
git add src/lib/venueNotices.ts src/lib/venueInvoiceJob.ts src/lib/__tests__/venueNotices.test.ts src/lib/__tests__/venueInvoiceJob.test.ts
git commit -m "feat(venue): monthly invoice-request job with approval, lease and staff notices" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 8: Register the job with the in-app scheduler (size S)

**Files:**
- Modify: `src/lib/scheduler.ts`, `src/lib/schedulerRunner.ts`
- Test: `src/lib/__tests__/scheduler.test.ts`, `src/lib/__tests__/schedulerRunner.test.ts`, `src/lib/__tests__/featureGuardBehaviour.test.ts` (mock only)

**Interfaces**
- Consumes: `venueJobWindowOpen` (Task 2), `runVenueInvoiceJob` (Task 7), `sydneyMonthKey`.
- Produces: `JobName` gains `"venueInvoice"` (appended LAST in `JOB_NAMES`, so existing `dueJobs` array expectations keep their order); `successKey("venueInvoice", now) === sydneyMonthKey(now)`; `Jobs` gains `venueInvoice`.

Cadence (see the section above): window = Sydney 1st from 09:00, spacing 30 min, 3 attempts per Sydney month (in-memory), success key = Sydney month. A feature-off result (`FEATURE_OFF_SKIP`) is not a success and refunds the attempt (already handled by `runJob`); `inFlight`/`failed` > 0 keep the month open (already handled by `reportsFailures`).

- [ ] **Step 1: Failing tests** in `scheduler.test.ts`. The shared `state()` helper must default the new job to "already done" like the clearance digest (so existing expectations on the 1st are unaffected): add `if (!("venueInvoice" in patch)) s.venueInvoice.lastSuccessKey = "2026-07"` next to the clearance line. Then:

```ts
describe("dueJobs — venue invoice (monthly, Sydney 1st from 09:00)", () => {
  // Sydney 1 Jul 2026 at h:m (AEST = UTC+10, so 09:00 is 30 Jun 23:00 UTC)
  const first = (h: number, m = 0) => new Date(Date.UTC(2026, 5, 30, 14 + h, m))
  const quiet = { reminders: { running: true }, checkouts: { running: true }, celebrations: { running: true }, clearanceDigest: { running: true } }
  const open = { venueInvoice: { lastSuccessKey: null }, ...quiet }
  it("is not due before 09:00 on the 1st", () => {
    expect(dueJobs(first(8, 55), state(open), {})).toEqual([])
  })
  it("is due from 09:00 on the 1st", () => {
    expect(dueJobs(first(9), state(open), {})).toEqual(["venueInvoice"])
  })
  it("is not due on the 2nd or later", () => {
    expect(dueJobs(new Date(Date.UTC(2026, 6, 1, 23, 0)), state(open), {})).toEqual([]) // 2 Jul 09:00 AEST
  })
  it("is not due again after a success this Sydney month, but is next month", () => {
    expect(dueJobs(first(10), state({ ...quiet, venueInvoice: { lastSuccessKey: "2026-07" } }), {})).toEqual([])
    expect(successKey("venueInvoice", first(10))).toBe("2026-07")
  })
  it("retries 30 min apart and stops after 3 attempts that month", () => {
    const s = state(open)
    let t = first(9).getTime()
    for (let i = 0; i < 3; i++) {
      expect(dueJobs(new Date(t), s, {})).toEqual(["venueInvoice"])
      recordStart("venueInvoice", s, new Date(t))
      t += 30 * MIN
    }
    expect(dueJobs(new Date(t), s, {})).toEqual([])
  })
})
```
  In `schedulerRunner.test.ts` add `venueInvoice: jest.fn(async () => ({}))` to the `jobs()` factory, plus a test:

```ts
it("runs the venue invoice job on the 1st from 09:00 and records the month; in-flight keeps it open", async () => {
  const s = initialState()
  const j = jobs({ venueInvoice: jest.fn(async () => ({ sent: 0, notified: 0, failed: 0, inFlight: 1 })) })
  const at9 = new Date("2026-06-30T23:00:00Z") // 1 Jul 09:00 AEST
  await tick(s, j, at9)
  expect(j.venueInvoice).toHaveBeenCalledWith(at9)
  expect(s.venueInvoice.lastSuccessKey).toBeNull() // inFlight > 0 => retry
  j.venueInvoice = jest.fn(async () => ({ sent: 1, notified: 2, failed: 0, inFlight: 0 }))
  await tick(s, j, new Date("2026-06-30T23:30:00Z"))
  expect(s.venueInvoice.lastSuccessKey).toBe("2026-07")
})
```
  In `featureGuardBehaviour.test.ts` add `jest.mock("@/lib/venueInvoiceJob", () => ({ runVenueInvoiceJob: jest.fn() }))` next to the other job mocks (it imports `DEFAULT_JOBS`; the dynamic import must resolve). Do NOT add a feature-gate test for this job: it is not a `FEATURES` flag.

- [ ] **Step 2: Run, expect FAIL**, then implement. `scheduler.ts`: add `"venueInvoice"` to `JobName`, to `JOB_NAMES` (last) and to `initialState()`; `successKey`: `if (job === "venueInvoice") return sydneyMonthKey(now)`; in `windowOpen`, BEFORE the error-digest fallthrough:

```ts
  // Monthly: only the Sydney 1st from 09:00 (venueSchedule.ts owns the rule). The Sydney-month success
  // key sends once; the 3-attempt cap applies per Sydney month. No env flag: the job itself no-ops
  // (and stays open) until an admin enables venue usage and sets a contact email.
  if (job === "venueInvoice") return venueJobWindowOpen(now)
```
  with `import { venueJobWindowOpen } from "@/lib/venueSchedule"` (no cycle: `venueSchedule` imports `dates` and `venueUsage` only). Update the file's top docblock sentence listing period jobs. `schedulerRunner.ts` `DEFAULT_JOBS`:

```ts
  // Not gated by a FEATURES flag: runVenueInvoiceJob checks venueUsage.enabled itself and returns the
  // feature-off skip so the month stays open.
  venueInvoice: async (now) => (await import("@/lib/venueInvoiceJob")).runVenueInvoiceJob(now),
```

- [ ] **Step 3: Run** `npm test -- --testPathPatterns="scheduler|featureGuardBehaviour"`, `npx tsc --noEmit`, `npm run lint`. PASS.

- [ ] **Step 4: Commit**

```bash
git status -s
git add src/lib/scheduler.ts src/lib/schedulerRunner.ts src/lib/__tests__/scheduler.test.ts src/lib/__tests__/schedulerRunner.test.ts src/lib/__tests__/featureGuardBehaviour.test.ts
git commit -m "feat(venue): register the monthly venue invoice job in the in-app scheduler" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 9: Admin list, bulk actions, add-all-Sundays, cancel dialog, rename to "Venue bookings" (size L)

**Files:**
- Create: `src/components/venue-usage/BookingList.tsx`
- Modify: `src/components/venue-usage/VenueUsageClient.tsx`, `src/app/(dashboard)/venue-usage/page.tsx`, `src/components/layout/sidebar/navData.ts`, `src/components/settings/VenueUsageSettingsForm.tsx` (copy only)
- Test: `src/components/venue-usage/__tests__/BookingList.test.tsx`, `src/components/venue-usage/__tests__/VenueUsageClient.test.tsx`

**Interfaces**
- Consumes: `setVenueUsageStatus`, `addAllSundays`, `deleteVenueUsage`, `type VenueMutationResult` (Task 5); `AlertDialog*` (`@/components/ui/alert-dialog`); `Badge`, `Button`, `Checkbox` (`@/components/ui/checkbox`); `DeleteConfirmButton`.
- Produces:
  - `VenueUsageRowView` gains `bookingRequestedAt: string | null` (ISO date-time)
  - `BookingList(props: { rows: VenueUsageRowView[]; onEdit: (r: VenueUsageRowView) => void; onResult: (r: VenueMutationResult | undefined) => void }): JSX.Element`
  - `VenueUsageClient` shows `Approval cleared — dates changed, please re-approve` (`role="status"`) whenever any mutation result has `approvalCleared`.

**UI rules**
- Rename the nav label (`"Venue Usage"` -> `"Venue bookings"`), the page `<h1>`, the settings card title/description/switch label ("Enable venue bookings", "Adds a Venue bookings page to the sidebar for editors."). The route stays `/venue-usage`.
- Row: checkbox (accessible name `Select <date>`), status badge, date, time and hours, purpose, `asked on <date>` when `bookingRequestedAt` and status REQUESTED, Edit, Cancel (hidden when already CANCELLED), Delete.
- Bulk bar appears when 1+ selected: `Mark confirmed` and `Cancel` (opens the same dialog) plus a count. Cards below `md` (existing `flex-col sm:flex-row` pattern); touch targets >= 36px.
- Cancel dialog: title "Cancel N date(s)?", text "Email venue about this cancellation?", actions `Cancel and email venue`, `Cancel without emailing`, and a dismiss `Keep bookings`.
- Add form (existing): next to "Add booking", while adding (not editing), a secondary button `Add all Sundays in <Month Year>` calling `addAllSundays({ month, startTime, endTime, purpose })` with the form's times/purpose.

- [ ] **Step 1: Failing tests** `BookingList.test.tsx` (jsdom; mock `@/lib/actions/venueUsage` and `next/navigation`):

```tsx
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { BookingList } from "@/components/venue-usage/BookingList"
import { setVenueUsageStatus } from "@/lib/actions/venueUsage"

jest.mock("@/lib/actions/venueUsage", () => ({ setVenueUsageStatus: jest.fn(), deleteVenueUsage: jest.fn() }))
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }) }))

const rows = [
  { id: 1, date: "2026-11-01", startTime: "17:00", endTime: "20:00", status: "REQUESTED" as const, purpose: "Service", notes: null, bookingRequestedAt: null },
  { id: 2, date: "2026-11-08", startTime: "17:00", endTime: "20:00", status: "REQUESTED" as const, purpose: null, notes: null, bookingRequestedAt: "2026-10-20T01:00:00.000Z" },
  { id: 3, date: "2026-11-15", startTime: "17:00", endTime: "20:00", status: "CANCELLED" as const, purpose: null, notes: null, bookingRequestedAt: null },
]
const setup = () => { const onResult = jest.fn(); render(<BookingList rows={rows} onEdit={jest.fn()} onResult={onResult} />); return onResult }
beforeEach(() => (setVenueUsageStatus as jest.Mock).mockResolvedValue({ success: "ok" }))

it("shows 'asked on' only for requested rows that were included in a request, and no Cancel on cancelled rows", () => {
  setup()
  expect(screen.getByText(/asked on Tue 20 Oct 2026/i)).toBeInTheDocument()
  expect(screen.getAllByText(/asked on/i)).toHaveLength(1)
  expect(screen.getAllByRole("button", { name: /^cancel$/i })).toHaveLength(2)
})
it("bulk 'Mark confirmed' sends the selected ids", async () => {
  const user = userEvent.setup(); const onResult = setup()
  await user.click(screen.getByRole("checkbox", { name: /select sunday, 1 november/i }))
  await user.click(screen.getByRole("checkbox", { name: /select sunday, 8 november/i }))
  await user.click(screen.getByRole("button", { name: /mark confirmed/i }))
  await waitFor(() => expect(setVenueUsageStatus).toHaveBeenCalledWith([1, 2], "CONFIRMED"))
  expect(onResult).toHaveBeenCalledWith({ success: "ok" })
})
it("cancelling asks whether to email the venue and passes the choice", async () => {
  const user = userEvent.setup(); setup()
  await user.click(screen.getAllByRole("button", { name: /^cancel$/i })[0])
  expect(screen.getByText(/email venue about this cancellation/i)).toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: /cancel and email venue/i }))
  await waitFor(() => expect(setVenueUsageStatus).toHaveBeenCalledWith([1], "CANCELLED", { emailVenue: true }))
  await user.click(screen.getAllByRole("button", { name: /^cancel$/i })[0])
  await user.click(screen.getByRole("button", { name: /cancel without emailing/i }))
  await waitFor(() => expect(setVenueUsageStatus).toHaveBeenLastCalledWith([1], "CANCELLED", { emailVenue: false }))
})
it("surfaces a warning from the action", async () => {
  ;(setVenueUsageStatus as jest.Mock).mockResolvedValue({ success: "Cancelled 1 date", warning: "Could not email the venue." })
  const user = userEvent.setup(); setup()
  await user.click(screen.getAllByRole("button", { name: /^cancel$/i })[0])
  await user.click(screen.getByRole("button", { name: /cancel without emailing/i }))
  expect(await screen.findByText(/could not email the venue/i)).toBeInTheDocument()
})
```
  `VenueUsageClient.test.tsx`: mock the actions and `BookingList`-independent bits; assert (a) the add-all button label `Add all Sundays in November 2026` calls `addAllSundays({ month: "2026-11", startTime: "17:00", endTime: "20:00", purpose: "" })`; (b) a result with `approvalCleared: true` (from `createVenueUsage`) renders the `status` text `Approval cleared`. ("asked on" renders `formatSydneyDate`, e.g. `Tue 20 Oct 2026`.)

- [ ] **Step 2: Run, expect FAIL**: `npm test -- --testPathPatterns="BookingList|VenueUsageClient"`.

- [ ] **Step 3: Implement** `src/components/venue-usage/BookingList.tsx`:

```tsx
"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { deleteVenueUsage, setVenueUsageStatus, type VenueMutationResult } from "@/lib/actions/venueUsage"
import { formatSydneyDate } from "@/lib/dates"
import {
  durationHours, formatHours, formatTime12, formatUsageDate, validateTimeRange, ymdToUtcDate,
  type VenueBookingStatusValue,
} from "@/lib/venueUsage"
import type { VenueUsageRowView } from "./VenueUsageClient"

const STATUS_LABEL: Record<VenueBookingStatusValue, string> = { REQUESTED: "Requested", CONFIRMED: "Confirmed", CANCELLED: "Cancelled" }
const STATUS_VARIANT: Record<VenueBookingStatusValue, "default" | "outline" | "destructive"> = { REQUESTED: "outline", CONFIRMED: "default", CANCELLED: "destructive" }

/** Human duration of a row, or "" when its times are invalid. */
function rowHours(r: { startTime: string; endTime: string }): string {
  return validateTimeRange(r.startTime, r.endTime) ? "" : formatHours(durationHours(r.startTime, r.endTime))
}

/**
 * Booking list for one month with selection, bulk "Mark confirmed" / "Cancel", per-row Edit/Cancel/Delete
 * and the "email the venue about this cancellation?" dialog.
 * @param props rows, edit callback and a callback that receives every mutation result
 */
export function BookingList({ rows, onEdit, onResult }: Readonly<{
  rows: VenueUsageRowView[]
  onEdit: (r: VenueUsageRowView) => void
  onResult: (r: VenueMutationResult | undefined) => void
}>) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [cancelIds, setCancelIds] = useState<number[] | null>(null)
  const [message, setMessage] = useState<VenueMutationResult | undefined>()
  const [pending, startTransition] = useTransition()

  function toggle(id: number) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function run(ids: number[], status: "CONFIRMED" | "CANCELLED", emailVenue?: boolean) {
    startTransition(async () => {
      const r = status === "CANCELLED" ? await setVenueUsageStatus(ids, status, { emailVenue: !!emailVenue }) : await setVenueUsageStatus(ids, status)
      setMessage(r)
      onResult(r)
      setCancelIds(null)
      if ("success" in r) {
        setSelected(new Set())
        router.refresh()
      }
    })
  }

  const ids = Array.from(selected)
  return (
    <div className="space-y-3">
      {ids.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2 text-sm">
          <span className="font-medium">{ids.length} selected</span>
          <Button size="sm" disabled={pending} onClick={() => run(ids, "CONFIRMED")}>Mark confirmed</Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => setCancelIds(ids)}>Cancel</Button>
        </div>
      )}
      {message && "error" in message && <p role="alert" className="text-sm text-destructive">{message.error}</p>}
      {message && "success" in message && (
        <p role="status" className="text-sm text-muted-foreground">
          {message.success}
          {message.warning && <span className="block text-destructive">{message.warning}</span>}
        </p>
      )}
      <ul className="divide-y">
        {rows.map((r) => {
          const label = formatUsageDate(ymdToUtcDate(r.date))
          return (
            <li key={r.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 gap-3">
                <input type="checkbox" className="mt-1 size-5 shrink-0 accent-primary" aria-label={`Select ${label}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{label}</span>
                    <Badge variant={STATUS_VARIANT[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                    {r.status === "REQUESTED" && r.bookingRequestedAt && (
                      <span className="text-xs text-muted-foreground">asked on {formatSydneyDate(new Date(r.bookingRequestedAt))}</span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{formatTime12(r.startTime)} – {formatTime12(r.endTime)} ({rowHours(r)})</p>
                  {r.purpose && <p className="text-sm">{r.purpose}</p>}
                  {r.notes && <p className="break-words text-xs text-muted-foreground">{r.notes}</p>}
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button variant="ghost" size="sm" onClick={() => onEdit(r)}>Edit</Button>
                {r.status !== "CANCELLED" && <Button variant="ghost" size="sm" disabled={pending} onClick={() => setCancelIds([r.id])}>Cancel</Button>}
                <DeleteConfirmButton
                  title="Delete this booking?"
                  description={`${label} will be removed from the log.`}
                  onConfirm={async () => {
                    const res = await deleteVenueUsage(r.id)
                    onResult(res)
                    return "error" in res ? res : undefined
                  }}
                />
              </div>
            </li>
          )
        })}
      </ul>
      <AlertDialog open={cancelIds !== null} onOpenChange={(open) => !open && setCancelIds(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel {cancelIds?.length} {cancelIds?.length === 1 ? "date" : "dates"}?</AlertDialogTitle>
            <AlertDialogDescription>Email venue about this cancellation?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:flex-wrap">
            <AlertDialogCancel>Keep bookings</AlertDialogCancel>
            <AlertDialogAction variant="outline" onClick={() => cancelIds && run(cancelIds, "CANCELLED", false)}>Cancel without emailing</AlertDialogAction>
            <AlertDialogAction onClick={() => cancelIds && run(cancelIds, "CANCELLED", true)}>Cancel and email venue</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
```
  (`AlertDialogAction` accepts `variant`/`size`. "asked on" uses `formatSydneyDate` because `bookingRequestedAt` is an instant: the UTC-based `formatDMY` would show the wrong day for Sydney evenings.)
  `VenueUsageClient.tsx`: remove the inline `<ul>` list, `STATUS_*` maps, `rowHours` and `errorOnly` use for rows; import `BookingList`; add `bookingRequestedAt: string | null` to `VenueUsageRowView`; add state `const [approvalCleared, setApprovalCleared] = useState(false)` and

```tsx
  function handleResult(r: VenueMutationResult | undefined) {
    if (r && "success" in r && r.approvalCleared) setApprovalCleared(true)
  }
```
  called from `BookingList onResult` and from `submit` (after `createVenueUsage`/`updateVenueUsage`) and the add-all handler; render `{approvalCleared && <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">Approval cleared — dates changed, please re-approve.</p>}` above the list. Add the add-all button inside the form's button row:

```tsx
            {form.id === null && (
              <Button type="button" variant="outline" disabled={pending} onClick={addAll}>
                Add all Sundays in {formatMonthLabel(month)}
              </Button>
            )}
```
```tsx
  function addAll() {
    startTransition(async () => {
      const result = await addAllSundays({ month, startTime: form.startTime, endTime: form.endTime, purpose: form.purpose })
      setFormState(result)
      handleResult(result)
      if (result && "success" in result) router.refresh()
    })
  }
```
  `page.tsx`: add `bookingRequestedAt: true` to the `select`, map `bookingRequestedAt: r.bookingRequestedAt?.toISOString() ?? null`, and change the `<h1>` to `Venue bookings` and the intro to "Plan and confirm dates at {venue}, ask the venue to book them, then request the monthly invoice. Only confirmed bookings are counted in the invoice request." `navData.ts`: label `"Venue bookings"`. Settings form copy as listed in UI rules (the `Switch`/label text only).

- [ ] **Step 4: Run** `npm test -- --testPathPatterns="BookingList|VenueUsageClient|navData|Sidebar|settings/page"`, `npx tsc --noEmit`, `npm run lint`. Then run the app (`npm run dev` with a local DB, see `.claude.local.md`), seed a few rows, and screenshot `/venue-usage` at 375px and 1920px: no horizontal scroll, buttons wrap, dialog readable. Record "manual check done" in the PR description.

- [ ] **Step 5: Commit**

```bash
git status -s
git add src/components/venue-usage src/app/\(dashboard\)/venue-usage/page.tsx src/components/layout/sidebar/navData.ts src/components/settings/VenueUsageSettingsForm.tsx
git commit -m "feat(venue): bulk confirm/cancel, add all Sundays, cancellation email prompt; rename to Venue bookings" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 10: Booking-request panel and invoice panel with approval (size L)

**Files:**
- Create: `src/components/venue-usage/BookingRequestPanel.tsx`, `src/components/venue-usage/InvoiceRequestPanel.tsx`
- Modify: `src/components/venue-usage/VenueUsageClient.tsx` (remove the inline `RequestPanel`, render the two panels)
- Test: `src/components/venue-usage/__tests__/BookingRequestPanel.test.tsx`, `src/components/venue-usage/__tests__/InvoiceRequestPanel.test.tsx`

**Interfaces**
- Consumes: `getBookingRequestPreview`, `sendBookingRequest`, `approveVenueMonth`, `withdrawVenueApproval` (Task 6); `getVenueRequestPreview`, `sendVenueUsageRequest`, `type VenueRequestPreview` (Task 6 fields); `DeleteConfirmButton`, `FormFeedback`, `Badge`.
- Produces: `BookingRequestPanel(): JSX.Element` (no props; loads its own data); `InvoiceRequestPanel(props: { defaultMonth: string }): JSX.Element`.

**UI rules**
- Booking panel: heading "Send booking request"; list of candidates as checkboxes (all ticked on load; label = `formatUsageDate` + times); reloads the preview with the ticked ids on every change; "Already asked" list (`asked on <date>`); To / CC / Replies go to / Subject; plain-text preview (`<pre>`) including the "already booked" section; `Send request` uses `DeleteConfirmButton` confirm and calls `sendBookingRequest(ids)`; disabled with the `blockedReason` text. Empty state: "No new dates to request."
- Invoice panel = the existing panel (month input, last-sent badge, To/CC/Replies/Subject, preview, Send/Send again) plus: a `warnings` list (`role="alert"` style, amber) above the preview; an "Automatic send" section shown only when `preview.isCurrentMonth`: when `approval` is null, `Approve automatic send on <autoSendLabel>` (disabled with explanation text when `!canApprove`; opens a confirm dialog showing the preview text, then `approveVenueMonth`); when approved, "Approved by <name> on <date>; will be sent on <autoSendLabel>" and `Withdraw approval` (`withdrawVenueApproval`); after a send, "Sent automatically" when `autoSent`.

- [ ] **Step 1: Failing tests.** `BookingRequestPanel.test.tsx` (mock `@/lib/actions/venueBookings`; `getBookingRequestPreview` resolves a preview with candidates `[{id:1,date:"2026-11-01",...},{id:2,date:"2026-11-08",...}]`, `selectedIds:[1,2]`, `asked:[{id:3,date:"2026-10-25",askedOn:"2026-10-20"}]`, `booked:[...]`, `text:"Hello Pat..."`, `to:"venue@example.com"`, `blockedReason:null`):

```tsx
it("ticks every new date by default and lists already-asked dates with the asked-on date", async () => {
  render(<BookingRequestPanel />)
  expect(await screen.findByRole("checkbox", { name: /sunday, 1 november/i })).toBeChecked()
  expect(screen.getByRole("checkbox", { name: /sunday, 8 november/i })).toBeChecked()
  expect(screen.getByText(/asked on Tuesday, 20 October/i)).toBeInTheDocument()
})
it("reloads the preview with only the ticked dates", async () => {
  const user = userEvent.setup(); render(<BookingRequestPanel />)
  await user.click(await screen.findByRole("checkbox", { name: /sunday, 1 november/i }))
  await waitFor(() => expect(getBookingRequestPreview).toHaveBeenLastCalledWith([2]))
})
it("sends the ticked ids after confirmation and shows the result", async () => {
  ;(sendBookingRequest as jest.Mock).mockResolvedValue({ success: "Booking request sent for 2 dates" })
  const user = userEvent.setup(); render(<BookingRequestPanel />)
  await user.click(await screen.findByRole("button", { name: /send request/i }))
  await user.click(await screen.findByRole("button", { name: /^send$/i }))
  await waitFor(() => expect(sendBookingRequest).toHaveBeenCalledWith([1, 2]))
})
it("disables sending and explains why when blocked", async () => {
  ;(getBookingRequestPreview as jest.Mock).mockResolvedValue({ ...preview, selectedIds: [], blockedReason: "Tick at least one date" })
  render(<BookingRequestPanel />)
  expect(await screen.findByText("Tick at least one date")).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: /send request/i })).not.toBeInTheDocument()
})
it("shows an empty state when there is nothing to request", async () => {
  ;(getBookingRequestPreview as jest.Mock).mockResolvedValue({ ...preview, candidates: [], selectedIds: [], blockedReason: "Tick at least one date" })
  render(<BookingRequestPanel />)
  expect(await screen.findByText(/no new dates to request/i)).toBeInTheDocument()
})
```
  `InvoiceRequestPanel.test.tsx` (mock `@/lib/actions/venueUsage` + `@/lib/actions/venueBookings`; a base `preview` with `month:"2026-10"`, `isCurrentMonth:true`, `autoSendLabel:"1 November, 9:00 AM"`, `approval:null`, `canApprove:true`, `warnings:[]`, `last:null`, `blockedReason:null`, text etc.):

```tsx
it("shows warnings above the preview", async () => {
  ;(getVenueRequestPreview as jest.Mock).mockResolvedValue({ ...preview, canApprove: false, warnings: ["1 date is still marked Requested"] })
  render(<InvoiceRequestPanel defaultMonth="2026-10" />)
  expect(await screen.findByText("1 date is still marked Requested")).toBeInTheDocument()
})
it("hides the automatic-send section for a month that is not the current one", async () => {
  ;(getVenueRequestPreview as jest.Mock).mockResolvedValue({ ...preview, isCurrentMonth: false })
  render(<InvoiceRequestPanel defaultMonth="2026-09" />)
  await screen.findByText(/last request|confirmed booking/i)
  expect(screen.queryByRole("button", { name: /approve automatic send/i })).not.toBeInTheDocument()
})
it("approve is disabled until the month is complete and explains why", async () => {
  ;(getVenueRequestPreview as jest.Mock).mockResolvedValue({ ...preview, canApprove: false, warnings: ["x"] })
  render(<InvoiceRequestPanel defaultMonth="2026-10" />)
  expect(await screen.findByRole("button", { name: /approve automatic send on 1 november, 9:00 am/i })).toBeDisabled()
  expect(screen.getByText(/complete every sunday/i)).toBeInTheDocument()
})
it("approves after a confirm dialog that shows the email preview", async () => {
  ;(approveVenueMonth as jest.Mock).mockResolvedValue({ success: "Approved" })
  const user = userEvent.setup(); render(<InvoiceRequestPanel defaultMonth="2026-10" />)
  await user.click(await screen.findByRole("button", { name: /approve automatic send/i }))
  expect(await screen.findByText(/Hello Pat/)).toBeInTheDocument() // preview text inside the dialog
  await user.click(screen.getByRole("button", { name: /^approve$/i }))
  await waitFor(() => expect(approveVenueMonth).toHaveBeenCalledWith("2026-10"))
})
it("shows who approved and lets the approval be withdrawn", async () => {
  ;(getVenueRequestPreview as jest.Mock).mockResolvedValue({ ...preview, approval: { approvedAt: "2026-10-24T01:00:00.000Z", approvedBy: "Sam Admin" } })
  ;(withdrawVenueApproval as jest.Mock).mockResolvedValue({ success: "Approval withdrawn" })
  const user = userEvent.setup(); render(<InvoiceRequestPanel defaultMonth="2026-10" />)
  expect(await screen.findByText(/approved by sam admin/i)).toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: /withdraw approval/i }))
  await waitFor(() => expect(withdrawVenueApproval).toHaveBeenCalledWith("2026-10"))
})
it("still offers Send / Send again and passes the resend flag", async () => {
  ;(getVenueRequestPreview as jest.Mock).mockResolvedValue({ ...preview, last: { status: "SUCCESS", sentAt: "2026-10-01T00:00:00.000Z", errorMessage: null } })
  ;(sendVenueUsageRequest as jest.Mock).mockResolvedValue({ success: "Invoice request sent" })
  const user = userEvent.setup(); render(<InvoiceRequestPanel defaultMonth="2026-10" />)
  await user.click(await screen.findByRole("button", { name: /send again/i }))
  await user.click(await screen.findByRole("button", { name: /^send$/i }))
  await waitFor(() => expect(sendVenueUsageRequest).toHaveBeenCalledWith("2026-10", true))
})
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement.** `BookingRequestPanel.tsx`:

```tsx
"use client"

import { useCallback, useEffect, useState } from "react"
import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { getBookingRequestPreview, sendBookingRequest, type BookingRequestPreview } from "@/lib/actions/venueBookings"
import { formatTime12, formatUsageDate, ymdToUtcDate } from "@/lib/venueUsage"

/**
 * "Send booking request" panel: tick the new REQUESTED dates, preview the email (new dates plus
 * already-booked dates), then send. Dates already asked about show "asked on <date>".
 */
export function BookingRequestPanel() {
  const [preview, setPreview] = useState<BookingRequestPreview | null>(null)
  const [ticked, setTicked] = useState<number[] | null>(null) // null = use the server default (all)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [result, setResult] = useState<{ error?: string; success?: string } | undefined>()

  const load = useCallback(async (ids?: number[]) => {
    const p = await getBookingRequestPreview(ids)
    if ("error" in p) { setLoadError(p.error); return }
    setLoadError(null)
    setPreview(p)
    setTicked(p.selectedIds)
  }, [])

  useEffect(() => { void load() }, [load])

  function toggle(id: number) {
    const current = ticked ?? []
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    setTicked(next)
    void load(next)
  }

  async function send() {
    const r = await sendBookingRequest(ticked ?? [])
    setResult(r)
    await load()
    return "error" in r ? r : undefined
  }

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <h2 className="text-lg font-medium">Send booking request</h2>
      {loadError && <p role="alert" className="text-sm text-destructive">{loadError}</p>}
      {preview && (
        <div className="space-y-3">
          {preview.candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No new dates to request.</p>
          ) : (
            <ul className="space-y-1">
              {preview.candidates.map((c) => {
                const label = formatUsageDate(ymdToUtcDate(c.date))
                return (
                  <li key={c.id}>
                    <label className="flex items-center gap-2 py-1 text-sm">
                      <input type="checkbox" className="size-5 accent-primary" aria-label={label} checked={(ticked ?? []).includes(c.id)} onChange={() => toggle(c.id)} />
                      <span>{label}, {formatTime12(c.startTime)} – {formatTime12(c.endTime)}</span>
                      {c.purpose && <span className="text-muted-foreground">({c.purpose})</span>}
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
          {preview.asked.length > 0 && (
            <ul className="text-sm text-muted-foreground">
              {preview.asked.map((a) => (
                <li key={a.id}>{formatUsageDate(ymdToUtcDate(a.date))}: asked on {formatUsageDate(ymdToUtcDate(a.askedOn))}</li>
              ))}
            </ul>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">To</dt><dd className="break-all">{preview.to || "Not set"}</dd>
            {preview.cc && (<><dt className="text-muted-foreground">CC</dt><dd className="break-all">{preview.cc}</dd></>)}
            <dt className="text-muted-foreground">Replies go to</dt><dd className="break-all">{preview.replyTo || "Not set"}</dd>
            <dt className="text-muted-foreground">Subject</dt><dd className="break-words">{preview.subject}</dd>
          </dl>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-3 text-sm">{preview.text}</pre>
          {preview.blockedReason ? (
            <p className="text-sm text-muted-foreground">{preview.blockedReason}</p>
          ) : (
            <DeleteConfirmButton
              title="Send booking request?"
              description={`This emails ${preview.to} asking to book ${(ticked ?? []).length} ${(ticked ?? []).length === 1 ? "date" : "dates"}.`}
              triggerLabel="Send request" triggerVariant="default" triggerSize="default" triggerClassName=""
              confirmLabel="Send" pendingLabel="Sending…" onConfirm={send}
            />
          )}
          {result && <FormFeedback state={result} />}
        </div>
      )}
    </section>
  )
}
```
  `InvoiceRequestPanel.tsx`: move the existing `RequestPanel` from `VenueUsageClient.tsx` verbatim (rename, `defaultMonth` prop), then add: (a) after the "N confirmed bookings" line,

```tsx
          {preview.warnings.length > 0 && (
            <ul role="alert" className="list-disc space-y-0.5 rounded-md border border-amber-300 bg-amber-50 p-3 pl-7 text-sm text-amber-900">
              {preview.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
```
  (b) before the Send control, the automatic-send section:

```tsx
          {preview.isCurrentMonth && (
            <div className="space-y-2 rounded-md border p-3">
              <h3 className="text-sm font-medium">Automatic send</h3>
              {preview.approval ? (
                <>
                  <p className="text-sm">
                    Approved by {preview.approval.approvedBy ?? "a former user"} on {formatSydneyDate(new Date(preview.approval.approvedAt))};
                    will be sent on {preview.autoSendLabel}.
                  </p>
                  <Button variant="outline" size="sm" onClick={withdraw}>Withdraw approval</Button>
                </>
              ) : (
                <>
                  <DeleteConfirmButton
                    title="Approve automatic send?"
                    description={<span className="block max-h-64 overflow-auto whitespace-pre-wrap text-sm">{preview.text}</span>}
                    triggerLabel={`Approve automatic send on ${preview.autoSendLabel}`}
                    triggerVariant="default" triggerSize="default" triggerClassName=""
                    disabled={!preview.canApprove}
                    disabledReason="Complete every Sunday (confirmed or cancelled), clear all Requested dates and confirm at least one date to enable this."
                    confirmLabel="Approve" pendingLabel="Approving…" onConfirm={approve}
                  />
                </>
              )}
            </div>
          )}
          {preview.autoSent && preview.last?.status === "SUCCESS" && <p className="text-sm text-muted-foreground">Sent automatically.</p>}
```
  with handlers `approve` (`const r = await approveVenueMonth(reqMonth); setResult(r); setReloadKey(k => k + 1); return errorOnly(r)`) and `withdraw` (same with `withdrawVenueApproval`). `DeleteConfirmButton` already supports `disabled` + `disabledReason` (renders an inert trigger with the reason as visible text). Its `description` is typed `string`: widen it to `React.ReactNode` (backwards compatible; it is rendered inside `AlertDialogDescription`) and add one assertion to its existing test in `src/components/shared/__tests__/`. Because `AlertDialogDescription` renders a `<p>`, pass a `<span className="block max-h-64 overflow-auto whitespace-pre-wrap">` rather than a `<pre>`.
  `VenueUsageClient.tsx`: delete the inline `RequestPanel`; render `<BookingRequestPanel />` then `<InvoiceRequestPanel defaultMonth={defaultRequestMonth} />`; remove now-unused imports (`getVenueRequestPreview`, `sendVenueUsageRequest`, `VenueRequestPreview`, `useEffect`).

- [ ] **Step 4: Run** `npm test -- --testPathPatterns="BookingRequestPanel|InvoiceRequestPanel|VenueUsageClient|DeleteConfirmButton"`, `npx tsc --noEmit`, `npm run lint`. PASS. Manual: screenshot both panels at 375px and 1920px (long To/CC addresses wrap; no horizontal scroll).

- [ ] **Step 5: Commit**

```bash
git status -s
git add src/components/venue-usage src/components/shared
git commit -m "feat(venue): booking-request panel and invoice panel with automatic-send approval" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 11: Calendar grid helpers, token helpers and the link-reset action (size M)

**Files:**
- Create: `src/lib/venueCalendar.ts` (pure), `src/lib/venueCalendarToken.ts` (server), `src/lib/actions/venueCalendar.ts`
- Modify: `src/lib/__tests__/featureGuards.test.ts` (`CORE_ACTIONS` += `"venueCalendar.ts"`)
- Test: `src/lib/__tests__/venueCalendar.test.ts`, `src/lib/__tests__/venueCalendarToken.test.ts`, `src/lib/actions/__tests__/venueCalendar.test.ts`

**Interfaces**
- Consumes: `addMonths`, `monthRange`, `isValidMonth`, `utcDateToYmd`, `ymdToUtcDate` (`venueUsage.ts`); `isAdmin`; `assertNotDemo`; `logAudit`; `readVenueUsageSettings`.
- Produces (`venueCalendar.ts`):
  - `VENUE_CALENDAR_TOKEN_KEY = "venueUsage.calendarToken"` (deliberately NOT in `VENUE_USAGE_SETTING_KEYS`; spec gap 4)
  - `CALENDAR_PAST_MONTHS = 12`, `CALENDAR_FUTURE_MONTHS = 6`
  - `clampCalendarMonth(requested: string | undefined, todayYMD: string): string` (invalid/missing -> current month; otherwise clamped to [-12, +6])
  - `type CalendarEntry = { id: number; date: string; startTime: string; endTime: string; purpose: string | null; status: "REQUESTED" | "CONFIRMED" }`
  - `type CalendarCell = { ymd: string; day: number; inMonth: boolean; entries: CalendarEntry[] }`
  - `buildMonthGrid(month: string, entries: readonly CalendarEntry[]): CalendarCell[][]` (Sunday-first weeks; leading/trailing days from adjacent months have `inMonth: false` and no entries)
  - `calendarStatusLabel(status: CalendarEntry["status"]): "Confirmed" | "Pending"`
- Produces (`venueCalendarToken.ts`, server):
  - `mintCalendarToken(): string` (24 CSPRNG bytes, base64url, 32 chars)
  - `tokenMatches(provided: string, stored: string): boolean` (SHA-256 both sides, `timingSafeEqual`; false for empty)
  - `readCalendarToken(): Promise<string | null>`
  - `calendarUrl(token: string): string | null` (`<AUTH_URL>/venue/<token>`)
- Produces (`actions/venueCalendar.ts`, `"use server"`): `resetVenueCalendarLink(): Promise<{ success: string; url: string | null } | { error: string }>`: ADMIN only, blocked in demo, requires the feature to be enabled; mints + upserts the token (creates it when unset, replaces it otherwise so the old link dies); audit `VENUE_CALENDAR_LINK_RESET` with no metadata.

- [ ] **Step 1: Failing tests** `venueCalendar.test.ts`:

```ts
/** @jest-environment node */
import { buildMonthGrid, calendarStatusLabel, clampCalendarMonth, type CalendarEntry } from "@/lib/venueCalendar"

describe("clampCalendarMonth", () => {
  const today = "2026-10-25"
  it("defaults to the current month for missing or invalid input", () => {
    expect(clampCalendarMonth(undefined, today)).toBe("2026-10")
    expect(clampCalendarMonth("nope", today)).toBe("2026-10")
    expect(clampCalendarMonth("2026-13", today)).toBe("2026-10")
  })
  it("allows -12 to +6 months and clamps beyond", () => {
    expect(clampCalendarMonth("2025-10", today)).toBe("2025-10")
    expect(clampCalendarMonth("2025-09", today)).toBe("2025-10")
    expect(clampCalendarMonth("2027-04", today)).toBe("2027-04")
    expect(clampCalendarMonth("2027-05", today)).toBe("2027-04")
  })
  it("crosses the year boundary", () => {
    expect(clampCalendarMonth("2027-02", "2026-12-31")).toBe("2027-02")
    expect(clampCalendarMonth("2028-01", "2026-12-31")).toBe("2027-06")
  })
})

describe("buildMonthGrid", () => {
  const e = (id: number, date: string, status: CalendarEntry["status"] = "CONFIRMED"): CalendarEntry =>
    ({ id, date, startTime: "17:00", endTime: "20:00", purpose: null, status })
  it("builds Sunday-first full weeks with out-of-month padding (Nov 2026 starts on a Sunday)", () => {
    const grid = buildMonthGrid("2026-11", [e(1, "2026-11-01"), e(2, "2026-11-08", "REQUESTED")])
    expect(grid[0][0]).toMatchObject({ ymd: "2026-11-01", day: 1, inMonth: true })
    expect(grid[0][0].entries.map((x) => x.id)).toEqual([1])
    expect(grid[1][0].entries.map((x) => x.id)).toEqual([2])
    expect(grid.every((w) => w.length === 7)).toBe(true)
    expect(grid.at(-1)!.at(-1)!.ymd).toBe("2026-12-05")
    expect(grid.at(-1)!.at(-1)!.inMonth).toBe(false)
  })
  it("pads the first week with the previous month (Oct 2026 starts on a Thursday)", () => {
    const grid = buildMonthGrid("2026-10", [])
    expect(grid[0].map((c) => c.ymd).slice(0, 4)).toEqual(["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30"])
    expect(grid[0].slice(0, 4).every((c) => !c.inMonth)).toBe(true)
  })
  it("never attaches entries to padding cells and sorts a cell's entries by start time", () => {
    const grid = buildMonthGrid("2026-10", [{ ...e(1, "2026-09-30"), startTime: "09:00" }, { ...e(2, "2026-10-04"), startTime: "18:00" }, { ...e(3, "2026-10-04"), startTime: "09:00" }])
    expect(grid[0].flatMap((c) => c.entries)).toEqual([])
    const sunday = grid[1][0]
    expect(sunday.entries.map((x) => x.id)).toEqual([3, 2])
  })
})
it("labels statuses", () => {
  expect(calendarStatusLabel("CONFIRMED")).toBe("Confirmed")
  expect(calendarStatusLabel("REQUESTED")).toBe("Pending")
})
```
  `venueCalendarToken.test.ts` (node; mock `@/lib/prisma` `appSetting.findUnique`):

```ts
it("mints distinct URL-safe tokens of at least 192 bits", () => {
  const a = mintCalendarToken(), b = mintCalendarToken()
  expect(a).not.toBe(b)
  expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/)
})
it("tokenMatches is exact, case-sensitive and false for empty or different-length input", () => {
  const t = mintCalendarToken()
  expect(tokenMatches(t, t)).toBe(true)
  expect(tokenMatches(t.toUpperCase(), t)).toBe(false)
  expect(tokenMatches("", t)).toBe(false)
  expect(tokenMatches(t, "")).toBe(false)
  expect(tokenMatches(t + "x", t)).toBe(false)
})
it("readCalendarToken returns the stored value or null", async () => {
  ;(prisma.appSetting.findUnique as jest.Mock).mockResolvedValueOnce({ value: "abc" })
  expect(await readCalendarToken()).toBe("abc")
  expect(prisma.appSetting.findUnique).toHaveBeenCalledWith({ where: { key: "venueUsage.calendarToken" } })
  ;(prisma.appSetting.findUnique as jest.Mock).mockResolvedValueOnce(null)
  expect(await readCalendarToken()).toBeNull()
  ;(prisma.appSetting.findUnique as jest.Mock).mockResolvedValueOnce({ value: "" })
  expect(await readCalendarToken()).toBeNull()
})
it("calendarUrl joins AUTH_URL and the token, null on a bad base", () => {
  process.env.AUTH_URL = "https://app.example.com"
  expect(calendarUrl("tok")).toBe("https://app.example.com/venue/tok")
  process.env.AUTH_URL = "not a url"
  expect(calendarUrl("tok")).toBeNull()
})
```
  `actions/venueCalendar.test.ts` (mock `@/auth`, `@/lib/prisma` `appSetting.upsert`, `@/lib/audit`, `next/cache`, `@/lib/demoMode`, `@/lib/venueUsageSettings`, `@/lib/venueCalendarToken` with `mintCalendarToken: () => "NEWTOKEN"` and `calendarUrl: (t) => "https://app.example.com/venue/" + t`):

```ts
it("is ADMIN only", async () => {
  for (const role of ["PASTOR", "OFFICE_ADMIN", "VIEWER", null]) {
    asRole(role); expect(await resetVenueCalendarLink()).toEqual({ error: "Unauthorized" })
  }
  expect(prisma.appSetting.upsert).not.toHaveBeenCalled()
})
it("is blocked in demo mode and when the feature is off", async () => {
  asRole("ADMIN"); (assertNotDemo as jest.Mock).mockReturnValueOnce({ error: "Not available in demo mode" })
  expect(await resetVenueCalendarLink()).toEqual({ error: "Not available in demo mode" })
  ;(readVenueUsageSettings as jest.Mock).mockResolvedValue({ enabled: false })
  expect(await resetVenueCalendarLink()).toEqual({ error: "Venue usage is not enabled" })
})
it("writes a fresh token over any old one, audits without the token, returns the URL", async () => {
  asRole("ADMIN")
  expect(await resetVenueCalendarLink()).toEqual({ success: "Calendar link reset", url: "https://app.example.com/venue/NEWTOKEN" })
  expect(prisma.appSetting.upsert).toHaveBeenCalledWith({
    where: { key: "venueUsage.calendarToken" },
    create: { key: "venueUsage.calendarToken", value: "NEWTOKEN" },
    update: { value: "NEWTOKEN" },
  })
  expect(logAudit).toHaveBeenCalledWith(7, "VENUE_CALENDAR_LINK_RESET", "AppSetting", undefined, {})
  expect(JSON.stringify((logAudit as jest.Mock).mock.calls)).not.toContain("NEWTOKEN")
})
```

- [ ] **Step 2: Run, expect FAIL**, then implement. `src/lib/venueCalendar.ts`:

```ts
import { addMonths, isValidMonth, monthRange, utcDateToYmd } from "@/lib/venueUsage"

/** AppSetting key holding the public calendar token. Not in the settings allowlist: only the reset action writes it. */
export const VENUE_CALENDAR_TOKEN_KEY = "venueUsage.calendarToken"
export const CALENDAR_PAST_MONTHS = 12
export const CALENDAR_FUTURE_MONTHS = 6

export type CalendarEntry = {
  id: number; date: string; startTime: string; endTime: string; purpose: string | null; status: "REQUESTED" | "CONFIRMED"
}
export type CalendarCell = { ymd: string; day: number; inMonth: boolean; entries: CalendarEntry[] }

/**
 * Month to show: the requested one clamped to 12 months back and 6 forward of today, or the current month
 * when the request is missing or malformed.
 * @param requested the `?month=` value
 * @param todayYMD Sydney "today" as "YYYY-MM-DD"
 */
export function clampCalendarMonth(requested: string | undefined, todayYMD: string): string {
  const current = todayYMD.slice(0, 7)
  if (!requested || !isValidMonth(requested)) return current
  const min = addMonths(current, -CALENDAR_PAST_MONTHS)
  const max = addMonths(current, CALENDAR_FUTURE_MONTHS)
  if (requested < min) return min
  if (requested > max) return max
  return requested
}

/**
 * Sunday-first weeks covering the month; days outside it are padding with no entries. A cell's
 * entries are sorted by start time.
 * @param month "YYYY-MM"
 * @param entries the month's CONFIRMED/REQUESTED rows
 */
export function buildMonthGrid(month: string, entries: readonly CalendarEntry[]): CalendarCell[][] {
  const { start, end } = monthRange(month)
  const cursor = new Date(start)
  cursor.setUTCDate(cursor.getUTCDate() - cursor.getUTCDay())
  const byDate = new Map<string, CalendarEntry[]>()
  for (const e of entries) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e])
  const weeks: CalendarCell[][] = []
  while (cursor.getTime() <= end.getTime() || cursor.getUTCDay() !== 0) {
    const week: CalendarCell[] = []
    for (let i = 0; i < 7; i++) {
      const ymd = utcDateToYmd(cursor)
      const inMonth = ymd.startsWith(`${month}-`)
      week.push({
        ymd, day: cursor.getUTCDate(), inMonth,
        entries: inMonth ? (byDate.get(ymd) ?? []).slice().sort((a, b) => a.startTime.localeCompare(b.startTime)) : [],
      })
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
    weeks.push(week)
  }
  return weeks
}

/**
 * Public wording for a status ("Pending" for REQUESTED).
 * @param status calendar entry status
 */
export function calendarStatusLabel(status: CalendarEntry["status"]): "Confirmed" | "Pending" {
  return status === "CONFIRMED" ? "Confirmed" : "Pending"
}
```
  (Loop check: Nov 2026 starts Sunday: cursor = Nov 1; while cursor <= Nov 30 -> weeks; after the week of Nov 29 the cursor is Dec 6 > end and `getUTCDay() === 0` stops: the last cell would be Dec 5. Matches the test.)
  `src/lib/venueCalendarToken.ts`:

```ts
import "server-only"
import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { VENUE_CALENDAR_TOKEN_KEY } from "@/lib/venueCalendar"

/** A fresh calendar token: 24 CSPRNG bytes (192 bits) as 32 base64url characters. */
export function mintCalendarToken(): string {
  return randomBytes(24).toString("base64url")
}

/**
 * Constant-time token comparison. Both sides are hashed first so the comparison length never depends on the input.
 * @param provided token from the URL
 * @param stored token from settings
 */
export function tokenMatches(provided: string, stored: string): boolean {
  if (!provided || !stored) return false
  const a = createHash("sha256").update(provided).digest()
  const b = createHash("sha256").update(stored).digest()
  return timingSafeEqual(a, b)
}

/** The stored calendar token, or null when none is set (calendar disabled). */
export async function readCalendarToken(): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: VENUE_CALENDAR_TOKEN_KEY } })
  return row?.value ? row.value : null
}

/**
 * Absolute calendar URL for a token (base from AUTH_URL).
 * @param token the calendar token
 * @returns the URL, or null when AUTH_URL is not a valid URL
 */
export function calendarUrl(token: string): string | null {
  try {
    return new URL(`/venue/${token}`, process.env.AUTH_URL ?? "http://localhost:3000").toString()
  } catch {
    return null
  }
}
```
  (`server-only` is mocked in jest via the project's existing moduleNameMapper, as `rateLimit.ts` already imports it; confirm in `jest.config.ts` and mirror what `rateLimit.test.ts` does if a mock is needed. Add `import { mintCalendarToken } ...` only in the action, never in a client component.) `src/lib/actions/venueCalendar.ts`:

```ts
"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { actorId } from "@/lib/actor"
import { isAdmin } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { assertNotDemo } from "@/lib/demoMode"
import { readVenueUsageSettings } from "@/lib/venueUsageSettings"
import { VENUE_CALENDAR_TOKEN_KEY } from "@/lib/venueCalendar"
import { calendarUrl, mintCalendarToken } from "@/lib/venueCalendarToken"

/**
 * Create or replace the public calendar link (ADMIN only; blocked in demo mode; feature must be on).
 * Replacing the token kills the previously shared link immediately. The token is never logged.
 */
export async function resetVenueCalendarLink(): Promise<{ success: string; url: string | null } | { error: string }> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }
  const settings = await readVenueUsageSettings()
  if (!settings.enabled) return { error: "Venue usage is not enabled" }
  const token = mintCalendarToken()
  await prisma.appSetting.upsert({
    where: { key: VENUE_CALENDAR_TOKEN_KEY },
    create: { key: VENUE_CALENDAR_TOKEN_KEY, value: token },
    update: { value: token },
  })
  await logAudit(actorId(session), "VENUE_CALENDAR_LINK_RESET", "AppSetting", undefined, {})
  revalidatePath("/venue-usage")
  return { success: "Calendar link reset", url: calendarUrl(token) }
}
```
  (the demo mock returns `{ error }`: widen the return type union accordingly if tsc complains.) Add `"venueCalendar.ts"` to `CORE_ACTIONS`.

- [ ] **Step 3: Run** `npm test -- --testPathPatterns="venueCalendar|featureGuards"`, `npx tsc --noEmit`, `npm run lint`. PASS.

- [ ] **Step 4: Commit**

```bash
git status -s
git add src/lib/venueCalendar.ts src/lib/venueCalendarToken.ts src/lib/actions/venueCalendar.ts src/lib/__tests__/featureGuards.test.ts src/lib/__tests__/venueCalendar.test.ts src/lib/__tests__/venueCalendarToken.test.ts src/lib/actions/__tests__/venueCalendar.test.ts
git commit -m "feat(venue): calendar grid helpers, token helpers and link reset action" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 12: Public calendar route `/venue/[token]` (size L)

**Files:**
- Create: `src/app/(public)/venue/[token]/page.tsx`, `src/components/venue-usage/VenueCalendarView.tsx`
- Modify: `src/lib/csp.ts` (public path), `src/lib/clientIp.ts` (header-based helper)
- Test: `src/app/(public)/venue/[token]/__tests__/page.test.tsx`, `src/components/venue-usage/__tests__/VenueCalendarView.test.tsx`, `__tests__/lib/csp.test.ts`, `src/lib/__tests__/clientIp.test.ts`

**Interfaces**
- Consumes: `readCalendarToken`, `tokenMatches` (Task 11); `clampCalendarMonth`, `buildMonthGrid`, `calendarStatusLabel`, `CalendarEntry` (Task 11); `rateLimit(key, limit, windowMs)` (`rateLimit.ts`); `readVenueUsageSettings`; `sydneyTodayYMD`; `monthRange`, `addMonths`, `formatMonthLabel`, `formatUsageDate`, `formatTime12`, `utcDateToYmd`.
- Produces:
  - `clientIpFromHeaders(h: Pick<Headers, "get">): string` (rightmost `x-forwarded-for` entry, else `"unknown"`); `getClientIp(req)` delegates to it.
  - `isPublicPath("/venue/<token>")` true; `/venue`, `/venue/a/b` false.
  - `VenueCalendarView(props: { venueName: string; month: string; token: string; todayYMD: string; entries: CalendarEntry[] }): JSX.Element` (server component, no client JS).

**Rules (spec "Public calendar")**
- No auth. Order: rate limit (`venueCal:<ip>`, 60 per minute) -> read settings + token -> `notFound()` if the feature is off, no token is set, or the token does not match (constant time) -> query. Unknown token and disabled feature are indistinguishable (both 404).
- `select` exactly `{ id, date, startTime, endTime, purpose, status }`, `status in [REQUESTED, CONFIRMED]`, `take 200`. Never `notes`, `createdBy`, names or CRM data. Page shows the venue name only.
- `robots: { index: false, follow: false }`, `dynamic = "force-dynamic"`. Month via `?month=`, clamped to -12/+6.
- View: month grid (confirmed green, pending amber, never colour alone: each entry carries text "Confirmed"/"Pending" visible or `sr-only`), prev/next links (plain `<Link>`; the prev/next link is replaced by a disabled span at the range limit), list below (date, time, purpose, label). Mobile-first: the grid cells show a coloured dot below `sm`, the list carries the details.

- [ ] **Step 1: Failing tests.** `clientIp.test.ts`: `clientIpFromHeaders(new Headers({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }))` is `"2.2.2.2"`; no header gives `"unknown"`. `csp.test.ts`: `isPublicPath("/venue/abc_DEF-123")` true, `"/venue"` false, `"/venue/a/b"` false, `"/venue-usage"` false. `VenueCalendarView.test.tsx`:

```tsx
const entries = [
  { id: 1, date: "2026-11-01", startTime: "17:00", endTime: "20:00", purpose: "Sunday service", status: "CONFIRMED" as const },
  { id: 2, date: "2026-11-08", startTime: "17:00", endTime: "20:30", purpose: null, status: "REQUESTED" as const },
]
it("renders the venue name, a list with date/time/purpose and text labels", () => {
  render(<VenueCalendarView venueName="Example Hall" month="2026-11" token="tok" todayYMD="2026-10-25" entries={entries} />)
  expect(screen.getByRole("heading", { name: /example hall/i })).toBeInTheDocument()
  expect(screen.getByText("November 2026")).toBeInTheDocument()
  expect(screen.getByText(/Sunday, 1 November/)).toBeInTheDocument()
  expect(screen.getByText("Sunday service")).toBeInTheDocument()
  expect(screen.getAllByText("Confirmed").length).toBeGreaterThan(0)
  expect(screen.getAllByText("Pending").length).toBeGreaterThan(0)
})
it("links to the previous and next month with the token", () => {
  render(<VenueCalendarView venueName="Example Hall" month="2026-11" token="tok" todayYMD="2026-10-25" entries={[]} />)
  expect(screen.getByRole("link", { name: /previous month/i })).toHaveAttribute("href", "/venue/tok?month=2026-10")
  expect(screen.getByRole("link", { name: /next month/i })).toHaveAttribute("href", "/venue/tok?month=2026-12")
})
it("disables prev at -12 months and next at +6 months", () => {
  const { rerender } = render(<VenueCalendarView venueName="V" month="2025-10" token="tok" todayYMD="2026-10-25" entries={[]} />)
  expect(screen.queryByRole("link", { name: /previous month/i })).not.toBeInTheDocument()
  rerender(<VenueCalendarView venueName="V" month="2027-04" token="tok" todayYMD="2026-10-25" entries={[]} />)
  expect(screen.queryByRole("link", { name: /next month/i })).not.toBeInTheDocument()
})
it("shows an empty message", () => {
  render(<VenueCalendarView venueName="V" month="2026-11" token="tok" todayYMD="2026-10-25" entries={[]} />)
  expect(screen.getByText(/no bookings this month/i)).toBeInTheDocument()
})
```
  `page.test.tsx` (node/jsdom per the crew page test; mock `next/navigation` `notFound: jest.fn(() => { throw new Error("NEXT_NOT_FOUND") })`, `next/headers` `headers: async () => new Headers({ "x-forwarded-for": "9.9.9.9" })`, `@/lib/prisma` (`venueUsage.findMany`), `@/lib/rateLimit`, `@/lib/venueUsageSettings`, `@/lib/venueCalendarToken` (keep the real `tokenMatches` via `jest.requireActual`, mock `readCalendarToken`), `@/lib/dates` `sydneyTodayYMD: () => "2026-10-25"`; stub `VenueCalendarView` to render its props as JSON):

```tsx
const run = async (token: string, month?: string) => VenueCalendarPage({ params: Promise.resolve({ token }), searchParams: Promise.resolve({ month }) })
beforeEach(() => {
  jest.resetAllMocks()
  ;(rateLimit as jest.Mock).mockReturnValue(true)
  ;(readVenueUsageSettings as jest.Mock).mockResolvedValue({ enabled: true, venueName: "Example Hall" })
  ;(readCalendarToken as jest.Mock).mockResolvedValue("good-token")
  ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue([])
})
it("404s an unknown token without touching the database", async () => {
  await expect(run("bad-token")).rejects.toThrow("NEXT_NOT_FOUND")
  expect(prisma.venueUsage.findMany).not.toHaveBeenCalled()
})
it("404s when the feature is off or no token is set (indistinguishable)", async () => {
  ;(readVenueUsageSettings as jest.Mock).mockResolvedValue({ enabled: false, venueName: "X" })
  await expect(run("good-token")).rejects.toThrow("NEXT_NOT_FOUND")
  ;(readVenueUsageSettings as jest.Mock).mockResolvedValue({ enabled: true, venueName: "X" })
  ;(readCalendarToken as jest.Mock).mockResolvedValue(null)
  await expect(run("good-token")).rejects.toThrow("NEXT_NOT_FOUND")
})
it("a reset token invalidates the old link", async () => {
  ;(readCalendarToken as jest.Mock).mockResolvedValue("new-token")
  await expect(run("good-token")).rejects.toThrow("NEXT_NOT_FOUND")
  await expect(run("new-token")).resolves.toBeTruthy()
})
it("queries only public fields and never notes", async () => {
  await run("good-token", "2026-11")
  const arg = (prisma.venueUsage.findMany as jest.Mock).mock.calls[0][0]
  expect(Object.keys(arg.select).sort()).toEqual(["date", "endTime", "id", "purpose", "startTime", "status"])
  expect(arg.where.status).toEqual({ in: ["REQUESTED", "CONFIRMED"] })
  expect(arg.take).toBe(200)
  expect(JSON.stringify(arg)).not.toContain("notes")
})
it("clamps the month and maps dates to YYYY-MM-DD", async () => {
  ;(prisma.venueUsage.findMany as jest.Mock).mockResolvedValue([{ id: 1, date: new Date("2026-11-01T00:00:00Z"), startTime: "17:00", endTime: "20:00", purpose: "Service", status: "CONFIRMED" }])
  const el = await run("good-token", "2019-01")
  const props = (el as { props: { month: string; entries: { date: string }[] } }).props
  expect(props.month).toBe("2025-10")
  const el2 = await run("good-token", "2026-11")
  expect((el2 as { props: { entries: { date: string }[] } }).props.entries[0].date).toBe("2026-11-01")
})
it("rate-limits by IP before any lookup", async () => {
  ;(rateLimit as jest.Mock).mockReturnValue(false)
  const el = await run("good-token")
  expect(rateLimit).toHaveBeenCalledWith("venueCal:9.9.9.9", 60, 60_000)
  expect(readCalendarToken).not.toHaveBeenCalled()
  expect(JSON.stringify(el)).toContain("Too many requests")
})
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement.** `clientIp.ts`: add

```ts
/**
 * Client IP from a headers object (Server Components receive `await headers()`, not a Request): the rightmost
 * `x-forwarded-for` entry (appended by the trusted proxy), else "unknown".
 * @param h anything with `get`
 */
export function clientIpFromHeaders(h: Pick<Headers, "get">): string {
  const last = h.get("x-forwarded-for")?.split(",").at(-1)?.trim()
  return last || "unknown"
}
```
  and make `getClientIp(req)` `return clientIpFromHeaders(req.headers)`. `csp.ts`: add `const PUBLIC_VENUE_CALENDAR = /^\/venue\/[A-Za-z0-9_-]+$/` with a comment (token-gated read-only committee calendar; bare `/venue` stays gated) and `|| PUBLIC_VENUE_CALENDAR.test(path)` in `isPublicPath`. The feature-route map (`featureRoutes.ts`) needs no entry (not a FEATURES flag). `page.tsx`:

```tsx
import { headers } from "next/headers"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { prisma } from "@/lib/prisma"
import { rateLimit } from "@/lib/rateLimit"
import { clientIpFromHeaders } from "@/lib/clientIp"
import { sydneyTodayYMD } from "@/lib/dates"
import { readVenueUsageSettings } from "@/lib/venueUsageSettings"
import { readCalendarToken, tokenMatches } from "@/lib/venueCalendarToken"
import { clampCalendarMonth, type CalendarEntry } from "@/lib/venueCalendar"
import { monthRange, utcDateToYmd } from "@/lib/venueUsage"
import { VenueCalendarView } from "@/components/venue-usage/VenueCalendarView"

// Always current; never cached or indexed. The token is the only secret.
export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Venue calendar", robots: { index: false, follow: false } }

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ month?: string }> }

/**
 * Public, read-only venue calendar for committee members. Gated only by the secret token (constant-time compare);
 * a wrong token, no token or the feature being off all 404. Shows venue name, dates, times, purpose and
 * Confirmed/Pending only: no notes, names or CRM data.
 */
export default async function VenueCalendarPage({ params, searchParams }: Readonly<Props>) {
  const { token } = await params
  const ip = clientIpFromHeaders(await headers())
  if (!rateLimit(`venueCal:${ip}`, 60, 60_000)) {
    return <p className="p-6 text-center text-sm">Too many requests. Please try again in a minute.</p>
  }
  const [settings, stored] = await Promise.all([readVenueUsageSettings(), readCalendarToken()])
  if (!settings.enabled || !stored || !tokenMatches(token, stored)) notFound()

  const today = sydneyTodayYMD()
  const { month: raw } = await searchParams
  const month = clampCalendarMonth(raw, today)
  const { start, end } = monthRange(month)
  const rows = await prisma.venueUsage.findMany({
    where: { date: { gte: start, lte: end }, status: { in: ["REQUESTED", "CONFIRMED"] } },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
    take: 200,
    select: { id: true, date: true, startTime: true, endTime: true, purpose: true, status: true },
  })
  const entries: CalendarEntry[] = rows.map((r) => ({
    id: r.id, date: utcDateToYmd(r.date), startTime: r.startTime, endTime: r.endTime, purpose: r.purpose,
    status: r.status === "CONFIRMED" ? "CONFIRMED" : "REQUESTED",
  }))
  return <VenueCalendarView venueName={settings.venueName} month={month} token={token} todayYMD={today} entries={entries} />
}
```
  (The "feature off" 404 and the "no token" 404 happen after the rate limit, so a scraper is throttled either way.) `VenueCalendarView.tsx` (server component; imports `Link` from `next/link`):

```tsx
import Link from "next/link"
import { CALENDAR_FUTURE_MONTHS, CALENDAR_PAST_MONTHS, buildMonthGrid, calendarStatusLabel, type CalendarEntry } from "@/lib/venueCalendar"
import { addMonths, durationHours, formatHours, formatMonthLabel, formatTime12, formatUsageDate, ymdToUtcDate } from "@/lib/venueUsage"

const WEEKDAY_HEADS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const STATUS_CLASS = {
  CONFIRMED: "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-100",
  REQUESTED: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
} as const

/**
 * Read-only month view for the public venue calendar: a Sunday-first grid (colour plus text labels) and a
 * list of the month's dates below it. Server component; navigation is plain links.
 * @param props venue name, month, token (for prev/next links), Sydney today and the month's entries
 */
export function VenueCalendarView({ venueName, month, token, todayYMD, entries }: Readonly<{
  venueName: string; month: string; token: string; todayYMD: string; entries: CalendarEntry[]
}>) {
  const current = todayYMD.slice(0, 7)
  const prev = addMonths(month, -1)
  const next = addMonths(month, 1)
  const canPrev = prev >= addMonths(current, -CALENDAR_PAST_MONTHS)
  const canNext = next <= addMonths(current, CALENDAR_FUTURE_MONTHS)
  const grid = buildMonthGrid(month, entries)
  const navClass = "inline-flex h-10 items-center rounded-md border px-3 text-sm"
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <h1 className="text-2xl font-semibold">{venueName || "Venue"} bookings</h1>
      <div className="flex items-center justify-between gap-2">
        {canPrev ? <Link className={navClass} href={`/venue/${token}?month=${prev}`} aria-label="Previous month">&larr;</Link> : <span className={`${navClass} opacity-40`} aria-hidden>&larr;</span>}
        <h2 className="text-lg font-medium">{formatMonthLabel(month)}</h2>
        {canNext ? <Link className={navClass} href={`/venue/${token}?month=${next}`} aria-label="Next month">&rarr;</Link> : <span className={`${navClass} opacity-40`} aria-hidden>&rarr;</span>}
      </div>
      <table className="w-full table-fixed border-collapse text-xs sm:text-sm">
        <caption className="sr-only">{formatMonthLabel(month)} calendar</caption>
        <thead><tr>{WEEKDAY_HEADS.map((d) => <th key={d} scope="col" className="p-1 text-center font-medium text-muted-foreground">{d}</th>)}</tr></thead>
        <tbody>
          {grid.map((week) => (
            <tr key={week[0].ymd}>
              {week.map((c) => (
                <td key={c.ymd} className={`h-14 border align-top p-1 sm:h-20 ${c.inMonth ? "" : "bg-muted/30 text-muted-foreground/50"}`}>
                  <div className={c.ymd === todayYMD ? "font-bold underline" : ""}>{c.day}</div>
                  {c.entries.map((e) => (
                    <div key={e.id} className={`mt-0.5 truncate rounded px-1 ${STATUS_CLASS[e.status]}`}>
                      <span className="sr-only">{calendarStatusLabel(e.status)}: </span>
                      <span aria-hidden className="sm:hidden">&bull;</span>
                      <span className="hidden sm:inline">{formatTime12(e.startTime)}</span>
                    </div>
                  ))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No bookings this month.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {entries.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <div>
                <p className="font-medium">{formatUsageDate(ymdToUtcDate(e.date))}</p>
                <p className="text-muted-foreground">{formatTime12(e.startTime)} – {formatTime12(e.endTime)} ({formatHours(durationHours(e.startTime, e.endTime))})</p>
                {e.purpose && <p>{e.purpose}</p>}
              </div>
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[e.status]}`}>{calendarStatusLabel(e.status)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```
  (In the view test, "Confirmed"/"Pending" are matched by `getAllByText`; the grid's sr-only label is "Confirmed: " with a trailing colon, so the list badge supplies the exact-text match. `formatUsageDate` returns "Sunday, 1 November" with no year: acceptable for a month-scoped list.)

- [ ] **Step 4: Run** `npm test -- --testPathPatterns="VenueCalendarView|venue/\\[token\\]|csp|clientIp"`, `npx tsc --noEmit`, `npm run lint`. PASS. Manual (dev server, token set via Task 13 or directly in the DB): open `/venue/<token>` logged OUT at 375px and 1920px; try a wrong token (404 page), `?month=2019-01` (clamped), and confirm no `<meta name="robots" content="noindex">` is missing in page source; confirm the middleware lets the anonymous request through (no redirect to `/login`).

- [ ] **Step 5: Commit**

```bash
git status -s
git add "src/app/(public)/venue" src/components/venue-usage/VenueCalendarView.tsx src/components/venue-usage/__tests__/VenueCalendarView.test.tsx src/lib/csp.ts src/lib/clientIp.ts __tests__/lib/csp.test.ts src/lib/__tests__/clientIp.test.ts
git commit -m "feat(venue): public read-only committee calendar at /venue/[token]" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 13: Calendar link box on the admin page (size S)

**Files:**
- Create: `src/components/venue-usage/CalendarLinkBox.tsx`
- Modify: `src/app/(dashboard)/venue-usage/page.tsx`, `src/components/venue-usage/VenueUsageClient.tsx`
- Test: `src/components/venue-usage/__tests__/CalendarLinkBox.test.tsx`

**Interfaces**
- Consumes: `resetVenueCalendarLink` (Task 11); `readCalendarToken`, `calendarUrl`; `isAdmin`; `DeleteConfirmButton`.
- Produces: `CalendarLinkBox(props: { url: string | null; canReset: boolean }): JSX.Element`; `VenueUsageClient` gains props `calendarUrl: string | null; canResetCalendar: boolean`.

**Rules:** any `canEdit` user sees and can copy the link; only ADMIN sees `Create link` / `Reset link` (spec gap 8). Reset confirms with "The old link will stop working immediately." No link: text "No calendar link yet." (ADMIN also sees `Create link`). Copy uses `navigator.clipboard.writeText` inside try/catch and falls back to selecting the read-only input.

- [ ] **Step 1: Failing tests** (mock `@/lib/actions/venueCalendar`, `next/navigation` `useRouter`):

```tsx
it("shows the link and a copy button to editors but no reset", () => {
  render(<CalendarLinkBox url="https://app.example.com/venue/tok" canReset={false} />)
  expect(screen.getByDisplayValue("https://app.example.com/venue/tok")).toHaveAttribute("readonly")
  expect(screen.getByRole("button", { name: /copy link/i })).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: /reset link/i })).not.toBeInTheDocument()
})
it("copies the link", async () => {
  const writeText = jest.fn().mockResolvedValue(undefined)
  Object.assign(navigator, { clipboard: { writeText } })
  const user = userEvent.setup(); render(<CalendarLinkBox url="https://app.example.com/venue/tok" canReset={false} />)
  await user.click(screen.getByRole("button", { name: /copy link/i }))
  expect(writeText).toHaveBeenCalledWith("https://app.example.com/venue/tok")
  expect(await screen.findByText(/copied/i)).toBeInTheDocument()
})
it("lets an admin reset after confirming, then refreshes", async () => {
  ;(resetVenueCalendarLink as jest.Mock).mockResolvedValue({ success: "Calendar link reset", url: "https://app.example.com/venue/new" })
  const user = userEvent.setup(); render(<CalendarLinkBox url="https://app.example.com/venue/tok" canReset />)
  await user.click(screen.getByRole("button", { name: /reset link/i }))
  expect(await screen.findByText(/old link will stop working/i)).toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: /^reset$/i }))
  await waitFor(() => expect(resetVenueCalendarLink).toHaveBeenCalled())
})
it("offers Create link to an admin when none exists, and nothing to an editor", () => {
  const { rerender } = render(<CalendarLinkBox url={null} canReset />)
  expect(screen.getByRole("button", { name: /create link/i })).toBeInTheDocument()
  rerender(<CalendarLinkBox url={null} canReset={false} />)
  expect(screen.getByText(/no calendar link yet/i)).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: /create link/i })).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run, expect FAIL**, then implement `CalendarLinkBox.tsx`:

```tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { resetVenueCalendarLink } from "@/lib/actions/venueCalendar"

/**
 * Committee calendar link: copy it (any editor), create or reset it (ADMIN). Resetting kills the old link.
 * @param props the absolute link (null when none) and whether the viewer may create/reset
 */
export function CalendarLinkBox({ url, canReset }: Readonly<{ url: string | null; canReset: boolean }>) {
  const router = useRouter()
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function copy() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError("Could not copy automatically: select the link and copy it.")
    }
  }

  async function reset() {
    const r = await resetVenueCalendarLink()
    if ("error" in r) return r
    router.refresh()
    return undefined
  }

  return (
    <section className="space-y-2 rounded-lg border bg-card p-4">
      <h2 className="text-lg font-medium">Committee calendar link</h2>
      <p className="text-sm text-muted-foreground">Anyone with this link can see the booked dates (no login). It shows dates, times and purpose only.</p>
      {url ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input readOnly value={url} aria-label="Calendar link" className="min-w-0 flex-1" onFocus={(e) => e.currentTarget.select()} />
          <Button type="button" variant="outline" onClick={copy}>Copy link</Button>
          {copied && <span role="status" className="text-sm text-muted-foreground">Copied</span>}
        </div>
      ) : (
        <p className="text-sm">No calendar link yet.</p>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {canReset && (
        <DeleteConfirmButton
          title={url ? "Reset the calendar link?" : "Create the calendar link?"}
          description={url ? "The old link will stop working immediately. Share the new link with the committee." : "Creates a secret link anyone can use to view the booked dates."}
          triggerLabel={url ? "Reset link" : "Create link"}
          triggerVariant="outline" triggerSize="default" triggerClassName=""
          confirmLabel={url ? "Reset" : "Create"} pendingLabel="Working…"
          onConfirm={reset}
        />
      )}
    </section>
  )
}
```
  Page: `import { isAdmin }`, `readCalendarToken`, `calendarUrl`; after the role/feature checks: `const token = await readCalendarToken()`, pass `calendarUrl={token ? calendarUrl(token) : null}` and `canResetCalendar={isAdmin(session?.user?.role)}` to `VenueUsageClient`, which renders `<CalendarLinkBox url={calendarUrl} canReset={canResetCalendar} />` after the panels. The token string never reaches the client except inside the full URL for users who passed `canEdit`.

- [ ] **Step 3: Run** `npm test -- --testPathPatterns="CalendarLinkBox|VenueUsageClient"`, `npx tsc --noEmit`, `npm run lint`. PASS. Manual: 375px screenshot (input + buttons wrap).

- [ ] **Step 4: Commit**

```bash
git status -s
git add src/components/venue-usage src/app/\(dashboard\)/venue-usage/page.tsx
git commit -m "feat(venue): calendar link box with copy and admin reset" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 14: Website docs and README (size M)

Required by the repo rule for feature PRs. No env vars are added (`docs/environment.md` unchanged: state this in the PR).

**Files:**
- Create: `website/src/content/docs/docs/venue-bookings.md`
- Modify: `website/src/sidebar.mjs`, `website/src/content/docs/docs/scheduled-jobs.md`, `website/src/content/docs/docs/roles-and-permissions.md`, `website/src/content/docs/docs/email-notifications.md`, `README.md`
- Verify only: `docs/environment.md` (no change), `.github` docs link checks if any (`grep -rn "docs/" .github/workflows | head`)

- [ ] **Step 1: Read the neighbours first** (`invoices.md` and `volunteer-crew-page.md` for frontmatter, tone, link style `/parishcrm/docs/<slug>/`; `scheduled-jobs.md` table + the per-job paragraphs; the roles table in `roles-and-permissions.md`; the template list in `email-notifications.md`) and match them.

- [ ] **Step 2: Create `venue-bookings.md`** with frontmatter `title: "Venue Bookings"` and a one-sentence `description`. Sections (plain prose, no real names; use "Example Hall"): **Who it is for** (churches that hire another parish's church/hall); **Turn it on** (Settings -> General -> Venue bookings: enable, venue name, contact name/email, invoice CC, booking request CCs, reply-to; ADMIN only); **Booking dates** (statuses Requested/Confirmed/Cancelled, add one date or "Add all Sundays", bulk Mark confirmed / Cancel, cancelling asks whether to email the venue, editing after the day to the actual times); **Asking the venue to book** (Send booking request panel, "already booked" list, "asked on"); **Monthly invoice request** (what is counted: confirmed only; warnings; manual Send/Send again; recording the venue's invoice as a normal expense in [Transactions](/parishcrm/docs/transactions/)); **Automatic send** (approve the current month once every Sunday is confirmed or cancelled and nothing is Requested; sent on the 1st at 9:00 AM Sydney; any change to that month clears the approval and shows "Approval cleared"; withdraw anytime before it is sent; what the reminder email says when not approved; editors get an email either way; the job only acts on the 1st, so if the app is offline all that day use manual Send); **Committee calendar** (link, what it shows and does not, reset kills old link, ADMIN creates/resets, 12 months back and 6 forward); **Email wording** (Settings -> Email templates: Venue booking request / Venue invoice request, the variables `{venueName} {contactName} {churchName} {month} {dates} {bookedDates} {totalHours} {senderName}`, cancellation notice wording is fixed); **Roles** (`ADMIN`/`PASTOR`/`OFFICE_ADMIN` manage; settings and link reset ADMIN only; others no access); **Audit** (everything is in the audit log, never the link itself). Link to `scheduled-jobs`, `email-notifications`, `settings-and-branding`, `roles-and-permissions`.

- [ ] **Step 3: Edit the others.**
  - `src/sidebar.mjs`: add `'venue-bookings'` to the `Dashboard & Accounting` group after `'invoices'`.
  - `scheduled-jobs.md`: add a table row "Venue invoice request | Once per Sydney month, on the 1st from 09:00 (only the 1st; at most 3 attempts per month per process, 30 min apart). Sends last month's invoice request if an admin approved it and the month is still complete, otherwise emails ADMIN, PASTOR and OFFICE_ADMIN users a reminder. Does nothing until Venue bookings is enabled with a contact email. No env flag, no HTTP endpoint (the Send button on the page is the manual route)." plus a paragraph in the per-job details: the lease on the month's request record (`reminderClaimedAt`, 10 minutes, so two instances or a restart never send twice), `reminderSentAt` only after the work completes, an already-sent month is left alone, and if every notice email fails the job retries.
  - `roles-and-permissions.md`: add a Venue bookings row (ADMIN/PASTOR/OFFICE_ADMIN manage bookings and requests; ADMIN-only settings and link reset; AUDITOR/VIEWER/EVENT_ORGANISER none).
  - `email-notifications.md`: add the booking request, cancellation notice, invoice request and the two staff notices to the list of emails, with the two editable templates.
  - `README.md`: add a feature bullet after **Petty cash**: `- **Venue bookings** — for churches that hire a hall: dated bookings (requested / confirmed / cancelled), booking-request and cancellation emails, a monthly invoice request (manual, or sent automatically on the 1st once an admin approves), and a secret no-login committee calendar.` Check no existing README sentence claims the opposite (for example a "Not included" or roadmap list mentioning venue or bookings): `grep -n -i "venue\|booking\|roadmap\|not included" README.md`.

- [ ] **Step 4: Verify.** `grep -n "venue-bookings" website/src/sidebar.mjs`; every `/parishcrm/docs/<slug>/` link in the new page names a file that exists under `website/src/content/docs/docs/`; `npm run lint`; if `website/` has its own build check that CI runs (look in `.github/workflows`), run the cheapest equivalent locally (`cd website && npx astro check` if configured) and fix only errors this change causes. Proofread that no real name/email/church detail appears.

- [ ] **Step 5: Commit**

```bash
git status -s
git add website/src/content/docs/docs/venue-bookings.md website/src/sidebar.mjs website/src/content/docs/docs/scheduled-jobs.md website/src/content/docs/docs/roles-and-permissions.md website/src/content/docs/docs/email-notifications.md README.md
git commit -m "docs(venue): venue bookings page, scheduled-job entry and README feature" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Final verification (before the PR)

- [ ] `npx prisma validate`, `npx tsc --noEmit`, `npm run lint`.
- [ ] Touched suites by basename: `npm test -- --testPathPatterns="venue|scheduler|emailTemplates|EmailTemplatesSection|settings|featureGuard|csp|clientIp|DeleteConfirmButton"`; then one full `npm test -- --coverage` run to confirm the coverage floor.
- [ ] `git status -s` shows nothing under `src/lib/generated`, `.claude/`, `CLAUDE.md`, `AGENTS.md`.
- [ ] Manual (screenshots in the PR): admin page and public calendar at 375px and >=1920px; approve -> edit a date -> "Approval cleared" notice; wrong calendar token -> 404; anonymous access to `/venue/<token>` works without login.
- [ ] Open the PR as one PR (migration + public route = risky class): wait for a real CodeRabbit review of head, run `/code-review high`, post a disposition table. No prod deploy without explicit approval; this PR adds a migration so the St Mark `PROD_VERSION` bump needs a human-reviewed bump.

## Self-Review

**Spec coverage**
- Data model: `bookingRequestedAt`, `approvedAt/By`, `autoSent` (T1); settings `bookingCcEmails` (T1), `calendarToken` (T11, deviation explained).
- Rules: invoice counts CONFIRMED only (T3/T4 reuse `confirmedOnly`); "already booked" = CONFIRMED and date >= Sydney today (T6 `loadBooked`); completeness (T2).
- Admin page: month picker/table/total (part 1, kept); add single date (part 1) and add-all (T5/T9); bulk confirm/cancel (T5/T9); cancel + optional email (T5/T9); booking-request panel with ticked rows, preview, To/CC/Reply-To, `bookingRequestedAt`, "asked on" (T6/T10); invoice panel with warnings, preview, last status, Send/Resend (T6/T10); approve (current month, complete-only, confirm with preview, `approvedAt/By`) and withdraw (T6/T10); invalidation in the same transaction, audited, with the UI notice (T5/T9); calendar link box with copy/reset (T11/T13); rename (T9).
- Emails: recipients table (T4 `invoiceRecipients`/`bookingRecipients`, scheduler Reply-To rule); template keys and vars, date-line format, escaping (T3); staff reminder / "sent" notice to all active canEdit users (T7).
- Monthly job steps 1 to 6, lease on `reminderClaimedAt`, stale after 10 min, `reminderSentAt` last (T7); scheduler cadence and gate (T2/T8, stated up front).
- Public calendar: no auth, constant-time token, 404 on unknown/disabled, noindex, rate limit, confirmed green / pending amber, cancelled hidden, prev/next -12..+6, venue name only (T11/T12).
- Errors/security/audit: failures recorded and retryable (T4, T7), gates at page and action (T5 to T13), `logAudit` on every mutation incl. approval, approval-clear, send, link reset, demo-mode blocks (T5 to T11).
- Testing list: every bullet has a task test (Sunday enumeration, completeness, month boundaries, Dec to Jan, Sydney gate: T2; builders: T3; actions: T5/T6/T11; job concurrency/lease/approved/not approved/already sent: T7; public page valid/invalid/reset/disabled/no notes: T12). Manual 375px/1920px in T9, T10, T12, T13.
- Docs/README (T14); `docs/environment.md` unchanged (no env vars).

**Placeholder scan:** no TBD/TODO steps; every code step shows the code, every test step shows the test. Two places say "confirm in the file" for a type shape that the plan reads from existing code (`validateSettingValue`'s return shape, `server-only` handling in jest); both have a stated fallback.

**Type consistency checked:** `VenueUsageSettings.bookingCcEmails` (T1) is read by `bookingRecipients` (T4); `InvoicePrep.rows` is `VenueUsageLine[]` and the job passes `prep.rows` to `totalHours`; `VenueMutationResult` (T5) is the type `BookingList` consumes (T9); `VenueRequestPreview` extra fields (T6) are what `InvoiceRequestPanel` reads (T10); `CalendarEntry.date` is "YYYY-MM-DD" (T11) and the page maps `utcDateToYmd` (T12); `UNSENT_FILTER` (T5) is reused by `withdrawVenueApproval` (T6); `MAX_ROWS_PER_MONTH` moved to `venueInvoice.ts` (T4) and imported by T5/T6/T7; `JobName` addition (T8) matches `Jobs` and `DEFAULT_JOBS`; the job returns `FEATURE_OFF_SKIP` whose shape the runner already recognises.

**Risks flagged for review:** (1) T5 converts three existing actions to transactions: existing action tests are rewritten around a `$transaction` mock; reviewers should confirm no behaviour change beyond the extra `approvalCleared` flag. (2) T3 changes the default invoice wording source to the template while keeping the old output byte-compatible for the default template; the unchanged existing `buildRequestEmail` tests are the proof. (3) T12 adds a public route: reviewers should check `isPublicPath`, the rate limit, the `select`, and that a 404 is returned for every non-match.
