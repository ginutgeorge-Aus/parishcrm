# Sunday School Classes, Teachers and Enrolment (OSS-9) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline on the main thread; one task at a time, main-thread check between tasks). Steps use checkbox (`- [ ]`) syntax for tracking. If the diff passes ~150 logic lines (it will), the single pre-PR review is `/code-review medium`.

## Workflow rules (PO's standing rules; apply to every task)

- **Start:** `/board move OSS-9 "In Progress"` (Waiting on = Claude) and seed the ticket `## State` block in `.claude/tickets/OSS-9.md`. Overwrite `## State` after each task (step · next · blocker). Append one Activity-log line per milestone.
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

**Goal:** Staff can set up Sunday School classes for a school year (name, level, optional location), assign teachers (People tagged *Sunday school teacher*), enrol children from People, see each child's class on their profile, and roll the whole school over to next year in one click (classes + teachers copied, children promoted one level). Foundation for OSS-10 (attendance roll) and the rest of the OSS-8 epic.

**Architecture:** Three new tables, no encrypted columns (class names, levels and locations are not PII; enrolment/teacher rows are only FKs). `SundaySchoolClass` is per `year` (AU school year = calendar year). `SundaySchoolEnrolment` carries a denormalised `year` so `@@unique([personId, year])` enforces "one class per child per year" in the DB, and enrolling a child already in another class that year *moves* them (upsert). A pure, client-safe module `src/lib/sundaySchool.ts` holds the Zod form schema, `currentSchoolYear`, and `planRollover` (pure promotion planner); a server-action module `src/lib/actions/sundaySchool.ts` does all writes. Pages live under `src/app/(dashboard)/sunday-school/`. Access: view = `canViewPeople`, edit = `canEdit`, both enforced in page and action.

**Tech Stack:** Next.js 16 App Router (Server Components + Server Actions), Prisma 7 (`@prisma/adapter-pg`), Zod v4, Jest 30 + React Testing Library, lucide-react icons, existing shadcn `ui/*` components.

Ticket: `.claude/tickets/OSS-9.md`. Epic: OSS-8. Next card: OSS-10 (`docs/superpowers/plans/2026-10-07-oss-10-sunday-school-attendance.md`) depends on the names below.

## PO decisions (confirmed by PO 2026-10-07 — all defaults)

Applied as defaults so the plan is executable; each is cheap to flip before Task 1.

1. **School year model: calendar `year` on the class, no Term model.** AU school year = calendar year; `currentSchoolYear()` = Sydney calendar year. Terms (T1–T4 date ranges) are out of scope; reports can filter by date range later.
2. **Grade = manual `level` on the class (integer progression order, 0 = Kindy/Prep), not derived from DOB.** `Person.dateOfBirth` is an encrypted string, so DB-side age queries are impossible, and churches group grades loosely ("Years 1–2"). Class `name` is the display label; `level` drives sort order and rollover promotion.
3. **Rollover = copy forward + promote.** "Roll over to {year+1}" copies every non-archived class (name, level, location, teachers) into next year and moves each enrolled child to the next year's class at `level + 1` at the same location. Children with no single matching target (top level / ambiguous / missing) are left unenrolled and counted in the result message. Refused if next year already has classes (idempotency). Previous year stays as read-only history.
4. **Multi-location in v1 = optional free-text `location` on the class** (campus/room/group), shown as a group heading and used to match rollover targets. No Location model.
5. **One class per child per year** (DB unique). Enrolling a child who is in another class that year moves them.
6. **Teachers must be People tagged `SUNDAY_SCHOOL_TEACHER`** (OSS-47) so every teacher falls under the clearance compliance list (OSS-49). The class page shows each teacher's WWCC status badge.
7. **Who can see / edit:** view = `canViewPeople` (ADMIN, PASTOR, OFFICE_ADMIN, VIEWER read-only); edit = `canEdit` (ADMIN, PASTOR, OFFICE_ADMIN). AUDITOR and EVENT_ORGANISER see nothing. (Letting assigned teacher accounts *mark the roll* is OSS-10.)
8. **Remove a class = archive** (`archivedAt`), never hard delete, so OSS-10 attendance history survives.

## Global Constraints

- Names (shared with OSS-10, use exactly):
  - Models `SundaySchoolClass { id Int, year Int, name String, level Int, location String @default(""), archivedAt DateTime?, createdAt, updatedAt }`, `SundaySchoolTeacher { id, classId, personId }` (`@@unique([classId, personId])`), `SundaySchoolEnrolment { id, classId, personId, year Int, enrolledAt }` (`@@unique([personId, year])`, accessor `personId_year`).
  - Person back-relations `sundaySchoolTeaching SundaySchoolTeacher[]`, `sundaySchoolEnrolments SundaySchoolEnrolment[]`.
  - Pure module `src/lib/sundaySchool.ts`: `ClassFormSchema`, `currentSchoolYear(at?: Date): number`, `planRollover(input): RolloverPlan`, `MAX_LEVEL = 20`.
  - Actions `src/lib/actions/sundaySchool.ts`: `createClass`, `updateClass`, `archiveClass`, `addTeacher`, `removeTeacher`, `enrolChildren`, `unenrolChild`, `rolloverYear`.
  - Routes `/sunday-school`, `/sunday-school/new`, `/sunday-school/[id]`, `/sunday-school/[id]/edit`.
  - Audit actions: `SS_CLASS_CREATED`, `SS_CLASS_UPDATED`, `SS_CLASS_ARCHIVED`, `SS_TEACHER_ADDED`, `SS_TEACHER_REMOVED`, `SS_ENROLLED`, `SS_UNENROLLED`, `SS_ROLLOVER`, entity `"SundaySchoolClass"`.
  - Migration dir `prisma/migrations/20261007000000_sunday_school_classes/`.
