# Ministry Roles Tag on Person (OSS-47) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline on the main thread, no per-task subagents: small card). Steps use checkbox (`- [ ]`) syntax for tracking.

## Workflow rules (PO's standing rules; apply to every task)

- **Start:** `/board move OSS-47 "In Progress"` (Waiting on = Claude) and seed the ticket `## State` block in `.claude/tickets/OSS-47.md`. Overwrite `## State` after each task (step · next · blocker). Append one Activity-log line per milestone.
- **Commits:** write each message with the `caveman-commit` skill (Conventional Commits, subject ≤50 chars), plus the Co-Authored-By trailer from Global Constraints.
- **Pre-push:** touched-suite tests + `npm run lint` only. No local `npm run build`.
- **One review pass before opening the PR:** built-in `/code-review low`. Fix the confirmed findings. Never run a second review on the same diff.
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


**Goal:** Let staff tag a person with one or more ministry roles (Staff, Volunteer, Sunday School Teacher, Youth Leader, Children's Ministry, Other), show them as badges on the profile, and filter the People list by role. This is the foundation of the child-safety epic: OSS-48 (clearances) and OSS-49 (compliance list + digest) use the tag to decide who needs a WWCC / Safe Ministry clearance.

**Architecture:** One Postgres enum + one enum-array column on `Person` (`ministryRoles`, not encrypted: a role label is not PII). A pure client-safe module `src/lib/ministryRoles.ts` holds labels, display order and the parser, shared by the action, form, page and list filter. `createPerson`/`updatePerson` read the multi-value form field with `formData.getAll` (the existing `Object.fromEntries(formData)` keeps only the last value, so the field cannot ride through `PersonSchema`). Audit goes through the existing `PERSON_UPDATED`.

**Tech Stack:** Next.js 16 App Router + Server Actions, Prisma 7 (`@prisma/adapter-pg`), PostgreSQL enum array, Zod v4, Jest 30 + React Testing Library.

## Global Constraints

- Names (shared with OSS-48/49, use exactly): enum `MinistryRole { STAFF VOLUNTEER SUNDAY_SCHOOL_TEACHER YOUTH_LEADER CHILDREN_MINISTRY OTHER }`; column `Person.ministryRoles MinistryRole[] @default([])`; module `src/lib/ministryRoles.ts` exporting `MINISTRY_ROLE_LABELS: Record<MinistryRole, string>`, `MINISTRY_ROLES: MinistryRole[]` (display order), `parseMinistryRoles(values: string[]): MinistryRole[] | null` (null = any invalid value; dedupes); form field name `ministryRoles` (multiple checkbox inputs, `formData.getAll("ministryRoles")`); migration dir `prisma/migrations/<timestamp>_ministry_roles/`.
- Branch `feat/ministry-roles`; PR title `feat(people): ministry roles tag on person`.
- Public AGPL repo: synthetic data only (`admin@example.com`, "Sample" family).
- Every mutation guarded at page AND server action (`canEdit`: ADMIN, PASTOR, OFFICE_ADMIN). Viewers see badges read-only.
- JSDoc on every new or changed function, exported or not.
- Enums import from `@/lib/generated/prisma/enums`. Zod v4 (`.issues`).
- Tests: `npm test -- --testPathPatterns="<x>"` (never bare `npx jest`). No local `npm run build` (CI builds). Pre-push = touched-suite tests + `npm run lint`.
- Commit messages: Conventional Commits, end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. PR body ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Adds a migration: the St Mark `PROD_VERSION` bump needs human review (note in PR).
- Feature PR updates website docs + stale README claims in the same PR.
- Out of scope (belong to OSS-48/49): clearance upload/verification, `roles-and-permissions.md`, `scheduled-jobs.md`, `data-encryption.md` doc edits, digest.

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `prisma/schema.prisma` | modify | enum `MinistryRole` + `Person.ministryRoles` |
| `prisma/migrations/20261006000000_ministry_roles/migration.sql` | create | CREATE TYPE + ADD COLUMN |
| `src/lib/ministryRoles.ts` | create | labels, order, `parseMinistryRoles`, `parseMinistryRoleFilter` |
| `src/lib/__tests__/ministryRoles.test.ts` | create | unit tests for the pure module |
| `src/lib/actions/person.ts` | modify | parse + persist + audit roles in create/update |
| `src/lib/actions/__tests__/person.test.ts` | modify | action tests for roles |
| `src/components/people/MinistryRoleBadges.tsx` | create | read-only badge list |
| `__tests__/components/MinistryRoleBadges.test.tsx` | create | badge render test |
| `src/components/people/PersonForm.tsx` | modify | checkbox group in Church section |
| `__tests__/components/PersonForm.ministryRoles.test.tsx` | create | form checkbox test |
| `src/app/(dashboard)/people/[id]/page.tsx` | modify | badges in Church card |
| `src/app/(dashboard)/people/[id]/edit/page.tsx` | no change | spreads full `person`, so `ministryRoles` already reaches the form |
| `src/components/people/PeopleFilters.tsx` | modify | "Ministry role" select |
| `src/app/(dashboard)/people/page.tsx` | modify | `ministryRole` search param -> `where` + export URL |
| `src/app/api/people/export/route.ts` | modify | same filter + "Ministry Roles" column |
| `__tests__/api/people-export-csv.test.ts` | modify | filter + column tests |
| `prisma/seed.ts` | modify | give demo people roles (create-only, never overwrites) |
| `.claude/rules/data-model.md` | modify | one bullet |
| `website/src/content/docs/docs/people-and-families.md` | modify | feature docs |

README: checked, it has no people-feature list (only stack, setup, roles table, encryption), so no README claim goes stale. Task 8 re-verifies with grep.

---

### Task 0: Branch from up-to-date main

**Files:** none.

- [ ] **Step 1: Create the branch**

```bash
cd /home/ggeorge/workspace/Projects/parishcrm
git fetch origin
git switch main
git pull --ff-only origin main
git switch -c feat/ministry-roles
git status --short
```
Expected: `Switched to a new branch 'feat/ministry-roles'`, status clean.

- [ ] **Step 2: Install and generate client (if node_modules stale)**

```bash
npm ci --no-audit --no-fund
```
Expected: exits 0 (`postinstall` runs `prisma generate`).

---

### Task 1: Pure module `ministryRoles.ts` (TDD)

**Files:**
- Create: `src/lib/ministryRoles.ts`
- Test: `src/lib/__tests__/ministryRoles.test.ts`

**Interfaces:**
- Consumes: `MinistryRole` enum from `@/lib/generated/prisma/enums`. This enum does not exist until Task 2 regenerates the client, so this task starts by doing the schema edit (Step 1) to keep the TDD loop honest.
- Produces: `MINISTRY_ROLE_LABELS`, `MINISTRY_ROLES`, `parseMinistryRoles(values: string[]): MinistryRole[] | null`, `parseMinistryRoleFilter(value: string | null | undefined): MinistryRole | null`.

- [ ] **Step 1: Add enum + column to the schema and generate the client**

In `prisma/schema.prisma`, insert directly after the `model Person {` field `bankingName String?` line (line 78) a new field, and add the enum next to the other Person enums (put it immediately above `model Person {`, line 38):

```prisma
// Ministry roles a person serves in. Drives who needs a child-safety clearance
// (OSS-48/49). Not PII, so stored plaintext. Postgres enum array.
enum MinistryRole {
  STAFF
  VOLUNTEER
  SUNDAY_SCHOOL_TEACHER
  YOUTH_LEADER
  CHILDREN_MINISTRY
  OTHER
}
```
and in `model Person`, after `bankingName           String?`:
```prisma
  ministryRoles         MinistryRole[]     @default([])
```
Also add one index line after `@@index([mobile])` in `model Person` is NOT needed (list is capped at 500 rows, `has` filter on a small table; YAGNI).

Then:
```bash
npx prisma format
npx prisma generate
```
Expected: `Generated Prisma Client` and `src/lib/generated/prisma/enums.ts` now contains `MinistryRole`. Check: `grep -n "MinistryRole" src/lib/generated/prisma/enums.ts` prints a match.

- [ ] **Step 2: Write the failing test**

Create `src/lib/__tests__/ministryRoles.test.ts`:

```ts
import {
  MINISTRY_ROLES,
  MINISTRY_ROLE_LABELS,
  parseMinistryRoles,
  parseMinistryRoleFilter,
} from "@/lib/ministryRoles"
import { MinistryRole } from "@/lib/generated/prisma/enums"

describe("MINISTRY_ROLES / MINISTRY_ROLE_LABELS", () => {
  it("lists every enum value exactly once, in display order", () => {
    expect([...MINISTRY_ROLES].sort()).toEqual(Object.values(MinistryRole).sort())
    expect(MINISTRY_ROLES[0]).toBe("STAFF")
  })

  it("has a non-empty label for every role", () => {
    for (const r of MINISTRY_ROLES) expect(MINISTRY_ROLE_LABELS[r].length).toBeGreaterThan(0)
    expect(MINISTRY_ROLE_LABELS.SUNDAY_SCHOOL_TEACHER).toBe("Sunday school teacher")
  })
})

describe("parseMinistryRoles", () => {
  it("returns [] for no values", () => {
    expect(parseMinistryRoles([])).toEqual([])
  })

  it("accepts valid values", () => {
    expect(parseMinistryRoles(["STAFF", "VOLUNTEER"])).toEqual(["STAFF", "VOLUNTEER"])
  })

  it("dedupes while keeping first-seen order", () => {
    expect(parseMinistryRoles(["VOLUNTEER", "STAFF", "VOLUNTEER"])).toEqual(["VOLUNTEER", "STAFF"])
  })

  it("returns null when any value is invalid", () => {
    expect(parseMinistryRoles(["STAFF", "PRESIDENT"])).toBeNull()
    expect(parseMinistryRoles([""])).toBeNull()
    expect(parseMinistryRoles(["staff"])).toBeNull()
  })
})

describe("parseMinistryRoleFilter", () => {
  it("returns the role for a valid value", () => {
    expect(parseMinistryRoleFilter("YOUTH_LEADER")).toBe("YOUTH_LEADER")
  })

  it("returns null for missing or invalid values", () => {
    expect(parseMinistryRoleFilter(undefined)).toBeNull()
    expect(parseMinistryRoleFilter(null)).toBeNull()
    expect(parseMinistryRoleFilter("")).toBeNull()
    expect(parseMinistryRoleFilter("nope")).toBeNull()
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- --testPathPatterns="ministryRoles"`
Expected: FAIL, `Cannot find module '@/lib/ministryRoles'`.

- [ ] **Step 4: Implement**

Create `src/lib/ministryRoles.ts`:

```ts
import { MinistryRole } from "@/lib/generated/prisma/enums"

/**
 * Human labels for each ministry role. Pure and client-safe so the form,
 * profile badges and list filter all share one source.
 */
export const MINISTRY_ROLE_LABELS: Record<MinistryRole, string> = {
  STAFF: "Staff",
  VOLUNTEER: "Volunteer",
  SUNDAY_SCHOOL_TEACHER: "Sunday school teacher",
  YOUTH_LEADER: "Youth leader",
  CHILDREN_MINISTRY: "Children's ministry",
  OTHER: "Other",
}

/** Every ministry role in display order (form checkboxes, badges, filter). */
export const MINISTRY_ROLES: MinistryRole[] = [
  "STAFF",
  "VOLUNTEER",
  "SUNDAY_SCHOOL_TEACHER",
  "YOUTH_LEADER",
  "CHILDREN_MINISTRY",
  "OTHER",
]

const VALID = new Set<string>(Object.values(MinistryRole))

/**
 * Validate raw form values into a deduped `MinistryRole[]`, preserving
 * first-seen order. Returns `null` if ANY value is not a known role, so the
 * caller can reject the whole submission rather than silently drop input.
 */
export function parseMinistryRoles(values: string[]): MinistryRole[] | null {
  const out: MinistryRole[] = []
  for (const v of values) {
    if (!VALID.has(v)) return null
    if (!out.includes(v as MinistryRole)) out.push(v as MinistryRole)
  }
  return out
}

/**
 * Parse a single `?ministryRole=` URL filter value. Unknown or empty values
 * mean "no filter" (null), matching how the other People filters degrade.
 */
export function parseMinistryRoleFilter(value: string | null | undefined): MinistryRole | null {
  return value && VALID.has(value) ? (value as MinistryRole) : null
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- --testPathPatterns="ministryRoles"`
Expected: PASS, 3 describe blocks, all green.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma src/lib/ministryRoles.ts src/lib/__tests__/ministryRoles.test.ts
git commit -m "$(cat <<'EOF'
feat(people): add MinistryRole enum and pure parser module

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```
(`src/lib/generated/` is checked in as generated output: run `git status --short src/lib/generated` and `git add src/lib/generated` too if it shows changes.)

---

### Task 2: Migration SQL

**Files:**
- Create: `prisma/migrations/20261006000000_ministry_roles/migration.sql`

Prod and self-hosters run `prisma migrate deploy` from `prisma/migrations/`; CI job `migrations` applies them to an empty Postgres and fails on any drift from `schema.prisma`. Hand-write the SQL exactly as Prisma emits it (same style as `20261001000000_totp_2fa`).

- [ ] **Step 1: Write the migration**

```sql
-- CreateEnum
CREATE TYPE "MinistryRole" AS ENUM ('STAFF', 'VOLUNTEER', 'SUNDAY_SCHOOL_TEACHER', 'YOUTH_LEADER', 'CHILDREN_MINISTRY', 'OTHER');

-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "ministryRoles" "MinistryRole"[] DEFAULT ARRAY[]::"MinistryRole"[];
```

- [ ] **Step 2: Verify against a throwaway DB (no drift)**

```bash
npx prisma dev --detach
```
Use the `DATABASE_URL` it prints (export it in this shell), then:
```bash
npx prisma migrate deploy
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script --exit-code
echo "exit=$?"
```
Expected: `migrate deploy` applies `20261006000000_ministry_roles`; the diff prints `-- This is an empty migration.` and `exit=0`. If non-zero, the diff output is the SQL to correct in `migration.sql` (this is exactly what CI checks). If `prisma dev` is unavailable, skip and rely on the CI `migrations` job, noting that in the PR.

- [ ] **Step 3: Commit**

```bash
git add prisma/migrations/20261006000000_ministry_roles
git commit -m "$(cat <<'EOF'
feat(people): migration for Person.ministryRoles

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Server actions parse, persist and audit roles (TDD)

**Files:**
- Modify: `src/lib/actions/person.ts` (imports lines 1-12; `createPerson` lines ~108-142; `updatePerson` lines ~144-212)
- Test: `src/lib/actions/__tests__/person.test.ts` (append new `describe` blocks at end of file)

**Interfaces:**
- Consumes: `parseMinistryRoles` from `@/lib/ministryRoles`.
- Produces: `createPerson`/`updatePerson` accept repeated `ministryRoles` form entries; invalid value returns `{ error: "Invalid ministry role" }` before any write; the person row gets `ministryRoles: MinistryRole[]`; `PERSON_UPDATED` audit metadata gains `ministryRoles`.

Design notes: absent field means "no roles ticked" so update sets `[]` (an unticked checkbox group submits nothing; this is how the edit form clears roles). The roles are plaintext, and `Object.fromEntries` only keeps the last of repeated keys, so roles are read with `formData.getAll` and added to the Prisma data after the Zod parse. Unknown extra keys in `Object.fromEntries` output (`ministryRoles`) are ignored by `PersonSchema` (Zod object strips unknown keys by default), so no schema change is needed.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/actions/__tests__/person.test.ts`. First extend the helper at the top: replace the `form` function (lines 40-44) with a version that accepts repeated values:

```ts
function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) for (const item of v) fd.append(k, item)
    else fd.set(k, v)
  }
  return fd
}
```
Then add `import { logAudit } from "@/lib/audit"` under the existing imports (line 5), and append at the end of the file:

```ts
describe("createPerson — ministry roles", () => {
  beforeEach(() => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "OFFICE_ADMIN" } })
    ;(prisma.family.findUnique as jest.Mock).mockResolvedValue({ id: 5, archivedAt: null })
    ;(prisma.person.create as jest.Mock).mockResolvedValue({ id: 9 })
  })

  it("persists every ticked role, deduped", async () => {
    await expect(
      createPerson(5, undefined, form({ ...VALID, ministryRoles: ["VOLUNTEER", "SUNDAY_SCHOOL_TEACHER", "VOLUNTEER"] }))
    ).rejects.toThrow("NEXT_REDIRECT")
    const data = (prisma.person.create as jest.Mock).mock.calls[0][0].data
    expect(data.ministryRoles).toEqual(["VOLUNTEER", "SUNDAY_SCHOOL_TEACHER"])
  })

  it("stores an empty array when none are ticked", async () => {
    await expect(createPerson(5, undefined, form(VALID))).rejects.toThrow("NEXT_REDIRECT")
    const data = (prisma.person.create as jest.Mock).mock.calls[0][0].data
    expect(data.ministryRoles).toEqual([])
  })

  it("rejects an unknown role before any write", async () => {
    const r = await createPerson(5, undefined, form({ ...VALID, ministryRoles: ["STAFF", "PRESIDENT"] }))
    expect(r).toEqual({ error: "Invalid ministry role" })
    expect(prisma.person.create).not.toHaveBeenCalled()
  })
})

