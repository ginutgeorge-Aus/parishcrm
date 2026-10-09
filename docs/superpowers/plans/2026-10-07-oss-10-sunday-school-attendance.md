# Sunday School Attendance Roll (OSS-10) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline on the main thread; one task at a time). Steps use checkbox (`- [ ]`) syntax for tracking. Pre-PR review: `/code-review medium` (diff will pass ~150 logic lines; it widens an access boundary, so read Task 3 carefully).

## Workflow rules (PO's standing rules; apply to every task)

- **Start:** `/board move OSS-10 "In Progress"` (Waiting on = Claude) and seed the ticket `## State` block in `.claude/tickets/OSS-10.md`. Overwrite `## State` after each task (step · next · blocker). Append one Activity-log line per milestone.
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
- **Stop at merge.** The PO merges. This card adds a migration, so the St Mark `PROD_VERSION` bump needs human review.

**Goal:** Take a Sunday School class roll on a phone in seconds: open the class, pick the date (defaults to today), tap **Present / Late / Absent** per child (one tap each, tap again to clear), or **Mark unmarked present** for the whole class, then fix the few exceptions. Staff can take any class's roll; a volunteer teacher with a confined login (an `EVENT_ORGANISER` account assigned to the class) can take only their own class's roll from `/my-classes`. The class page shows recent sessions with counts.

**Architecture:** Three new tables on top of OSS-9: `SundaySchoolSession` (one per class per date, `@@unique([classId, date])`, created lazily on the first mark), `SundaySchoolAttendance` (one row per child per session, `status` enum `PRESENT | LATE | ABSENT`; no row = not marked), and `SundaySchoolRollMarker` (class ↔ login account, the exact twin of `EventManager`). Access helper `src/lib/sundaySchoolAccess.ts::canMarkRoll` mirrors `canManageEvent` (editor, or an `EVENT_ORGANISER` with a marker row — role re-checked so a stale row after a role change grants nothing). One client component `RollList` (pattern: `CheckInList`, optimistic per-row with in-flight guard) is rendered by two pages: `/sunday-school/[id]/roll` (dashboard) and `/my-classes/[id]/roll` (organiser surface). Middleware's organiser allow-list gains `/my-classes`.

**Tech Stack:** Next.js 16 App Router + Server Actions, Prisma 7, Jest 30 + RTL, existing `sydneyTodayYMD`, `isRealCalendarDate`, `listAssignableOrganisers`.

Ticket: `.claude/tickets/OSS-10.md`. **Depends on OSS-9 merged** (`SundaySchoolClass`, `SundaySchoolEnrolment`, `/sunday-school/[id]`, `src/lib/actions/sundaySchool.ts`).

## PO decisions (confirmed by PO 2026-10-07 — all defaults)

1. **Who can mark the roll:** ADMIN, PASTOR, OFFICE_ADMIN (any class) **plus** volunteer teachers given an `EVENT_ORGANISER` login and assigned to the class (only that class, via `/my-classes`). VIEWER sees rolls read-only. Rationale: teachers are in the classroom on Sunday; `EVENT_ORGANISER` is already the confined "volunteer" role (no member PII, middleware-locked), so no new role and no VIEWER PII exposure. Roll markers are assigned per class by staff, separately from the Person-based teacher list (User and Person are not linked in this app).
2. **Statuses: Present, Late, Absent; "not marked" = no row.** Late is a real status (card asks for it) and counts as attended in summaries.
3. **Bulk action = "Mark unmarked present"** (fast path: most children attend; then tap the absentees). No "mark rest absent" in v1.
4. **Date defaults to today (Sydney)**, editable for back-entry; future dates refused; the date must fall in the class's school year. Works for non-Sunday classes too.
5. **Session = class + date, created lazily** on the first mark. No session scheduling, no "class didn't run" state in v1.
6. **Roll shows currently enrolled children** plus anyone already marked in that session (so history stays visible after a child is moved/unenrolled). Archived classes are read-only.
7. **Audit:** one audit row per mark change and one per bulk action (`SS_ATTENDANCE_MARKED`, `SS_ATTENDANCE_BULK_PRESENT`).

## Global Constraints

