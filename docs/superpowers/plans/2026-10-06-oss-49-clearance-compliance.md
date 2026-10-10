# OSS-49 Clearance Compliance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (fresh sonnet subagent per task; main thread reviews between tasks). Steps use checkbox (`- [ ]`) syntax for tracking.

## Workflow rules (PO's standing rules; apply to every task)

- **Start:** `/board move OSS-49 "In Progress"` (Waiting on = Claude) and seed the ticket `## State` block in `.claude/tickets/OSS-49.md`. Overwrite `## State` after each task (step · next · blocker). Append one Activity-log line per milestone.
- **Commits:** write each message with the `caveman-commit` skill (Conventional Commits, subject ≤50 chars), plus the Co-Authored-By trailer from Global Constraints.
- **Pre-push:** touched-suite tests + `npm run lint` only. No local `npm run build`.
- **One review pass before opening the PR:** built-in `/code-review medium`. Fix the confirmed findings. Never run a second review on the same diff.
- **After the PR opens:** comment `@codex review`. Wait for CI with background `gh pr checks <n> --watch`, never by polling in the foreground. Move the card to Review (Waiting on = PO), delete the ticket's `## State` block, and log the PR URL.
- **Before reporting the PR as ready:**
  - After the final push, re-pull every review source: `gh api repos/ginutgeorge-Aus/parishcrm/pulls/<n>/comments` and `gh pr view <n> --json reviews,comments`, plus the check results. Sources are Codex, CodeRabbit, CI, Sonar and humans.
  - Verify each finding against HEAD and dedupe.
  - Mark each one Fixed, Stale, or deferred. Deferred findings get a drafted issue, and you must ask the PO before creating it, because this is a public repo.
  - **Ask the PO before marking any finding Refuted or by-design.**
  - Confirm CodeRabbit really reviewed the head SHA; its check passes even when it is rate-limited.
  - Docs nitpicks get one fix round. Further wording nits go into one follow-up.
  - Post a disposition table on the PR.
  - If a review source can't be read, report the gap.
- **Stop at merge.** The PO merges. A migration in the release means the St Mark `PROD_VERSION` bump needs human review.


**Goal:** Give admins a clearance compliance page (filters, CSV export), a WWCC batch-verify helper laid out in the OCG portal's field order, and a monthly email digest of expired / expiring / missing / unverified clearances.

**Architecture:** A pure view layer (`clearanceComplianceView.ts`, client-safe) plus a server query/bucket layer (`clearanceCompliance.ts`) feed three consumers: the `/people/clearances` page (list + `?view=batch`), a CSV route, and the digest job. The digest is a new scheduler job `clearanceDigest` (1st of month from 07:00 Sydney, 3 attempts max) whose once-per-month guard is an `AppSetting` lease row, the same mechanism as `errorDigest`. **No schema change and no migration.** No new env var.

**Tech Stack:** Next.js 16 App Router (Server Components + Server Actions), Prisma 7, Jest 30 + RTL, existing `sendEmail`, `escapeCsv`, `sydney*` date helpers.

Ticket: `.claude/tickets/OSS-49.md`. Depends on OSS-47 (ministry roles) and OSS-48 (clearances), both merged first.

## Global Constraints

- Public AGPL repo: synthetic test data only (`WWC0000000E`, `admin@example.com`, "Test Person"). Never commit real data.
- Every mutation is guarded in the page AND the server action; `assertNotDemo()` first in actions; `logAudit(actorId(session), ...)`.
- JSDoc on every new or changed function, exported or not.
- Dates: Sydney wall clock via `src/lib/dates.ts` (`sydneyToday`, `sydneyClock`); stored dates are UTC-midnight `@db.Date`; format with `formatDMY` (UTC parts).
- Decrypted values (WWC number, DOB) are never logged, never emailed, never in CSV. Email and CSV carry names + statuses only.
- `"use server"` files export only `async` functions (no exported constants).
- Next.js 16: route handler / page `params` and `searchParams` are Promises. Read `node_modules/next/dist/docs/` before using any API not already used in this repo.
- Tests: `npm test -- --testPathPatterns="<name>"` (never bare `npx jest`). Tests with `Request`/Prisma/actions need `/** @jest-environment node */`.
- No local `npm run build`. Pre-push = touched-suite tests + `npm run lint`.
- Commits: Conventional Commits, subject <= 50 chars, end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. PR body ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Branch `feat/clearance-compliance`; PR title `feat(people): clearance compliance list and monthly digest`.

## Contract names used (from OSS-47 / OSS-48; must already exist)