describe("updatePerson — ministry roles", () => {
  beforeEach(() => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "OFFICE_ADMIN" } })
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({ familyId: 5, archivedAt: null })
    ;(prisma.person.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
  })

  it("writes the submitted roles", async () => {
    await expect(
      updatePerson(3, 5, undefined, form({ ...VALID, ministryRoles: ["STAFF", "YOUTH_LEADER"] }))
    ).rejects.toThrow("NEXT_REDIRECT")
    const data = (prisma.person.updateMany as jest.Mock).mock.calls[0][0].data
    expect(data.ministryRoles).toEqual(["STAFF", "YOUTH_LEADER"])
  })

  it("clears roles when the group is submitted empty", async () => {
    await expect(updatePerson(3, 5, undefined, form(VALID))).rejects.toThrow("NEXT_REDIRECT")
    const data = (prisma.person.updateMany as jest.Mock).mock.calls[0][0].data
    expect(data.ministryRoles).toEqual([])
  })

  it("rejects an unknown role without updating", async () => {
    const r = await updatePerson(3, 5, undefined, form({ ...VALID, ministryRoles: ["NOPE"] }))
    expect(r).toEqual({ error: "Invalid ministry role" })
    expect(prisma.person.updateMany).not.toHaveBeenCalled()
  })

  it("audits the roles through PERSON_UPDATED", async () => {
    await expect(
      updatePerson(3, 5, undefined, form({ ...VALID, ministryRoles: ["VOLUNTEER"] }))
    ).rejects.toThrow("NEXT_REDIRECT")
    expect(logAudit).toHaveBeenCalledWith(1, "PERSON_UPDATED", "Person", 3, {
      familyId: 5,
      ministryRoles: ["VOLUNTEER"],
    })
  })

  it("still rejects a VIEWER before parsing roles", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "VIEWER" } })
    const r = await updatePerson(3, 5, undefined, form({ ...VALID, ministryRoles: ["STAFF"] }))
    expect(r).toEqual({ error: "Unauthorized" })
    expect(prisma.person.updateMany).not.toHaveBeenCalled()
  })
})
```
Note: `actorId(session)` returns the numeric id from `session.user.id` "1", so the audit actor is `1`. If this assertion fails on the actor, run `grep -n "export function actorId" -A8 src/lib/actor.ts` and adjust the first argument to what it returns for `{ id: "1" }`.

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- --testPathPatterns="actions/__tests__/person"`
Expected: the 8 new tests FAIL (`data.ministryRoles` undefined; no "Invalid ministry role" error); the 14 pre-existing tests still pass.