- Branch `feat/sunday-school-classes`; PR title `feat(sunday-school): classes, teachers and enrolment`.
- Public AGPL repo: synthetic data only (`admin@example.com`, the "Sample" family, "Test Child").
- Every mutation guarded at page AND server action (`canEdit`), `assertNotDemo()` first in each action, `logAudit(actorId(session), ...)` after each write. `"use server"` files export only `async` functions.
- `select` over `include` everywhere a page reads people (names only reach these pages; no email/phone/DOB).
- Enums from `@/lib/generated/prisma/enums`. Zod v4 (`.issues`). Ids validated with `isValidPgId` / `parseRouteId` (`src/lib/validation.ts`).
- Next.js 16: page `params` / `searchParams` are Promises. Read `node_modules/next/dist/docs/` before using any API not already used in this repo.
- JSDoc on every new or changed function, exported or not.
- Tests: `npm test -- --testPathPatterns="<x>"` (never bare `npx jest`). Action tests start with `/** @jest-environment node */`. Remember duplicate test roots (`src/**/__tests__` and root `__tests__/`): use basename patterns.
- Commits end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. PR body ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Feature PR updates website docs + stale README claims in the same PR.

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `prisma/schema.prisma` | modify | 3 models + 2 Person back-relations |
| `prisma/migrations/20261007000000_sunday_school_classes/migration.sql` | create | CREATE TABLE × 3, indexes, FKs |
| `src/lib/sundaySchool.ts` | create | pure: form schema, `currentSchoolYear`, `planRollover` |
| `src/lib/__tests__/sundaySchool.test.ts` | create | unit tests for the pure module |
| `src/lib/actions/sundaySchool.ts` | create | 8 server actions |
| `src/lib/actions/__tests__/sundaySchool.test.ts` | create | guards, IDOR, move-on-enrol, rollover txn |
| `src/components/sunday-school/ClassForm.tsx` | create | create/edit form (`useActionState`) |
| `src/components/sunday-school/TeachersPanel.tsx` | create | list + add/remove teacher (client) |
| `src/components/sunday-school/EnrolPanel.tsx` | create | enrolled list + candidate picker (client) |
| `src/components/sunday-school/RolloverButton.tsx` | create | confirm dialog + call `rolloverYear` |
| `__tests__/components/sunday-school/EnrolPanel.test.tsx` | create | filter + submit test |
| `src/app/(dashboard)/sunday-school/page.tsx` | create | list by year, grouped by location |
| `src/app/(dashboard)/sunday-school/new/page.tsx` | create | new class |
| `src/app/(dashboard)/sunday-school/[id]/page.tsx` | create | class detail (teachers, children) |
| `src/app/(dashboard)/sunday-school/[id]/edit/page.tsx` | create | edit class |
| `__tests__/app/sunday-school-page.test.tsx` | create | role gates (AUDITOR redirect, VIEWER read-only) |
| `src/components/layout/sidebar/navData.ts` | modify | "Sunday School" link (Members group) |
| `__tests__/components/sidebar/navData.test.ts` | modify | link visibility |
| `src/app/(dashboard)/people/[id]/page.tsx` | modify | "Sunday School: <class> (<year>)" line in Church card |
| `prisma/seed.ts` | modify | one demo class + a synthetic child (create-only) |
| `.claude/rules/data-model.md` | modify | Sunday School bullets |
| `website/src/content/docs/docs/sunday-school.md` | create | feature docs |
| `website/src/sidebar.mjs` | modify | add `sunday-school` to People & Families |
| `website/src/content/docs/docs/roles-and-permissions.md` | modify | matrix row |
| `README.md` | modify | Core features bullet |

---

### Task 0: Branch from up-to-date main

**Files:** none.

- [ ] **Step 1: Create the branch**