- Names (use exactly):
  - `enum AttendanceStatus { PRESENT LATE ABSENT }`.
  - `SundaySchoolSession { id, classId, date DateTime @db.Date, createdAt }` `@@unique([classId, date])` (accessor `classId_date`).
  - `SundaySchoolAttendance { id, sessionId, personId, status AttendanceStatus, markedAt DateTime @updatedAt, markedById Int? }` `@@unique([sessionId, personId])`.
  - `SundaySchoolRollMarker { id, classId, userId, createdAt }` `@@unique([classId, userId])` (accessor `classId_userId`), `@@index([userId])`.
  - Back-relations: `SundaySchoolClass.sessions`, `SundaySchoolClass.rollMarkers`, `Person.sundaySchoolAttendance`, `User.sundaySchoolRollMarkers`, `User.sundaySchoolAttendanceMarked @relation("SsAttendanceMarkedBy")`.
  - `src/lib/sundaySchoolAccess.ts`: `isRollMarker(userId, classId)`, `canMarkRoll(userId, classId, role)`.
  - `src/lib/sundaySchoolRollView.ts` (pure, client-safe): `ATTENDANCE_LABELS`, `ATTENDANCE_STATUSES`, `parseRollDate(raw, classYear, today)`, `rollCounts(rows)`, `ymdToDbDate(ymd)`.
  - `src/lib/sundaySchoolRoll.ts` (server): `loadRoll(classId, ymd)`.
  - Actions `src/lib/actions/sundaySchoolAttendance.ts`: `setAttendance`, `markUnmarkedPresent`, `addRollMarker`, `removeRollMarker`.
  - Routes `/sunday-school/[id]/roll?date=YYYY-MM-DD`, `/my-classes`, `/my-classes/[id]/roll?date=`.
  - Migration `prisma/migrations/20261014000000_sunday_school_attendance/` (timestamp must sort after OSS-9's; use the real date when executing).
- Branch `feat/sunday-school-attendance`; PR title `feat(sunday-school): take the class roll`.
- Public AGPL repo: synthetic data only. The roll shows **names only** (no DOB, contact, notes) — `select` names only.
- Every mutation guarded in page AND action; `assertNotDemo()` first; `logAudit(actorId(session), …)`; `"use server"` exports only async functions.
- Dates: `@db.Date` at UTC midnight built from a validated `YYYY-MM-DD` (`new Date(\`${ymd}T00:00:00.000Z\`)`), never `new Date(y, m, d)`. "Today" = `sydneyTodayYMD()`.
- Next.js 16: `params`/`searchParams` are Promises. JSDoc on every new/changed function.
- Tests: `npm test -- --testPathPatterns="<x>"`; action/access tests `/** @jest-environment node */`. Duplicate test roots exist (e.g. `organiserAccess` has both `__tests__/lib/` and `src/lib/__tests__/`) — update both if both assert the allow-list.
- Commits end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`; PR body ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `prisma/schema.prisma` | modify | enum + 3 models + back-relations |
| `prisma/migrations/20261014000000_sunday_school_attendance/migration.sql` | create | generated SQL |
| `src/lib/sundaySchoolRollView.ts` | create | pure labels, date parse, counts |
| `src/lib/__tests__/sundaySchoolRollView.test.ts` | create | unit tests |
| `src/lib/sundaySchoolAccess.ts` | create | `isRollMarker`, `canMarkRoll` |
| `src/lib/__tests__/sundaySchoolAccess.test.ts` | create | role × marker matrix |
| `src/lib/sundaySchoolRoll.ts` | create | `loadRoll` server loader (shared by both pages) |
| `src/lib/actions/sundaySchoolAttendance.ts` | create | 4 actions |
| `src/lib/actions/__tests__/sundaySchoolAttendance.test.ts` | create | guards, IDOR, date rules, bulk |
| `src/components/sunday-school/RollList.tsx` | create | mobile roll UI (client) |
| `__tests__/components/sunday-school/RollList.test.tsx` | create | tap / clear / revert / bulk / readOnly |
| `src/components/sunday-school/RollMarkersPanel.tsx` | create | assign organiser logins (twin of `EventManagersPanel`) |
| `src/app/(dashboard)/sunday-school/[id]/roll/page.tsx` | create | staff/viewer roll page |
| `src/app/(dashboard)/sunday-school/[id]/page.tsx` | modify | "Take roll" button, Recent sessions card, Roll markers panel |
| `src/app/(organiser)/my-classes/page.tsx` | create | organiser's assigned classes |
| `src/app/(organiser)/my-classes/[id]/roll/page.tsx` | create | organiser roll page |
| `src/lib/organiserAccess.ts` | modify | allow `/my-classes` |
| `src/lib/__tests__/organiserAccess.test.ts`, `__tests__/lib/organiserAccess.test.ts` | modify | allow-list cases |
| `src/components/organiser/OrganiserHeader.tsx` | modify | "Events · Classes" links |
| `.claude/rules/data-model.md` | modify | attendance bullet + enum list |
| `website/src/content/docs/docs/sunday-school.md` | modify | "Taking the roll" section |
| `website/src/content/docs/docs/event-organisers.md` | modify | organisers can be roll markers |
| `website/src/content/docs/docs/roles-and-permissions.md` | modify | matrix row + helper row |
| `README.md` | modify | extend Sunday School bullet |

---

### Task 0: Branch and preflight

- [ ] **Step 1**

```bash
cd /home/ggeorge/workspace/Projects/parishcrm
git fetch origin && git switch main && git pull --ff-only origin main
git log --oneline -5 | grep -i "sunday-school" || echo "STOP: OSS-9 not merged"
grep -n "model SundaySchoolEnrolment" prisma/schema.prisma || echo "STOP: OSS-9 schema missing"
git switch -c feat/sunday-school-attendance
npm ci --no-audit --no-fund
```
Expected: OSS-9 commit present, schema grep matches, branch created. If either STOP prints, stop and report.

---

### Task 1: Schema + migration

**Files:** `prisma/schema.prisma`, `prisma/migrations/20261014000000_sunday_school_attendance/migration.sql`

- [ ] **Step 1: Schema**

Add after the OSS-9 models:

```prisma
enum AttendanceStatus {
  PRESENT
  LATE
  ABSENT
}

// One roll per class per calendar date, created on the first mark (OSS-10).
model SundaySchoolSession {
  id         Int                      @id @default(autoincrement())
  classId    Int
  date       DateTime                 @db.Date
  createdAt  DateTime                 @default(now())
  class      SundaySchoolClass        @relation(fields: [classId], references: [id], onDelete: Cascade)
  attendance SundaySchoolAttendance[]

  @@unique([classId, date])
}

// One mark per child per session. No row = not marked.
model SundaySchoolAttendance {
  id         Int                 @id @default(autoincrement())
  sessionId  Int
  personId   Int
  status     AttendanceStatus
  markedAt   DateTime            @updatedAt
  markedById Int?
  session    SundaySchoolSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  person     Person              @relation(fields: [personId], references: [id], onDelete: Cascade)
  markedBy   User?               @relation("SsAttendanceMarkedBy", fields: [markedById], references: [id], onDelete: SetNull)

  @@unique([sessionId, personId])
  @@index([personId])
  @@index([markedById])
}

// A login account (EVENT_ORGANISER) allowed to take this class's roll. Twin of
// EventManager; the role is re-checked at use (see sundaySchoolAccess.ts).
model SundaySchoolRollMarker {
  id        Int               @id @default(autoincrement())
  classId   Int
  userId    Int
  createdAt DateTime          @default(now())
  class     SundaySchoolClass @relation(fields: [classId], references: [id], onDelete: Cascade)
  user      User              @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([classId, userId])
  @@index([userId])
}
```
Back-relations: `SundaySchoolClass { sessions SundaySchoolSession[]  rollMarkers SundaySchoolRollMarker[] }`, `Person { sundaySchoolAttendance SundaySchoolAttendance[] }`, `User { sundaySchoolRollMarkers SundaySchoolRollMarker[]  sundaySchoolAttendanceMarked SundaySchoolAttendance[] @relation("SsAttendanceMarkedBy") }`. Add `AttendanceStatus` to the enum list in `.claude/rules/data-model.md` (Task 8).

`markedAt @updatedAt`: note `createMany` sets `@updatedAt` too (Prisma fills it on create); bulk `updateMany` is not used anywhere here, so the prisma-patterns trap does not bite.

```bash
npx prisma format && npx prisma generate
```

- [ ] **Step 2: Migration** — same throwaway-DB procedure as OSS-9 Task 1 Step 2 (`prisma dev --detach`, `migrate deploy`, `migrate diff --from-config-datasource --to-schema … --script > …/migration.sql`, deploy again, re-diff with `--exit-code` → `exit=0`). Expected SQL: `CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'ABSENT')`, three `CREATE TABLE`, `"SundaySchoolSession_classId_date_key"`, `"SundaySchoolAttendance_sessionId_personId_key"`, `"SundaySchoolRollMarker_classId_userId_key"`, indexes, FKs (`markedById … ON DELETE SET NULL`, the rest `CASCADE`).

- [ ] **Step 3: Commit** — `feat(sunday-school): attendance and roll-marker schema` (include both plan files if still untracked: the OSS-10 plan is committed in this PR if OSS-9's PR did not carry it).

---

### Task 2: Pure roll view module (TDD)

**Files:** `src/lib/sundaySchoolRollView.ts`, `src/lib/__tests__/sundaySchoolRollView.test.ts`

**Interfaces:**
```ts
export const ATTENDANCE_STATUSES: AttendanceStatus[]            // ["PRESENT","LATE","ABSENT"] (button order)
export const ATTENDANCE_LABELS: Record<AttendanceStatus, string> // Present / Late / Absent
export type RollRow = { personId: number; name: string; status: AttendanceStatus | null; enrolled: boolean }
export function parseRollDate(raw: string | undefined, classYear: number, todayYMD: string):
  { ok: true; ymd: string } | { ok: false; error: string }