- [ ] **Step 3: Implement**

In `src/lib/actions/person.ts`:

1. Add import after line 12 (`import { parseOptimisticUpdatedAt, isP2034 } ...`):
```ts
import { parseMinistryRoles } from "@/lib/ministryRoles"
```

2. Add a helper directly below `encryptPersonFields` (after its closing `}` at line ~101, before `export async function createPerson`):
```ts
/**
 * Read the repeated `ministryRoles` form field and validate it. Absent field
 * means "no boxes ticked" and yields []. Returns null if any value is not a
 * known `MinistryRole`. Needs `getAll` because `Object.fromEntries(formData)`
 * keeps only the last value of a repeated key.
 */
function readMinistryRoles(formData: FormData) {
  return parseMinistryRoles(formData.getAll("ministryRoles").map(String))
}
```

3. In `createPerson`, immediately after the `PersonSchema.safeParse` error check (the line `if (!parsed.success) return { error: parsed.error.issues[0].message }`, line ~124), add:
```ts
  const ministryRoles = readMinistryRoles(formData)
  if (ministryRoles === null) return { error: "Invalid ministry role" }
```
and change the create call to include them:
```ts
    person = await prisma.person.create({ data: { ...createData, ministryRoles, familyId, consentUpdatedAt: new Date() } })
```