- `MinistryRole` enum, `Person.ministryRoles`, `MINISTRY_ROLE_LABELS`, `MINISTRY_ROLES` (`src/lib/ministryRoles.ts`).
- `ClearanceType { WWCC SAFE_MINISTRY }`, model `PersonClearance` (fields `id, personId, type, number (encrypted), expiresAt, verifiedAt, verifiedById, verificationNote`), Person back-relation `clearances`.
- `clearanceStatus(c, today)`, `ClearanceStatus`, `EXPIRING_WINDOW_DAYS` (=60), `CLEARANCE_TYPE_LABELS` (`src/lib/clearanceStatus.ts`).
- `canManageClearances(role)` (`src/lib/roleGuard.ts`), `getWwccVerifyUrl()` (`src/lib/clearanceSettings.ts`), `src/lib/actions/clearance.ts` (this plan appends `verifyClearancesBulk`).
- **ID types (confirmed against the OSS-48 plan):** `PersonClearance.id` is `String @id @default(cuid())`; `personId`, `verifiedById`, `createdById` and `Person.id`/`User.id` are `Int`. So clearance ids are `string`, person ids `number`. `verificationNote` is **encrypted at rest** (`encrypt()` on write, like OSS-48's `verifyClearance`).

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/dates.ts` (modify) | add `sydneyMonthKey` |
| `src/lib/clearanceComplianceView.ts` (create) | pure, client-safe: labels, filter parsing, `WwccBatchRow`, TSV/copy helpers, `dmy` |
| `src/lib/clearanceCompliance.ts` (create) | server: `loadComplianceRows`, `toComplianceRow`, filters, `bucketCompliance`, `loadWwccVerifyBatch` |
| `src/lib/actions/clearance.ts` (modify) | append `verifyClearancesBulk` |
| `src/app/(dashboard)/people/clearances/page.tsx` (create) | list + `?view=batch` |
| `src/components/people/ClearanceComplianceTable.tsx` (create) | server presentational table |
| `src/components/people/WwccBatchVerify.tsx` (create) | client: copy buttons, checkboxes, Mark verified |
| `src/app/api/clearances/export/route.ts` (create) | CSV export |
| `src/components/layout/sidebar/navData.ts` (modify) | nav link |
| `src/lib/clearanceDigestEmail.ts` (create) | pure email renderer |
| `src/lib/clearanceDigest.ts` (create) | `sendClearanceDigest`, lease, `runClearanceDigestLocked`, `runClearanceDigest` |
| `src/lib/scheduler.ts`, `src/lib/schedulerRunner.ts` (modify) | job wiring |
| `src/app/api/cron/send-clearance-digest/route.ts` (create) | manual trigger |
| `website/src/content/docs/docs/{people-and-families,roles-and-permissions,scheduled-jobs,email-notifications}.md`, `README.md`, `docs/self-hosting.md` (modify) | docs |

Idempotency storage decision: **`AppSetting` key `clearanceDigestLastMonth`** (value `YYYY-MM`, or `running:<month>:<ms>` while a run holds the lease). Chosen over a new `*Send` table because the digest is one global send per month (not per-recipient like `CelebrationSend`), so no migration is needed. The lease logic mirrors `runErrorDigestLocked` in `src/lib/errorDigest.ts:92-160`; it is intentionally copied, not extracted (extracting would force edits to a working, tested module; follow-up candidate).

---

### Task 0: Branch and preflight

**Files:** none changed.

- [ ] **Step 1: Branch from up-to-date main**

```bash
cd /home/ggeorge/workspace/Projects/parishcrm
git fetch origin
git switch main
git pull --ff-only origin main
git switch -c feat/clearance-compliance
git status --short
```
Expected: clean tree on `feat/clearance-compliance`.

- [ ] **Step 2: Verify OSS-47 and OSS-48 are merged. If any check fails, STOP and report; do not continue.**

```bash
grep -n "model PersonClearance" -A6 prisma/schema.prisma
grep -n "ministryRoles" prisma/schema.prisma
test -f src/lib/clearanceStatus.ts && grep -n "export function clearanceStatus\|EXPIRING_WINDOW_DAYS\|CLEARANCE_TYPE_LABELS" src/lib/clearanceStatus.ts
test -f src/lib/ministryRoles.ts && grep -n "MINISTRY_ROLE_LABELS" src/lib/ministryRoles.ts
grep -n "canManageClearances" src/lib/roleGuard.ts
grep -n "export async function getWwccVerifyUrl" src/lib/clearanceSettings.ts
grep -n "^export async function" src/lib/actions/clearance.ts
sed -n 1,25p src/lib/actions/clearance.ts
```
Expected: every grep prints a match. Note the exact import lines at the top of `src/lib/actions/clearance.ts` (Task 2 merges into them).

- [ ] **Step 3: Check the id type**

The `id` line from the first grep must be `String @id @default(cuid())` (clearance id is a string) and `personId Int`. If it differs, stop and report.

- [ ] **Step 4: Baseline tests green**

```bash
npm test -- --testPathPatterns="scheduler|clearance|dates" 2>&1 | tail -15
```
Expected: PASS.

---

### Task 1: Compliance data layer (pure view helpers + server loader)

**Files:**
- Create: `src/lib/clearanceComplianceView.ts`
- Create: `src/lib/clearanceCompliance.ts`
- Test: `src/lib/__tests__/clearanceComplianceView.test.ts`, `src/lib/__tests__/clearanceCompliance.test.ts`

**Interfaces:**
- Consumes: `clearanceStatus`, `ClearanceStatus` (`@/lib/clearanceStatus`), `ClearanceType`, `MinistryRole` (`@/lib/generated/prisma/enums`), `formatDMY`, `safeDobDate` (`@/lib/formatting`), `safeDecrypt` (`@/lib/crypto`).
- Produces (used by Tasks 3-7):
  - `clearanceComplianceView.ts`: `CLEARANCE_STATUS_LABELS`, `CLEARANCE_STATUS_VARIANT`, `COMPLIANCE_FILTERS`, `ComplianceFilter`, `FILTER_STATUS`, `FILTER_LABELS`, `parseComplianceFilter(raw)`, `dmy(d: Date | null): string | null`, `WwccBatchRow`, `batchRowIssues(row)`, `isBatchRowReady(row)`, `batchRowTsv(row)`, `batchTsv(rows)`.
  - `clearanceCompliance.ts`: `COMPLIANCE_CAP`, `ComplianceCell`, `ComplianceRow`, `CompliancePerson`, `toComplianceRow(p, today)`, `rowStatuses(row)`, `matchesFilter(row, f)`, `filterRows(rows, f)`, `BucketEntry`, `ComplianceBuckets`, `bucketCompliance(rows)`, `bucketsEmpty(b)`, `countFlaggedPeople(b)`, `loadComplianceRows(today)`, `loadWwccVerifyBatch(today)`.

- [ ] **Step 1: Write the failing test for the pure helpers**

Create `src/lib/__tests__/clearanceComplianceView.test.ts`:

```ts
/** @jest-environment node */
import {
  parseComplianceFilter, dmy, batchRowIssues, isBatchRowReady, batchRowTsv, batchTsv, type WwccBatchRow,
} from "@/lib/clearanceComplianceView"

const row = (over: Partial<WwccBatchRow> = {}): WwccBatchRow => ({
  clearanceId: "c1", personId: 10, familyName: "Testperson", givenName: "Alex",
  dobDmy: "05/03/1990", number: "WWC0000000E", status: "UNVERIFIED",
  expiresDmy: "01/06/2027", verifiedDmy: null, ...over,
})

describe("parseComplianceFilter", () => {
  it.each(["expired", "expiring", "missing", "unverified"])("accepts %s", (v) => {
    expect(parseComplianceFilter(v)).toBe(v)
  })
  it.each([undefined, "", "EXPIRED", "verified", "x"])("rejects %s", (v) => {
    expect(parseComplianceFilter(v)).toBeNull()
  })
})

describe("dmy", () => {
  it("formats a UTC-midnight date as dd/mm/yyyy", () => {
    expect(dmy(new Date("2027-06-01T00:00:00.000Z"))).toBe("01/06/2027")
  })
  it("returns null for null", () => {
    expect(dmy(null)).toBeNull()
  })
})

describe("batch rows", () => {
  it("is ready when DOB and number are present", () => {
    expect(batchRowIssues(row())).toEqual([])
    expect(isBatchRowReady(row())).toBe(true)
  })
  it("flags a missing DOB and a missing number", () => {
    expect(batchRowIssues(row({ dobDmy: null }))).toEqual(["Missing date of birth"])
    expect(batchRowIssues(row({ number: null }))).toEqual(["Missing WWC number"])
    expect(batchRowIssues(row({ dobDmy: null, number: null }))).toHaveLength(2)
    expect(isBatchRowReady(row({ number: null }))).toBe(false)
  })
  it("renders one TSV line in OCG field order: family name, DOB, WWC number", () => {
    expect(batchRowTsv(row())).toBe("Testperson\t05/03/1990\tWWC0000000E")
  })
  it("strips tabs/newlines from cells so a paste cannot shift columns", () => {
    expect(batchRowTsv(row({ familyName: "Test\tperson\n" }))).toBe("Test person\t05/03/1990\tWWC0000000E")
  })
  it("joins only ready rows for copy-all", () => {
    const rows = [row(), row({ clearanceId: "c2", number: null }), row({ clearanceId: "c3", familyName: "Other" })]
    expect(batchTsv(rows)).toBe("Testperson\t05/03/1990\tWWC0000000E\nOther\t05/03/1990\tWWC0000000E")
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- --testPathPatterns="clearanceComplianceView"`
Expected: FAIL, "Cannot find module '@/lib/clearanceComplianceView'".

- [ ] **Step 3: Implement `src/lib/clearanceComplianceView.ts`**

```ts
import type { ClearanceStatus } from "@/lib/clearanceStatus"
import { formatDMY } from "@/lib/formatting"

/**
 * Pure, client-safe helpers shared by the clearance compliance page, the CSV
 * export, the batch-verify client component and the digest. No Prisma, no
 * crypto: anything here may be bundled into the browser.
 */

export const CLEARANCE_STATUS_LABELS: Record<ClearanceStatus, string> = {
  MISSING: "Missing",
  UNVERIFIED: "Unverified",
  VERIFIED: "Verified",
  EXPIRING: "Expiring soon",
  EXPIRED: "Expired",
}

export type StatusBadgeVariant = "default" | "secondary" | "destructive" | "outline"

export const CLEARANCE_STATUS_VARIANT: Record<ClearanceStatus, StatusBadgeVariant> = {
  MISSING: "destructive",
  EXPIRED: "destructive",
  UNVERIFIED: "secondary",
  EXPIRING: "outline",
  VERIFIED: "default",
}

/** Filter chips, in display order (also the digest bucket order). */
export const COMPLIANCE_FILTERS = ["expired", "expiring", "missing", "unverified"] as const
export type ComplianceFilter = (typeof COMPLIANCE_FILTERS)[number]

export const FILTER_STATUS: Record<ComplianceFilter, ClearanceStatus> = {
  expired: "EXPIRED",
  expiring: "EXPIRING",
  missing: "MISSING",
  unverified: "UNVERIFIED",
}

export const FILTER_LABELS: Record<ComplianceFilter, string> = {
  expired: "Expired",
  expiring: "Expiring (60 days)",
  missing: "Missing",
  unverified: "Unverified",
}

/**
 * Parses the `?status=` query value. Anything unknown (including wrong case)
 * is "no filter" so a bad link never throws.
 */
export function parseComplianceFilter(raw: string | undefined | null): ComplianceFilter | null {
  return (COMPLIANCE_FILTERS as readonly string[]).includes(raw ?? "") ? (raw as ComplianceFilter) : null
}

/** A UTC-midnight calendar date as dd/mm/yyyy, or null. */
export function dmy(d: Date | null): string | null {
  return d ? formatDMY(d) : null
}

/**
 * One WWCC awaiting (re)verification, shaped for the OCG employer portal form:
 * Family name, Date of birth, WWC number. Plain strings only (it crosses the
 * server/client boundary). `familyName` is the person's surname, not the
 * household name.
 */
export type WwccBatchRow = {
  clearanceId: string
  personId: number
  familyName: string
  givenName: string
  dobDmy: string | null
  number: string | null
  status: "UNVERIFIED" | "EXPIRING"
  expiresDmy: string | null
  verifiedDmy: string | null
}

/** Reasons a row cannot be pasted into the portal or marked verified. */
export function batchRowIssues(row: Pick<WwccBatchRow, "dobDmy" | "number">): string[] {
  const issues: string[] = []
  if (!row.dobDmy) issues.push("Missing date of birth")
  if (!row.number) issues.push("Missing WWC number")
  return issues
}

/** True when a row has everything the portal asks for. */
export function isBatchRowReady(row: Pick<WwccBatchRow, "dobDmy" | "number">): boolean {
  return batchRowIssues(row).length === 0
}

function cleanCell(s: string | null): string {
  return (s ?? "").replace(/[\t\r\n]+/g, " ").trim()
}

/** `Family name<TAB>DOB<TAB>WWC number` — the portal's field order, for pasting. */
export function batchRowTsv(row: Pick<WwccBatchRow, "familyName" | "dobDmy" | "number">): string {
  return [cleanCell(row.familyName), cleanCell(row.dobDmy), cleanCell(row.number)].join("\t")
}

/** All ready rows, one per line. Rows with missing data are left out. */
export function batchTsv(rows: WwccBatchRow[]): string {
  return rows.filter(isBatchRowReady).map(batchRowTsv).join("\n")
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- --testPathPatterns="clearanceComplianceView"`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the server layer**

Create `src/lib/__tests__/clearanceCompliance.test.ts`:

```ts
/** @jest-environment node */
jest.mock("@/lib/prisma", () => ({
  prisma: { person: { findMany: jest.fn() }, personClearance: { findMany: jest.fn() } },
}))
jest.mock("@/lib/crypto", () => ({
  safeDecrypt: jest.fn((v: string) => (v === "enc:bad" ? "[decryption error]" : v.replace(/^enc:/, ""))),
}))

import { prisma } from "@/lib/prisma"
import {
  toComplianceRow, matchesFilter, filterRows, bucketCompliance, bucketsEmpty, countFlaggedPeople,
  loadComplianceRows, loadWwccVerifyBatch, COMPLIANCE_CAP, type CompliancePerson,
} from "@/lib/clearanceCompliance"

const TODAY = new Date("2026-10-06T00:00:00.000Z")
const d = (s: string) => new Date(`${s}T00:00:00.000Z`)

const person = (over: Partial<CompliancePerson> = {}): CompliancePerson => ({
  id: 1, firstName: "Alex", lastName: "Testperson", ministryRoles: ["SUNDAY_SCHOOL_TEACHER"],
  family: { name: "Testperson Family" }, clearances: [], ...over,
})
const clr = (type: "WWCC" | "SAFE_MINISTRY", over: Record<string, unknown> = {}) => ({
  id: type === "WWCC" ? "c11" : "c12", type, number: "enc:WWC0000000E",
  expiresAt: d("2027-06-01"), verifiedAt: new Date("2026-09-01T00:00:00Z"), ...over,
})

describe("toComplianceRow", () => {
  it("marks both types MISSING for a ministry-role person with no clearances", () => {
    const r = toComplianceRow(person(), TODAY)
    expect(r.wwcc.status).toBe("MISSING")
    expect(r.safeMinistry.status).toBe("MISSING")
    expect(r.wwcc.clearanceId).toBeNull()
  })
  it("leaves an absent type null (not required) for a person with no ministry role", () => {
    const r = toComplianceRow(person({ ministryRoles: [], clearances: [clr("WWCC")] }), TODAY)
    expect(r.wwcc.status).toBe("VERIFIED")
    expect(r.safeMinistry.status).toBeNull()
  })
  it("maps statuses through clearanceStatus and exposes hasNumber, never the number", () => {
    const r = toComplianceRow(person({
      clearances: [clr("WWCC", { verifiedAt: null }), clr("SAFE_MINISTRY", { expiresAt: d("2026-09-01"), number: null })],
    }), TODAY)
    expect(r.wwcc.status).toBe("UNVERIFIED")
    expect(r.wwcc.hasNumber).toBe(true)
    expect(r.safeMinistry.status).toBe("EXPIRED")
    expect(r.safeMinistry.hasNumber).toBe(false)
    expect(JSON.stringify(r)).not.toContain("WWC0000000E")
  })
  it("flags a verified clearance expiring within 60 days as EXPIRING", () => {
    const r = toComplianceRow(person({ clearances: [clr("WWCC", { expiresAt: d("2026-11-15") })] }), TODAY)
    expect(r.wwcc.status).toBe("EXPIRING")
  })
})

describe("filters and buckets", () => {
  const rows = [
    toComplianceRow(person({ id: 1, firstName: "Alex", clearances: [clr("WWCC", { expiresAt: d("2026-09-01") })] }), TODAY), // WWCC expired, SM missing
    toComplianceRow(person({ id: 2, firstName: "Blake", clearances: [clr("WWCC"), clr("SAFE_MINISTRY")] }), TODAY), // all verified
    toComplianceRow(person({ id: 3, firstName: "Casey", clearances: [clr("WWCC", { verifiedAt: null }), clr("SAFE_MINISTRY", { expiresAt: d("2026-11-15") })] }), TODAY), // unverified + expiring
  ]
  it("matches a row when either cell has the status", () => {
    expect(filterRows(rows, "expired").map((r) => r.personId)).toEqual([1])
    expect(filterRows(rows, "missing").map((r) => r.personId)).toEqual([1])
    expect(filterRows(rows, "unverified").map((r) => r.personId)).toEqual([3])
    expect(filterRows(rows, "expiring").map((r) => r.personId)).toEqual([3])
    expect(filterRows(rows, null)).toHaveLength(3)
    expect(matchesFilter(rows[1], "expired")).toBe(false)
  })
  it("buckets names with the clearance types that triggered them, in row order", () => {
    const b = bucketCompliance(rows)
    expect(b.expired).toEqual([{ personId: 1, name: "Alex Testperson", types: ["WWCC"] }])
    expect(b.missing).toEqual([{ personId: 1, name: "Alex Testperson", types: ["SAFE_MINISTRY"] }])
    expect(b.unverified).toEqual([{ personId: 3, name: "Casey Testperson", types: ["WWCC"] }])
    expect(b.expiring).toEqual([{ personId: 3, name: "Casey Testperson", types: ["SAFE_MINISTRY"] }])
    expect(bucketsEmpty(b)).toBe(false)
    expect(countFlaggedPeople(b)).toBe(2)
  })
  it("reports empty buckets when everyone is verified", () => {
    const b = bucketCompliance([rows[1]])
    expect(bucketsEmpty(b)).toBe(true)
    expect(countFlaggedPeople(b)).toBe(0)
  })
})

describe("loadComplianceRows", () => {
  const findMany = prisma.person.findMany as jest.Mock
  beforeEach(() => jest.clearAllMocks())

  it("queries active people with a ministry role or any clearance and never selects document bytes", async () => {
    findMany.mockResolvedValue([person()])
    const { rows, truncated } = await loadComplianceRows(TODAY)
    const arg = findMany.mock.calls[0][0]
    expect(arg.where).toEqual({
      archivedAt: null,
      OR: [{ ministryRoles: { isEmpty: false } }, { clearances: { some: {} } }],
    })
    expect(arg.select.clearances.select.document).toBeUndefined()
    expect(arg.take).toBe(COMPLIANCE_CAP + 1)
    expect(rows).toHaveLength(1)
    expect(truncated).toBe(false)
  })
  it("flags truncation when the cap is exceeded", async () => {
    findMany.mockResolvedValue(Array.from({ length: COMPLIANCE_CAP + 1 }, (_, i) => person({ id: i + 1 })))
    const { rows, truncated } = await loadComplianceRows(TODAY)
    expect(rows).toHaveLength(COMPLIANCE_CAP)
    expect(truncated).toBe(true)
  })
})

describe("loadWwccVerifyBatch", () => {
  const findMany = prisma.personClearance.findMany as jest.Mock
  beforeEach(() => jest.clearAllMocks())

  const dbRow = (over: Record<string, unknown> = {}, p: Record<string, unknown> = {}) => ({
    id: "c11", number: "enc:WWC0000000E", expiresAt: d("2027-06-01"), verifiedAt: null,
    person: { id: 1, firstName: "Alex", lastName: "Testperson", dateOfBirth: "enc:1990-03-05", ...p },
    ...over,
  })

  it("keeps only never-verified, unexpired WWCC rows, decrypts DOB + number, formats dd/mm/yyyy", async () => {
    findMany.mockResolvedValue([
      dbRow(),                                                                                   // unverified
      dbRow({ id: "c12", expiresAt: d("2026-11-15") }),                                             // unverified + expiring: keep
      dbRow({ id: "c15", verifiedAt: new Date("2026-09-01T00:00:00Z"), expiresAt: d("2026-11-15") }), // verified + expiring: skip (renewal clears verification)
      dbRow({ id: "c13", verifiedAt: new Date("2026-09-01T00:00:00Z") }),                           // verified: skip
      dbRow({ id: "c14", expiresAt: d("2026-09-01") }),                                             // expired: skip
    ])
    const out = await loadWwccVerifyBatch(TODAY)
    expect(findMany.mock.calls[0][0].where).toEqual({ type: "WWCC", person: { archivedAt: null } })
    expect(out.map((r) => [r.clearanceId, r.status])).toEqual([["c11", "UNVERIFIED"], ["c12", "EXPIRING"]])
    expect(out[0]).toMatchObject({
      personId: 1, familyName: "Testperson", givenName: "Alex",
      dobDmy: "05/03/1990", number: "WWC0000000E", expiresDmy: "01/06/2027", verifiedDmy: null,
    })
    expect(out[1].verifiedDmy).toBe("01/09/2026")
  })
  it("treats a missing or undecryptable DOB / number as null so the row is flagged, never pasted as junk", async () => {
    findMany.mockResolvedValue([
      dbRow({ number: null }, { dateOfBirth: null }),
      dbRow({ id: "c12", number: "enc:bad" }, { dateOfBirth: "enc:bad" }),
    ])
    const out = await loadWwccVerifyBatch(TODAY)
    expect(out[0]).toMatchObject({ dobDmy: null, number: null })
    expect(out[1]).toMatchObject({ dobDmy: null, number: null })
  })
})
```

- [ ] **Step 6: Run to verify it fails**

Run: `npm test -- --testPathPatterns="clearanceCompliance"`
Expected: FAIL, "Cannot find module '@/lib/clearanceCompliance'".

- [ ] **Step 7: Implement `src/lib/clearanceCompliance.ts`**

```ts
import { prisma } from "@/lib/prisma"
import { safeDecrypt } from "@/lib/crypto"
import { ClearanceType, type MinistryRole } from "@/lib/generated/prisma/enums"
import { clearanceStatus, type ClearanceStatus } from "@/lib/clearanceStatus"
import { safeDobDate } from "@/lib/formatting"
import {
  COMPLIANCE_FILTERS, FILTER_STATUS, dmy, type ComplianceFilter, type WwccBatchRow,
} from "@/lib/clearanceComplianceView"

/**
 * Compliance queries shared by the /people/clearances page, the CSV export and
 * the monthly digest. A person is "required" to hold both clearance types when
 * they carry at least one ministry role; a person with no role who nonetheless
 * has a clearance on file is listed too, but an absent type is then simply
 * not required (`status: null`) rather than MISSING.
 *
 * The WWC number is never put on a row here (only `hasNumber`); the batch
 * loader below is the single place that decrypts it.
 */

/** Rows decrypted/listed per request; one past it is fetched to detect truncation. */
export const COMPLIANCE_CAP = 2000

export type ComplianceCell = {
  status: ClearanceStatus | null // null = not required and none on file
  clearanceId: string | null
  expiresAt: Date | null
  verifiedAt: Date | null
  hasNumber: boolean
}

export type ComplianceRow = {
  personId: number
  firstName: string
  lastName: string
  familyName: string
  ministryRoles: MinistryRole[]
  wwcc: ComplianceCell
  safeMinistry: ComplianceCell
}

/** The shape `loadComplianceRows` selects from Prisma (no document bytes). */
export type CompliancePerson = {
  id: number
  firstName: string
  lastName: string
  ministryRoles: MinistryRole[]
  family: { name: string }
  clearances: {
    id: string
    type: ClearanceType
    number: string | null
    expiresAt: Date | null
    verifiedAt: Date | null
  }[]
}

/**
 * Builds one list row from a person and their clearances, computing each
 * cell's status as of `today` (a Sydney calendar date at UTC midnight).
 */
export function toComplianceRow(p: CompliancePerson, today: Date): ComplianceRow {
  const required = p.ministryRoles.length > 0
  const cell = (type: ClearanceType): ComplianceCell => {
    const c = p.clearances.find((x) => x.type === type)
    if (!c) {
      return { status: required ? "MISSING" : null, clearanceId: null, expiresAt: null, verifiedAt: null, hasNumber: false }
    }
    return {
      status: clearanceStatus(c, today),
      clearanceId: c.id,
      expiresAt: c.expiresAt,
      verifiedAt: c.verifiedAt,
      hasNumber: c.number !== null,
    }
  }
  return {
    personId: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    familyName: p.family.name,
    ministryRoles: p.ministryRoles,
    wwcc: cell(ClearanceType.WWCC),
    safeMinistry: cell(ClearanceType.SAFE_MINISTRY),
  }
}

/** The (non-null) statuses of a row's two cells. */
export function rowStatuses(row: ComplianceRow): ClearanceStatus[] {
  return [row.wwcc.status, row.safeMinistry.status].filter((s): s is ClearanceStatus => s !== null)
}

/** True when either cell has the status the filter stands for. */
export function matchesFilter(row: ComplianceRow, f: ComplianceFilter): boolean {
  return rowStatuses(row).includes(FILTER_STATUS[f])
}

/** `rows` unchanged for no filter, otherwise only the matching rows. */
export function filterRows(rows: ComplianceRow[], f: ComplianceFilter | null): ComplianceRow[] {
  return f ? rows.filter((r) => matchesFilter(r, f)) : rows
}

export type BucketEntry = { personId: number; name: string; types: ClearanceType[] }
export type ComplianceBuckets = Record<ComplianceFilter, BucketEntry[]>

/**
 * Groups rows into the digest buckets (expired / expiring / missing /
 * unverified). A person appears once per bucket with the clearance type(s)
 * that put them there, so two problems on one person show in two buckets.
 */
export function bucketCompliance(rows: ComplianceRow[]): ComplianceBuckets {
  const buckets: ComplianceBuckets = { expired: [], expiring: [], missing: [], unverified: [] }
  for (const row of rows) {
    const cells: [ClearanceType, ComplianceCell][] = [
      [ClearanceType.WWCC, row.wwcc],
      [ClearanceType.SAFE_MINISTRY, row.safeMinistry],
    ]
    for (const bucket of COMPLIANCE_FILTERS) {
      const types = cells.filter(([, c]) => c.status === FILTER_STATUS[bucket]).map(([t]) => t)
      if (types.length) buckets[bucket].push({ personId: row.personId, name: `${row.firstName} ${row.lastName}`, types })
    }
  }
  return buckets
}

/** True when no bucket has anyone in it (the digest is skipped). */
export function bucketsEmpty(b: ComplianceBuckets): boolean {
  return COMPLIANCE_FILTERS.every((k) => b[k].length === 0)
}

/** Distinct people across all buckets. */
export function countFlaggedPeople(b: ComplianceBuckets): number {
  return new Set(COMPLIANCE_FILTERS.flatMap((k) => b[k].map((e) => e.personId))).size
}

/**
 * Loads every active person with a ministry role or any clearance, ordered by
 * surname, as list rows. `truncated` is true when more than COMPLIANCE_CAP
 * people matched (rows then holds the first COMPLIANCE_CAP).
 */
export async function loadComplianceRows(today: Date): Promise<{ rows: ComplianceRow[]; truncated: boolean }> {
  const people = await prisma.person.findMany({
    where: {
      archivedAt: null,
      OR: [{ ministryRoles: { isEmpty: false } }, { clearances: { some: {} } }],
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: COMPLIANCE_CAP + 1,
    select: {
      id: true, firstName: true, lastName: true, ministryRoles: true,
      family: { select: { name: true } },
      clearances: { select: { id: true, type: true, number: true, expiresAt: true, verifiedAt: true } },
    },
  })
  return {
    rows: people.slice(0, COMPLIANCE_CAP).map((p) => toComplianceRow(p, today)),
    truncated: people.length > COMPLIANCE_CAP,
  }
}

// What cryptoCore.safeDecrypt returns when a value cannot be decrypted.
const DECRYPT_FAILED = "[decryption error]"

function decryptOrNull(value: string | null): string | null {
  if (!value) return null
  const plain = safeDecrypt(value)
  return plain === DECRYPT_FAILED ? null : plain
}

/**
 * WWCCs that need checking on the OCG portal: never verified (verifiedAt null)
 * and not yet expired (UNVERIFIED, or EXPIRING while unverified), with the
 * three portal fields decrypted (surname, DOB dd/mm/yyyy, WWC number). This is
 * the only loader that returns a WWC number or DOB; callers must be gated by
 * `canManageClearances`. A DOB or number that is absent or cannot be decrypted
 * comes back null so the UI flags the row instead of offering junk to paste.
 */
export async function loadWwccVerifyBatch(today: Date): Promise<WwccBatchRow[]> {
  const clearances = await prisma.personClearance.findMany({
    where: { type: ClearanceType.WWCC, person: { archivedAt: null } },
    orderBy: [{ person: { lastName: "asc" } }, { person: { firstName: "asc" } }],
    take: COMPLIANCE_CAP,
    select: {
      id: true, number: true, expiresAt: true, verifiedAt: true,
      person: { select: { id: true, firstName: true, lastName: true, dateOfBirth: true } },
    },
  })
  const out: WwccBatchRow[] = []
  for (const c of clearances) {
    const status = clearanceStatus(c, today)
    // Verified rows are done until renewal (a changed number/expiry clears verification); expired ones cannot pass the portal.
    if (c.verifiedAt || status === "EXPIRED") continue
    const dobPlain = decryptOrNull(c.person.dateOfBirth)
    out.push({
      clearanceId: c.id,
      personId: c.person.id,
      familyName: c.person.lastName,
      givenName: c.person.firstName,
      dobDmy: dmy(dobPlain ? safeDobDate(dobPlain) : null),
      number: decryptOrNull(c.number),
      status,
      expiresDmy: dmy(c.expiresAt),
      verifiedDmy: dmy(c.verifiedAt),
    })
  }
  return out
}
```

- [ ] **Step 8: Run to verify pass**

Run: `npm test -- --testPathPatterns="clearanceComplianceView|clearanceCompliance"`
Expected: PASS (both suites).

- [ ] **Step 9: Commit**

```bash
git add src/lib/clearanceComplianceView.ts src/lib/clearanceCompliance.ts src/lib/__tests__/clearanceComplianceView.test.ts src/lib/__tests__/clearanceCompliance.test.ts
git commit -m "feat(people): clearance compliance data layer" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `verifyClearancesBulk` server action

**Files:**
- Modify: `src/lib/actions/clearance.ts` (append; merge imports into the existing import block)
- Test: `src/lib/actions/__tests__/clearanceBulk.test.ts` (create)

**Interfaces:**
- Consumes: `auth`, `actorId` (`@/lib/actor`), `canManageClearances`, `logAudit`, `assertNotDemo`, `encrypt` (`@/lib/crypto`), `prisma`, `revalidatePath`, `ActionResultWithSuccess` (`./types`).
- Produces: `verifyClearancesBulk(ids: string[], note?: string): Promise<ActionResultWithSuccess>` used by Task 5.

- [ ] **Step 1: Write the failing test**

Create `src/lib/actions/__tests__/clearanceBulk.test.ts`:

```ts
/** @jest-environment node */
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@/lib/crypto", () => ({ encrypt: jest.fn((v: string) => `enc:${v}`) }))
jest.mock("@/lib/demoMode", () => ({ assertNotDemo: jest.fn(() => null), isDemoMode: jest.fn(() => false) }))
jest.mock("@/lib/prisma", () => ({
  prisma: { personClearance: { findMany: jest.fn(), updateMany: jest.fn() } },
}))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { assertNotDemo } from "@/lib/demoMode"
import { revalidatePath } from "next/cache"
import { verifyClearancesBulk } from "@/lib/actions/clearance"

const mockAuth = auth as jest.Mock
const findMany = prisma.personClearance.findMany as jest.Mock
const updateMany = prisma.personClearance.updateMany as jest.Mock

const found = [
  { id: "c11", personId: 1, type: "WWCC", number: "enc:x" },
  { id: "c12", personId: 2, type: "WWCC", number: "enc:y" },
]

describe("verifyClearancesBulk", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { role: "OFFICE_ADMIN", id: "7" } })
    findMany.mockResolvedValue(found)
    updateMany.mockResolvedValue({ count: 2 })
  })

  it("is blocked in demo mode before anything else", async () => {
    ;(assertNotDemo as jest.Mock).mockReturnValueOnce({ error: "demo" })
    expect(await verifyClearancesBulk(["c11"])).toEqual({ error: "demo" })
    expect(mockAuth).not.toHaveBeenCalled()
  })

  it.each(["VIEWER", "AUDITOR", "EVENT_ORGANISER"])("rejects %s", async (role) => {
    mockAuth.mockResolvedValue({ user: { role, id: "7" } })
    expect(await verifyClearancesBulk(["c11"])).toEqual({ error: "Unauthorized" })
    expect(updateMany).not.toHaveBeenCalled()
  })

  it("rejects an unauthenticated caller", async () => {
    mockAuth.mockResolvedValue(null)
    expect(await verifyClearancesBulk(["c11"])).toEqual({ error: "Unauthorized" })
  })

  it("rejects an empty selection, a non-id and an oversize selection", async () => {
    expect(await verifyClearancesBulk([])).toEqual({ error: "Select at least one clearance" })
    expect(await verifyClearancesBulk(["c11", ""])).toEqual({ error: "Invalid selection" })
    expect(await verifyClearancesBulk(["c11", 5 as unknown as string])).toEqual({ error: "Invalid selection" })
    const many = Array.from({ length: 201 }, (_, i) => `c${i}`)
    expect(await verifyClearancesBulk(many)).toEqual({ error: "Select at most 200 clearances at a time" })
    expect(updateMany).not.toHaveBeenCalled()
  })

  it("rejects a note over 500 characters", async () => {
    expect(await verifyClearancesBulk(["c11"], "x".repeat(501))).toEqual({ error: "Note is too long (max 500 characters)" })
  })

  it("fails the whole batch when an id no longer exists (IDOR / stale selection)", async () => {
    findMany.mockResolvedValue([found[0]])
    expect(await verifyClearancesBulk(["c11", "c12"])).toEqual({ error: "Some selected clearances no longer exist" })
    expect(updateMany).not.toHaveBeenCalled()
  })

  it("refuses WWCC rows that have no number", async () => {
    findMany.mockResolvedValue([found[0], { ...found[1], number: null }])
    expect(await verifyClearancesBulk(["c11", "c12"])).toEqual({
      error: "1 selected WWCC record(s) have no WWC number — add it before verifying",
    })
    expect(updateMany).not.toHaveBeenCalled()
  })

  it("verifies the de-duplicated set with actor, time and trimmed note, audits each, revalidates", async () => {
    const res = await verifyClearancesBulk(["c11", "c12", "c11"], "  OCG: current  ")
    expect(findMany).toHaveBeenCalledWith({
      where: { id: { in: ["c11", "c12"] }, person: { archivedAt: null } },
      select: { id: true, personId: true, type: true, number: true },
    })
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["c11", "c12"] } },
      data: { verifiedAt: expect.any(Date), verifiedById: 7, verificationNote: "enc:OCG: current" },
    })
    expect(logAudit).toHaveBeenCalledTimes(2)
    expect(logAudit).toHaveBeenCalledWith(7, "CLEARANCE_VERIFIED", "Person", 1, { clearanceId: "c11", type: "WWCC", bulk: true, hasNote: true })
    expect(revalidatePath).toHaveBeenCalledWith("/people/clearances")
    expect(revalidatePath).toHaveBeenCalledWith("/people/1")
    expect(res).toEqual({ success: "Marked 2 clearance(s) verified" })
  })

  it("stores a blank note as null", async () => {
    await verifyClearancesBulk(["c11"], "   ")
    expect(updateMany.mock.calls[0][0].data.verificationNote).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --testPathPatterns="clearanceBulk"`
Expected: FAIL, `verifyClearancesBulk` is not a function / not exported.

- [ ] **Step 3: Implement**

At the top of `src/lib/actions/clearance.ts`, merge (do not duplicate) these imports into the existing block: `auth` from `@/auth`, `actorId` from `@/lib/actor`, `revalidatePath` from `next/cache`, `prisma`, `canManageClearances`, `logAudit`, `assertNotDemo`, `encrypt` (`@/lib/crypto`) from `@/lib/validation`, `type ActionResultWithSuccess` from `./types`. Then append at the end of the file:

```ts
// Not exported: a "use server" module may only export async functions.
const BULK_VERIFY_MAX = 200
const VERIFY_NOTE_MAX = 500

/**
 * Marks many clearances verified in one step (the "Mark verified" button on the
 * WWCC batch helper). One optional note (for example the portal's status text)
 * is stored on every row. All-or-nothing: if any id is missing, archived or a
 * WWCC without a number, nothing is written. Verification time and actor are
 * recorded; one CLEARANCE_VERIFIED audit entry is written per clearance.
 */
export async function verifyClearancesBulk(ids: string[], note?: string): Promise<ActionResultWithSuccess> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!canManageClearances(session?.user?.role)) return { error: "Unauthorized" }

  if (!Array.isArray(ids) || ids.length === 0) return { error: "Select at least one clearance" }
  if (ids.length > BULK_VERIFY_MAX) return { error: `Select at most ${BULK_VERIFY_MAX} clearances at a time` }
  if (!ids.every((id) => typeof id === "string" && id.length > 0 && id.length <= 64)) return { error: "Invalid selection" }
  const cleanNote = typeof note === "string" ? note.trim() : ""
  if (cleanNote.length > VERIFY_NOTE_MAX) return { error: `Note is too long (max ${VERIFY_NOTE_MAX} characters)` }

  const unique = [...new Set(ids)]
  const found = await prisma.personClearance.findMany({
    where: { id: { in: unique }, person: { archivedAt: null } },
    select: { id: true, personId: true, type: true, number: true },
  })
  if (found.length !== unique.length) return { error: "Some selected clearances no longer exist" }
  const noNumber = found.filter((c) => c.type === "WWCC" && !c.number)
  if (noNumber.length > 0) {
    return { error: `${noNumber.length} selected WWCC record(s) have no WWC number — add it before verifying` }
  }

  const actor = actorId(session)
  const { count } = await prisma.personClearance.updateMany({
    where: { id: { in: unique } },
    data: { verifiedAt: new Date(), verifiedById: actor, verificationNote: cleanNote ? encrypt(cleanNote) : null },
  })
  for (const c of found) {
    await logAudit(actor, "CLEARANCE_VERIFIED", "Person", c.personId, { clearanceId: c.id, type: c.type, bulk: true, hasNote: cleanNote !== "" })
  }
  revalidatePath("/people/clearances")
  for (const personId of new Set(found.map((c) => c.personId))) revalidatePath(`/people/${personId}`)
  return { success: `Marked ${count} clearance(s) verified` }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- --testPathPatterns="clearanceBulk|actions/__tests__/clearance"`
Expected: PASS (existing OSS-48 clearance action tests still pass).

- [ ] **Step 5: Commit**

```bash
git add src/lib/actions/clearance.ts src/lib/actions/__tests__/clearanceBulk.test.ts
git commit -m "feat(people): bulk verify clearances action" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Compliance page (list, filter chips), table, nav link

**Files:**
- Create: `src/components/people/ClearanceComplianceTable.tsx`
- Create: `src/app/(dashboard)/people/clearances/page.tsx`
- Create: `src/app/(dashboard)/people/clearances/loading.tsx`
- Modify: `src/components/layout/sidebar/navData.ts:5` (icon import) and `:40` (nav item)
- Test: `src/app/(dashboard)/people/clearances/__tests__/page.test.tsx`, add a case to `__tests__/components/sidebar/navData.test.ts`

**Interfaces:**
- Consumes: Task 1 (`loadComplianceRows`, `filterRows`, `loadWwccVerifyBatch`, `ComplianceRow`, view helpers), `getWwccVerifyUrl`, `canManageClearances`, `MINISTRY_ROLE_LABELS`.
- Produces: route `/people/clearances` with `?status=expired|expiring|missing|unverified` and `?view=batch` (batch component is Task 5; this task wires a placeholder-free import of it, so Task 5's component file must exist first — to keep tasks independently green, this task renders the batch view only after Task 5; see Step 6 note).

- [ ] **Step 1: Write the failing page test**

Create `src/app/(dashboard)/people/clearances/__tests__/page.test.tsx`:

```tsx
/** @jest-environment node */
import { renderToStaticMarkup } from "react-dom/server"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn((to: string) => { throw new Error(`REDIRECT:${to}`) }),
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@/lib/clearanceSettings", () => ({ getWwccVerifyUrl: jest.fn().mockResolvedValue("https://portal.example.test/login") }))
jest.mock("@/lib/prisma", () => ({ prisma: {} }))
jest.mock("@/lib/crypto", () => ({ safeDecrypt: jest.fn() }))
jest.mock("@/lib/clearanceCompliance", () => ({
  ...jest.requireActual("@/lib/clearanceCompliance"),
  loadComplianceRows: jest.fn(),
  loadWwccVerifyBatch: jest.fn(),
}))
jest.mock("@/components/people/ClearanceComplianceTable", () => {
  const React = require("react")
  return { ClearanceComplianceTable: ({ rows }: { rows: unknown[] }) => React.createElement("div", { "data-testid": "table" }, `rows:${rows.length}`) }
})
jest.mock("@/components/people/WwccBatchVerify", () => {
  const React = require("react")
  return { WwccBatchVerify: ({ rows, verifyUrl }: { rows: unknown[]; verifyUrl: string }) => React.createElement("div", { "data-testid": "batch" }, `batch:${rows.length}:${verifyUrl}`) }
})

import { auth } from "@/auth"
import { logAudit } from "@/lib/audit"
import { loadComplianceRows, loadWwccVerifyBatch, toComplianceRow } from "@/lib/clearanceCompliance"
import ClearancesPage from "../page"

const mockAuth = auth as jest.Mock
const TODAY = new Date()
const mkRow = (id: number, expired: boolean) => toComplianceRow({
  id, firstName: "P" + id, lastName: "Testperson", ministryRoles: ["STAFF"], family: { name: "F" },
  clearances: expired ? [{ id: id * 10, type: "WWCC", number: "x", expiresAt: new Date("2020-01-01T00:00:00Z"), verifiedAt: new Date() }] : [],
}, TODAY)

async function render(sp: Record<string, string> = {}) {
  return renderToStaticMarkup(await ClearancesPage({ searchParams: Promise.resolve(sp) }))
}

describe("ClearancesPage", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { role: "OFFICE_ADMIN", id: "7" } })
    ;(loadComplianceRows as jest.Mock).mockResolvedValue({ rows: [mkRow(1, true), mkRow(2, false)], truncated: false })
    ;(loadWwccVerifyBatch as jest.Mock).mockResolvedValue([{ clearanceId: "c1" }])
  })

  it("redirects an unauthenticated visitor to /login", async () => {
    mockAuth.mockResolvedValue(null)
    await expect(render()).rejects.toThrow("REDIRECT:/login")
  })
  it.each(["VIEWER", "AUDITOR", "EVENT_ORGANISER"])("redirects %s to /", async (role) => {
    mockAuth.mockResolvedValue({ user: { role, id: "7" } })
    await expect(render()).rejects.toThrow("REDIRECT:/")
    expect(loadComplianceRows).not.toHaveBeenCalled()
  })
  it("lists all rows with filter chips and a CSV link", async () => {
    const html = await render()
    expect(html).toContain("rows:2")
    expect(html).toContain("?status=expired")
    expect(html).toContain("/api/clearances/export")
    expect(html).toContain("view=batch")
  })
  it("applies a valid status filter and carries it into the CSV link", async () => {
    const html = await render({ status: "missing" })
    expect(html).toContain("rows:1") // only person 2 has MISSING cells; person 1 has WWCC expired + SM missing too
    expect(html).toContain("/api/clearances/export?status=missing")
  })
  it("ignores an unknown status", async () => {
    expect(await render({ status: "bogus" })).toContain("rows:2")
  })
  it("batch view loads the batch, passes the portal URL, and audits the view", async () => {
    const html = await render({ view: "batch" })
    expect(html).toContain("batch:1:https://portal.example.test/login")
    expect(loadComplianceRows).not.toHaveBeenCalled()
    expect(logAudit).toHaveBeenCalledWith(7, "CLEARANCE_BATCH_VIEWED", "Person", undefined, { rowCount: 1 })
  })
})
```

Note on the "missing" case: person 1 (WWCC expired, Safe Ministry absent => MISSING) AND person 2 (both MISSING) both match `missing`, so the real expectation is `rows:2`. Use `expect(html).toContain("rows:2")` in that test; the `/api/clearances/export?status=missing` assertion is what proves filtering is carried. (Fix the literal when pasting; it is called out here so the executor does not "fix" the code to match a wrong test.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --testPathPatterns="people/clearances"`
Expected: FAIL, "Cannot find module '../page'".

- [ ] **Step 3: Implement the table**

Create `src/components/people/ClearanceComplianceTable.tsx`:

```tsx
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { MINISTRY_ROLE_LABELS } from "@/lib/ministryRoles"
import { CLEARANCE_STATUS_LABELS, CLEARANCE_STATUS_VARIANT, dmy } from "@/lib/clearanceComplianceView"
import type { ComplianceCell, ComplianceRow } from "@/lib/clearanceCompliance"

/** Status badge plus expiry date for one clearance type; a dash when not required and none on file. */
function StatusCell({ cell }: Readonly<{ cell: ComplianceCell }>) {
  if (!cell.status) return <span className="text-muted-foreground">—</span>
  return (
    <div className="flex flex-col gap-0.5">
      <Badge variant={CLEARANCE_STATUS_VARIANT[cell.status]}>{CLEARANCE_STATUS_LABELS[cell.status]}</Badge>
      {cell.expiresAt && <span className="text-xs text-muted-foreground">Expires {dmy(cell.expiresAt)}</span>}
    </div>
  )
}

/**
 * Read-only compliance table: one row per person with their WWCC and Safe
 * Ministry status. Names link to the profile where staff upload and verify.
 * Carries no WWC numbers or dates of birth.
 */
export function ClearanceComplianceTable({ rows }: Readonly<{ rows: ComplianceRow[] }>) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Person</TableHead>
          <TableHead>Family</TableHead>
          <TableHead>Ministry roles</TableHead>
          <TableHead>WWCC</TableHead>
          <TableHead>Safe Ministry</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={5} className="text-center text-muted-foreground">
              Nobody matches. Tag people with a ministry role on their profile to track their clearances.
            </TableCell>
          </TableRow>
        )}
        {rows.map((r) => (
          <TableRow key={r.personId}>
            <TableCell>
              <Link className="font-medium hover:underline" href={`/people/${r.personId}`}>
                {r.lastName}, {r.firstName}
              </Link>
            </TableCell>
            <TableCell>{r.familyName}</TableCell>
            <TableCell>{r.ministryRoles.map((m) => MINISTRY_ROLE_LABELS[m]).join(", ") || "—"}</TableCell>
            <TableCell><StatusCell cell={r.wwcc} /></TableCell>
            <TableCell><StatusCell cell={r.safeMinistry} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
```

- [ ] **Step 4: Implement the page and loading skeleton**

Create `src/app/(dashboard)/people/clearances/loading.tsx`:

```tsx
import { ListPageSkeleton } from "@/components/shared/ListPageSkeleton"

export default function Loading() {
  return <ListPageSkeleton />
}
```

Create `src/app/(dashboard)/people/clearances/page.tsx`:

```tsx
import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { logAudit } from "@/lib/audit"
import { canManageClearances } from "@/lib/roleGuard"
import { sydneyToday } from "@/lib/dates"
import { loadComplianceRows, loadWwccVerifyBatch, filterRows } from "@/lib/clearanceCompliance"
import { getWwccVerifyUrl } from "@/lib/clearanceSettings"
import { COMPLIANCE_FILTERS, FILTER_LABELS, parseComplianceFilter } from "@/lib/clearanceComplianceView"
import { ClearanceComplianceTable } from "@/components/people/ClearanceComplianceTable"
import { WwccBatchVerify } from "@/components/people/WwccBatchVerify"
import { Button } from "@/components/ui/button"

/**
 * Clearance compliance (WWCC + Safe Ministry) for people with a ministry role.
 * Default view: status table with filter chips and CSV export. `?view=batch`:
 * the OCG-portal verification helper. ADMIN, PASTOR and OFFICE_ADMIN only
 * (`canManageClearances`); the server action and CSV route re-check the role.
 */
export default async function ClearancesPage(
  props: Readonly<{ searchParams: Promise<{ status?: string; view?: string }> }>
) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (!canManageClearances(session.user.role)) redirect("/")

  const { status, view } = await props.searchParams
  const today = sydneyToday()

  if (view === "batch") {
    const [rows, verifyUrl] = await Promise.all([loadWwccVerifyBatch(today), getWwccVerifyUrl()])
    // Decrypted DOBs and WWC numbers are shown in bulk here, so leave a trace.
    await logAudit(actorId(session), "CLEARANCE_BATCH_VIEWED", "Person", undefined, { rowCount: rows.length })
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-2xl font-semibold text-foreground">Verify WWCC batch</h2>
          <Button variant="outline" size="sm" asChild>
            <Link href="/people/clearances">Back to compliance</Link>
          </Button>
        </div>
        <WwccBatchVerify rows={rows} verifyUrl={verifyUrl} />
      </div>
    )
  }

  const filter = parseComplianceFilter(status)
  const { rows: all, truncated } = await loadComplianceRows(today)
  const rows = filterRows(all, filter)
  const exportHref = filter ? `/api/clearances/export?status=${filter}` : "/api/clearances/export"

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-semibold text-foreground">Clearance compliance</h2>
        <div className="flex gap-2 print:hidden">
          <Button size="sm" asChild>
            <Link href="/people/clearances?view=batch">Verify WWCC batch</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={exportHref} download>Export CSV</a>
          </Button>
        </div>
      </div>

      <nav aria-label="Filter by status" className="flex flex-wrap gap-2 print:hidden">
        <Button size="sm" variant={filter ? "outline" : "default"} asChild>
          <Link href="/people/clearances">All</Link>
        </Button>
        {COMPLIANCE_FILTERS.map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} asChild>
            <Link href={`/people/clearances?status=${f}`}>{FILTER_LABELS[f]}</Link>
          </Button>
        ))}
      </nav>

      <p className="text-sm text-muted-foreground">
        {rows.length} of {all.length} people with a ministry role or clearance on file
      </p>
      {truncated && (
        <p className="text-sm text-warning bg-warning/10 border border-warning/40 rounded px-3 py-2">
          Too many people to list in full — showing the first {all.length}.
        </p>
      )}

      <ClearanceComplianceTable rows={rows} />
    </div>
  )
}
```

- [ ] **Step 5: Nav link**

Edit `src/components/layout/sidebar/navData.ts`: in the lucide import (line 4) add `BadgeCheck`: change `CalendarDays, Wallet, ReceiptText, Settings2, ShieldCheck,` to `CalendarDays, Wallet, ReceiptText, Settings2, ShieldCheck, BadgeCheck,`. After the Anniversaries line (`{ href: "/people/anniversaries", ...}`, currently line 40) insert:

```ts
        { href: "/people/clearances", label: "Clearances", icon: BadgeCheck, show: isEditor },
```

Append to `__tests__/components/sidebar/navData.test.ts`:

```ts
it("shows the Clearances link only to editors (canManageClearances = canEdit)", () => {
  const visible = (flags: typeof allTrueFlags) =>
    flattenNavItems(buildNavGroups(flags).find((g) => g.label === "Members")!.items)
      .filter((i) => i.show).map((i) => i.label)
  expect(visible(allTrueFlags)).toContain("Clearances")
  expect(visible({ ...allTrueFlags, isEditor: false })).not.toContain("Clearances")
})
```

- [ ] **Step 6: Make the page importable before Task 5**

`page.tsx` imports `WwccBatchVerify` (Task 5). If executing strictly in order, create a minimal stub file now so this task is green, and Task 5 overwrites it:

`src/components/people/WwccBatchVerify.tsx`:
```tsx
"use client"
import type { WwccBatchRow } from "@/lib/clearanceComplianceView"

/** Replaced in Task 5 with the full batch-verify UI. */
export function WwccBatchVerify({ rows }: Readonly<{ rows: WwccBatchRow[]; verifyUrl: string }>) {
  return <p>{rows.length} WWCC(s) to verify</p>
}
```
The page test mocks this module, so it passes regardless.

- [ ] **Step 7: Run to verify pass**

Run: `npm test -- --testPathPatterns="people/clearances|navData"`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/people/ClearanceComplianceTable.tsx src/components/people/WwccBatchVerify.tsx "src/app/(dashboard)/people/clearances" src/components/layout/sidebar/navData.ts __tests__/components/sidebar/navData.test.ts
git commit -m "feat(people): clearance compliance page" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: CSV export route

**Files:**
- Create: `src/app/api/clearances/export/route.ts`
- Test: `src/app/api/clearances/export/__tests__/route.test.ts`

**Interfaces:**
- Consumes: Task 1 (`loadComplianceRows`, `filterRows`, `dmy`, `CLEARANCE_STATUS_LABELS`, `parseComplianceFilter`), `escapeCsv` (`@/lib/csvUtils`), `rateLimit`, `getClientIp`, `logAudit`.
- Produces: `GET /api/clearances/export?status=<filter>` returning `text/csv`; audit action `CLEARANCE_EXPORTED`.

- [ ] **Step 1: Write the failing test**

Create `src/app/api/clearances/export/__tests__/route.test.ts`:

```ts
/** @jest-environment node */
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@/lib/rateLimit", () => ({ rateLimit: jest.fn(() => true) }))
jest.mock("@/lib/prisma", () => ({ prisma: {} }))
jest.mock("@/lib/crypto", () => ({ safeDecrypt: jest.fn() }))
jest.mock("@/lib/clearanceCompliance", () => ({
  ...jest.requireActual("@/lib/clearanceCompliance"),
  loadComplianceRows: jest.fn(),
}))

import { NextRequest } from "next/server"
import { auth } from "@/auth"
import { logAudit } from "@/lib/audit"
import { rateLimit } from "@/lib/rateLimit"
import { loadComplianceRows, toComplianceRow } from "@/lib/clearanceCompliance"
import { GET } from "../route"

const mockAuth = auth as jest.Mock
const req = (q = "") => new NextRequest(`http://localhost/api/clearances/export${q}`)
const today = new Date()
const row = (lastName: string, clearances: object[] = []) =>
  toComplianceRow({
    id: 1, firstName: "Alex", lastName, ministryRoles: ["STAFF", "YOUTH_LEADER"],
    family: { name: "F" }, clearances: clearances as never,
  }, today)

describe("GET /api/clearances/export", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(rateLimit as jest.Mock).mockReturnValue(true)
    mockAuth.mockResolvedValue({ user: { role: "OFFICE_ADMIN", id: "7" } })
    ;(loadComplianceRows as jest.Mock).mockResolvedValue({ rows: [row("Testperson")], truncated: false })
  })

  it("401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null)
    expect((await GET(req())).status).toBe(401)
  })
  it.each(["VIEWER", "AUDITOR", "EVENT_ORGANISER"])("403 for %s", async (role) => {
    mockAuth.mockResolvedValue({ user: { role, id: "7" } })
    expect((await GET(req())).status).toBe(403)
    expect(loadComplianceRows).not.toHaveBeenCalled()
  })
  it("429 when rate limited", async () => {
    ;(rateLimit as jest.Mock).mockReturnValue(false)
    expect((await GET(req())).status).toBe(429)
  })
  it("returns a no-store CSV attachment with headers, roles and statuses, and no sensitive columns", async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("text/csv")
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment; filename="clearance-compliance-\d{4}-\d{2}-\d{2}\.csv"$/)
    const [header, line] = (await res.text()).split("\n")
    expect(header).toBe("Family name,Given name,Ministry roles,WWCC status,WWCC expires,WWCC verified,Safe Ministry status,Safe Ministry expires,Safe Ministry verified")
    expect(line).toBe("Testperson,Alex,Staff; Youth leader,Missing,,,Missing,,")
    expect(header).not.toMatch(/number|birth|dob/i)
  })
  it("neutralises spreadsheet formulas in names (escapeCsv)", async () => {
    ;(loadComplianceRows as jest.Mock).mockResolvedValue({ rows: [row("=cmd")], truncated: false })
    const text = await (await GET(req())).text()
    expect(text.split("\n")[1].startsWith("'=cmd,")).toBe(true)
  })
  it("honours ?status=, audits CLEARANCE_EXPORTED, flags truncation", async () => {
    ;(loadComplianceRows as jest.Mock).mockResolvedValue({
      rows: [row("Testperson"), row("Other", [{ id: "c9", type: "WWCC", number: "x", expiresAt: new Date("2020-01-01T00:00:00Z"), verifiedAt: new Date() }])],
      truncated: true,
    })
    const res = await GET(req("?status=expired"))
    expect((await res.text()).split("\n")).toHaveLength(2) // header + the one expired person
    expect(res.headers.get("X-Export-Truncated")).toBe("true")
    expect(logAudit).toHaveBeenCalledWith(7, "CLEARANCE_EXPORTED", "Person", undefined, { rowCount: 1, filter: "expired" }, expect.any(String))
  })
})
```

Note: the expected `line` depends on the label text for `STAFF` / `YOUTH_LEADER` in `MINISTRY_ROLE_LABELS` (OSS-47). If OSS-47 used different label wording, update the expected literal to `MINISTRY_ROLE_LABELS.STAFF + "; " + MINISTRY_ROLE_LABELS.YOUTH_LEADER` by importing `MINISTRY_ROLE_LABELS` in the test.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --testPathPatterns="clearances/export"`
Expected: FAIL, "Cannot find module '../route'".