export function parseAttendanceStatus(v: unknown): AttendanceStatus | null | undefined // undefined = invalid, null = clear
export function rollCounts(rows: RollRow[]): { present: number; late: number; absent: number; unmarked: number; attended: number }
export function ymdToDbDate(ymd: string): Date
```

- [ ] **Step 1: Failing test**

```ts
import { parseRollDate, rollCounts, parseAttendanceStatus, ymdToDbDate, ATTENDANCE_STATUSES } from "@/lib/sundaySchoolRollView"

describe("parseRollDate", () => {
  const today = "2026-10-11"
  it("defaults to today when missing/blank", () => {
    expect(parseRollDate(undefined, 2026, today)).toEqual({ ok: true, ymd: today })
    expect(parseRollDate("", 2026, today)).toEqual({ ok: true, ymd: today })
  })
  it("accepts a past date in the class year", () => {
    expect(parseRollDate("2026-02-01", 2026, today)).toEqual({ ok: true, ymd: "2026-02-01" })
  })
  it("rejects malformed, impossible, future and other-year dates", () => {
    expect(parseRollDate("2026-02-30", 2026, today).ok).toBe(false)
    expect(parseRollDate("11/10/2026", 2026, today).ok).toBe(false)
    expect(parseRollDate("2026-10-12", 2026, today)).toEqual({ ok: false, error: "Can't take a roll for a future date" })
    expect(parseRollDate("2025-12-28", 2026, today)).toEqual({ ok: false, error: "This class is for 2026" })
  })
  it("today in a different year than the class (viewing last year's class) still validates the year", () => {
    expect(parseRollDate(undefined, 2025, "2026-01-04")).toEqual({ ok: false, error: "This class is for 2025" })
  })
})

describe("parseAttendanceStatus", () => {
  it("maps values", () => {
    expect(parseAttendanceStatus("LATE")).toBe("LATE")
    expect(parseAttendanceStatus(null)).toBeNull()
    expect(parseAttendanceStatus("present")).toBeUndefined()
  })
})

describe("rollCounts", () => {
  it("counts each status; attended = present + late", () => {
    const r = (status: string | null) => ({ personId: 1, name: "x", status, enrolled: true }) as never
    expect(rollCounts([r("PRESENT"), r("LATE"), r("ABSENT"), r(null), r(null)]))
      .toEqual({ present: 1, late: 1, absent: 1, unmarked: 2, attended: 2 })
  })
})