4. In `updatePerson`, after its `PersonSchema.safeParse` error check (line ~158) add the same two lines:
```ts
  const ministryRoles = readMinistryRoles(formData)
  if (ministryRoles === null) return { error: "Invalid ministry role" }
```
change the `updateMany` data to:
```ts
      data: { ...updateData, ministryRoles, consentUpdatedAt: new Date() },
```
and the audit call (line ~200) to:
```ts
  await logAudit(actorId(session), "PERSON_UPDATED", "Person", id, { familyId, ministryRoles })
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test -- --testPathPatterns="actions/__tests__/person"`
Expected: PASS, all 22 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/actions/person.ts src/lib/actions/__tests__/person.test.ts
git commit -m "$(cat <<'EOF'
feat(people): validate and persist ministry roles in person actions

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Badge component + profile Church card (TDD)

**Files:**
- Create: `src/components/people/MinistryRoleBadges.tsx`
- Test: `__tests__/components/MinistryRoleBadges.test.tsx`
- Modify: `src/app/(dashboard)/people/[id]/page.tsx` (imports ~line 14; `PersonInfoCards` props line 81; Church card lines 115-126)

**Interfaces:**
- Consumes: `MINISTRY_ROLE_LABELS` from `@/lib/ministryRoles`.
- Produces: `MinistryRoleBadges({ roles }: { roles: MinistryRole[] })` renders nothing for `[]`, else a wrapping list of outline `Badge`s.

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/MinistryRoleBadges.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { MinistryRoleBadges } from "@/components/people/MinistryRoleBadges"