```bash
cd /home/ggeorge/workspace/Projects/parishcrm
git fetch origin
git switch main
git pull --ff-only origin main
git switch -c feat/sunday-school-classes
git status --short
```
Expected: on `feat/sunday-school-classes`; only this plan file and the OSS-10 plan may show as untracked (commit them in this PR's first commit with the ticket).

- [ ] **Step 2: Install and generate**

```bash
npm ci --no-audit --no-fund
```
Expected: exits 0 (`postinstall` runs `prisma generate`).

---

### Task 1: Schema + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261007000000_sunday_school_classes/migration.sql`

- [ ] **Step 1: Add the models**

Append after `model PersonClearance { ... }` (end of the People section):

```prisma
// Sunday School (OSS-9). A class belongs to one school year (AU school year =
// calendar year). `level` is the progression order (0 = Kindy/Prep) used to sort
// and to promote children on rollover; `name` is the display label. `location`
// is an optional campus/room/group label ("" = none — NOT NULL so the unique
// below holds; Postgres treats NULLs as distinct). Archive, never delete, so
// OSS-10 attendance history survives.
model SundaySchoolClass {
  id         Int                     @id @default(autoincrement())
  year       Int
  name       String
  level      Int
  location   String                  @default("")
  archivedAt DateTime?
  createdAt  DateTime                @default(now())
  updatedAt  DateTime                @updatedAt
  teachers   SundaySchoolTeacher[]
  enrolments SundaySchoolEnrolment[]

  @@unique([year, name, location])
  @@index([year, archivedAt])
}

// A Person (tagged SUNDAY_SCHOOL_TEACHER) who teaches a class.
model SundaySchoolTeacher {
  id       Int               @id @default(autoincrement())
  classId  Int
  personId Int
  class    SundaySchoolClass @relation(fields: [classId], references: [id], onDelete: Cascade)
  person   Person            @relation(fields: [personId], references: [id], onDelete: Cascade)

  @@unique([classId, personId])
  @@index([personId])
}

// A child's place in a class. `year` is copied from the class so the DB can
// enforce one class per child per school year.
model SundaySchoolEnrolment {
  id         Int               @id @default(autoincrement())
  classId    Int
  personId   Int
  year       Int
  enrolledAt DateTime          @default(now())
  class      SundaySchoolClass @relation(fields: [classId], references: [id], onDelete: Cascade)
  person     Person            @relation(fields: [personId], references: [id], onDelete: Cascade)

  @@unique([personId, year])
  @@index([classId])
}
```

In `model Person`, after `clearances            PersonClearance[]`:
```prisma
  sundaySchoolTeaching   SundaySchoolTeacher[]
  sundaySchoolEnrolments SundaySchoolEnrolment[]
```

```bash
npx prisma format && npx prisma generate
grep -n "SundaySchoolEnrolment" src/lib/generated/prisma/models.ts | head -2
```
Expected: generate succeeds; grep prints a match.

- [ ] **Step 2: Generate the migration SQL against a throwaway DB**

```bash
npx prisma dev --detach      # export the DATABASE_URL it prints in this shell
npx prisma migrate deploy    # apply existing migrations
mkdir -p prisma/migrations/20261007000000_sunday_school_classes
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script \
  > prisma/migrations/20261007000000_sunday_school_classes/migration.sql
npx prisma migrate deploy
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script --exit-code; echo "exit=$?"
```
Expected: the generated file contains three `CREATE TABLE` blocks (`SundaySchoolClass` with `"location" TEXT NOT NULL DEFAULT ''`), `CREATE UNIQUE INDEX "SundaySchoolClass_year_name_location_key"`, `"SundaySchoolEnrolment_personId_year_key"`, `"SundaySchoolTeacher_classId_personId_key"`, the `@@index` indexes, and four `ADD CONSTRAINT ... ON DELETE CASCADE ON UPDATE CASCADE` FKs. Second diff prints `-- This is an empty migration.` and `exit=0`. If `prisma dev` is unavailable, hand-write the SQL in the style of `20261006120000_person_clearance/migration.sql` and rely on CI's `migrations` job (note it in the PR).

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261007000000_sunday_school_classes docs/superpowers/plans/2026-10-07-oss-9-sunday-school-classes.md docs/superpowers/plans/2026-10-07-oss-10-sunday-school-attendance.md
git commit -m "$(cat <<'EOF'
feat(sunday-school): class, teacher, enrolment schema

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Pure module `sundaySchool.ts` (TDD)

**Files:**
- Create: `src/lib/sundaySchool.ts`
- Test: `src/lib/__tests__/sundaySchool.test.ts`

**Interfaces (produced):**
```ts
export const MAX_LEVEL = 20
export const ClassFormSchema: z.ZodType<{ name: string; level: number; location: string }>
export function currentSchoolYear(at?: Date): number
export type RolloverClassInput = { id: number; name: string; level: number; location: string; teacherPersonIds: number[]; childPersonIds: number[] }
export type RolloverPlan = {
  classes: { sourceId: number; name: string; level: number; location: string; teacherPersonIds: number[] }[]
  placements: { personId: number; targetSourceId: number }[]   // target = the SOURCE class whose copy receives the child
  unplaced: number[]                                            // personIds left unenrolled
}
export function planRollover(classes: RolloverClassInput[]): RolloverPlan
```

Design: `planRollover` works on source ids; the action maps `sourceId -> newId` after creating the copies. A child in class (level L, location X) goes to the unique class at (L+1, X). Zero or 2+ candidates → `unplaced` (top level graduates, or ambiguous: staff place by hand). Pure, no Prisma import, so it is unit-tested without mocks.

- [ ] **Step 1: Write the failing test**

```ts
import { ClassFormSchema, currentSchoolYear, planRollover, MAX_LEVEL } from "@/lib/sundaySchool"

describe("ClassFormSchema", () => {
  it("trims and coerces", () => {
    const r = ClassFormSchema.safeParse({ name: "  Years 1–2 ", level: "1", location: " Hall " })
    expect(r.success && r.data).toEqual({ name: "Years 1–2", level: 1, location: "Hall" })
  })
  it("defaults location to empty string", () => {
    const r = ClassFormSchema.safeParse({ name: "Kindy", level: "0" })
    expect(r.success && r.data.location).toBe("")
  })
  it("rejects empty name, negative or too-high level, long strings", () => {
    expect(ClassFormSchema.safeParse({ name: " ", level: "1" }).success).toBe(false)
    expect(ClassFormSchema.safeParse({ name: "A", level: "-1" }).success).toBe(false)
    expect(ClassFormSchema.safeParse({ name: "A", level: String(MAX_LEVEL + 1) }).success).toBe(false)
    expect(ClassFormSchema.safeParse({ name: "A", level: "1.5" }).success).toBe(false)
    expect(ClassFormSchema.safeParse({ name: "x".repeat(81), level: "1" }).success).toBe(false)
  })
})

describe("currentSchoolYear", () => {
  it("uses the Sydney calendar year (31 Dec 14:00Z is already 1 Jan in Sydney)", () => {
    expect(currentSchoolYear(new Date("2026-12-31T14:00:00Z"))).toBe(2027)
    expect(currentSchoolYear(new Date("2026-06-01T00:00:00Z"))).toBe(2026)
  })
})

describe("planRollover", () => {
  const cls = (id: number, level: number, location = "", kids: number[] = [], teachers: number[] = []) =>
    ({ id, name: `C${id}`, level, location, teacherPersonIds: teachers, childPersonIds: kids })

  it("copies every class with its teachers", () => {
    const plan = planRollover([cls(1, 0, "", [], [7]), cls(2, 1)])
    expect(plan.classes).toEqual([
      { sourceId: 1, name: "C1", level: 0, location: "", teacherPersonIds: [7] },
      { sourceId: 2, name: "C2", level: 1, location: "", teacherPersonIds: [] },
    ])
  })

  it("promotes children to level+1 at the same location", () => {
    const plan = planRollover([cls(1, 0, "North", [10, 11]), cls(2, 1, "North"), cls(3, 1, "South")])
    expect(plan.placements).toEqual([
      { personId: 10, targetSourceId: 2 },
      { personId: 11, targetSourceId: 2 },
    ])
    expect(plan.unplaced).toEqual([])
  })

  it("leaves top-level and ambiguous children unplaced", () => {
    const plan = planRollover([cls(1, 0, "", [10]), cls(2, 1, "", [20]), cls(3, 1, "", [])])
    // level 0 -> two level-1 classes at "" = ambiguous; level 1 -> no level 2 = graduates
    expect(plan.placements).toEqual([])
    expect(plan.unplaced.sort()).toEqual([10, 20])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --testPathPatterns="lib/__tests__/sundaySchool"`
Expected: FAIL, `Cannot find module '@/lib/sundaySchool'`.

- [ ] **Step 3: Implement**

```ts
import { z } from "zod"
import { sydneyParts } from "@/lib/dates"

/** Highest class level (0 = Kindy/Prep … 12 = Year 12, headroom for youth groups). */
export const MAX_LEVEL = 20

/**
 * Class create/edit form. `level` arrives as a string from FormData; must be a
 * whole number 0..MAX_LEVEL. `location` is optional and normalised to "" (not
 * null) because the DB unique (year, name, location) needs a NOT NULL column.
 */
export const ClassFormSchema = z.object({
  name: z.string().trim().min(1, "Class name is required").max(80, "Class name is too long"),
  level: z.coerce.number().int("Level must be a whole number").min(0).max(MAX_LEVEL, `Level must be 0–${MAX_LEVEL}`),
  location: z.string().trim().max(80, "Location is too long").optional().transform((v) => v ?? ""),
})

/** The school year "now" — the Sydney calendar year (AU school year = calendar year). */
export function currentSchoolYear(at: Date = new Date()): number {
  return sydneyParts(at).year
}

export type RolloverClassInput = {
  id: number; name: string; level: number; location: string
  teacherPersonIds: number[]; childPersonIds: number[]
}
export type RolloverPlan = {
  classes: { sourceId: number; name: string; level: number; location: string; teacherPersonIds: number[] }[]
  placements: { personId: number; targetSourceId: number }[]
  unplaced: number[]
}

/**
 * Plan a year rollover without touching the DB. Every class is copied (same
 * name/level/location/teachers). Each child moves to the ONE class at
 * level+1 in the same location; if there is none (top level) or more than one
 * (ambiguous), the child is returned in `unplaced` for staff to place by hand.
 */
export function planRollover(classes: RolloverClassInput[]): RolloverPlan {
  const key = (level: number, location: string) => `${level}\u0000${location}`
  const byKey = new Map<string, number[]>()
  for (const c of classes) {
    const k = key(c.level, c.location)
    byKey.set(k, [...(byKey.get(k) ?? []), c.id])
  }
  const placements: RolloverPlan["placements"] = []
  const unplaced: number[] = []
  for (const c of classes) {
    const targets = byKey.get(key(c.level + 1, c.location)) ?? []
    for (const personId of c.childPersonIds) {
      if (targets.length === 1) placements.push({ personId, targetSourceId: targets[0] })
      else unplaced.push(personId)
    }
  }
  return {
    classes: classes.map((c) => ({
      sourceId: c.id, name: c.name, level: c.level, location: c.location, teacherPersonIds: c.teacherPersonIds,
    })),
    placements,
    unplaced,
  }
}
```
(`z` import: match the repo — `grep -rn "from \"zod\"" src/lib | head -1` and use the same specifier.)

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- --testPathPatterns="lib/__tests__/sundaySchool"`
Expected: PASS.

- [ ] **Step 5: Commit** — `feat(sunday-school): pure form schema and rollover planner`.

---

### Task 3: Server actions (TDD)

**Files:**
- Create: `src/lib/actions/sundaySchool.ts`
- Test: `src/lib/actions/__tests__/sundaySchool.test.ts`

**Interfaces (produced):**
```ts
createClass(year: number, _prev: ActionResult, formData: FormData): Promise<ActionResult>          // redirect /sunday-school/<id>
updateClass(id: number, _prev: ActionResult, formData: FormData): Promise<ActionResult>            // year is NOT editable; redirect /sunday-school/<id>
archiveClass(id: number): Promise<ActionResult>
addTeacher(classId: number, personId: number): Promise<ActionResult>
removeTeacher(classId: number, personId: number): Promise<ActionResult>
enrolChildren(classId: number, personIds: number[]): Promise<ActionResultWithSuccess>             // upsert by personId_year = move
unenrolChild(classId: number, personId: number): Promise<ActionResult>
rolloverYear(fromYear: number): Promise<ActionResultWithSuccess>
```

Rules every action follows (in this order): `assertNotDemo()` → `auth()` + `canEdit` → validate ids (`isValidPgId`, arrays capped at 200 and deduped) → parent lookup (class exists, `archivedAt: null`) → child lookup (IDOR: person exists, `archivedAt: null`) → write → `logAudit(actorId(session), ..., "SundaySchoolClass", classId, meta)` → `revalidatePath`.

Specific rules:
- `createClass`/`updateClass`: `ClassFormSchema.safeParse(Object.fromEntries(formData))`; `year` within `MIN_YEAR..MAX_YEAR`. Wrap only the DB call in try/catch; `isP2002` → `{ error: "A class with this name and location already exists for that year (it may be archived)" }`. `redirect` outside the catch.
- `addTeacher`: person must have `ministryRoles: { has: "SUNDAY_SCHOOL_TEACHER" }` → else `{ error: "Tag this person as a Sunday school teacher first" }`. Duplicate → P2002 swallowed (idempotent, like `addEventManager`). `removeTeacher` uses `deleteMany` (missing = success).
- `enrolChildren`: load the class's `year`; `prisma.person.findMany({ where: { id: { in: ids }, archivedAt: null }, select: { id: true } })`; if any id missing → `{ error: "Person not found" }`. Then in one `$transaction`, per id: `sundaySchoolEnrolment.upsert({ where: { personId_year: { personId, year } }, create: { classId, personId, year }, update: { classId } })`. Count moves by reading existing rows first (`findMany where personId in ids, year`) — `moved = existing.filter(e => e.classId !== classId).length`. Return `{ success: "Enrolled 3 (1 moved from another class)" }`. Revalidate `/sunday-school/${classId}` and each old class path.
- `unenrolChild`: `deleteMany({ where: { classId, personId } })`.
- `rolloverYear(fromYear)`: refuse if `sundaySchoolClass.count({ where: { year: fromYear + 1 } }) > 0` (archived classes count too) → `{ error: "<year+1> already has classes — roll over is one-time" }`. Load non-archived classes for `fromYear` with `teachers.personId` and `enrolments.personId` filtered to non-archived persons; `planRollover`; one interactive `$transaction` creates classes (map `sourceId → newId`), `sundaySchoolTeacher.createMany`, `sundaySchoolEnrolment.createMany({ skipDuplicates: true })` with `year: fromYear + 1`. Audit once (`SS_ROLLOVER`, entity id 0 not allowed → use the first new class id, meta `{ fromYear, classes, placed, unplaced }`). Return `{ success: "Created N classes for <y>; moved M children; K need placing by hand" }`.

- [ ] **Step 1: Write the failing tests** (sketch — complete each `it` with the same mock style as `eventManager.action.test.ts`)

```ts
/** @jest-environment node */
import { UserRole } from "@/lib/generated/prisma/enums"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => {
  const m = {
    sundaySchoolClass: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), count: jest.fn() },
    sundaySchoolTeacher: { create: jest.fn(), createMany: jest.fn(), deleteMany: jest.fn() },
    sundaySchoolEnrolment: { findMany: jest.fn(), upsert: jest.fn(), createMany: jest.fn(), deleteMany: jest.fn() },
    person: { findFirst: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(),
  }
  m.$transaction.mockImplementation((arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: typeof m) => unknown)(m) : Promise.all(arg as unknown[]))
  return { prisma: m }
})
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/demoMode", () => ({ assertNotDemo: jest.fn(() => null) }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("next/navigation", () => ({ redirect: jest.fn(() => { throw new Error("NEXT_REDIRECT") }) }))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { addTeacher, enrolChildren, rolloverYear, createClass, archiveClass } from "@/lib/actions/sundaySchool"