it("ymdToDbDate is UTC midnight", () => {
  expect(ymdToDbDate("2026-10-11").toISOString()).toBe("2026-10-11T00:00:00.000Z")
})
it("button order", () => expect(ATTENDANCE_STATUSES).toEqual(["PRESENT", "LATE", "ABSENT"]))
```
Run: `npm test -- --testPathPatterns="sundaySchoolRollView"` → FAIL.

- [ ] **Step 2: Implement**

```ts
import type { AttendanceStatus } from "@/lib/generated/prisma/enums"
import { isRealCalendarDate } from "@/lib/validation"

/** Roll button order (most common first). */
export const ATTENDANCE_STATUSES: AttendanceStatus[] = ["PRESENT", "LATE", "ABSENT"]

/** Human labels for each status. */
export const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = { PRESENT: "Present", LATE: "Late", ABSENT: "Absent" }

export type RollRow = { personId: number; name: string; status: AttendanceStatus | null; enrolled: boolean }

/**
 * Validate a roll's `?date=`. Blank = today (Sydney YMD supplied by caller).
 * Must be a real calendar date, not in the future, and inside the class's
 * school year (AU school year = calendar year).
 */
export function parseRollDate(raw: string | undefined, classYear: number, todayYMD: string) {
  const ymd = raw?.trim() || todayYMD
  if (!isRealCalendarDate(ymd)) return { ok: false, error: "Invalid date" } as const
  if (ymd > todayYMD) return { ok: false, error: "Can't take a roll for a future date" } as const
  if (Number(ymd.slice(0, 4)) !== classYear) return { ok: false, error: `This class is for ${classYear}` } as const
  return { ok: true, ymd } as const
}

/** Parse a status from the client. `null` = clear the mark; `undefined` = invalid input. */
export function parseAttendanceStatus(v: unknown): AttendanceStatus | null | undefined {
  if (v === null) return null
  return typeof v === "string" && (ATTENDANCE_STATUSES as string[]).includes(v) ? (v as AttendanceStatus) : undefined
}

/** Summary counts for a roll. Late counts as attended. */
export function rollCounts(rows: RollRow[]) {
  const c = { present: 0, late: 0, absent: 0, unmarked: 0, attended: 0 }
  for (const r of rows) {
    if (r.status === "PRESENT") c.present++
    else if (r.status === "LATE") c.late++
    else if (r.status === "ABSENT") c.absent++
    else c.unmarked++
  }
  c.attended = c.present + c.late
  return c
}

/** A validated `YYYY-MM-DD` as the UTC-midnight Date stored in `@db.Date` columns. */
export function ymdToDbDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`)
}
```
Note: `parseRollDate` for a past-year class viewed in January returns an error for the *default* date; the page then falls back to the class's last session date or `${classYear}-12-31` (Task 5) — keep the pure function strict.

Run → PASS. Commit `feat(sunday-school): pure roll view helpers`.

---

### Task 3: Access helper (TDD)

**Files:** `src/lib/sundaySchoolAccess.ts`, `src/lib/__tests__/sundaySchoolAccess.test.ts`

- [ ] **Step 1: Failing test** — matrix:

| role | marker row | expected `canMarkRoll` | DB queried? |
|---|---|---|---|
| ADMIN / PASTOR / OFFICE_ADMIN | – | true | no |
| EVENT_ORGANISER | yes | true | yes |
| EVENT_ORGANISER | no | false | yes |
| VIEWER / AUDITOR (stale row exists) | yes | false | **no** |
| undefined | – | false | no |

```ts
/** @jest-environment node */
jest.mock("@/lib/prisma", () => ({ prisma: { sundaySchoolRollMarker: { findUnique: jest.fn() } } }))
// it.each over the table; assert findUnique called with { where: { classId_userId: { classId: 4, userId: 9 } }, select: { id: true } }
```
Run: `npm test -- --testPathPatterns="sundaySchoolAccess"` → FAIL.