describe("MinistryRoleBadges", () => {
  it("renders a labelled badge per role", () => {
    render(<MinistryRoleBadges roles={["STAFF", "SUNDAY_SCHOOL_TEACHER"]} />)
    expect(screen.getByText("Staff")).toBeInTheDocument()
    expect(screen.getByText("Sunday school teacher")).toBeInTheDocument()
  })

  it("renders nothing when there are no roles", () => {
    const { container } = render(<MinistryRoleBadges roles={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --testPathPatterns="MinistryRoleBadges"`
Expected: FAIL, `Cannot find module '@/components/people/MinistryRoleBadges'`.

- [ ] **Step 3: Implement the component**

Create `src/components/people/MinistryRoleBadges.tsx`:

```tsx
import { Badge } from "@/components/ui/badge"
import type { MinistryRole } from "@/lib/generated/prisma/enums"
import { MINISTRY_ROLE_LABELS } from "@/lib/ministryRoles"

/**
 * Read-only badges for a person's ministry roles. Renders nothing when the
 * person has none, so callers can drop it in without a length check.
 */
export function MinistryRoleBadges({ roles }: Readonly<{ roles: MinistryRole[] }>) {
  if (roles.length === 0) return null
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Ministry roles">
      {roles.map((r) => (
        <li key={r}>
          <Badge variant="outline">{MINISTRY_ROLE_LABELS[r]}</Badge>
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- --testPathPatterns="MinistryRoleBadges"`
Expected: PASS, 2 tests.

- [ ] **Step 5: Wire into the profile Church card**

In `src/app/(dashboard)/people/[id]/page.tsx`:

- Add imports below line 15 (`import { DeletePersonButton } ...`):
```tsx
import { MinistryRoleBadges } from "@/components/people/MinistryRoleBadges"
import type { MinistryRole } from "@/lib/generated/prisma/enums"
```
- Change the `person` prop type of `PersonInfoCards` (line 81) to:
```tsx
  person: { gender: string | null; membershipDate: Date | null; baptismDate: Date | null; ministryRoles: MinistryRole[] }
```
- In the Church card (inside `<CardContent>` after the `baptismDate` field, before the notes block, lines ~118-120), insert:
```tsx
          {person.ministryRoles.length > 0 && (
            <div className="col-span-2">
              <span className="text-muted-foreground text-sm">Ministry roles</span>
              <div className="mt-1">
                <MinistryRoleBadges roles={person.ministryRoles} />
              </div>
            </div>
          )}
```
The page already passes the full Prisma `person` (from `findUnique`, no `select`) at line ~312, so `ministryRoles` is present. All roles that can view people (everyone but AUDITOR/EVENT_ORGANISER, already redirected at line 225) see the badges; no extra gate is needed because the field is not sensitive.

- [ ] **Step 6: Type check the touched files**

Run: `npx tsc --noEmit`
Expected: exit 0, no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/people/MinistryRoleBadges.tsx __tests__/components/MinistryRoleBadges.test.tsx "src/app/(dashboard)/people/[id]/page.tsx"
git commit -m "$(cat <<'EOF'
feat(people): show ministry role badges on the profile Church card

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: PersonForm checkbox group (TDD)

**Files:**
- Modify: `src/components/people/PersonForm.tsx` (imports lines 1-17; `Person` type lines 19-43; Church section after line 189)
- Test: `__tests__/components/PersonForm.ministryRoles.test.tsx`

**Interfaces:**
- Consumes: `MINISTRY_ROLES`, `MINISTRY_ROLE_LABELS` from `@/lib/ministryRoles`.
- Produces: form posts one `ministryRoles` entry per ticked box. Uses native `<input type="checkbox" name="ministryRoles" value={role}>` (not the Radix `Checkbox`): native inputs submit natively in a `<form action>` and render in jsdom without `ResizeObserver`. `edit/page.tsx` needs no change because it spreads the full person into the `person` prop.

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/PersonForm.ministryRoles.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { PersonForm } from "@/components/people/PersonForm"

jest.mock("next/navigation", () => ({
  useRouter: () => ({ back: jest.fn() }),
}))

const noop = async () => undefined

describe("PersonForm ministry roles", () => {
  it("renders one named checkbox per ministry role, all unticked for a new person", () => {
    render(<PersonForm action={noop} canSeePastoralNotes={false} />)
    const boxes = screen.getAllByRole("checkbox", { name: /staff|volunteer|sunday school teacher|youth leader|children's ministry|other/i })
    expect(boxes).toHaveLength(6)
    for (const b of boxes) {
      expect(b).not.toBeChecked()
      expect(b).toHaveAttribute("name", "ministryRoles")
    }
  })

  it("pre-ticks the person's existing roles", () => {
    render(
      <PersonForm
        action={noop}
        canSeePastoralNotes={false}
        person={{ firstName: "Jane", lastName: "Sample", ministryRoles: ["SUNDAY_SCHOOL_TEACHER"] }}
      />
    )
    expect(screen.getByRole("checkbox", { name: "Sunday school teacher" })).toBeChecked()
    expect(screen.getByRole("checkbox", { name: "Staff" })).not.toBeChecked()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --testPathPatterns="PersonForm.ministryRoles"`
Expected: FAIL, no checkboxes matching (found 0, expected 6) and a TS/prop error on `ministryRoles`.

- [ ] **Step 3: Implement**

In `src/components/people/PersonForm.tsx`:

- Add imports after line 17 (`import type { ActionResult } ...`):
```tsx
import type { MinistryRole } from "@/lib/generated/prisma/enums"
import { MINISTRY_ROLES, MINISTRY_ROLE_LABELS } from "@/lib/ministryRoles"
```
- Add to the `Person` type (after `bankingName?: string | null`, line 40):
```tsx
  ministryRoles?: MinistryRole[]
```
- In Section 3 (Church), after the `bankingName` `<div className="space-y-2">...</div>` block (ends line 189) and before `</section>` (line 190), insert:
```tsx
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium leading-none">Ministry roles</legend>
          <p className="text-sm text-muted-foreground">
            Roles this person serves in. Used to decide who needs a child-safety clearance.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {MINISTRY_ROLES.map((role) => (
              <label key={role} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="ministryRoles"
                  value={role}
                  defaultChecked={person?.ministryRoles?.includes(role) ?? false}
                  className="size-4 accent-primary"
                />
                {MINISTRY_ROLE_LABELS[role]}
              </label>
            ))}
          </div>
        </fieldset>
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- --testPathPatterns="PersonForm.ministryRoles"`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/people/PersonForm.tsx __tests__/components/PersonForm.ministryRoles.test.tsx
git commit -m "$(cat <<'EOF'
feat(people): ministry role checkboxes on the person form

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: People list filter by ministry role

**Files:**
- Modify: `src/components/people/PeopleFilters.tsx` (imports lines 14-15; after the family-role `<Select>` ends line 82)
- Modify: `src/app/(dashboard)/people/page.tsx` (imports; `searchParams` type line 16-17; filter parse lines 25-33; `peopleWhere` lines 37-46; export params lines 76-79)
- Modify: `src/app/api/people/export/route.ts` (imports line 9; filter parse lines 35-40; `where` lines 49-62; `select` lines 63-77; `headers` line 80; `rows` lines 85-96)
- Modify (test): `__tests__/api/people-export-csv.test.ts`
- Test: `__tests__/components/PeopleFilters.ministryRole.test.tsx`

**Interfaces:**
- Consumes: `parseMinistryRoleFilter`, `MINISTRY_ROLES`, `MINISTRY_ROLE_LABELS`.
- Produces: URL param `?ministryRole=<ENUM>`; Prisma filter `{ ministryRoles: { has: role } }`. Server-side parse means an invalid value silently means "no filter" (already unit-tested in Task 1). The page/route wiring is thin and covered by the Task 1 parser tests plus the manual check in Task 9; the filter UI gets a render test.

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/PeopleFilters.ministryRole.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { PeopleFilters } from "@/components/people/PeopleFilters"

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams("ministryRole=VOLUNTEER"),
}))

describe("PeopleFilters ministry role select", () => {
  it("renders the ministry role filter showing the current selection", () => {
    render(<PeopleFilters />)
    const trigger = screen.getByRole("combobox", { name: "Filter by ministry role" })
    expect(trigger).toHaveTextContent("Volunteer")
  })

  it("shows the Clear button when a ministry role filter is active", () => {
    render(<PeopleFilters />)
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument()
  })
})
```

- [ ] **Step 1b: Write the failing export tests**

In `__tests__/api/people-export-csv.test.ts` add `ministryRoles: [],` to `basePerson` (after `baptismDate: null,`, line 39), then append inside the `describe("GET /api/people/export (bulk CSV)", ...)` block (before its closing `})`):

```ts
  it("adds a Ministry Roles column with labels joined by '; '", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFindMany.mockResolvedValue([{ ...basePerson, ministryRoles: ["VOLUNTEER", "SUNDAY_SCHOOL_TEACHER"] }])
    const res = await GET(makeRequest())
    const [header, row] = (await res.text()).split("\n")
    expect(header.split(",").pop()).toBe("Ministry Roles")
    expect(row.endsWith("Volunteer; Sunday school teacher")).toBe(true)
  })

  it("leaves the Ministry Roles cell empty when the person has none", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    const res = await GET(makeRequest())
    const [, row] = (await res.text()).split("\n")
    expect(row.endsWith(",")).toBe(true)
  })

  it("filters by ?ministryRole= and ignores an invalid value", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    await GET(makeRequest("?ministryRole=STAFF"))
    expect(mockFindMany.mock.calls[0][0].where.ministryRoles).toEqual({ has: "STAFF" })
    mockFindMany.mockClear()
    await GET(makeRequest("?ministryRole=BOGUS"))
    expect(mockFindMany.mock.calls[0][0].where).not.toHaveProperty("ministryRoles")
  })
```
(The cell goes through the existing `escapeCsv` formula-injection guard like every other column; labels are fixed constants, so this is defence in depth.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --testPathPatterns="PeopleFilters.ministryRole|people-export-csv"`
Expected: FAIL, unable to find role combobox named "Filter by ministry role"; the 3 new export tests also FAIL (no column, no filter).

- [ ] **Step 3: Implement the filter UI**

In `src/components/people/PeopleFilters.tsx` add after line 15:
```tsx
import { MINISTRY_ROLES, MINISTRY_ROLE_LABELS } from "@/lib/ministryRoles"
```
and insert after the family-role `</Select>` (line 82, before `{hasFilters && (`):
```tsx
      <Select
        value={searchParams.get("ministryRole") ?? "ALL"}
        onValueChange={(v: string) => update("ministryRole", v === "ALL" ? "" : v)}
      >
        <SelectTrigger className="w-48" aria-label="Filter by ministry role">
          <SelectValue placeholder="Ministry role" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All ministry roles</SelectItem>
          {MINISTRY_ROLES.map((r) => (
            <SelectItem key={r} value={r}>{MINISTRY_ROLE_LABELS[r]}</SelectItem>
          ))}
        </SelectContent>
      </Select>
```

- [ ] **Step 4: Wire the list page**

In `src/app/(dashboard)/people/page.tsx`:
- Add import after line 11: `import { parseMinistryRoleFilter } from "@/lib/ministryRoles"`
- Change the props type (lines 16-17) to `Promise<{ q?: string; classification?: string; role?: string; ministryRole?: string }>`.
- After the `roleFilter` block (ends line 33) add:
```tsx
  const ministryRoleFilter = parseMinistryRoleFilter(searchParams.ministryRole)
```
- Add to `peopleWhere` after `...(roleFilter && { role: roleFilter }),` (line 45):
```tsx
    ...(ministryRoleFilter && { ministryRoles: { has: ministryRoleFilter } }),
```
- Add after `if (roleFilter) exportParams.set("role", roleFilter)` (line 79):
```tsx
  if (ministryRoleFilter) exportParams.set("ministryRole", ministryRoleFilter)
```

- [ ] **Step 5: Wire the CSV export so it matches the screen**

In `src/app/api/people/export/route.ts`:
- Add import after line 11: `import { parseMinistryRoleFilter } from "@/lib/ministryRoles"`
- After the `roleFilter` block (ends line 40) add:
```ts
  const ministryRoleFilter = parseMinistryRoleFilter(searchParams.get("ministryRole"))
```
- In the `where` object after `...(roleFilter && { role: roleFilter }),` (line 56) add:
```ts
      ...(ministryRoleFilter && { ministryRoles: { has: ministryRoleFilter } }),
```
- Add `ministryRoles: true,` to the `select` (after `baptismDate: true,`).
- Add import: `import { MINISTRY_ROLE_LABELS } from "@/lib/ministryRoles"`.
- Append `"Ministry Roles"` to the `headers` array (after `"Baptism Date"`).
- Append to each `rows` entry after `fmtDate(p.baptismDate),`:
```ts
    p.ministryRoles.map((r) => MINISTRY_ROLE_LABELS[r]).join("; "),
```
The existing `.map(escapeCsv)` pipeline applies the formula-injection guard to the new cell.

- [ ] **Step 6: Run tests and type check**

Run: `npm test -- --testPathPatterns="PeopleFilters|people-export|ministryRoles"` then `npx tsc --noEmit`
Expected: PASS (new filter + export tests; existing export tests unchanged), tsc exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/components/people/PeopleFilters.tsx "src/app/(dashboard)/people/page.tsx" src/app/api/people/export/route.ts __tests__/api/people-export-csv.test.ts __tests__/components/PeopleFilters.ministryRole.test.tsx
git commit -m "$(cat <<'EOF'
feat(people): ministry role filter and CSV export column

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Demo seed roles

**Files:**
- Modify: `prisma/seed.ts` (the two `prisma.person.upsert` `create` blocks, lines 52-83)

Both upserts have `update: {}`, so existing databases are untouched and re-seeding never overwrites edits. Roles only land on fresh seeds (and the live demo reseed).

- [ ] **Step 1: Add roles to the create blocks**

In John's `create` (after `membershipDate: new Date("2018-01-01"),`, line 66) add:
```ts
      ministryRoles: ["STAFF"],
```
In Jane's `create` (after `membershipDate`, line 82) add:
```ts
      ministryRoles: ["VOLUNTEER", "SUNDAY_SCHOOL_TEACHER"],
```

- [ ] **Step 2: Verify it type-checks and seeds**

Run: `npx tsc --noEmit`
Expected: exit 0.
Then, against the throwaway DB from Task 2: `ALLOW_DEMO_SEED=true npm run db:seed`
Expected: seed completes without error (skip if no local DB; CI does not seed).

- [ ] **Step 3: Commit**

```bash
git add prisma/seed.ts
git commit -m "$(cat <<'EOF'
chore(seed): give demo people ministry roles

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Docs (website, data-model rule, README check)

**Files:**
- Modify: `website/src/content/docs/docs/people-and-families.md` (lines ~26, ~29-33, ~51 area, ~58, ~74)
- Modify: `.claude/rules/data-model.md` (after the "Banking name" bullet, line 18). Note `.claude/` is gitignored local config: edit it but do not `git add` it.
- Check: `README.md`

- [ ] **Step 1: Website docs**

In `website/src/content/docs/docs/people-and-families.md` make these edits:

a) "Adding/editing a person" paragraph (the one beginning "From a family's page, **Add person**"): after `banking name (for bank-import auto-matching), and email consent.` insert ` It also has a **Ministry roles** checkbox group (Staff, Volunteer, Sunday school teacher, Youth leader, Children's ministry, Other) for the roles the person serves in.`

b) "People list" bullets: replace `- Search by first/last name; filter by classification and family role.` with `- Search by first/last name; filter by classification, family role and ministry role.` and add a new bullet after it: `- The **Export CSV** link carries the same filters, including ministry role, and the CSV has a **Ministry Roles** column (labels joined with "; ").` (replace nothing else; the existing "Export CSV (ADMIN only)" bullet stays).

c) Add a new subsection after the "People list (`/people`)" section's roles table is NOT needed. Instead insert this new subsection immediately before `### Roles who can see or do what`:
```markdown
### Ministry roles
Each person can be tagged with any number of ministry roles: **Staff**, **Volunteer**, **Sunday school teacher**, **Youth leader**, **Children's ministry** or **Other**. Tick them on the person form (ADMIN, PASTOR, OFFICE_ADMIN). They appear as badges in the **Church** card on the person's profile, visible to every role that can open the profile, and you can filter `/people` by them (`?ministryRole=VOLUNTEER`). The tag marks who works with children or serves the church; it is the basis for tracking child-safety clearances (Working With Children Check, Safe Ministry) in later releases.
```

d) "Data model" `Person` bullet: after `` `classification` (`Classification`: MEMBER/VISITOR/INACTIVE/STUDENT), `` insert `` `ministryRoles` (`MinistryRole[]`: STAFF/VOLUNTEER/SUNDAY_SCHOOL_TEACHER/YOUTH_LEADER/CHILDREN_MINISTRY/OTHER; a Postgres enum array, plaintext, default empty), ``.