- [ ] **Step 3: Implement**

Create `src/app/api/clearances/export/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { canManageClearances } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { getClientIp } from "@/lib/clientIp"
import { rateLimit } from "@/lib/rateLimit"
import { escapeCsv } from "@/lib/csvUtils"
import { sydneyToday, sydneyTodayYMD } from "@/lib/dates"
import { MINISTRY_ROLE_LABELS } from "@/lib/ministryRoles"
import { loadComplianceRows, filterRows, type ComplianceCell } from "@/lib/clearanceCompliance"
import { CLEARANCE_STATUS_LABELS, dmy, parseComplianceFilter } from "@/lib/clearanceComplianceView"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const HEADERS = [
  "Family name", "Given name", "Ministry roles",
  "WWCC status", "WWCC expires", "WWCC verified",
  "Safe Ministry status", "Safe Ministry expires", "Safe Ministry verified",
]

/** Three CSV cells (status label, expiry, verified date) for one clearance type. */
function cells(c: ComplianceCell): string[] {
  return [c.status ? CLEARANCE_STATUS_LABELS[c.status] : "", dmy(c.expiresAt) ?? "", dmy(c.verifiedAt) ?? ""]
}

/**
 * Compliance CSV for ADMIN / PASTOR / OFFICE_ADMIN. Names, roles, statuses and
 * dates only: never the WWC number or date of birth. Every cell goes through
 * `escapeCsv` (formula-injection guard). Optional `?status=` mirrors the page.
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canManageClearances(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  if (!rateLimit(`export:clearances:${actorId(session)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const filter = parseComplianceFilter(req.nextUrl.searchParams.get("status"))
  const now = new Date()
  const { rows: all, truncated } = await loadComplianceRows(sydneyToday(now))
  const rows = filterRows(all, filter)

  const csv = [
    HEADERS,
    ...rows.map((r) => [
      r.lastName, r.firstName, r.ministryRoles.map((m) => MINISTRY_ROLE_LABELS[m]).join("; "),
      ...cells(r.wwcc), ...cells(r.safeMinistry),
    ]),
  ].map((line) => line.map(escapeCsv).join(",")).join("\n")

  await logAudit(actorId(session), "CLEARANCE_EXPORTED", "Person", undefined, { rowCount: rows.length, filter }, getClientIp(req))

  const headers: Record<string, string> = {
    "Content-Type": "text/csv",
    "Content-Disposition": `attachment; filename="clearance-compliance-${sydneyTodayYMD(now)}.csv"`,
    "Cache-Control": "no-store",
  }
  if (truncated) headers["X-Export-Truncated"] = "true"
  return new NextResponse(csv, { headers })
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- --testPathPatterns="clearances/export"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/clearances
git commit -m "feat(people): clearance compliance CSV export" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Batch verify client component

**Files:**
- Overwrite: `src/components/people/WwccBatchVerify.tsx` (stub from Task 3)
- Test: `src/components/people/__tests__/WwccBatchVerify.test.tsx`

**Interfaces:**
- Consumes: `WwccBatchRow`, `batchRowIssues`, `isBatchRowReady`, `batchRowTsv`, `batchTsv`, `CLEARANCE_STATUS_LABELS` (`@/lib/clearanceComplianceView`), `verifyClearancesBulk` (Task 2), `Button`, `Checkbox`, `Input`, `Badge`, `Table*`.
- Produces: `WwccBatchVerify({ rows, verifyUrl })` default portal-order UI.

- [ ] **Step 1: Write the failing test**

Create `src/components/people/__tests__/WwccBatchVerify.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

const refresh = jest.fn()
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
jest.mock("@/lib/actions/clearance", () => ({ verifyClearancesBulk: jest.fn() }))

import { verifyClearancesBulk } from "@/lib/actions/clearance"
import { WwccBatchVerify } from "@/components/people/WwccBatchVerify"
import type { WwccBatchRow } from "@/lib/clearanceComplianceView"

const mockVerify = verifyClearancesBulk as jest.Mock
const writeText = jest.fn().mockResolvedValue(undefined)

const row = (over: Partial<WwccBatchRow> = {}): WwccBatchRow => ({
  clearanceId: "c1", personId: 10, familyName: "Testperson", givenName: "Alex",
  dobDmy: "05/03/1990", number: "WWC0000000E", status: "UNVERIFIED",
  expiresDmy: "01/06/2027", verifiedDmy: null, ...over,
})
const rows = [
  row(),
  row({ clearanceId: "c2", personId: 11, familyName: "Sample", givenName: "Bo", dobDmy: null }),
  row({ clearanceId: "c3", personId: 12, familyName: "Other", givenName: "Cy", status: "EXPIRING", verifiedDmy: "01/09/2026" }),
]

beforeEach(() => {
  jest.clearAllMocks()
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
})

it("links to the portal in a new tab", () => {
  render(<WwccBatchVerify rows={rows} verifyUrl="https://portal.example.test/login" />)
  const link = screen.getByRole("link", { name: /open ocg portal/i })
  expect(link).toHaveAttribute("href", "https://portal.example.test/login")
  expect(link).toHaveAttribute("target", "_blank")
  expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"))
})

it("shows columns in the portal field order and flags a row missing its DOB", () => {
  render(<WwccBatchVerify rows={rows} verifyUrl="https://p.test" />)
  const headers = screen.getAllByRole("columnheader").map((h) => h.textContent)
  expect(headers.indexOf("Family name")).toBeLessThan(headers.indexOf("Date of birth"))
  expect(headers.indexOf("Date of birth")).toBeLessThan(headers.indexOf("WWC number"))
  expect(screen.getByText("Missing date of birth")).toBeInTheDocument()
  expect(screen.getByRole("checkbox", { name: /select bo sample/i })).toBeDisabled()
  expect(screen.getByRole("checkbox", { name: /select alex testperson/i })).toBeEnabled()
})

it("copies a single cell", async () => {
  render(<WwccBatchVerify rows={rows} verifyUrl="https://p.test" />)
  fireEvent.click(screen.getByRole("button", { name: "Copy WWC number for Alex Testperson" }))
  await waitFor(() => expect(writeText).toHaveBeenCalledWith("WWC0000000E"))
})

it("copy all rows copies only ready rows, tab separated, in portal order", async () => {
  render(<WwccBatchVerify rows={rows} verifyUrl="https://p.test" />)
  fireEvent.click(screen.getByRole("button", { name: /copy all rows/i }))
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(
    "Testperson\t05/03/1990\tWWC0000000E\nOther\t05/03/1990\tWWC0000000E"
  ))
})

it("Mark verified is disabled until a row is ticked, then sends ids and the note and refreshes", async () => {
  mockVerify.mockResolvedValue({ success: "Marked 2 clearance(s) verified" })
  render(<WwccBatchVerify rows={rows} verifyUrl="https://p.test" />)
  const mark = screen.getByRole("button", { name: /mark verified/i })
  expect(mark).toBeDisabled()
  fireEvent.click(screen.getByRole("checkbox", { name: /select alex testperson/i }))
  fireEvent.click(screen.getByRole("checkbox", { name: /select cy other/i }))
  fireEvent.change(screen.getByLabelText(/portal outcome note/i), { target: { value: "OCG: current" } })
  fireEvent.click(mark)
  await waitFor(() => expect(mockVerify).toHaveBeenCalledWith(["c1", "c3"], "OCG: current"))
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Marked 2 clearance(s) verified"))
  expect(refresh).toHaveBeenCalled()
})

it("select all ticks only ready rows", () => {
  render(<WwccBatchVerify rows={rows} verifyUrl="https://p.test" />)
  fireEvent.click(screen.getByRole("checkbox", { name: /select all ready/i }))
  expect(screen.getByRole("checkbox", { name: /select alex testperson/i })).toBeChecked()
  expect(screen.getByRole("checkbox", { name: /select bo sample/i })).not.toBeChecked()
})

it("shows an action error and does not refresh", async () => {
  mockVerify.mockResolvedValue({ error: "Unauthorized" })
  render(<WwccBatchVerify rows={rows} verifyUrl="https://p.test" />)
  fireEvent.click(screen.getByRole("checkbox", { name: /select alex testperson/i }))
  fireEvent.click(screen.getByRole("button", { name: /mark verified/i }))
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Unauthorized"))
  expect(refresh).not.toHaveBeenCalled()
})

it("shows an empty state when nothing needs verifying", () => {
  render(<WwccBatchVerify rows={[]} verifyUrl="https://p.test" />)
  expect(screen.getByText(/nothing to verify/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --testPathPatterns="WwccBatchVerify"`
Expected: FAIL (stub lacks the UI).

- [ ] **Step 3: Implement (overwrite the stub)**

`src/components/people/WwccBatchVerify.tsx`:

```tsx
"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { verifyClearancesBulk } from "@/lib/actions/clearance"
import { batchRowIssues, batchTsv, isBatchRowReady, type WwccBatchRow } from "@/lib/clearanceComplianceView"

type Message = { kind: "success" | "error"; text: string }

/** Copies text to the clipboard; false when the browser blocks it. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** One value with a small copy button next to it. */
function CopyCell({ value, label }: Readonly<{ value: string | null; label: string }>) {
  const [copied, setCopied] = useState(false)
  if (!value) return <span className="text-muted-foreground">—</span>
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono text-sm">{value}</span>
      <Button
        type="button" size="sm" variant="ghost" aria-label={label}
        onClick={async () => { if (await copyText(value)) { setCopied(true); setTimeout(() => setCopied(false), 1500) } }}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </span>
  )
}

/**
 * WWCC verification helper. The OCG employer portal has no API, so each row
 * shows Family name, Date of birth and WWC number (the portal's field order)
 * with copy buttons. Staff verify in the portal, tick the rows it confirmed and
 * press Mark verified, which records who/when plus an optional outcome note.
 * Rows missing a DOB or number are flagged and cannot be ticked.
 */
export function WwccBatchVerify({ rows, verifyUrl }: Readonly<{ rows: WwccBatchRow[]; verifyUrl: string }>) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [note, setNote] = useState("")
  const [message, setMessage] = useState<Message | null>(null)
  const [pending, startTransition] = useTransition()
  const [copiedAll, setCopiedAll] = useState(false)

  const ready = rows.filter(isBatchRowReady)
  const allReadySelected = ready.length > 0 && ready.every((r) => selected.has(r.clearanceId))

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const markVerified = () =>
    startTransition(async () => {
      const res = await verifyClearancesBulk([...selected], note)
      if (res && "error" in res) {
        setMessage({ kind: "error", text: res.error })
        return
      }
      if (res && "success" in res) {
        setMessage({ kind: "success", text: res.success })
        setSelected(new Set())
        setNote("")
        router.refresh()
      }
    })

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing to verify: no unverified or expiring WWCCs.</p>
  }

  return (
    <div className="space-y-4">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Open the OCG employer portal and sign in.</li>
        <li>Paste each worker&apos;s family name, date of birth and WWC number (copy buttons below) and click Verify.</li>
        <li>Tick the rows the portal confirmed, add an optional note, then press Mark verified.</li>
      </ol>

      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm">
          <a href={verifyUrl} target="_blank" rel="noopener noreferrer">Open OCG portal ↗</a>
        </Button>
        <Button
          type="button" size="sm" variant="outline" disabled={ready.length === 0}
          onClick={async () => { if (await copyText(batchTsv(rows))) { setCopiedAll(true); setTimeout(() => setCopiedAll(false), 1500) } }}
        >
          {copiedAll ? "Copied" : "Copy all rows"}
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                aria-label="Select all ready rows"
                checked={allReadySelected}
                disabled={ready.length === 0}
                onCheckedChange={(on) => setSelected(on === true ? new Set(ready.map((r) => r.clearanceId)) : new Set())}
              />
            </TableHead>
            <TableHead>Family name</TableHead>
            <TableHead>Date of birth</TableHead>
            <TableHead>WWC number</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Last verified</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const issues = batchRowIssues(r)
            const who = `${r.givenName} ${r.familyName}`
            return (
              <TableRow key={r.clearanceId}>
                <TableCell>
                  <Checkbox
                    aria-label={`Select ${who}`}
                    checked={selected.has(r.clearanceId)}
                    disabled={issues.length > 0}
                    onCheckedChange={(on) => toggle(r.clearanceId, on === true)}
                  />
                </TableCell>
                <TableCell>
                  <CopyCell value={r.familyName} label={`Copy family name for ${who}`} />
                  <div className="text-xs text-muted-foreground">{r.givenName}</div>
                </TableCell>
                <TableCell><CopyCell value={r.dobDmy} label={`Copy date of birth for ${who}`} /></TableCell>
                <TableCell><CopyCell value={r.number} label={`Copy WWC number for ${who}`} /></TableCell>
                <TableCell>
                  <Badge variant={r.status === "EXPIRING" ? "outline" : "secondary"}>
                    {r.status === "EXPIRING" ? `Expiring ${r.expiresDmy ?? ""}`.trim() : "Unverified"}
                  </Badge>
                  {issues.map((i) => (
                    <div key={i} className="text-xs text-destructive">{i}</div>
                  ))}
                </TableCell>
                <TableCell>{r.verifiedDmy ?? "—"}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          Portal outcome note (optional)
          <Input
            aria-label="Portal outcome note"
            maxLength={500} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. OCG: current, no restrictions"
            className="w-80 max-w-full"
          />
        </label>
        <Button type="button" disabled={selected.size === 0 || pending} onClick={markVerified}>
          {pending ? "Saving…" : `Mark verified (${selected.size})`}
        </Button>
      </div>

      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "text-sm text-destructive" : "text-sm text-success"}>
          {message.text}
        </p>
      )}
    </div>
  )
}
```

Implementation note: the visible label "Portal outcome note (optional)" wraps the input and the input also has an `aria-label`; the test queries `getByLabelText(/portal outcome note/i)`, which matches both the wrapping label and the aria-label to the same element, so it resolves uniquely. If RTL reports multiple matches, drop the `aria-label` attribute.

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- --testPathPatterns="WwccBatchVerify"`
Expected: PASS. If `toBeInTheDocument` is undefined, check `jest.setup` loads `@testing-library/jest-dom` (other component tests use it; mirror their imports).

- [ ] **Step 5: Commit**

```bash
git add src/components/people/WwccBatchVerify.tsx src/components/people/__tests__/WwccBatchVerify.test.tsx
git commit -m "feat(people): WWCC batch verify helper" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Digest email renderer

**Files:**
- Create: `src/lib/clearanceDigestEmail.ts`
- Test: `src/lib/__tests__/clearanceDigestEmail.test.ts`

**Interfaces:**
- Consumes: `ComplianceBuckets`, `BucketEntry` (Task 1), `COMPLIANCE_FILTERS`, `FILTER_LABELS` (`clearanceComplianceView`), `CLEARANCE_TYPE_LABELS`, `EXPIRING_WINDOW_DAYS` (`clearanceStatus`).
- Produces: `renderClearanceDigestEmail(input: { churchName: string; asOf: string; buckets: ComplianceBuckets; complianceUrl: string | null }): { subject: string; html: string; text: string }`; `NAMES_PER_BUCKET = 50`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/clearanceDigestEmail.test.ts`:

```ts
/** @jest-environment node */
import { renderClearanceDigestEmail, NAMES_PER_BUCKET } from "@/lib/clearanceDigestEmail"
import type { ComplianceBuckets } from "@/lib/clearanceCompliance"

jest.mock("@/lib/prisma", () => ({ prisma: {} }))
jest.mock("@/lib/crypto", () => ({ safeDecrypt: jest.fn() }))

const empty: ComplianceBuckets = { expired: [], expiring: [], missing: [], unverified: [] }
const input = (b: Partial<ComplianceBuckets>, url: string | null = "https://crm.example.test/people/clearances") => ({
  churchName: "Test Church", asOf: "01/11/2026", buckets: { ...empty, ...b }, complianceUrl: url,
})

describe("renderClearanceDigestEmail", () => {
  const buckets: Partial<ComplianceBuckets> = {
    expired: [{ personId: 1, name: "Alex Testperson", types: ["WWCC"] }],
    expiring: [{ personId: 2, name: "Bo Sample", types: ["WWCC", "SAFE_MINISTRY"] }],
    missing: [{ personId: 3, name: "Cy Other", types: ["SAFE_MINISTRY"] }],
    unverified: [{ personId: 4, name: "Di Example", types: ["WWCC"] }],
  }

  it("has a church-named subject and the as-of date", () => {
    const r = renderClearanceDigestEmail(input(buckets))
    expect(r.subject).toBe("Clearance compliance digest — Test Church")
    expect(r.text).toContain("01/11/2026")
  })
  it("lists each bucket with count, names and the clearance types, in Expired/Expiring/Missing/Unverified order", () => {
    const { text } = renderClearanceDigestEmail(input(buckets))
    const order = ["Expired (1)", "Expiring within 60 days (1)", "Missing (1)", "Unverified (1)"].map((h) => text.indexOf(h))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(text).toContain("Alex Testperson — WWCC")
    expect(text).toContain("Bo Sample — WWCC, Safe Ministry")
  })
  it("omits empty buckets", () => {
    const { text } = renderClearanceDigestEmail(input({ expired: buckets.expired }))
    expect(text).toContain("Expired (1)")
    expect(text).not.toContain("Missing (")
  })
  it("links to the compliance page and reminds admins to act on OCG barring alerts", () => {
    const r = renderClearanceDigestEmail(input(buckets))
    expect(r.html).toContain('href="https://crm.example.test/people/clearances"')
    expect(r.text).toContain("https://crm.example.test/people/clearances")
    expect(r.text).toMatch(/barring alert/i)
    expect(r.html).toMatch(/barring alert/i)
  })
  it("falls back to a navigation hint when there is no base URL", () => {
    const r = renderClearanceDigestEmail(input(buckets, null))
    expect(r.html).not.toContain("href=")
    expect(r.text).toContain("People > Clearances")
  })
  it("HTML-escapes names", () => {
    const r = renderClearanceDigestEmail(input({ missing: [{ personId: 9, name: "<b>Eve</b> & Co", types: ["WWCC"] }] }))
    expect(r.html).toContain("&lt;b&gt;Eve&lt;/b&gt; &amp; Co")
    expect(r.html).not.toContain("<b>Eve</b>")
  })
  it("caps names per bucket and says how many were left out", () => {
    const many = Array.from({ length: NAMES_PER_BUCKET + 3 }, (_, i) => ({ personId: i, name: `Person ${i}`, types: ["WWCC" as const] }))
    const { text } = renderClearanceDigestEmail(input({ missing: many }))
    expect(text).toContain(`Missing (${NAMES_PER_BUCKET + 3})`)
    expect(text).toContain("and 3 more")
    expect(text).not.toContain(`Person ${NAMES_PER_BUCKET + 2}`)
  })
  it("states that it carries no numbers or dates of birth", () => {
    expect(renderClearanceDigestEmail(input(buckets)).text).toMatch(/no WWCC numbers or dates of birth/i)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --testPathPatterns="clearanceDigestEmail"`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Create `src/lib/clearanceDigestEmail.ts`:

```ts
import type { ComplianceBuckets, BucketEntry } from "@/lib/clearanceCompliance"
import { COMPLIANCE_FILTERS, type ComplianceFilter } from "@/lib/clearanceComplianceView"
import { CLEARANCE_TYPE_LABELS, EXPIRING_WINDOW_DAYS } from "@/lib/clearanceStatus"

/** Names listed per bucket before "and N more" (keeps the email a sane size). */
export const NAMES_PER_BUCKET = 50

const HEADINGS: Record<ComplianceFilter, string> = {
  expired: "Expired",
  expiring: `Expiring within ${EXPIRING_WINDOW_DAYS} days`,
  missing: "Missing",
  unverified: "Unverified",
}

/** Escapes text for safe interpolation into HTML. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

/** "Name — WWCC, Safe Ministry". */
function entryLine(e: BucketEntry): string {
  return `${e.name} — ${e.types.map((t) => CLEARANCE_TYPE_LABELS[t]).join(", ")}`
}

/**
 * Renders the monthly clearance digest. Names, clearance types and counts
 * only: never a WWC number or date of birth (email is not an encrypted
 * channel). Empty buckets are omitted. `complianceUrl` null means the base URL
 * is not configured, so a plain navigation hint replaces the link.
 */
export function renderClearanceDigestEmail(input: {
  churchName: string
  asOf: string
  buckets: ComplianceBuckets
  complianceUrl: string | null
}): { subject: string; html: string; text: string } {
  const { churchName, asOf, buckets, complianceUrl } = input
  const subject = `Clearance compliance digest — ${churchName}`
  const reminder =
    "If the Working With Children Check authority (in NSW, the Office of the Children's Guardian) emails you a barring alert for a worker registered on your employer profile, act on it straight away. Do not wait for this digest."
  const footer = "This email lists names only: no WWCC numbers or dates of birth."

  const textParts: string[] = [`Clearance compliance as of ${asOf} — ${churchName}`, ""]
  const htmlParts: string[] = [
    `<p>Clearance compliance as of <strong>${esc(asOf)}</strong> — ${esc(churchName)}</p>`,
  ]

  for (const key of COMPLIANCE_FILTERS) {
    const entries = buckets[key]
    if (entries.length === 0) continue
    const shown = entries.slice(0, NAMES_PER_BUCKET)
    const more = entries.length - shown.length
    const heading = `${HEADINGS[key]} (${entries.length})`
    textParts.push(heading, ...shown.map((e) => `  - ${entryLine(e)}`))
    if (more > 0) textParts.push(`  ...and ${more} more`)
    textParts.push("")
    htmlParts.push(
      `<h3 style="font-family:Arial,sans-serif;margin:16px 0 4px">${esc(heading)}</h3>`,
      `<ul style="font-family:Arial,sans-serif;font-size:14px;margin:0;padding-left:20px">${shown
        .map((e) => `<li>${esc(entryLine(e))}</li>`)
        .join("")}${more > 0 ? `<li>...and ${more} more</li>` : ""}</ul>`
    )
  }

  if (complianceUrl) {
    textParts.push(`Review and verify: ${complianceUrl}`)
    htmlParts.push(`<p style="font-family:Arial,sans-serif;font-size:14px"><a href="${esc(complianceUrl)}">Open the clearance compliance page</a></p>`)
  } else {
    textParts.push("Review and verify: open People > Clearances in the CRM.")
    htmlParts.push(`<p style="font-family:Arial,sans-serif;font-size:14px">Review and verify: open People &gt; Clearances in the CRM.</p>`)
  }
  textParts.push("", reminder, "", footer)
  htmlParts.push(
    `<p style="font-family:Arial,sans-serif;font-size:14px"><strong>${esc(reminder)}</strong></p>`,
    `<p style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8">${esc(footer)}</p>`
  )

  return { subject, html: htmlParts.join("\n"), text: textParts.join("\n") }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- --testPathPatterns="clearanceDigestEmail"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/clearanceDigestEmail.ts src/lib/__tests__/clearanceDigestEmail.test.ts
git commit -m "feat(people): clearance digest email renderer" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Digest run (once-per-month lease + send)

**Files:**
- Create: `src/lib/clearanceDigest.ts`
- Modify: `src/lib/dates.ts` (add `sydneyMonthKey` after `sydneyWeekStartYMD`, i.e. after line ~74)
- Test: `src/lib/__tests__/clearanceDigest.test.ts`; add to `src/lib/__tests__/datesClock.test.ts`

**Interfaces:**
- Consumes: Task 1 (`loadComplianceRows`, `bucketCompliance`, `bucketsEmpty`, `countFlaggedPeople`), Task 6 renderer, `sendEmail`, `isAmbiguousDeliveryError` (`@/lib/email`), `getChurchName` (`@/lib/emailTemplateStore`), `logAudit`, `logger`, `withRetry`, `isP2002`.
- Produces: `sydneyMonthKey(at?: Date): string` (`YYYY-MM`); `ClearanceDigestResult = { flagged: number; sent: number; failed: number }`; `sendClearanceDigest(now)`; `runClearanceDigestLocked(now, opts?: { force?: boolean }): Promise<ClearanceDigestResult | "done" | "locked">`; `runClearanceDigest(now?: Date): Promise<ClearanceDigestResult>` (scheduler entry; throws when locked).

- [ ] **Step 1: Write the failing `sydneyMonthKey` test**

Append to `src/lib/__tests__/datesClock.test.ts` (and add `sydneyMonthKey` to the import on line 2):

```ts
describe("sydneyMonthKey", () => {
  it("is the Sydney month, rolling over at Sydney midnight not UTC midnight", () => {
    // 2026-06-30 14:00 UTC = Wed 2026-07-01 00:00 AEST
    expect(sydneyMonthKey(new Date("2026-06-30T14:00:00Z"))).toBe("2026-07")
    expect(sydneyMonthKey(new Date("2026-06-30T13:59:00Z"))).toBe("2026-06")
  })
  it("handles the year boundary under daylight saving (AEDT)", () => {
    // 2026-12-31 13:00 UTC = Fri 2027-01-01 00:00 AEDT
    expect(sydneyMonthKey(new Date("2026-12-31T13:00:00Z"))).toBe("2027-01")
    expect(sydneyMonthKey(new Date("2026-12-31T12:59:00Z"))).toBe("2026-12")
  })
})
```

Run: `npm test -- --testPathPatterns="datesClock"` — Expected: FAIL (`sydneyMonthKey` is not a function).

- [ ] **Step 2: Implement `sydneyMonthKey`**

In `src/lib/dates.ts`, after `sydneyWeekStartYMD`, add:

```ts
/** The Sydney calendar month (`YYYY-MM`) containing `at`. */
export function sydneyMonthKey(at: Date = new Date()): string {
  return sydneyClock(at).ymd.slice(0, 7)
}
```
Run: `npm test -- --testPathPatterns="datesClock"` — Expected: PASS.

- [ ] **Step 3: Write the failing digest test**

Create `src/lib/__tests__/clearanceDigest.test.ts`:

```ts
/** @jest-environment node */
jest.mock("@/lib/prisma", () => ({
  prisma: {
    appSetting: { findUnique: jest.fn(), create: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn() },
    user: { findMany: jest.fn() },
  },
}))
jest.mock("@/lib/crypto", () => ({ safeDecrypt: jest.fn() }))
jest.mock("@/lib/email", () => ({ sendEmail: jest.fn(), isAmbiguousDeliveryError: jest.fn((e: { ambiguous?: boolean }) => e?.ambiguous === true) }))
jest.mock("@/lib/emailTemplateStore", () => ({ getChurchName: jest.fn().mockResolvedValue("Test Church") }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@/lib/logger", () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }))
jest.mock("@/lib/clearanceCompliance", () => ({
  ...jest.requireActual("@/lib/clearanceCompliance"),
  loadComplianceRows: jest.fn(),
}))

import { prisma } from "@/lib/prisma"
import { sendEmail } from "@/lib/email"
import { logAudit } from "@/lib/audit"
import { loadComplianceRows, toComplianceRow } from "@/lib/clearanceCompliance"
import { runClearanceDigest, runClearanceDigestLocked } from "@/lib/clearanceDigest"

const findUnique = prisma.appSetting.findUnique as jest.Mock
const create = prisma.appSetting.create as jest.Mock
const updateMany = prisma.appSetting.updateMany as jest.Mock
const settingDeleteMany = prisma.appSetting.deleteMany as jest.Mock
const users = prisma.user.findMany as jest.Mock
const send = sendEmail as jest.Mock

const KEY = "clearanceDigestLastMonth"
const FIRST = new Date("2026-10-31T20:00:00Z") // Sun 2026-11-01 07:00 AEDT
const MONTH = "2026-11"
const lease = (at: Date) => `running:${MONTH}:${at.getTime()}`

const flaggedRows = () => [
  toComplianceRow({
    id: 1, firstName: "Alex", lastName: "Testperson", ministryRoles: ["STAFF"], family: { name: "F" },
    clearances: [{ id: "c11", type: "WWCC", number: "enc:WWC0000000E", expiresAt: new Date("2020-01-01T00:00:00Z"), verifiedAt: new Date() }],
  }, new Date("2026-11-01T00:00:00Z")),
]
const cleanRows = () => [
  toComplianceRow({
    id: 2, firstName: "Bo", lastName: "Sample", ministryRoles: ["STAFF"], family: { name: "F" },
    clearances: [
      { id: "c21", type: "WWCC", number: "enc:x", expiresAt: new Date("2030-01-01T00:00:00Z"), verifiedAt: new Date() },
      { id: "c22", type: "SAFE_MINISTRY", number: null, expiresAt: new Date("2030-01-01T00:00:00Z"), verifiedAt: new Date() },
    ],
  }, new Date("2026-11-01T00:00:00Z")),
]

beforeEach(() => {
  jest.clearAllMocks()
  findUnique.mockResolvedValue({ key: KEY, value: "2026-10" })
  updateMany.mockResolvedValue({ count: 1 })
  settingDeleteMany.mockResolvedValue({ count: 1 })
  create.mockResolvedValue({})
  users.mockResolvedValue([{ email: "admin@example.com" }, { email: "pastor@example.com" }])
  send.mockResolvedValue(undefined)
  ;(loadComplianceRows as jest.Mock).mockResolvedValue({ rows: flaggedRows(), truncated: false })
})

describe("runClearanceDigestLocked", () => {
  it("emails every active ADMIN and PASTOR once, with names and no sensitive values, then records the month", async () => {
    const r = await runClearanceDigestLocked(FIRST)
    expect(users).toHaveBeenCalledWith({ where: { role: { in: ["ADMIN", "PASTOR"] }, archivedAt: null }, select: { email: true } })
    expect(send).toHaveBeenCalledTimes(2)
    const [to, subject, html, text] = send.mock.calls[0]
    expect(to).toBe("admin@example.com")
    expect(subject).toBe("Clearance compliance digest — Test Church")
    expect(text).toContain("Alex Testperson — WWCC")
    expect(html + text).not.toContain("WWC0000000E")
    expect(r).toEqual({ flagged: 1, sent: 2, failed: 0 })
    expect(updateMany).toHaveBeenNthCalledWith(1, { where: { key: KEY, value: "2026-10" }, data: { value: lease(FIRST) } })
    expect(updateMany).toHaveBeenNthCalledWith(2, { where: { key: KEY, value: lease(FIRST) }, data: { value: MONTH } })
    expect(logAudit).toHaveBeenCalledWith(null, "CLEARANCE_DIGEST_SENT", "Person", undefined, expect.objectContaining({ sent: 2, failed: 0, flagged: 1 }))
  })

  it("creates the setting row on the very first run", async () => {
    findUnique.mockResolvedValue(null)
    await runClearanceDigestLocked(FIRST)
    expect(create).toHaveBeenCalledWith({ data: { key: KEY, value: lease(FIRST) } })
  })

  it("sends nothing when every bucket is empty, but still records the month so it is not retried", async () => {
    ;(loadComplianceRows as jest.Mock).mockResolvedValue({ rows: cleanRows(), truncated: false })
    const r = await runClearanceDigestLocked(FIRST)
    expect(send).not.toHaveBeenCalled()
    expect(r).toEqual({ flagged: 0, sent: 0, failed: 0 })
    expect(updateMany).toHaveBeenLastCalledWith({ where: { key: KEY, value: lease(FIRST) }, data: { value: MONTH } })
  })

  it("is 'done' (no work) when this month already ran, unless forced", async () => {
    findUnique.mockResolvedValue({ key: KEY, value: MONTH })
    expect(await runClearanceDigestLocked(FIRST)).toBe("done")
    expect(send).not.toHaveBeenCalled()
    expect(await runClearanceDigestLocked(FIRST, { force: true })).toMatchObject({ sent: 2 })
  })

  it("is 'locked' while another run holds a fresh lease", async () => {
    findUnique.mockResolvedValue({ key: KEY, value: lease(new Date(FIRST.getTime() - 60_000)) })
    expect(await runClearanceDigestLocked(FIRST)).toBe("locked")
    expect(send).not.toHaveBeenCalled()
  })

  it("reclaims a stale lease (crashed run)", async () => {
    findUnique.mockResolvedValue({ key: KEY, value: lease(new Date(FIRST.getTime() - 3 * 60 * 60_000)) })
    expect(await runClearanceDigestLocked(FIRST)).toMatchObject({ sent: 2 })
  })

  it("is 'locked' when it loses the compare-and-set race", async () => {
    updateMany.mockResolvedValueOnce({ count: 0 })
    expect(await runClearanceDigestLocked(FIRST)).toBe("locked")
    expect(send).not.toHaveBeenCalled()
  })

  it("releases the lease and reports failures when every send fails, so the scheduler retries", async () => {
    send.mockRejectedValue(new Error("smtp down"))
    const r = await runClearanceDigestLocked(FIRST)
    expect(r).toEqual({ flagged: 1, sent: 0, failed: 2 })
    expect(updateMany).toHaveBeenLastCalledWith({ where: { key: KEY, value: lease(FIRST) }, data: { value: "2026-10" } })
  })

  it("keeps the month recorded after a partial failure (no resend to those who got it)", async () => {
    send.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("bad address"))
    const r = await runClearanceDigestLocked(FIRST)
    expect(r).toEqual({ flagged: 1, sent: 1, failed: 1 })
    expect(updateMany).toHaveBeenLastCalledWith({ where: { key: KEY, value: lease(FIRST) }, data: { value: MONTH } })
  })

  it("treats an ambiguous delivery error as sent (never resend on a maybe)", async () => {
    send.mockRejectedValue(Object.assign(new Error("socket closed"), { ambiguous: true }))
    expect(await runClearanceDigestLocked(FIRST)).toEqual({ flagged: 1, sent: 2, failed: 0 })
  })

  it("records the month with no send when there is nobody to email", async () => {
    users.mockResolvedValue([])
    expect(await runClearanceDigestLocked(FIRST)).toEqual({ flagged: 1, sent: 0, failed: 0 })
    expect(updateMany).toHaveBeenLastCalledWith({ where: { key: KEY, value: lease(FIRST) }, data: { value: MONTH } })
  })

  it("releases the lease and rethrows when the query throws", async () => {
    ;(loadComplianceRows as jest.Mock).mockRejectedValue(new Error("db down"))
    await expect(runClearanceDigestLocked(FIRST)).rejects.toThrow("db down")
    expect(updateMany).toHaveBeenLastCalledWith({ where: { key: KEY, value: lease(FIRST) }, data: { value: "2026-10" } })
  })
})

describe("runClearanceDigest (scheduler entry)", () => {
  it("returns zeros when the month is already done", async () => {
    findUnique.mockResolvedValue({ key: KEY, value: MONTH })
    expect(await runClearanceDigest(FIRST)).toEqual({ flagged: 0, sent: 0, failed: 0 })
  })
  it("throws when locked so the scheduler does not record success", async () => {
    findUnique.mockResolvedValue({ key: KEY, value: lease(new Date(FIRST.getTime() - 60_000)) })
    await expect(runClearanceDigest(FIRST)).rejects.toThrow(/in progress/)
  })
})
```

Run: `npm test -- --testPathPatterns="clearanceDigest.test"` — Expected: FAIL (module not found).

- [ ] **Step 4: Implement `src/lib/clearanceDigest.ts`**

```ts
import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { logger } from "@/lib/logger"
import { sendEmail, isAmbiguousDeliveryError } from "@/lib/email"
import { getChurchName } from "@/lib/emailTemplateStore"
import { sydneyMonthKey, sydneyToday } from "@/lib/dates"
import { formatDMY } from "@/lib/formatting"
import { isP2002 } from "@/lib/validation"
import { withRetry } from "@/lib/retry"
import { UserRole } from "@/lib/generated/prisma/enums"
import { loadComplianceRows, bucketCompliance, bucketsEmpty, countFlaggedPeople } from "@/lib/clearanceCompliance"
import { renderClearanceDigestEmail } from "@/lib/clearanceDigestEmail"

/** `failed`/`sent` are per recipient; the scheduler retries while `failed > 0`. */
export type ClearanceDigestResult = { flagged: number; sent: number; failed: number }

const LAST_MONTH_KEY = "clearanceDigestLastMonth"
const LEASE_PREFIX = "running:"
// A run that dies mid-send leaves its lease behind; after this long a later run
// may reclaim it so the month is not silently lost. A digest is a handful of
// emails, so 30 minutes is far longer than a live run.
const LEASE_MS = 30 * 60_000

/** True while `value` is a lease younger than LEASE_MS (`running:<month>:<ms>`). */
function freshLease(value: string, now: Date): boolean {
  if (!value.startsWith(LEASE_PREFIX)) return false
  const startedAt = Number(value.slice(value.lastIndexOf(":") + 1))
  return Number.isFinite(startedAt) && now.getTime() - startedAt < LEASE_MS
}

/** Absolute link to the compliance page, or null when AUTH_URL is not a valid URL. */
function complianceUrl(): string | null {
  try {
    return new URL("/people/clearances", process.env.AUTH_URL ?? "http://localhost:3000").toString()
  } catch {
    return null
  }
}

/**
 * Builds and sends the digest: expired / expiring / missing / unverified
 * clearances, names only, to every active ADMIN and PASTOR. An all-clear month
 * sends nothing. Ambiguous delivery errors count as sent so a maybe-delivered
 * email is never repeated. No lease handling here; see runClearanceDigestLocked.
 */
export async function sendClearanceDigest(now: Date): Promise<ClearanceDigestResult> {
  const today = sydneyToday(now)
  const { rows, truncated } = await loadComplianceRows(today)
  if (truncated) logger.error("[clearanceDigest] more people than the compliance cap; digest covers the first batch only")
  const buckets = bucketCompliance(rows)
  if (bucketsEmpty(buckets)) return { flagged: 0, sent: 0, failed: 0 }
  const flagged = countFlaggedPeople(buckets)

  const recipients = await prisma.user.findMany({
    where: { role: { in: [UserRole.ADMIN, UserRole.PASTOR] }, archivedAt: null },
    select: { email: true },
  })
  if (recipients.length === 0) {
    logger.error("[clearanceDigest] no active ADMIN or PASTOR to email; digest not sent")
    return { flagged, sent: 0, failed: 0 }
  }

  const { subject, html, text } = renderClearanceDigestEmail({
    churchName: await getChurchName(),
    asOf: formatDMY(today),
    buckets,
    complianceUrl: complianceUrl(),
  })

  let sent = 0
  let failed = 0
  for (const r of recipients) {
    try {
      await sendEmail(r.email, subject, html, text)
      sent++
    } catch (err) {
      if (isAmbiguousDeliveryError(err)) {
        sent++
        logger.error("[clearanceDigest] ambiguous delivery for one recipient; treated as sent, not retried")
      } else {
        failed++
        logger.error("[clearanceDigest] send failed for one recipient")
      }
    }
  }
  await logAudit(null, "CLEARANCE_DIGEST_SENT", "Person", undefined, {
    flagged, sent, failed,
    expired: buckets.expired.length, expiring: buckets.expiring.length,
    missing: buckets.missing.length, unverified: buckets.unverified.length,
  })
  return { flagged, sent, failed }
}

/** Puts the setting back to what it was before this run's lease (best effort, never throws). */
async function releaseLease(prevValue: string | null, lease: string): Promise<void> {
  const restoreTo = prevValue && !prevValue.startsWith(LEASE_PREFIX) ? prevValue : null
  try {
    if (restoreTo) {
      await prisma.appSetting.updateMany({ where: { key: LAST_MONTH_KEY, value: lease }, data: { value: restoreTo } })
    } else {
      await prisma.appSetting.deleteMany({ where: { key: LAST_MONTH_KEY, value: lease } })
    }
  } catch (e) {
    logger.error(`[clearanceDigest] lease release failed (expires in ${LEASE_MS / 60_000} min): ${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * Runs the digest at most once per Sydney month and never concurrently.
 * Guard: one AppSetting row. `<YYYY-MM>` = that month is done;
 * `running:<month>:<ms>` = a lease held by an in-flight run, taken by
 * compare-and-set. A run that fails (throws, or every send fails) restores the
 * previous value so a later attempt retries the month. Returns "locked" when
 * another run holds a fresh lease or won the race and "done" when this month
 * already ran (never with `force`); the two stay distinct so a scheduler that
 * saw "locked" is never mistaken for finished.
 */
export async function runClearanceDigestLocked(
  now: Date,
  opts: { force?: boolean } = {}
): Promise<ClearanceDigestResult | "done" | "locked"> {
  const month = sydneyMonthKey(now)
  const prev = await prisma.appSetting.findUnique({ where: { key: LAST_MONTH_KEY } })
  if (prev && freshLease(prev.value, now)) return "locked"
  if (prev?.value === month && !opts.force) return "done"

  const lease = `${LEASE_PREFIX}${month}:${now.getTime()}`
  if (prev) {
    const { count } = await prisma.appSetting.updateMany({ where: { key: LAST_MONTH_KEY, value: prev.value }, data: { value: lease } })
    if (count === 0) return "locked"
  } else {
    try {
      await prisma.appSetting.create({ data: { key: LAST_MONTH_KEY, value: lease } })
    } catch (e) {
      if (isP2002(e)) return "locked"
      throw e
    }
  }

  let result: ClearanceDigestResult
  try {
    result = await sendClearanceDigest(now)
  } catch (e) {
    await releaseLease(prev?.value ?? null, lease)
    throw e
  }
  // Every recipient failed cleanly: nothing was delivered, so release and let
  // the scheduler retry (it sees failed > 0 and keeps the month open).
  if (result.failed > 0 && result.sent === 0) {
    await releaseLease(prev?.value ?? null, lease)
    return result
  }
  // Mail is out: never rethrow from here (a retry would re-send). Retry the
  // write; if it still fails the lease expires and a later run may repeat.
  try {
    await withRetry(
      () => prisma.appSetting.updateMany({ where: { key: LAST_MONTH_KEY, value: lease }, data: { value: month } }),
      { attempts: 3, baseDelayMs: 200 }
    )
  } catch (e) {
    logger.error(`[clearanceDigest] digest sent but failed to mark ${month} done: ${e instanceof Error ? e.message : String(e)}`)
  }
  return result
}

/** In-app scheduler entry: once per Sydney month, never overlapping another run. Throws when locked so success is not recorded. */
export async function runClearanceDigest(now: Date = new Date()): Promise<ClearanceDigestResult> {
  const r = await runClearanceDigestLocked(now)
  if (r === "done") return { flagged: 0, sent: 0, failed: 0 }
  if (r === "locked") throw new Error("another clearance-digest run is in progress — will retry")
  return r
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npm test -- --testPathPatterns="clearanceDigest|datesClock"`
Expected: PASS. (`withRetry` real implementation runs `updateMany` once on success; if `withRetry` sleeps in tests only on failure, no timer issue.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/clearanceDigest.ts src/lib/dates.ts src/lib/__tests__/clearanceDigest.test.ts src/lib/__tests__/datesClock.test.ts
git commit -m "feat(people): monthly clearance digest run" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Scheduler job + runner wiring

**Files:**
- Modify: `src/lib/scheduler.ts` (lines 16, 24, 26-28, 31-34, 37-41, 43-48; anchors below)
- Modify: `src/lib/schedulerRunner.ts:13-18`
- Test: `src/lib/__tests__/scheduler.test.ts`, `src/lib/__tests__/schedulerRunner.test.ts`

**Interfaces:**
- Consumes: `sydneyMonthKey` (Task 7), `runClearanceDigest` (Task 7).
- Produces: `JobName` includes `"clearanceDigest"`; due from the 1st of each Sydney month 07:00 through the 7th (catch-up), `successKey` = `YYYY-MM`, 3 attempts per month.

- [ ] **Step 1: Write the failing scheduler tests**

In `src/lib/__tests__/scheduler.test.ts`, change the first `describe`-independent pieces: add to the `successKey` block and a new `describe`. Insert before `describe("successKey", ...)`:

```ts
describe("dueJobs — clearanceDigest (monthly)", () => {
  const quiet = { reminders: { running: true }, checkouts: { running: true }, celebrations: { running: true } }
  // Wed 2026-07-01 Sydney (AEST, UTC+10): 07:00 = 2026-06-30T21:00Z
  const FIRST_0700 = new Date("2026-06-30T21:00:00Z")
  const MIN = 60_000
  it("is not due before 07:00 Sydney on the 1st", () => {
    expect(dueJobs(new Date("2026-06-30T20:59:00Z"), state(quiet), {})).toEqual([])
  })
  it("is due from 07:00 Sydney on the 1st, all day, until it succeeds", () => {
    expect(dueJobs(FIRST_0700, state(quiet), {})).toEqual(["clearanceDigest"])
    expect(dueJobs(new Date("2026-07-01T13:59:00Z"), state(quiet), {})).toEqual(["clearanceDigest"]) // 23:59 AEST
  })
  it("stays due through the 7th so an outage on the 1st catches up", () => {
    expect(dueJobs(new Date("2026-07-01T21:00:00Z"), state(quiet), {})).toEqual(["clearanceDigest"]) // 2 Jul 07:00
    expect(dueJobs(new Date("2026-07-07T13:59:00Z"), state(quiet), {})).toEqual(["clearanceDigest"]) // 7 Jul 23:59
  })
  it("is not due from the 8th to month end", () => {
    expect(dueJobs(new Date("2026-07-07T14:00:00Z"), state(quiet), {})).toEqual([]) // 8 Jul 00:00
    expect(dueJobs(new Date("2026-06-29T21:00:00Z"), state(quiet), {})).toEqual([]) // 30 Jun 07:00
  })
  it("is not due again that month after a success", () => {
    expect(dueJobs(FIRST_0700, state({ ...quiet, clearanceDigest: { lastSuccessKey: "2026-07" } }), {})).toEqual([])
  })
  it("is due again next month (new key)", () => {
    // Sat 2026-08-01 07:00 AEST = 2026-07-31T21:00Z
    expect(dueJobs(new Date("2026-07-31T21:00:00Z"), state({ ...quiet, clearanceDigest: { lastSuccessKey: "2026-07" } }), {})).toEqual(["clearanceDigest"])
  })
  it("backs off 30 min after an unsuccessful attempt and gives up after 3 (same cap as celebrations)", () => {
    const s = state(quiet)
    let t = FIRST_0700.getTime()
    for (let i = 0; i < 3; i++) {
      expect(dueJobs(new Date(t), s, {})).toEqual(["clearanceDigest"])
      recordStart("clearanceDigest", s, new Date(t))
      expect(dueJobs(new Date(t + 29 * MIN), s, {})).toEqual([])
      t += 30 * MIN
    }
    expect(dueJobs(new Date(t), s, {})).toEqual([])
  })
  it("uses Sydney time under daylight saving (AEDT, UTC+11): 1 Nov 2026", () => {
    expect(dueJobs(new Date("2026-10-31T19:59:00Z"), state(quiet), {})).toEqual([]) // 06:59 AEDT
    expect(dueJobs(new Date("2026-10-31T20:00:00Z"), state(quiet), {})).toEqual(["clearanceDigest"]) // 07:00 AEDT
  })
  it("rolls over on 1 Jan at Sydney time, not UTC", () => {
    // 2026-12-31T20:00Z = Fri 2027-01-01 07:00 AEDT
    expect(dueJobs(new Date("2026-12-31T20:00:00Z"), state(quiet), {})).toEqual(["clearanceDigest"])
    expect(successKey("clearanceDigest", new Date("2026-12-31T20:00:00Z"))).toBe("2027-01")
  })
  it("does not need ERROR_DIGEST or GitHub config", () => {
    expect(dueJobs(FIRST_0700, state(quiet), { ERROR_DIGEST: "false" })).toEqual(["clearanceDigest"])
  })
})
```

Inside the existing `describe("successKey", ...)` first test add: `expect(successKey("clearanceDigest", at(9))).toBe("2026-07")`.

Run: `npm test -- --testPathPatterns="scheduler.test"` — Expected: FAIL (`"clearanceDigest"` unknown / not returned).

- [ ] **Step 2: Implement in `src/lib/scheduler.ts`**

Apply these exact edits:

1. Line 1: `import { sydneyClock, sydneyWeekStartYMD } from "@/lib/dates"` becomes `import { sydneyClock, sydneyMonthKey, sydneyWeekStartYMD } from "@/lib/dates"`.
2. In the doc comment (line ~7-9) change "Interval jobs run every 30 min; period jobs run once per Sydney day/week from an opening hour" to "...once per Sydney day/week/month from an opening hour".
3. `JobName` (line 16): `export type JobName = "reminders" | "checkouts" | "celebrations" | "errorDigest" | "clearanceDigest"`.
4. `JOB_NAMES` (line 26): `const JOB_NAMES: readonly JobName[] = ["reminders", "checkouts", "celebrations", "errorDigest", "clearanceDigest"]`.
5. After `const DIGEST_FROM_HOUR = 9` add `const CLEARANCE_DIGEST_FROM_HOUR = 7`.
6. `initialState` return: `return { reminders: fresh(), checkouts: fresh(), celebrations: fresh(), errorDigest: fresh(), clearanceDigest: fresh() }`.
7. `successKey`: update the doc comment to "Sydney day (celebrations), Sydney week (error digest), Sydney month (clearance digest), none (interval jobs)" and add before `return null`:
   `if (job === "clearanceDigest") return sydneyMonthKey(now)`
8. `windowOpen`: immediately after the celebrations line add:
   ```ts
   // Monthly: opens on the 1st (Sydney) from 07:00 and stays open to the end of
   // the 7th, so an outage on the 1st catches up; the Sydney-month success key
   // sends once, and the 3-attempt cap applies within that month.
   if (job === "clearanceDigest") {
     const day = Number(c.ymd.slice(8, 10))
     return day <= 7 && (day > 1 || c.hour >= CLEARANCE_DIGEST_FROM_HOUR)
   }
   ```

- [ ] **Step 3: Run scheduler tests**

Run: `npm test -- --testPathPatterns="scheduler.test"`
Expected: PASS, including all pre-existing tests unmodified (no existing test runs on a 1st at/after 07:00 Sydney: `at()` is 2 July, the DST case is 7 Jan).

- [ ] **Step 4: Failing runner test, then wire**

In `src/lib/__tests__/schedulerRunner.test.ts` add `clearanceDigest: jest.fn(async () => ({})),` to the `jobs()` factory (after `errorDigest`, line 12) and append inside `describe("tick", ...)`:

```ts
  it("runs the monthly clearance digest on the 1st and records the month as its success key", async () => {
    const s = initialState(); const j = jobs()
    const first = new Date("2026-06-30T21:00:00Z") // Wed 2026-07-01 07:00 AEST
    await tick(s, j, first)
    expect(j.clearanceDigest).toHaveBeenCalledWith(first)
    expect(s.clearanceDigest.lastSuccessKey).toBe("2026-07")
    await tick(s, j, new Date("2026-06-30T22:00:00Z"))
    expect(j.clearanceDigest).toHaveBeenCalledTimes(1)
  })

  it("keeps the digest open when sends failed (failed > 0), so a later tick retries it", async () => {
    const s = initialState()
    const j = jobs({ clearanceDigest: jest.fn(async () => ({ flagged: 3, sent: 0, failed: 2 })) })
    await tick(s, j, new Date("2026-06-30T21:00:00Z"))
    expect(s.clearanceDigest.lastSuccessKey).toBeNull()
  })
```

Run: `npm test -- --testPathPatterns="schedulerRunner"` — Expected: FAIL (job not wired; `Jobs` type has no `clearanceDigest`).

In `src/lib/schedulerRunner.ts` `DEFAULT_JOBS` (after the `errorDigest` line) add:

```ts
  clearanceDigest: async (now) => (await import("@/lib/clearanceDigest")).runClearanceDigest(now),
```
Also update the module doc comment line "Due jobs run concurrently" (no change needed) and nothing else: `Jobs = Record<JobName, ...>` picks up the new key automatically; `countsOnly` logs only the numeric `flagged/sent/failed`, never names.

- [ ] **Step 5: Run**

Run: `npm test -- --testPathPatterns="scheduler|instrumentation"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/scheduler.ts src/lib/schedulerRunner.ts src/lib/__tests__/scheduler.test.ts src/lib/__tests__/schedulerRunner.test.ts
git commit -m "feat(scheduler): monthly clearanceDigest job" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Manual cron route

**Files:**
- Create: `src/app/api/cron/send-clearance-digest/route.ts`
- Test: `src/app/api/cron/send-clearance-digest/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `bearerOk` (`@/lib/cronAuth`), `runClearanceDigestLocked` (Task 7).
- Produces: `POST /api/cron/send-clearance-digest` (503 when `CRON_SECRET` unset, 401 bad bearer, 409 locked, 200 + `{flagged,sent,failed}`; `force: true` so a manual trigger runs even after this month's send, like `error-issues`).

- [ ] **Step 1: Write the failing test**

```ts
/** @jest-environment node */
// src/app/api/cron/send-clearance-digest/__tests__/route.test.ts
jest.mock("@/lib/clearanceDigest", () => ({ runClearanceDigestLocked: jest.fn() }))
import { POST } from "../route"
import { runClearanceDigestLocked } from "@/lib/clearanceDigest"

function req(auth?: string) {
  return new Request("http://x/api/cron/send-clearance-digest", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  })
}

describe("POST /api/cron/send-clearance-digest", () => {
  const OLD = { ...process.env }
  afterEach(() => { process.env = { ...OLD }; jest.clearAllMocks() })

  it("503 when CRON_SECRET unset", async () => {
    delete process.env.CRON_SECRET
    expect((await POST(req("Bearer x"))).status).toBe(503)
    expect(runClearanceDigestLocked).not.toHaveBeenCalled()
  })
  it("401 with no or a bad bearer", async () => {
    process.env.CRON_SECRET = "s"
    expect((await POST(req())).status).toBe(401)
    expect((await POST(req("Bearer nope"))).status).toBe(401)
    expect(runClearanceDigestLocked).not.toHaveBeenCalled()
  })
  it("200 + counts on a good bearer, forcing past this month's marker", async () => {
    process.env.CRON_SECRET = "s"
    ;(runClearanceDigestLocked as jest.Mock).mockResolvedValue({ flagged: 3, sent: 2, failed: 0 })
    const res = await POST(req("Bearer s"))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ flagged: 3, sent: 2, failed: 0 })
    expect(runClearanceDigestLocked).toHaveBeenCalledWith(expect.any(Date), { force: true })
  })
  it("409 when another run holds the lease", async () => {
    process.env.CRON_SECRET = "s"
    ;(runClearanceDigestLocked as jest.Mock).mockResolvedValue("locked")
    expect((await POST(req("Bearer s"))).status).toBe(409)
  })
})
```

Run: `npm test -- --testPathPatterns="send-clearance-digest"` — Expected: FAIL, module not found.

- [ ] **Step 2: Implement**

```ts
import { NextResponse } from "next/server"
import { bearerOk } from "@/lib/cronAuth"
import { runClearanceDigestLocked } from "@/lib/clearanceDigest"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Manual / external trigger for the monthly clearance digest (the in-app
 * scheduler normally runs it on the 1st). Bearer-authed with CRON_SECRET.
 * Shares the scheduler's lease so runs never overlap, but `force` lets an
 * operator re-send after this month's digest already went out.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error("[send-clearance-digest] CRON_SECRET unset — clearance digest endpoint is DISABLED")
    return NextResponse.json({ error: "CRON_SECRET unset: disabled" }, { status: 503 })
  }
  if (!bearerOk(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const result = await runClearanceDigestLocked(new Date(), { force: true })
  if (result === "locked") return NextResponse.json({ error: "Another digest run is in progress" }, { status: 409 })
  return NextResponse.json(result)
}
```
(`result` cannot be `"done"` with `force: true`; TypeScript still types it as possible, and `NextResponse.json("done")` would be harmless, so no extra branch.)

- [ ] **Step 3: Run**

Run: `npm test -- --testPathPatterns="send-clearance-digest"`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cron/send-clearance-digest
git commit -m "feat(cron): manual clearance digest trigger" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Docs (website + README + self-hosting)

**Files (modify):**
- `website/src/content/docs/docs/people-and-families.md` (insert before `### Roles who can see or do what`)
- `website/src/content/docs/docs/roles-and-permissions.md` (matrix table after the `Edit people & families / events` row, and helper table)
- `website/src/content/docs/docs/scheduled-jobs.md` (frontmatter description + intro, In-app scheduler table, endpoint table, "All four", How it works, Configuration table)
- `website/src/content/docs/docs/email-notifications.md` (What gets sent table + Scheduled sends)
- `README.md` (Core features bullet)
- `docs/self-hosting.md:163-169` (Scheduled jobs paragraph)

Do each edit by locating the anchor with `grep -n` first (OSS-47/48 may already have added neighbouring text; extend rather than duplicate).

- [ ] **Step 1: people-and-families.md**

Insert this section immediately before `### Roles who can see or do what`:

```markdown
### Clearance compliance (`/people/clearances`)
*People → Clearances* in the sidebar (ADMIN, PASTOR and OFFICE_ADMIN only). It lists everyone who has a ministry role or a clearance on file, with a WWCC and a Safe Ministry status for each: **Missing**, **Unverified**, **Verified**, **Expiring soon** (within 60 days) or **Expired**. Anyone with a ministry role is expected to hold both clearances; an absent one shows as Missing.
- **Filter chips** (Expired / Expiring / Missing / Unverified) narrow the list. **Export CSV** downloads the current filter: names, roles, statuses and dates only. It never contains WWC numbers or dates of birth.
- **Verify WWCC batch** (`?view=batch`) lists every unverified or expiring WWCC in the order the NSW Office of the Children's Guardian (OCG) employer portal asks for it: family name, date of birth (dd/mm/yyyy), WWC number, each with a copy button, plus **Copy all rows**. The portal has no public API, so you check the workers there, then tick the rows it confirmed and press **Mark verified** (optionally with a note, such as the portal's outcome). That records who verified and when. Rows with no date of birth or number are flagged and cannot be ticked. Viewing the batch is written to the audit log.
- **Monthly digest**: on the 1st of each month ADMIN and PASTOR users get one email listing expired, expiring, missing and unverified clearances by name, with a link to this page. See [Scheduled Jobs](/parishcrm/docs/scheduled-jobs/). It also reminds you to act on any OCG barring-alert emails, which the OCG sends to the employer when a registered worker is barred.
```

- [ ] **Step 2: roles-and-permissions.md**

After the row `| Edit people & families / events | ...` add:

```markdown
| Clearance compliance page, WWCC batch verify, CSV export, digest email (`/people/clearances`) | Yes | Yes | Yes | No | No | No |
```
After the `canViewPeople` helper row add (merge with the `canManageClearances` row OSS-48 may have added; do not duplicate):

```markdown
| `canManageClearances` | Same as `canEdit` — upload/verify clearances, use the compliance page and batch verify |
```

- [ ] **Step 3: scheduled-jobs.md**

Make these edits (grep each anchor):
- Frontmatter `description` and first paragraph: add "a monthly clearance-compliance digest" to the list of jobs (keep within existing sentence style).
- In-app scheduler table add the row:
  `| Clearance compliance digest | Once per Sydney month, on the 1st from 07:00 (catches up through the 7th if the app was down). Emails ADMIN and PASTOR users; nothing is sent in a month where every clearance is in order. |`
- Change "at most 3 times per day or week" to "at most 3 times per day, week or month".
- Endpoint table add:
  `| \`POST /api/cron/send-clearance-digest\` | Sends the monthly clearance-compliance digest to ADMIN and PASTOR users. A manual call sends again even if this month's digest already went out. | Monthly (1st) |`
- "All four require `CRON_SECRET`" becomes "All five".
- In **How it works** add a bullet after the `error-issues` bullet:
  `- **\`send-clearance-digest\`** records the Sydney month it last sent in an app setting (\`clearanceDigestLastMonth\`) and takes a short lease while sending, so a restart, a second tick or an overlapping manual call cannot send the month twice. If every send fails the month stays open and the job retries; once at least one recipient has the email the month is marked done.`
- Configuration table: `CRON_SECRET` row: "all four endpoints" becomes "all five endpoints". No new variable.

- [ ] **Step 4: email-notifications.md**

Add a row to the "What gets sent" table after the birthday/anniversary row:

```markdown
| Clearance compliance digest | Automatic, once a month (1st), to ADMIN and PASTOR users | Names and counts of expired, expiring (60 days), missing and unverified WWCC / Safe Ministry clearances, a link to `/people/clearances`, and a reminder to act on OCG barring alerts. Never includes WWC numbers or dates of birth. Skipped when nothing needs attention. |
```
In "Scheduled sends" change "Event reminders and birthday/anniversary emails are sent" to "Event reminders, birthday/anniversary emails and the monthly clearance digest are sent".

- [ ] **Step 5: README.md**

`grep -n "Families & members" README.md`. If OSS-47/48 already added a clearance mention, extend it; otherwise change the bullet to:

```markdown
- **Families & members** — family + person records with member numbers, email-consent tracking, soft-archive, role-gated pastoral notes, ministry-role tags, WWCC / Safe Ministry clearance tracking with a compliance page (filters, CSV), an OCG verify-batch helper and a monthly expiry digest email.
```

- [ ] **Step 6: docs/self-hosting.md**

In the "Scheduled jobs" paragraph (lines ~163-169) change "celebration emails and the weekly error digest run inside the app" to "celebration emails, the monthly clearance-compliance digest and the weekly error digest run inside the app".

- [ ] **Step 7: Verify no stale claims, then commit**

```bash
grep -rn "All four\|all four" website/src/content/docs/docs/scheduled-jobs.md || echo "ok: no stale 'four'"
git add website README.md docs/self-hosting.md
git commit -m "docs: clearance compliance, batch verify, digest" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
Expected: "ok: no stale 'four'".

---

### Task 11: Verify, push, PR

**Files:** none changed (fix-ups only if checks fail).

- [ ] **Step 1: Touched suites + lint**

```bash
npm test -- --testPathPatterns="clearance|scheduler|dates|navData|WwccBatchVerify|people/clearances|send-clearance-digest" 2>&1 | tail -25
npm run lint 2>&1 | tail -25
npx tsc --noEmit 2>&1 | tail -15
```
Expected: all PASS, lint clean, no type errors. Fix any failure at its root (do not skip). Lint rules to watch: `react-hooks/*` in `WwccBatchVerify.tsx`, semgrep-style rules do not run locally.

- [ ] **Step 2: Local smoke (no `npm run build`)**

```bash
npx prisma dev --detach
npm run db:push
ALLOW_DEMO_SEED=true npm run db:seed
npm run dev
```
With `DISABLE_OTP=true` (dev only), log in as the seeded admin. Tag a person with a ministry role, add a WWCC (number, DOB set, expiry within 60 days) and no Safe Ministry. Check: `/people/clearances` shows Expiring + Missing; chips filter; **Export CSV** downloads with no number/DOB column; `?view=batch` shows the row with copy buttons; tick it, **Mark verified**, row's "Last verified" updates; log in as the seeded viewer: `/people/clearances` redirects to `/` and `/api/clearances/export` returns 403. Then:

```bash
curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/send-clearance-digest
```
Expected: `{"flagged":N,"sent":M,"failed":0}`; with no SMTP configured in dev, set `E2E_MOCK_EMAIL=true` to see `[E2E_MOCK_EMAIL] sendMail <addr>` in the server log. Stop the dev server and `npx prisma dev stop` after.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/clearance-compliance
gh pr create --title "feat(people): clearance compliance list and monthly digest" --body "$(cat <<'EOF'
## Summary
- `/people/clearances` (ADMIN/PASTOR/OFFICE_ADMIN): WWCC + Safe Ministry status per person with a ministry role, filter chips (Expired / Expiring 60d / Missing / Unverified), CSV export through `escapeCsv` (audit `CLEARANCE_EXPORTED`; no numbers or DOB).
- `?view=batch`: OCG-portal verify helper (family name, DOB dd/mm/yyyy, WWC number) with copy buttons, Copy all rows, tick + `verifyClearancesBulk` with optional note. Rows missing DOB/number are flagged and unselectable. Viewing is audited (`CLEARANCE_BATCH_VIEWED`).
- Monthly digest: scheduler job `clearanceDigest` (1st of the month from 07:00 Sydney, max 3 attempts), `runClearanceDigest`, manual `POST /api/cron/send-clearance-digest`. Emails ADMIN + PASTOR names only per bucket, link to the page, reminder to act on OCG barring alerts. Nothing sent when all buckets are empty.
- Once-per-month guard is an `AppSetting` lease row (`clearanceDigestLastMonth`), same pattern as `errorDigest`.
- Docs: people-and-families, roles-and-permissions, scheduled-jobs, email-notifications, README, self-hosting.

Closes OSS-49. Depends on OSS-47 / OSS-48 (merged).

## Release note for the PROD_VERSION bump
- **No new migration** in this PR (OSS-47/48 carry theirs).
- **No new env read** (`AUTH_URL` and `CRON_SECRET` are already read).
- Behaviour change on release: the in-app scheduler will email ADMIN/PASTOR users on the 1st of the next month if any clearance is expired/expiring/missing/unverified. So the release is fit for the nightly `auto-upgrade.yml` unless the OSS-47/48 migrations in the same version range need a human-reviewed bump.

## Test plan
- [x] `npm test` touched suites (scheduler boundaries incl. Sydney DST/year rollover, digest idempotency/lease/partial failure, bulk action guards, CSV formula guard, batch UI)
- [x] `npm run lint`, `tsc --noEmit`
- [ ] Phone/desktop check of `/people/clearances` and batch view on prod after release

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr comment --body "@codex review"
```

- [ ] **Step 4: STOP.** Do not merge. Merge needs the PO and the standard pre-merge review-findings disposition table (codex + CodeRabbit; re-pull comments after the final push, verify each finding at HEAD, defer confirmed ones to issues). Report the PR URL.

---

## Self-Review

**Spec coverage**
- 1 `clearanceCompliance.ts` list + per-type status + 4 filters: Task 1.
- 2 Page + nav + chips + CSV (guard, `CLEARANCE_EXPORTED`): Tasks 3, 4. `canManageClearances` gating in page, route and (for the mutation) the action: Tasks 2-4.
- 3 Batch view in OCG order with copy buttons, copy-all, checkboxes, `verifyClearancesBulk` + note, `getWwccVerifyUrl()` link, missing DOB/number flagged: Tasks 1 (view helpers, loader), 2 (action), 3 (page wiring, URL), 5 (UI).
- 4 Monthly job (window 1st >= 07:00 Sydney, once/month, retry cap 3), `runClearanceDigest`, cron route, ADMIN+PASTOR email with counts + names per bucket + link + OCG reminder, no numbers/DOB, skip when empty: Tasks 6-9.
- 5 Docs (scheduled-jobs, people-and-families, email-notifications, roles-and-permissions) + README: Task 10. (`data-encryption.md` is OSS-48's; this PR adds no new encrypted field.)
- Task 0 branch + OSS-48 check; final lint/push/PR/`@codex review`/stop with the PROD_VERSION note: Tasks 0, 11.
- Ticket tests: `windowOpen` monthly boundary (Sydney TZ), bucket logic, idempotency: Tasks 8, 1, 7.

**Placeholder scan:** none. Two explicit conditional notes (test literal for the "missing" page case; label wording from OSS-47) tell the executor exactly what to change.

**Type consistency:** `WwccBatchRow`, `ComplianceRow/Cell/Buckets/BucketEntry`, `ClearanceDigestResult`, `COMPLIANCE_FILTERS`/`ComplianceFilter`, `loadComplianceRows` -> `{ rows, truncated }`, `filterRows`, `sydneyMonthKey`, `verifyClearancesBulk(ids: number[], note?)` are defined once and used with identical names/signatures in later tasks. Audit action names: `CLEARANCE_EXPORTED`, `CLEARANCE_BATCH_VIEWED` (new), `CLEARANCE_VERIFIED` (OSS-48 name, reused), `CLEARANCE_DIGEST_SENT` (new).

**Known judgement calls (flagged for the PO in the hand-back):** PO-side decisions applied 2026-10-06: window 1st–7th (catch-up), batch list = never-verified and unexpired WWCCs only, no follow-up card for a shared lease helper.