- [ ] **Step 2: Implement** (copy the shape and the comment's reasoning from `src/lib/eventManager.ts`)

```ts
import { prisma } from "@/lib/prisma"
import { canEdit } from "@/lib/roleGuard"
import { UserRole } from "@/lib/generated/prisma/enums"

/** True when this login is assigned to take this class's roll. */
export async function isRollMarker(userId: number, classId: number): Promise<boolean> {
  const row = await prisma.sundaySchoolRollMarker.findUnique({
    where: { classId_userId: { classId, userId } },
    select: { id: true },
  })
  return row !== null
}

/**
 * May this user mark this class's roll? Editors: any class. EVENT_ORGANISER:
 * only classes they are assigned to. The role check is load-bearing — marker
 * rows only cascade on user delete, not on a role change, so a downgraded
 * account must not keep access through a stale row (same rule as canManageEvent).
 */
export async function canMarkRoll(userId: number, classId: number, role: UserRole | undefined): Promise<boolean> {
  if (canEdit(role)) return true
  if (role !== UserRole.EVENT_ORGANISER) return false
  return isRollMarker(userId, classId)
}
```
Run → PASS. Commit `feat(sunday-school): roll access helper`.

---

### Task 4: Actions (TDD)

**Files:** `src/lib/actions/sundaySchoolAttendance.ts`, `src/lib/actions/__tests__/sundaySchoolAttendance.test.ts`

**Interfaces:**
```ts
setAttendance(classId: number, ymd: string, personId: number, status: AttendanceStatus | null): Promise<ActionResult>
markUnmarkedPresent(classId: number, ymd: string): Promise<ActionResultWithSuccess>
addRollMarker(classId: number, userId: number): Promise<ActionResult>     // canEdit; target must be live EVENT_ORGANISER
removeRollMarker(classId: number, userId: number): Promise<ActionResult>  // canEdit; deleteMany
```

Order in the two roll actions: `assertNotDemo()` → `auth()`; no session → Unauthorized → `isValidPgId` ids → `canMarkRoll(actorId(session), classId, role)` else `{ error: "Unauthorized" }` → class `findFirst({ id, archivedAt: null }, select { year })` else "Class not found" → `parseRollDate(ymd, cls.year, sydneyTodayYMD())` (blank not allowed here: reject `!ymd`) → status via `parseAttendanceStatus` (undefined → "Invalid status") → write → audit → `revalidatePath` both roll paths + `/sunday-school/${classId}`.

Concurrency (same pattern as OSS-9's `withLiveClass`): after the guards, run each roll action's eligibility check + write in ONE `prisma.$transaction`. First `SELECT … FROM "SundaySchoolClass" WHERE id = … AND "archivedAt" IS NULL FOR SHARE` (archive waits / write refused if archive committed), then lock the relevant enrolment row(s) `FOR SHARE` (`"SundaySchoolEnrolment" WHERE "classId" = … AND "personId" = ANY(…)`) and the selected live `"Person"` rows `FOR SHARE` (`"archivedAt" IS NULL`), and re-check eligibility under those locks — a concurrent move/unenrol/family archive waits or the mark is refused. Raw lock SQL needs `// nosemgrep: crm-no-raw-sql` (Prisma has no locking API). The historical-correction rule below still applies inside the transaction.

`setAttendance` specifics:
- IDOR: child must be enrolled in THIS class and not archived (`sundaySchoolEnrolment.findFirst({ where: { classId, personId, person: { archivedAt: null } } })`, matching the roster) **or** already have a row in this class+date session (correcting history after a move). Else `{ error: "Child is not in this class" }`.
- Session: module-private `ensureSession(tx, classId, date)` — takes the roll action's transaction client, so a rolled-back mark leaves no empty session:
  ```ts
  /**
   * Get-or-create the (class, date) session inside the caller's transaction.
   * createMany + skipDuplicates is INSERT … ON CONFLICT DO NOTHING, so a
   * concurrent first mark never raises P2002 (which would abort the transaction).
   */
  async function ensureSession(tx: Prisma.TransactionClient, classId: number, date: Date): Promise<number> {
    await tx.sundaySchoolSession.createMany({ data: [{ classId, date }], skipDuplicates: true })
    const s = await tx.sundaySchoolSession.findUniqueOrThrow({ where: { classId_date: { classId, date } }, select: { id: true } })
    return s.id
  }
  ```
- `status === null` → `sundaySchoolAttendance.deleteMany({ where: { sessionId, personId } })` (do not create a session just to clear: look it up with `findUnique`; if absent, return success).
- else `upsert({ where: { sessionId_personId }, create: { sessionId, personId, status, markedById: actor }, update: { status, markedById: actor } })`.
- Audit `SS_ATTENDANCE_MARKED`, entity `"SundaySchoolClass"`, id `classId`, meta `{ date: ymd, personId, status }`.

`markUnmarkedPresent`: same guards; `ensureSession`; enrolled ids = `enrolment.findMany({ where: { classId, person: { archivedAt: null } }, select: { personId } })`; `createMany({ data: ids.map(… status: "PRESENT", markedById), skipDuplicates: true })` — `skipDuplicates` leaves every existing mark (incl. Absent/Late) untouched. Audit once with `{ date, count }`. Return `{ success: "Marked N present" }`.

`addRollMarker`/`removeRollMarker`: copy `addEventManager`/`removeEventManager` (`src/lib/actions/eventAccess.ts:60-95`) with `sundaySchoolRollMarker`, class must be live, audit `SS_ROLL_MARKER_ADDED` / `SS_ROLL_MARKER_REMOVED` with `{ targetUserId }`, revalidate `/sunday-school/${classId}` and `/my-classes`.

- [ ] **Step 1: Failing tests** (mock style as OSS-9 Task 3; mock `@/lib/sundaySchoolAccess` and `@/lib/dates` `sydneyTodayYMD: () => "2026-10-11"`):
  - `canMarkRoll` false → `{ error: "Unauthorized" }`, no writes.
  - demo mode → `DEMO_ERROR`, `auth` not called.
  - archived/missing class → "Class not found".
  - future date → "Can't take a roll for a future date"; other year → "This class is for 2026"; `"2026-13-01"` → "Invalid date".
  - unknown status `"HERE"` → "Invalid status".
  - child not enrolled and no prior mark → "Child is not in this class"; not enrolled but prior mark exists → allowed.
  - happy path: upsert called with `where: { sessionId_personId: { sessionId: 55, personId: 3 } }`, `markedById: 1`; audit meta; revalidates `/sunday-school/4/roll` and `/my-classes/4/roll`.
  - `ensureSession` uses `createMany({ skipDuplicates: true })` then `findUniqueOrThrow` on the passed `tx` (existing session → same id, no P2002).
  - clear with no session → success, no `upsert` on session.
  - `markUnmarkedPresent` → `createMany` with `skipDuplicates: true` and only enrolled ids; returns `{ success: "Marked 2 present" }`. (`createMany` returns `{ count }`; use it for N.)
  - `addRollMarker` as OFFICE_ADMIN with a VIEWER target → "User is not an event organiser"; as EVENT_ORGANISER → Unauthorized.

Run: `npm test -- --testPathPatterns="sundaySchoolAttendance"` → FAIL.

- [ ] **Step 2: Implement** per the rules above. Run → PASS.

- [ ] **Step 3: Commit** — `feat(sunday-school): roll marking actions`.

---

### Task 5: Roll loader + `RollList` component (TDD)

**Files:** `src/lib/sundaySchoolRoll.ts`, `src/components/sunday-school/RollList.tsx`, `__tests__/components/sunday-school/RollList.test.tsx`

- [ ] **Step 1: Loader**

```ts
import "server-only"
/**
 * Load one class's roll for a date: currently enrolled (non-archived) children
 * plus anyone already marked in that session, names only, sorted by last name.
 * Returns null when the class does not exist. Callers gate access first.
 */
export async function loadRoll(classId: number, ymd: string) {
  const date = ymdToDbDate(ymd)
  const cls = await prisma.sundaySchoolClass.findUnique({
    where: { id: classId },
    select: {
      id: true, name: true, year: true, location: true, archivedAt: true,
      enrolments: { where: { person: { archivedAt: null } }, select: { person: { select: { id: true, firstName: true, lastName: true } } } },
      sessions: { where: { date }, select: { attendance: { select: { status: true, person: { select: { id: true, firstName: true, lastName: true } } } } } },
    },
  })
  if (!cls) return null
  // merge: Map<personId, RollRow>; enrolled first (status null), then overlay session marks (enrolled=false if not enrolled)
  // sort by lastName, firstName (keep both names in the map for sorting)
  return { cls: { id: cls.id, name: cls.name, year: cls.year, location: cls.location, archived: cls.archivedAt !== null }, rows }
}
```
(`server-only` is already used by `src/lib/crypto.ts`.)

- [ ] **Step 2: `RollList` failing test**

```tsx
jest.mock("@/lib/actions/sundaySchoolAttendance", () => ({
  setAttendance: jest.fn().mockResolvedValue(undefined),
  markUnmarkedPresent: jest.fn().mockResolvedValue({ success: "Marked 1 present" }),
}))
// rows: Amy (null), Ben (ABSENT)
// 1. renders "0 present · 0 late · 1 absent · 1 not marked"
// 2. tap "Present" on Amy -> button aria-pressed=true immediately; setAttendance(4, "2026-10-11", amyId, "PRESENT")
// 3. tap "Present" on Amy again -> setAttendance(..., null) (clear)
// 4. setAttendance resolves {error:"Unauthorized"} -> Amy reverts, error text shown
// 5. "Mark unmarked present" -> markUnmarkedPresent(4, "2026-10-11"); Amy shows Present, Ben stays Absent
// 6. readOnly -> no buttons enabled, no bulk button, statuses shown as text
// 7. search "be" -> only Ben visible
```
Run: `npm test -- --testPathPatterns="RollList"` → FAIL.

- [ ] **Step 3: Implement `RollList`**

Props: `{ classId: number; date: string; rows: RollRow[]; readOnly: boolean; dateHrefBase: string }`.
- Copy the state model from `src/components/events/CheckInList.tsx`: `Record<personId, AttendanceStatus|null>` lazily initialised, adjust-state-during-render on new `rows`, per-row `pendingIds` Set guard, optimistic set → server call → revert on `{ error }` or throw.
- Serialize bulk vs per-row: while **Mark unmarked present** is pending, disable every row's buttons; while any row is pending, disable the bulk button. On bulk success, set to `PRESENT` only rows still `null` locally (never overwrite a row changed meanwhile), then `router.refresh()` so the list matches the DB.
- Header (sticky on mobile: `sticky top-0 z-10 bg-muted pb-2`): `<input type="date" max={today}>` whose change does `router.push(`${dateHrefBase}?date=${v}`)`; counts line from `rollCounts`; search `Input`; **Mark unmarked present** button (hidden when `readOnly` or no unmarked) → on success set every `null` row to `PRESENT` locally.
- Row: name (+ "not enrolled" muted tag when `!enrolled`), then a 3-button group `role="group" aria-label={`Attendance for ${name}`}`; each button `aria-pressed`, `min-h-11 min-w-20`, design tokens only (Present `bg-income/10 text-income`, Late `bg-warning/20 text-warning-foreground`, Absent `bg-destructive/10 text-destructive`, inactive `variant="outline"`). Tap active → clear. Lists of any size: plain `<ul>`; no virtualisation needed at Sunday School sizes (YAGNI), one roundtrip per tap.
- At ≤ 360 px the buttons wrap under the name (`flex-wrap`), no horizontal scroll.

Run → PASS. Commit `feat(sunday-school): roll list component`.

---

### Task 6: Pages (dashboard roll, organiser surface, class page additions)

**Files:** `src/app/(dashboard)/sunday-school/[id]/roll/page.tsx`, `src/app/(organiser)/my-classes/page.tsx`, `src/app/(organiser)/my-classes/[id]/roll/page.tsx`, `src/app/(dashboard)/sunday-school/[id]/page.tsx`, `src/components/sunday-school/RollMarkersPanel.tsx`, `src/lib/organiserAccess.ts` (+ both tests), `src/components/organiser/OrganiserHeader.tsx`.

- [ ] **Step 1: Organiser allow-list (TDD)** — add to both `organiserAccess` tests: `/my-classes` and `/my-classes/4/roll` allowed; `/sunday-school/4/roll` and `/sunday-school` still denied. Run `npm test -- --testPathPatterns="organiserAccess"` → FAIL; then in `isOrganiserAllowedPath` add
```ts
if (pathname === "/my-classes" || pathname.startsWith("/my-classes/")) return true
```
→ PASS.

- [ ] **Step 2: Dashboard roll page `/sunday-school/[id]/roll`**

```tsx
// session; canViewPeople else redirect("/"); parseRouteId else notFound()
// cls year lookup (findUnique select year, archivedAt) else notFound()
// rawDate = typeof sp.date === "string" ? sp.date : undefined   // repeated ?date= arrives as string[] — ignore it
// parsed = parseRollDate(rawDate, cls.year, sydneyTodayYMD())
//   if !parsed.ok && !rawDate -> redirect(`?date=${cls.year}-12-31`) when the class year is past, else render the error
//   if !parsed.ok -> render error text + date picker only
// roll = await loadRoll(id, parsed.ymd)
// readOnly = roll.cls.archived || !(await canMarkRoll(actorId(session), id, session.user.role))   // VIEWER -> read only
// <Link href={`/sunday-school/${id}`}>← {name}</Link> <h1>Roll · {name}</h1>
// <RollList classId={id} date={parsed.ymd} rows={roll.rows} readOnly={readOnly} dateHrefBase={`/sunday-school/${id}/roll`} />
```

- [ ] **Step 3: Organiser pages**

`/my-classes` — list `sundaySchoolRollMarker.findMany({ where: { userId, class: { archivedAt: null } }, select: { class: { select: { id, name, year, location } } }, orderBy: { class: { name: "asc" } } })` → cards linking to `/my-classes/{id}/roll`. Empty state: "No classes assigned to you yet. An administrator will add you to the classes you teach." Layout gate is the existing `(organiser)/layout.tsx` (EVENT_ORGANISER or editor) — no change.

`/my-classes/[id]/roll` — IDOR gate exactly like `my-events/[id]/check-in`: `if (!(await canMarkRoll(userId, id, role))) notFound()`; then same body as Step 2 (incl. the `rawDate` normalisation) with `readOnly = roll.cls.archived`, `dateHrefBase = /my-classes/${id}/roll`, back link `/my-classes`.

`OrganiserHeader`: keep the crest link to `/my-events`; add two text links "Events" (`/my-events`) and "Classes" (`/my-classes`) before Sign out (`text-primary-foreground/80 hover:…`, same as the sign-out button styling). Also on `/my-events` page's empty state no change.

- [ ] **Step 4: Class detail page additions** (OSS-9 page)

- **Take roll** button (`/sunday-school/{id}/roll`) shown to anyone with `canViewPeople` (VIEWER lands read-only), hidden for archived classes.
- **Recent sessions** card: `sundaySchoolSession.findMany({ where: { classId: id }, orderBy: { date: "desc" }, take: 10, select: { date: true, attendance: { select: { status: true } } } })` → rows "Sun 5 Oct 2026 — 14 present · 2 late · 3 absent" (`@db.Date` is UTC midnight, so format with the UTC-parts `formatDMY` from `src/lib/formatting.ts`, not `formatSydneyDate`; link `/sunday-school/{id}/roll?date=${d.toISOString().slice(0, 10)}`).
- **Roll markers** card (editor only): `RollMarkersPanel` — copy `src/components/events/EventManagersPanel.tsx`, swap actions to `addRollMarker`/`removeRollMarker`, candidates from `listAssignableOrganisers()` (already canEdit-gated). Helper text: "Volunteer logins (role *Event organiser*) that can take this class's roll from their phone. Create the login under Users."

- [ ] **Step 5: Page tests** — add to `__tests__/app/sunday-school-page.test.tsx` (from OSS-9) or a new `__tests__/app/sunday-school-roll-page.test.tsx`: AUDITOR → redirect `/`; VIEWER → RollList `readOnly`; ADMIN → not readOnly; organiser page with `canMarkRoll` false → `notFound`. Run `npm test -- --testPathPatterns="sunday-school-roll-page|sunday-school-page"` → PASS.

- [ ] **Step 6: Commit** — `feat(sunday-school): roll pages and organiser access`.

---

### Task 7: Docs

- [ ] **Step 1: `sunday-school.md`** — add after "Using it" bullets:

```markdown
### Taking the roll

Open a class and press **Take roll** (`/sunday-school/[id]/roll`). The date defaults to today;
change it to enter an earlier week. Each child has **Present**, **Late** and **Absent** buttons:
one tap marks, tapping the same button again clears it. **Mark unmarked present** fills in
everyone you haven't marked, so for a full class you tap only the absentees. Counts at the top
update as you go. Late counts as attended.

Volunteer teachers don't need dashboard access: create a login with the **Event organiser** role,
then add it under **Roll markers** on the class. On their phone they sign in, go to **Classes**
(`/my-classes`) and see only the classes they're assigned to. VIEWER accounts can see rolls but not
change them. Rolls for archived classes are read-only.
```
And in "How it works": one paragraph — a roll is created on the first mark for that class and date; each mark records who marked it and when; a child moved to another class keeps their earlier marks; every mark is in the audit log.

- [ ] **Step 2: `event-organisers.md`** — under "For organisers", add: "The same login can also be assigned to Sunday School classes as a **roll marker**; they then see **Classes** (`/my-classes`) and can take those classes' rolls only. See [Sunday School](/parishcrm/docs/sunday-school/)."

- [ ] **Step 3: `roles-and-permissions.md`** — matrix row after the OSS-9 Sunday School row:
```markdown
| Take a Sunday School roll | Yes | Yes | Yes | No | View only | Assigned classes only |
```
Helper table: `| \`canMarkRoll\` (\`src/lib/sundaySchoolAccess.ts\`) | Editors for any class; EVENT_ORGANISER only for classes they are assigned to as roll marker |`. In "EVENT_ORGANISER confinement" add `/my-classes` to the allow-list sentence.

- [ ] **Step 4: README** — Sunday School bullet: append ", mobile roll (present/late/absent) for staff and assigned volunteer logins".

- [ ] **Step 5: Website build** — `cd website && npm run build 2>&1 | tail -5` → success.

- [ ] **Step 6: Commit** — `docs(sunday-school): taking the roll`.

---

### Task 8: Rules doc, verify, push, PR

- [ ] **Step 1: data-model.md** — extend the Sunday School bullet: "`SundaySchoolSession` (`@@unique([classId, date])`, lazy) → `SundaySchoolAttendance` (`AttendanceStatus` PRESENT|LATE|ABSENT, no row = unmarked, `markedById`); `SundaySchoolRollMarker` (EVENT_ORGANISER login ↔ class, twin of `EventManager`; `canMarkRoll` re-checks role)." Add `AttendanceStatus` to the enum list.

- [ ] **Step 2: Checks**

```bash
npm test -- --testPathPatterns="sundaySchool|sunday-school|RollList|organiserAccess" 2>&1 | tail -25
npm run lint 2>&1 | tail -15
npx tsc --noEmit 2>&1 | tail -15
```
Expected: PASS, clean.

- [ ] **Step 3: Local smoke** (throwaway DB, seed — OSS-9 seeds "Years 1–2" with Test Child; `DISABLE_OTP=true npm run dev`)
  - Admin: class → Take roll → tap Present / Late / Absent / clear; reload keeps state; **Mark unmarked present** leaves an Absent untouched; future date in the picker shows the error; Recent sessions shows counts.
  - Create a user with role Event organiser (`organiser@example.com`), add as roll marker. Log in as them: lands on My Events; header → Classes → the class → take roll. Direct URL `/my-classes/<other class id>/roll` → 404; `/sunday-school` → redirected to `/my-events`.
  - Change that user's role to VIEWER: `/my-classes/<id>/roll` no longer allows marking (stale marker row ignored).
  - VIEWER: roll visible, buttons disabled.
  - Phone width 360 px: rows wrap, no horizontal scroll, buttons ≥ 44 px.

- [ ] **Step 4: Push + PR**

```bash
git push -u origin feat/sunday-school-attendance
gh pr create --title "feat(sunday-school): take the class roll" --body "$(cat <<'EOF'
## Summary
- Mobile roll per class + date: Present / Late / Absent, tap again to clear, "Mark unmarked present", live counts, search. Optimistic with revert (CheckInList pattern).
- Sessions created lazily (`@@unique([classId, date])`); marks record who/when; moved children keep history.
- Volunteer teachers: EVENT_ORGANISER logins assigned per class as roll markers get `/my-classes` (middleware allow-list) and can mark only their classes. `canMarkRoll` re-checks role so stale rows grant nothing.
- VIEWER read-only; archived classes read-only; future / other-year dates refused.
- Class page: Take roll, Recent sessions, Roll markers panel.
- Docs: sunday-school, event-organisers, roles-and-permissions, README.

Closes OSS-10 (epic OSS-8). Builds on OSS-9.

## Release note for the PROD_VERSION bump
- **Adds migration `…_sunday_school_attendance`** (new enum + 3 new tables) → human-reviewed bump.
- Widens the EVENT_ORGANISER middleware allow-list to `/my-classes` (self-gated by `canMarkRoll`).
- No new env var.

## Test plan
- [x] Pure roll helpers, access matrix, action guards/IDOR/date rules/bulk, RollList behaviour, organiser allow-list, page gates
- [x] `npm run lint`, `tsc --noEmit`
- [ ] Local smoke as admin, organiser (assigned / unassigned / downgraded), viewer; 360 px — tick only after it has actually been run

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh project item-add 3 --owner ginutgeorge-Aus --url <PR URL>
gh pr comment --body "@codex review"
```

- [ ] **Step 5: STOP.** Disposition loop per Workflow rules; PO merges.

---

## Out of scope / follow-up

- QR / barcode check-in and printable badges → OSS-11 (can reuse `QrScanButton` + `setAttendance`).
- Attendance rates, streaks, absentee flags, dashboards → OSS-12. CSV/PDF reports → OSS-13 (`escapeCsv` guard).
- Offline marking (service worker queue) for churches with poor signal → new card if requested.
- "Class didn't run" / cancelled-session state, scheduled sessions, term calendars.
- Linking `User` ↔ `Person` so a teacher's login is derived from the teacher list (v1 assigns markers separately).
- A dedicated `TEACHER` role (v1 reuses EVENT_ORGANISER; rename/label only if it confuses users).
- Parent notifications on absence → OSS-14/15. Late arrival time stamp / pickup sign-out.
- "Mark rest absent" bulk action.

## Self-Review

- Card scope: per-class session roll (Tasks 1, 4–6), one-click present/absent/late (Task 5), any class size (single list, per-row calls, bulk createMany), mobile-friendly (Task 5 layout + smoke at 360 px). Docs (Task 7). Verify (Task 8).
- Access boundary: page AND action both use `canMarkRoll`; organiser routes 404 when unassigned; middleware widened only for `/my-classes`; stale marker after role change covered by test (Task 3) and smoke.
- Names consistent with OSS-9 plan (`SundaySchoolClass`, `SundaySchoolEnrolment`, `/sunday-school/[id]`).