e) "Audit logging": after the sentence ending `only the linked \`familyId\`.` add ` \`PERSON_UPDATED\` also records the person's ministry roles (not PII).` (Match the exact existing wording: the sentence reads "Person audit metadata deliberately excludes member PII — only the linked `familyId`.")

f) "Server actions" `createPerson` / `updatePerson` bullet: append ` Ministry roles are read from the repeated \`ministryRoles\` form field and validated against the enum; any unknown value rejects the whole save.`

- [ ] **Step 2: Data-model rule note**

In `.claude/rules/data-model.md` after the "Banking name" bullet (line 18) add:
```markdown
- **Ministry roles**: `Person.ministryRoles MinistryRole[] @default([])` (Postgres enum array, plaintext). Parse via `parseMinistryRoles` in `src/lib/ministryRoles.ts`; form field is the repeated `ministryRoles` (read with `formData.getAll`, not `Object.fromEntries`). Basis for OSS-48/49 clearance requirements.
```

- [ ] **Step 3: README check**

Run: `grep -n -i "classification\|ministry\|people" README.md`
Expected: only the architecture tree, roles table and encryption sentences from before; none claims a people-field list. No README edit needed. If a feature list that enumerates person fields does appear, add "ministry roles" to it in this step.

- [ ] **Step 4: Commit**