const as = (role: UserRole) => (auth as jest.Mock).mockResolvedValue({ user: { id: "1", role } })
beforeEach(() => jest.clearAllMocks())

describe("guards", () => {
  it.each([UserRole.VIEWER, UserRole.AUDITOR, UserRole.EVENT_ORGANISER])("%s cannot mutate", async (role) => {
    as(role)
    expect(await archiveClass(1)).toEqual({ error: "Unauthorized" })
    expect(await enrolChildren(1, [2])).toEqual({ error: "Unauthorized" })
    expect(prisma.sundaySchoolEnrolment.upsert).not.toHaveBeenCalled()
  })
  it("rejects an archived class", async () => {
    as(UserRole.OFFICE_ADMIN)
    ;(prisma.sundaySchoolClass.findFirst as jest.Mock).mockResolvedValue(null) // where archivedAt:null
    expect(await enrolChildren(1, [2])).toEqual({ error: "Class not found" })
  })
})

describe("createClass", () => {
  it("maps a duplicate to a friendly error", async () => { /* create rejects {code:"P2002"} -> error text */ })
  it("redirects to the new class on success", async () => { /* rejects NEXT_REDIRECT; create data has year */ })
})

describe("addTeacher", () => {
  it("requires the SUNDAY_SCHOOL_TEACHER tag", async () => {
    as(UserRole.ADMIN)
    ;(prisma.sundaySchoolClass.findFirst as jest.Mock).mockResolvedValue({ id: 1, year: 2026 })
    ;(prisma.person.findFirst as jest.Mock).mockResolvedValue(null) // where includes ministryRoles has
    expect(await addTeacher(1, 5)).toEqual({ error: "Tag this person as a Sunday school teacher first" })
  })
})