```bash
git add website/src/content/docs/docs/people-and-families.md
git commit -m "$(cat <<'EOF'
docs(website): document ministry roles on people

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Full verification, push, PR, Codex review

**Files:** none.

- [ ] **Step 1: Touched suites**

```bash
npm test -- --testPathPatterns="ministryRoles|MinistryRoleBadges|PersonForm|PeopleFilters|actions/__tests__/person|people"
```
Expected: all PASS.

- [ ] **Step 2: Types and lint**

```bash
npx tsc --noEmit
npm run lint
```
Expected: both exit 0 with no errors.

- [ ] **Step 3: Manual smoke (if the throwaway DB is running)**

`npm run db:push` is NOT used (it records no migration history); the DB already has the migration from Task 2. Start `npm run dev` with `DISABLE_OTP=true` in `.env.local`, log in as `admin@example.com`, open a person > Edit, tick "Sunday school teacher" and "Volunteer", Save. Expected: profile Church card shows both badges. Open `/people?ministryRole=VOLUNTEER`: the person is listed, others are not; "Clear" resets. Log in as a viewer: badges visible, no Edit button. Stop dev server and `npx prisma dev stop`.

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin feat/ministry-roles
gh pr create --base main --head feat/ministry-roles \
  --title "feat(people): ministry roles tag on person" \
  --body "$(cat <<'EOF'
## What & why

Adds a ministry-roles tag on Person (Staff, Volunteer, Sunday school teacher, Youth leader, Children's ministry, Other). It decides who needs a child-safety clearance in the follow-up cards (OSS-48 clearances, OSS-49 compliance list and monthly digest). Ticket: OSS-47.

## Changes

- `Person.ministryRoles MinistryRole[]` (Postgres enum array, plaintext) + migration `20261006000000_ministry_roles`
- `src/lib/ministryRoles.ts`: labels, display order, `parseMinistryRoles`, filter parser
- `createPerson`/`updatePerson`: validate repeated `ministryRoles` field (read via `formData.getAll`), reject unknown values, audit via existing `PERSON_UPDATED`
- Person form checkbox group, profile Church card badges, People list + CSV export filter by ministry role, plus a "Ministry Roles" CSV column
- Demo seed gives the sample people roles (create-only)
- Website docs (`people-and-families.md`); README checked, no stale claim

## Checklist

- [x] Tests pass and lint is clean
- [x] Types check (`npx tsc --noEmit`)
- [x] PR title follows Conventional Commits
- [x] Schema change: migration committed + client regenerated
- [x] Role checks enforced at both page (`canEdit` on edit page) and action
- [x] Docs page updated; README still accurate
- [x] No secrets, member PII, or real credentials in the diff

## Notes for reviewer

- **Adds a migration**: the St Mark `PROD_VERSION` bump needs human review (not auto-upgrade safe).
- An unticked checkbox group submits nothing, so saving the edit form with no roles ticked clears roles. That is intended.
- No index on `ministryRoles`: the list is capped at 500 rows and the table is small.
- Out of scope: clearance upload/verification (OSS-48), compliance list and digest (OSS-49).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
Expected: prints the PR URL.

- [ ] **Step 5: Request Codex review**

```bash
gh pr comment --body "@codex review"
```
Expected: comment URL printed.

- [ ] **Step 6: STOP**

Do not merge. Merge needs the Product Owner and the review gate: all bot findings (Codex, CodeRabbit, CI) must be read, verified against HEAD and given a recorded disposition first (Fixed / Stale / Refuted, or deferred to a linked issue), and CodeRabbit must have really reviewed the head SHA. Report the PR URL and wait.