describe("enrolChildren", () => {
  it("upserts by personId_year and reports moves", async () => {
    as(UserRole.ADMIN)
    ;(prisma.sundaySchoolClass.findFirst as jest.Mock).mockResolvedValue({ id: 1, year: 2026 })
    ;(prisma.person.findMany as jest.Mock).mockResolvedValue([{ id: 2 }, { id: 3 }])
    ;(prisma.sundaySchoolEnrolment.findMany as jest.Mock).mockResolvedValue([{ personId: 3, classId: 9 }])
    const r = await enrolChildren(1, [2, 3, 3])
    expect(prisma.sundaySchoolEnrolment.upsert).toHaveBeenCalledTimes(2)
    expect((prisma.sundaySchoolEnrolment.upsert as jest.Mock).mock.calls[1][0]).toEqual({
      where: { personId_year: { personId: 3, year: 2026 } },
      create: { classId: 1, personId: 3, year: 2026 },
      update: { classId: 1 },
    })
    expect(r).toEqual({ success: "Enrolled 2 (1 moved from another class)" })
  })
  it("rejects an unknown or archived person", async () => { /* findMany returns 1 of 2 -> Person not found */ })
  it("rejects more than 200 ids", async () => { /* -> Too many people */ })
})

describe("rolloverYear", () => {
  it("refuses when next year already has classes", async () => {
    as(UserRole.ADMIN)
    ;(prisma.sundaySchoolClass.count as jest.Mock).mockResolvedValue(2)
    expect(await rolloverYear(2026)).toEqual({ error: "2027 already has classes — roll over is one-time" })
  })
  it("creates copies, teachers and promoted enrolments in one transaction", async () => {
    as(UserRole.ADMIN)
    ;(prisma.sundaySchoolClass.count as jest.Mock).mockResolvedValue(0)
    ;(prisma.sundaySchoolClass.findMany as jest.Mock).mockResolvedValue([
      { id: 1, name: "Kindy", level: 0, location: "", teachers: [{ personId: 7 }], enrolments: [{ personId: 10 }] },
      { id: 2, name: "Years 1–2", level: 1, location: "", teachers: [], enrolments: [{ personId: 20 }] },
    ])
    ;(prisma.sundaySchoolClass.create as jest.Mock)
      .mockResolvedValueOnce({ id: 101 }).mockResolvedValueOnce({ id: 102 })
    const r = await rolloverYear(2026)
    expect(prisma.sundaySchoolTeacher.createMany).toHaveBeenCalledWith({ data: [{ classId: 101, personId: 7 }], skipDuplicates: true })
    expect(prisma.sundaySchoolEnrolment.createMany).toHaveBeenCalledWith({
      data: [{ classId: 102, personId: 10, year: 2027 }], skipDuplicates: true,
    })
    expect(r).toEqual({ success: "Created 2 classes for 2027; moved 1 child; 1 need placing by hand" })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --testPathPatterns="actions/__tests__/sundaySchool"`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement** — skeleton for the shared guard + one action; the rest follow the rules above.

```ts
"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { logAudit } from "@/lib/audit"
import { assertNotDemo } from "@/lib/demoMode"
import { prisma } from "@/lib/prisma"
import { canEdit } from "@/lib/roleGuard"
import { isP2002, isValidPgId, MIN_YEAR, MAX_YEAR } from "@/lib/validation"
import { ClassFormSchema, planRollover } from "@/lib/sundaySchool"
import type { ActionResult, ActionResultWithSuccess } from "./types"

const MAX_BATCH = 200

/**
 * Shared guard: demo block, editor role, live (non-archived) class. Returns the
 * session + class year, or an error result. Not exported ("use server" files
 * may only export async functions; this is module-private).
 */
async function editableClass(classId: number) {
  const demo = assertNotDemo()
  if (demo) return { error: demo.error } as const
  const session = await auth()
  if (!canEdit(session?.user?.role)) return { error: "Unauthorized" } as const
  if (!isValidPgId(classId)) return { error: "Invalid class" } as const
  const cls = await prisma.sundaySchoolClass.findFirst({
    where: { id: classId, archivedAt: null },
    select: { id: true, year: true },
  })
  if (!cls) return { error: "Class not found" } as const
  return { session, cls } as const
}

/**
 * Enrol (or move) children into a class. One class per child per year is a DB
 * unique (personId, year), so an upsert moves a child already enrolled
 * elsewhere this year. canEdit-gated; ids deduped and capped.
 */
export async function enrolChildren(classId: number, personIds: number[]): Promise<ActionResultWithSuccess> {
  const g = await editableClass(classId)
  if ("error" in g) return { error: g.error }
  const ids = [...new Set(personIds)]
  if (ids.length === 0) return { error: "Pick at least one child" }
  if (ids.length > MAX_BATCH) return { error: "Too many people at once" }
  if (!ids.every(isValidPgId)) return { error: "Invalid person" }

  const found = await prisma.person.findMany({ where: { id: { in: ids }, archivedAt: null }, select: { id: true } })
  if (found.length !== ids.length) return { error: "Person not found" }

  const year = g.cls.year
  const existing = await prisma.sundaySchoolEnrolment.findMany({
    where: { personId: { in: ids }, year },
    select: { personId: true, classId: true },
  })
  const movedFrom = existing.filter((e) => e.classId !== classId)
  await prisma.$transaction(ids.map((personId) =>
    prisma.sundaySchoolEnrolment.upsert({
      where: { personId_year: { personId, year } },
      create: { classId, personId, year },
      update: { classId },
    })))
  await logAudit(actorId(g.session), "SS_ENROLLED", "SundaySchoolClass", classId, { personIds: ids, moved: movedFrom.length })
  revalidatePath(`/sunday-school/${classId}`)
  for (const m of new Set(movedFrom.map((e) => e.classId))) revalidatePath(`/sunday-school/${m}`)
  revalidatePath("/sunday-school")
  const movedNote = movedFrom.length ? ` (${movedFrom.length} moved from another class)` : ""
  return { success: `Enrolled ${ids.length}${movedNote}` }
}
```
`createClass` cannot use `editableClass` (no class yet): inline the demo + role guard. `rolloverYear` uses `prisma.$transaction(async (tx) => { ... })` (interactive) because new ids feed the later inserts. Check `MIN_YEAR`/`MAX_YEAR` are exported from `src/lib/validation.ts` (they are, lines 67–68). Pluralise "child/children" in the rollover message with a tiny local helper.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- --testPathPatterns="actions/__tests__/sundaySchool"`
Expected: PASS.

- [ ] **Step 5: Commit** — `feat(sunday-school): class, teacher, enrolment actions`.

---

### Task 4: Class list, create and edit pages

**Files:**
- Create: `src/components/sunday-school/ClassForm.tsx`, `src/components/sunday-school/RolloverButton.tsx`
- Create: `src/app/(dashboard)/sunday-school/page.tsx`, `.../new/page.tsx`, `.../[id]/edit/page.tsx`
- Test: `__tests__/app/sunday-school-page.test.tsx`

Copy page scaffolding (breadcrumb, headings, `Card`, `Button asChild` links) from `src/app/(dashboard)/people/page.tsx` and `.../people/new/page.tsx` so it matches existing style. Check `__tests__/app/breadcrumb-consistency.test.tsx` — if it enumerates dashboard pages, add the new ones the way it expects.

- [ ] **Step 1: Page test (failing)**

```tsx
/** @jest-environment node */
// Mirrors __tests__/app/birthdays-page.test.tsx mocking of auth/prisma/redirect.
// Cases:
// - AUDITOR -> redirect("/")
// - VIEWER  -> renders class names, NO "New class" / "Roll over" controls
// - ADMIN   -> renders both controls
// - ?year=abc -> falls back to currentSchoolYear()
```
Run: `npm test -- --testPathPatterns="sunday-school-page"` → FAIL (module missing).

- [ ] **Step 2: `/sunday-school` page**

```tsx
type Props = { searchParams: Promise<{ year?: string; archived?: string }> }

/** Sunday School classes for one school year, grouped by location. canViewPeople to view; canEdit sees controls. */
export default async function SundaySchoolPage(props: Readonly<Props>) {
  const session = await auth()
  if (!session) redirect("/login")
  if (!canViewPeople(session.user.role)) redirect("/")
  const sp = await props.searchParams
  const parsed = Number.parseInt(sp.year ?? "", 10)
  const year = parsed >= MIN_YEAR && parsed <= MAX_YEAR ? parsed : currentSchoolYear()
  const editor = canEdit(session.user.role)

  const classes = await prisma.sundaySchoolClass.findMany({
    where: { year, archivedAt: null },
    orderBy: [{ location: "asc" }, { level: "asc" }, { name: "asc" }],
    select: {
      id: true, name: true, level: true, location: true,
      teachers: { select: { person: { select: { firstName: true, lastName: true } } } },
      _count: { select: { enrolments: true } },
    },
  })
  const nextYearHasClasses = editor
    ? (await prisma.sundaySchoolClass.count({ where: { year: year + 1 } })) > 0 // archived classes count too
    : true
  // Render: heading "Sunday School", year switcher (← 2025 | 2026 | 2027 →, plain Links ?year=),
  // editor: <Button asChild><Link href={`/sunday-school/new?year=${year}`}>New class</Link></Button>
  //         {classes.length > 0 && !nextYearHasClasses && <RolloverButton fromYear={year} />}
  // Group by location ("" -> "All locations" heading only when >1 group exists).
  // Each class: Card/row link -> /sunday-school/{id}: name, "Level n", teachers joined, "{count} children".
  // Empty state: "No classes for {year} yet." (+ "Create the first class" for editors).
}
```
Mobile: one column of cards (`grid gap-3 md:grid-cols-2`), no table, so it works at 360 px.

- [ ] **Step 3: `ClassForm` + new/edit pages**

`ClassForm` (client, `useActionState(action, undefined)`, `FormFeedback` for errors): inputs `name` (required), `level` (`type="number" min=0 max=20`, helper text "0 = Kindy/Prep, 1 = Year 1 … — used to order classes and to move children up at rollover"), `location` (optional, helper "Campus, room or group — leave blank if you have one location"). Year shown read-only text ("School year 2026").
- `new/page.tsx`: `canEdit` else `redirect("/sunday-school")`; year from `?year=` (same parse) → `createClass.bind(null, year)`.
- `[id]/edit/page.tsx`: `canEdit`; `parseRouteId`; load `{ id, year, name, level, location, archivedAt }`, `notFound()` if missing/archived; `updateClass.bind(null, id)`. Includes an **Archive class** button (`DeleteConfirmButton` from `src/components/shared/` with copy "Archive this class? It disappears from the list; its enrolments and history are kept.") calling `archiveClass`, then `router.push("/sunday-school")`.

- [ ] **Step 4: `RolloverButton`**

Client; `Dialog` confirm: "Copy all {n} classes and their teachers into {year+1}, and move each child up one level at the same location? Children in the top class, or where more than one next-level class exists, stay unenrolled for you to place." Calls `rolloverYear(fromYear)` in `useTransition`; on success shows the message and `router.push(`/sunday-school?year=${fromYear + 1}`)`.

- [ ] **Step 5: Run tests** — `npm test -- --testPathPatterns="sunday-school-page"` → PASS.

- [ ] **Step 6: Commit** — `feat(sunday-school): class list, create, edit pages`.

---

### Task 5: Class detail page — teachers + enrolment (TDD on the picker)

**Files:**
- Create: `src/app/(dashboard)/sunday-school/[id]/page.tsx`
- Create: `src/components/sunday-school/TeachersPanel.tsx`, `src/components/sunday-school/EnrolPanel.tsx`
- Test: `__tests__/components/sunday-school/EnrolPanel.test.tsx`

- [ ] **Step 1: Page data (server)**

```tsx
// canViewPeople else redirect("/"); parseRouteId else notFound()
const cls = await prisma.sundaySchoolClass.findUnique({
  where: { id },
  select: {
    id: true, year: true, name: true, level: true, location: true, archivedAt: true,
    teachers: { select: { person: { select: {
      id: true, firstName: true, lastName: true,
      // badge only (canViewClearanceStatus covers every role allowed on this page)
      clearances: { where: { type: "WWCC" }, select: { verifiedAt: true, expiresAt: true } },
    } } } },
    enrolments: {
      where: { person: { archivedAt: null } },
      orderBy: [{ person: { lastName: "asc" } }, { person: { firstName: "asc" } }],
      select: { person: { select: { id: true, firstName: true, lastName: true, family: { select: { id: true, name: true } } } } },
    },
  },
})
if (!cls) notFound()
// teacher badge: clearanceStatus(person.clearances[0] ?? null, sydneyToday()) + CLEARANCE_STATUS_LABELS
```
Editor-only extra queries (skip for VIEWER):
```ts
// Teacher candidates: tagged teachers not already on this class.
prisma.person.findMany({
  where: { archivedAt: null, ministryRoles: { has: "SUNDAY_SCHOOL_TEACHER" }, sundaySchoolTeaching: { none: { classId: id } } },
  select: { id: true, firstName: true, lastName: true }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
})
// Enrolment candidates: everyone live who is not in THIS class; carries their current class this year (for "Move" labelling).
prisma.person.findMany({
  where: { archivedAt: null, sundaySchoolEnrolments: { none: { classId: id } } },
  select: { id: true, firstName: true, lastName: true, role: true, family: { select: { name: true } },
            sundaySchoolEnrolments: { where: { year: cls.year }, select: { class: { select: { name: true } } } } },
  orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  take: 2000,
})
```
Archived class: render read-only with an "Archived" badge (no panels' controls).

Layout: header (name, "Level n · Location · Year"), Edit button (editor), then two cards: **Teachers** (`TeachersPanel`) and **Children (n)** (`EnrolPanel`). Child names link to `/people/{id}`.

- [ ] **Step 2: `EnrolPanel` failing test**

```tsx
// Renders enrolled list with "Remove" (editor) and an "Add children" section:
// - search input filters candidates by name (case-insensitive)
// - "Children only" checkbox is ticked by default and hides role !== "CHILD"
// - a candidate already in another class shows "in Years 3–4 — will move"
// - ticking two and pressing "Enrol 2" calls enrolChildren(classId, [ids]) once
// - readOnly prop hides every control
jest.mock("@/lib/actions/sundaySchool", () => ({ enrolChildren: jest.fn().mockResolvedValue({ success: "Enrolled 2" }), unenrolChild: jest.fn() }))
```
Run: `npm test -- --testPathPatterns="EnrolPanel"` → FAIL.

- [ ] **Step 3: Implement `EnrolPanel` + `TeachersPanel`**

`EnrolPanel` (client): props `{ classId, enrolled: {id,name,familyName}[], candidates: {id,name,familyName,isChild,currentClass: string|null}[], readOnly }`. Selected ids in a `Set` state; submit via `useTransition` → `enrolChildren`; show `FormFeedback` with `{ success }`/`{ error }`. Remove = `unenrolChild` with a small confirm. Touch targets `min-h-11`. Candidate list scrolls inside a `max-h-96 overflow-y-auto` box.

`TeachersPanel` (client): list each teacher with the WWCC badge (reuse the `STATUS_BADGE` token map pattern from `PersonClearances.tsx`; if it is not exported, export a tiny `ClearanceStatusBadge` from that file rather than duplicating the map), Remove button (editor); a `<select>` of candidates + **Add teacher**. Empty-candidate hint: "Only people tagged *Sunday school teacher* can be added — tag them on their profile."

- [ ] **Step 4: Run** — `npm test -- --testPathPatterns="EnrolPanel|sunday-school-page"` → PASS.

- [ ] **Step 5: Commit** — `feat(sunday-school): class detail with teachers and enrolment`.

---

### Task 6: Nav link + person profile line

**Files:**
- Modify: `src/components/layout/sidebar/navData.ts`, `__tests__/components/sidebar/navData.test.ts`
- Modify: `src/app/(dashboard)/people/[id]/page.tsx`

- [ ] **Step 1: Failing nav test** — in `navData.test.ts` add: with `canViewPeople: true` the Members group contains `{ href: "/sunday-school", label: "Sunday School" }` with `show: true`; with `canViewPeople: false` `show` is false.

Run: `npm test -- --testPathPatterns="navData"` → FAIL.

- [ ] **Step 2: Implement** — import `School` from `lucide-react`; in the Members group after Anniversaries:
```ts
{ href: "/sunday-school", label: "Sunday School", icon: School, show: canViewPeople },
```
Run again → PASS.

- [ ] **Step 3: Person profile** — in the person page query add
```ts
sundaySchoolEnrolments: { where: { year: currentSchoolYear() }, select: { class: { select: { id: true, name: true } } } },
```
and in the Church card, under the ministry-role badges, when present: `Sunday School: <Link href={`/sunday-school/${c.id}`}>{c.name}</Link> ({year})`. No new test file: extend the existing person page test only if one asserts the Church card's exact contents (`grep -rln "Church" __tests__/app | head`).

- [ ] **Step 4: Commit** — `feat(sunday-school): nav link and profile class line`.

---

### Task 7: Seed + rules doc

**Files:** `prisma/seed.ts`, `.claude/rules/data-model.md`

- [ ] **Step 1: Seed (create-only, never overwrites)** — after the Jane Sample upsert: upsert person id 3 `{ firstName: "Test", lastName: "Child", role: "CHILD", familyId: demoFamily.id, classification: "MEMBER" }` with `update: {}`; then `sundaySchoolClass.upsert({ where: { year_name_location: { year: <Sydney year>, name: "Years 1–2", location: "" } }, update: {}, create: { year, name: "Years 1–2", level: 1 } })`; teacher Jane (id 2) via `upsert` on `classId_personId`; enrol Test Child via `upsert` on `personId_year`. Guard each with the seed's existing `ALLOW_DEMO_SEED` flow (it already wraps the whole seed).

- [ ] **Step 2: data-model.md** — add under People & Families:
```markdown
- **Sunday School** (OSS-9): `SundaySchoolClass` (per `year`, `level` = progression order, `location String @default("")`, archive-only) → `SundaySchoolTeacher` (Person tagged `SUNDAY_SCHOOL_TEACHER`) + `SundaySchoolEnrolment` (`year` denormalised; `@@unique([personId, year])` = one class per child per year, enrol = upsert/move). Pure helpers + `planRollover` in `src/lib/sundaySchool.ts`; actions in `src/lib/actions/sundaySchool.ts`.
```

- [ ] **Step 3: Verify seed** — `ALLOW_DEMO_SEED=true npm run db:seed` twice against the throwaway DB → both exit 0 (idempotent).

- [ ] **Step 4: Commit** — `chore(sunday-school): demo seed and data-model rule`.

---

### Task 8: Docs (website + README)

**Files:** `website/src/content/docs/docs/sunday-school.md` (create), `website/src/sidebar.mjs`, `website/src/content/docs/docs/roles-and-permissions.md`, `README.md`.

- [ ] **Step 1: `sunday-school.md`**

```markdown
---
title: "Sunday School"
description: "Set up Sunday School classes for each school year, assign teachers, enrol children from People, and roll the whole school over to next year in one step."
---

Sunday School lives under **Members → Sunday School** (`/sunday-school`). Classes belong to a
school year (the calendar year). ADMIN, PASTOR and OFFICE_ADMIN can set classes up; VIEWER can
look but not change anything.

## Using it

- **Classes** — *New class* asks for a name ("Years 1–2"), a **level** (0 = Kindy/Prep, 1 = Year 1 …)
  and an optional **location** (campus, room or group). Level orders the list and decides where
  children move at rollover. Use the year arrows to look at other years.
- **Teachers** — on a class, *Add teacher* lists people tagged **Sunday school teacher** on their
  profile ([People and Families](/parishcrm/docs/people-and-families/)). Each teacher shows their WWCC status, so gaps are visible
  where the class is managed.
- **Children** — *Add children* lists people not in this class; *Children only* (on by default)
  shows people whose family role is Child. A child can be in one class per year: enrolling a child
  who is already in another class moves them. The child's class also shows on their profile.
- **Archive** — removing a class archives it; enrolments and (later) attendance history are kept.
- **Roll over to next year** — on the class list, once per year: copies every class and its
  teachers into next year and moves each child up one level at the same location. Children in the
  top class, or where two next-level classes exist at the same location, are left for you to place.

## How it works

Classes, teacher links and enrolments are three tables keyed to People; nothing here is
encrypted because it holds only names you already see in People, class names and levels.
One-class-per-child-per-year is enforced by the database. Every change is written to the audit log.
```

- [ ] **Step 2: sidebar.mjs** — People & Families group: append `'sunday-school'` after `'birthdays-and-celebrations'`.

- [ ] **Step 3: roles-and-permissions.md** — after the `Edit people & families / events` row:
```markdown
| Sunday School classes, teachers, enrolment, rollover (`/sunday-school`) | Yes | Yes | Yes | No | View only | No |
```

- [ ] **Step 4: README.md** — Core features, after the Families & members bullet:
```markdown
- **Sunday School** — classes per school year with levels and locations, teacher assignment (clearance status shown), child enrolment from People, one-step year rollover.
```

- [ ] **Step 5: Website build check** — `(set -o pipefail; cd website && npm ci && npm run build 2>&1 | tail -5)` (the website is a separate Astro build; this is not the app build). Expected: success, `sunday-school` page emitted.

- [ ] **Step 6: Commit** — `docs(sunday-school): classes, teachers, enrolment`.

---

### Task 9: Verify, push, PR

- [ ] **Step 1: Touched suites + lint + types**

```bash
set -euo pipefail
npm test -- --testPathPatterns="sundaySchool|sunday-school|EnrolPanel|navData|person" 2>&1 | tail -25
npm run lint 2>&1 | tail -15
npx tsc --noEmit 2>&1 | tail -15
```
Expected: all PASS, lint clean, no type errors.

- [ ] **Step 2: Local smoke** (`npx prisma dev --detach`, `npm run db:push`, `ALLOW_DEMO_SEED=true npm run db:seed`, `DISABLE_OTP=true npm run dev`)
  - As `admin@example.com`: create "Kindy" (level 0) and "Years 3–4" (level 3, location "North"); add Jane as teacher (badge shows); enrol Test Child into Kindy, then into "Years 1–2" → message says moved; profile shows the class; archive "Years 3–4" → gone from list.
  - Roll over → next year has copies + Jane; Test Child is in "Years 1–2" → moves to nothing (no level 2) → counted as needing placement; second rollover click is refused.
  - As `pastor@example.com`/a VIEWER account: list + detail visible, no controls; as an AUDITOR: `/sunday-school` redirects to `/`.
  - Phone width (devtools 360 px): list and detail usable without horizontal scroll.

- [ ] **Step 3: Push + PR**

```bash
git push -u origin feat/sunday-school-classes
gh pr create --title "feat(sunday-school): classes, teachers and enrolment" --body "$(cat <<'EOF'
## Summary
- New `/sunday-school` (Members nav): classes per school year with level + optional location, grouped by location.
- Teachers = People tagged Sunday school teacher, WWCC status badge per teacher.
- Enrol children from People (children-only filter, one class per child per year — DB unique; enrolling elsewhere moves the child). Class shown on the person profile.
- One-step rollover: copies classes + teachers to next year, promotes children one level at the same location; leftovers reported. One-time per year.
- Archive (not delete) keeps history for OSS-10 attendance.
- Gates: view `canViewPeople`, edit `canEdit` (page + action). Audit on every write.
- Docs: new `sunday-school` page, roles matrix, README.

Closes OSS-9 (epic OSS-8).

## Release note for the PROD_VERSION bump
- **Adds migration `20261007000000_sunday_school_classes`** (3 new tables, no changes to existing tables) → human-reviewed bump.
- No new env var.

## Test plan
- [x] Pure planner + form schema unit tests; action guards/IDOR/move/rollover tests; page role-gate tests; EnrolPanel test
- [x] `npm run lint`, `tsc --noEmit`
- [x] Local smoke as admin / viewer / auditor, phone width

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh project item-add 3 --owner ginutgeorge-Aus --url <PR URL>
gh pr comment --body "@codex review"
```

- [ ] **Step 4: STOP.** Run the review-findings disposition loop from the Workflow rules; the PO merges.

---

## Out of scope / follow-up

- Term model (T1–T4 date ranges) and term-based reports → revisit with OSS-12/13 if the PO wants per-term stats.
- Age / suggested class from DOB (DOB is encrypted; would need decrypt-in-app) → follow-up card if wanted.
- Location as a managed list (rename once, filter dropdown) → only if free text proves messy.
- Bulk "enrol a whole family's children" from the family page; CSV import of enrolments (OSS-18).
- Rollover preview screen with manual overrides (v1 reports leftovers; staff place them).
- Blocking teacher assignment on an expired/missing WWCC (v1 shows the badge only; OSS-49 digest already chases it).
- Allergy / medical / pickup-authorisation notes on enrolment (sensitive; needs encryption + its own card).
- Attendance (OSS-10), QR badges (OSS-11), dashboards (OSS-12), reports (OSS-13), parent messaging (OSS-14/15), registration (OSS-16).

## Self-Review

- Card scope: class/grade models (Task 1, level = grade), teacher assignment (Tasks 3, 5), enrol from People (Tasks 3, 5, profile line Task 6), term/year rollover (Tasks 2, 3, 4), multi-location groups (location field, grouping, rollover match). Docs (Task 8). Verify (Task 9).
- Names consistent with OSS-10's plan: `SundaySchoolClass`, `SundaySchoolEnrolment.personId_year`, `/sunday-school/[id]`, `canViewPeople`/`canEdit`.
- Risky bits called out: NULL-in-unique avoided with `location ""`; rollover idempotency guard; archived class/person filtered in every query and action.
