# WWCC + Safe Ministry Clearances Implementation Plan (OSS-48)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (fresh sonnet subagent per task; main thread reviews between tasks). Steps use checkbox (`- [ ]`) syntax for tracking.

## Workflow rules (PO's standing rules; apply to every task)

- **Start:** `/board move OSS-48 "In Progress"` (Waiting on = Claude) and seed the ticket `## State` block in `.claude/tickets/OSS-48.md`. Overwrite `## State` after each task (step · next · blocker). Append one Activity-log line per milestone.
- **Commits:** write each message with the `caveman-commit` skill (Conventional Commits, subject ≤50 chars), plus the Co-Authored-By trailer from Global Constraints.
- **Pre-push:** touched-suite tests + `npm run lint` only. No local `npm run build`.
- **One review pass before opening the PR:** built-in `/code-review high (encrypted files + auth gating)`. Fix the confirmed findings. Never run a second review on the same diff.
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


**Goal:** Staff (`canEdit` roles) upload a person's WWCC / Safe Ministry document, record number + expiry, and mark it Verified (WWCC: after checking the OCG employer portal). Status shows on the person profile. VIEWERs see the status badge only.

**Architecture:** One new `PersonClearance` table (one current row per person+type, encrypted number/document/filename/note, same BYTEA-of-encrypted-base64 storage as `TransactionAttachment`). Shared upload primitives move to `src/lib/fileUpload.ts`. Pure `src/lib/clearanceStatus.ts` computes the badge. `src/lib/clearanceView.ts` builds a role-filtered view model server-side so a VIEWER's client props never contain the number, doc id or note. Server actions in `src/lib/actions/clearance.ts`; doc download via a 404-opaque route. UI is a `PersonClearances` client component inside a new "Safeguarding" card on the person page.

**Tech Stack:** Next.js 16 App Router + Server Actions, Prisma 7 (`@prisma/adapter-pg`), AES-256-GCM `src/lib/crypto.ts`, Jest 30 + RTL.

Ticket: `.claude/tickets/OSS-48.md`. Depends on OSS-47 (merged before start; provides `MinistryRole`, `Person.ministryRoles`). OSS-49 (compliance list + monthly digest) builds on the names below, so use them exactly.

## Global Constraints

- Public AGPL repo: synthetic data only in tests (`WWC0000000E`, `admin@example.com`). Never real names/numbers.
- Every mutation guarded at the page AND the Server Action; `assertNotDemo()` first in every action; `logAudit(actorId(session), ...)`.
- JSDoc on every new/changed function, exported or not.
- Encrypt via `src/lib/crypto.ts` (`encrypt`, `safeDecrypt`); never log decrypted values or put them in audit metadata.
- Dates: `expiresAt` is `@db.Date`, stored at UTC midnight; "today" is `sydneyToday()` from `src/lib/dates.ts`; never `new Date(y, m, d)`.
- Next.js 16: route-handler `params` is a `Promise` (the existing attachment route already does `props: { params: Promise<...> }` + `await props.params`).
- Run single suites with `npm test -- --testPathPatterns="<pattern>"`. No local `npm run build` (CI builds). Pre-push = touched suites + `npm run lint`.
- `src/lib/generated/prisma/` is git-ignored: regenerate with `npx prisma generate`, never `git add` it.
- Commits: Conventional Commits, each ends with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. PR body ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Branch `feat/child-safety-clearances`; PR title `feat(people): WWCC and Safe Ministry clearances on profile`.

## Names (from the shared epic contract; do not rename)

`ClearanceType { WWCC SAFE_MINISTRY }`; model `PersonClearance`; `Person.clearances`; `User` relation name `ClearanceVerifiedBy`; `src/lib/fileUpload.ts` (`sniffContentType`, `sanitizeFilename`, `MAX_UPLOAD_BYTES`, `ALLOWED_UPLOAD_TYPES`); `src/lib/clearanceStatus.ts` (`ClearanceStatus`, `EXPIRING_WINDOW_DAYS`, `clearanceStatus`, `CLEARANCE_TYPE_LABELS`); `canManageClearances`, `canViewClearanceStatus` in `roleGuard.ts`; actions `upsertClearance`, `verifyClearance`, `unverifyClearance`, `deleteClearance`; AppSetting key `clearance.wwccVerifyUrl` + `getWwccVerifyUrl()` in `src/lib/clearanceSettings.ts`; route `src/app/api/people/[id]/clearances/[clearanceId]/route.ts`; component `src/components/people/PersonClearances.tsx`; audit actions `CLEARANCE_ADDED/_UPDATED/_VERIFIED/_UNVERIFIED/_REMOVED/_VIEWED`.

Deviations forced by the real schema (flagged in the PR body):
- `Person.id` and `User.id` are `Int` (autoincrement), so `personId`, `verifiedById`, `createdById` are `Int`, and action signatures take `personId: number` (contract text said `string`). `PersonClearance.id` is `String @id @default(cuid())` (same style as `TrustedDevice`/`BackupCode`).
- `verificationNote` is encrypted (free text could name a person/reference number).
- `createdById` has no FK (plain `Int?`; the audit log is the history).

## File map

| File | Responsibility |
|---|---|
| `src/lib/fileUpload.ts` (new) | Magic-byte sniff, filename sanitiser, size/type constants (moved from transactionAttachment) |
| `src/lib/actions/transactionAttachment.ts` | Import the shared primitives (behaviour unchanged) |
| `prisma/schema.prisma` | `ClearanceType`, `PersonClearance`, back-relations |
| `prisma/migrations/<ts>_person_clearance/migration.sql` | Prod migration |
| `scripts/rotate-encryption-key.ts` + `__tests__/scripts/rotate-encryption-key.test.ts` | Key rotation covers new encrypted columns |
| `src/lib/roleGuard.ts` | `canManageClearances`, `canViewClearanceStatus` |
| `src/lib/clearanceStatus.ts` (new) | Pure status calc + labels |
| `src/lib/clearanceSettings.ts` (new) | `getWwccVerifyUrl()` |
| `src/lib/actions/clearance.ts` (new) | upsert / verify / unverify / delete |
| `src/app/api/people/[id]/clearances/[clearanceId]/route.ts` (new) | Doc download |
| `src/lib/clearanceView.ts` (new) | Role-filtered view model for the card |
| `src/components/people/PersonClearances.tsx` (new) | Card UI + verify dialog |
| `src/app/(dashboard)/people/[id]/page.tsx` | Query + render Safeguarding card |
| `website/src/content/docs/docs/{people-and-families,roles-and-permissions,data-encryption,privacy-and-audit-log}.md`, `README.md`, `.claude/rules/{encryption,data-model}.md` | Docs |

Tests: `__tests__/lib/{fileUpload,clearanceStatus,clearanceSettings,clearanceView,role-guard}.test.ts`, `__tests__/actions/clearance.test.ts`, `__tests__/api/clearance-route.test.ts`, `__tests__/components/PersonClearances.test.tsx`.

---

### Task 0: Branch and prerequisites

- [ ] **Step 1: Update main and branch**

```bash
cd /home/ggeorge/workspace/Projects/parishcrm
git checkout main && git pull --ff-only origin main
git checkout -b feat/child-safety-clearances
```

- [ ] **Step 2: Verify OSS-47 is merged. If not, STOP and report.**

```bash
grep -n "enum MinistryRole\|ministryRoles" prisma/schema.prisma
ls src/lib/ministryRoles.ts
```
Expected: both `enum MinistryRole` and `ministryRoles MinistryRole[]` found, file exists. If either is missing, stop: OSS-48 depends on OSS-47.

- [ ] **Step 3: Install + generate + baseline test run**

```bash
npm ci --no-audit --no-fund && npx prisma generate
npm test -- --testPathPatterns="transaction-attachment|role-guard|rotate-encryption"
```
Expected: all PASS (baseline).

- [ ] **Step 4: Note the newest migration dir** (new migration must sort after it):

```bash
ls prisma/migrations | tail -3
```

---

### Task 1: Shared `fileUpload.ts` (refactor, tests stay green)

**Files:**
- Create: `src/lib/fileUpload.ts`, `__tests__/lib/fileUpload.test.ts`
- Modify: `src/lib/actions/transactionAttachment.ts` (lines 21-48 are the constants/helpers being moved; `ALLOWED_MIME` used ~line 63, `MAX_ATTACHMENT_BYTES` ~line 67)

- [ ] **Step 1: Write the failing test** `__tests__/lib/fileUpload.test.ts`

```ts
import {
  ALLOWED_UPLOAD_TYPES,
  MAX_UPLOAD_BYTES,
  sanitizeFilename,
  sniffContentType,
} from "@/lib/fileUpload"

describe("sniffContentType", () => {
  it("detects PDF", () => {
    expect(sniffContentType(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe("application/pdf")
  })
  it("detects JPEG", () => {
    expect(sniffContentType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg")
  })
  it("detects PNG", () => {
    expect(sniffContentType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe("image/png")
  })
  it("accepts a Node Buffer (Uint8Array subclass)", () => {
    expect(sniffContentType(Buffer.from("%PDF-1.7"))).toBe("application/pdf")
  })
  it("returns null for unknown, truncated or empty input", () => {
    expect(sniffContentType(new Uint8Array([1, 2, 3, 4]))).toBeNull()
    expect(sniffContentType(new Uint8Array([0xff, 0xd8]))).toBeNull()
    expect(sniffContentType(new Uint8Array([]))).toBeNull()
    expect(sniffContentType(Buffer.from("<svg"))).toBeNull()
  })
})

describe("sanitizeFilename", () => {
  it("strips path segments", () => {
    expect(sanitizeFilename("C:\\Users\\x\\wwcc.pdf")).toBe("wwcc.pdf")
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd")
  })
  it("trims and caps length at 255", () => {
    expect(sanitizeFilename("  a.pdf  ")).toBe("a.pdf")
    expect(sanitizeFilename("x".repeat(400))).toHaveLength(255)
  })
  it("falls back to 'attachment' for empty names", () => {
    expect(sanitizeFilename("")).toBe("attachment")
    expect(sanitizeFilename("dir/")).toBe("attachment")
  })
})

describe("limits", () => {
  it("is 4 MB and JPEG/PNG/PDF only", () => {
    expect(MAX_UPLOAD_BYTES).toBe(4 * 1024 * 1024)
    expect([...ALLOWED_UPLOAD_TYPES].sort()).toEqual(["application/pdf", "image/jpeg", "image/png"])
  })
})
```

- [ ] **Step 2: Run, confirm FAIL**

Run: `npm test -- --testPathPatterns="fileUpload"`
Expected: FAIL, "Cannot find module '@/lib/fileUpload'".

- [ ] **Step 3: Create `src/lib/fileUpload.ts`**

```ts
// Shared upload primitives for DB-stored, encrypted documents (transaction
// receipts, person clearances). Pure — no server-only imports — so it is
// unit-testable and client-safe.

// 4 MB, not 5: leaves multipart-overhead headroom under next.config's 5mb
// serverActions.bodySizeLimit so Next doesn't reject the body before the
// action's own size check runs.
/** Maximum accepted upload size in bytes (4 MB). */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024

/** Declared MIME types accepted for upload (must also pass the magic-byte sniff). */
export const ALLOWED_UPLOAD_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf",
])

const MAX_FILENAME_LEN = 255

/** The content types `sniffContentType` can return. */
export type SniffedContentType = "image/jpeg" | "image/png" | "application/pdf"

/**
 * Sniff the real content type from the leading magic bytes — never trust the
 * attacker-controlled `file.type`, which is persisted and used to serve the
 * file. Returns null when the bytes match no allowed type.
 */
export function sniffContentType(bytes: Uint8Array): SniffedContentType | null {
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "application/pdf" // %PDF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg"
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png"
  return null
}

/**
 * Strip any path segments a browser might include and bound the length.
 * Falls back to "attachment" when nothing usable remains.
 */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "attachment"
  const trimmed = base.trim().slice(0, MAX_FILENAME_LEN)
  return trimmed || "attachment"
}
```

- [ ] **Step 4: Run, confirm PASS**

Run: `npm test -- --testPathPatterns="fileUpload"` → PASS.

- [ ] **Step 5: Point `transactionAttachment.ts` at the shared module.** Use Edit:

Replace the import `import { assertNotDemo } from "@/lib/demoMode"` with:
```ts
import { assertNotDemo } from "@/lib/demoMode"
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES, sanitizeFilename, sniffContentType } from "@/lib/fileUpload"
```
Delete the block from the comment line `// 4 MB, not 5: leaves multipart-overhead headroom ...` through the end of the `sanitizeFilename` function (i.e. the consts `MAX_ATTACHMENT_BYTES`, `ALLOWED_MIME`, `MAX_FILENAME_LEN`, the local `sniffContentType` and `sanitizeFilename`), but KEEP this block:
```ts
// Bound attachments per transaction — an editor could otherwise pin unlimited
// 5 MB blobs to a single row (storage DoS). 20 covers any real receipt set.
const MAX_ATTACHMENTS_PER_TX = 20
```
Then replace `ALLOWED_MIME.has(file.type)` with `ALLOWED_UPLOAD_TYPES.has(file.type)` and `file.size > MAX_ATTACHMENT_BYTES` with `file.size > MAX_UPLOAD_BYTES`.

- [ ] **Step 6: Existing suites must stay green**

Run: `npm test -- --testPathPatterns="transaction-attachment|TransactionAttachments|fileUpload"`
Expected: PASS (action + api + component + new). Also `npx tsc --noEmit -p .` Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/fileUpload.ts __tests__/lib/fileUpload.test.ts src/lib/actions/transactionAttachment.ts
git commit -m "refactor(upload): extract shared fileUpload primitives

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Schema, migration, key-rotation coverage

**Files:**
- Modify: `prisma/schema.prisma` (Person model ~line 38-99 — add after `celebrationSends` line; User model ~101-145 — add after `managedEvents`; add enum + model after `TransactionAttachment` ~line 351), `scripts/rotate-encryption-key.ts` (FIELDS ~line 77, BLOB_FIELDS ~line 83), `__tests__/scripts/rotate-encryption-key.test.ts` (CANONICAL ~line 270-290)
- Create: `prisma/migrations/<ts>_person_clearance/migration.sql`

- [ ] **Step 1: Save the pre-change schema for the migration diff**

```bash
mkdir -p "$TMPDIR" 2>/dev/null; git show HEAD:prisma/schema.prisma > /tmp/claude-1000/-home-ggeorge-workspace-Projects-parishcrm/2973440f-aada-43d8-9252-b5e5a20e0d61/scratchpad/schema-before.prisma
```

- [ ] **Step 2: Edit `prisma/schema.prisma`**

In `model Person`, after the line `celebrationSends      CelebrationSend[]` add:
```prisma
  clearances            PersonClearance[]
```
In `model User`, after the line `managedEvents          EventManager[]` add:
```prisma
  clearancesVerified     PersonClearance[]        @relation("ClearanceVerifiedBy")
```
After the closing `}` of `model TransactionAttachment` add:
```prisma

enum ClearanceType {
  WWCC
  SAFE_MINISTRY
}

// Child-safety clearance (NSW Working With Children Check / church Safe
// Ministry certificate) for a person. ONE current row per person+type — a new
// upload replaces it; the audit log (CLEARANCE_*) keeps the history. Document
// storage mirrors TransactionAttachment: base64 -> encrypt() -> UTF-8 bytes in
// a BYTEA column, served only via an auth-gated route. Changing number, expiry
// or document clears verifiedAt/verifiedById/verificationNote (re-verify).
model PersonClearance {
  id               String        @id @default(cuid())
  personId         Int
  person           Person        @relation(fields: [personId], references: [id], onDelete: Cascade)
  type             ClearanceType
  number           String? // encrypted at rest (WWC number)
  expiresAt        DateTime?     @db.Date
  document         Bytes? // encrypted base64 of the file, stored as UTF-8 bytes
  documentName     String? // encrypted at rest
  documentType     String? // sniffed content type (image/jpeg | image/png | application/pdf)
  documentSize     Int?
  verifiedAt       DateTime?
  verifiedById     Int?
  verifiedBy       User?         @relation("ClearanceVerifiedBy", fields: [verifiedById], references: [id], onDelete: SetNull)
  verificationNote String? // encrypted at rest
  createdById      Int?
  createdAt        DateTime      @default(now())
  updatedAt        DateTime      @updatedAt

  @@unique([personId, type])
  @@index([type, expiresAt])
  // FK index.
  @@index([verifiedById])
}
```

- [ ] **Step 3: Generate the migration SQL from the schema diff (no DB needed) and write it**

```bash
S=/tmp/claude-1000/-home-ggeorge-workspace-Projects-parishcrm/2973440f-aada-43d8-9252-b5e5a20e0d61/scratchpad
npx prisma migrate diff --from-schema "$S/schema-before.prisma" --to-schema prisma/schema.prisma --script
```
Create `prisma/migrations/20261006120000_person_clearance/migration.sql` (the timestamp MUST sort after the newest dir from Task 0 Step 4; if OSS-47's dir is later than `20261006120000`, use a later timestamp). Its content should be exactly the diff output. Expected content:

```sql
-- CreateEnum
CREATE TYPE "ClearanceType" AS ENUM ('WWCC', 'SAFE_MINISTRY');

-- CreateTable
CREATE TABLE "PersonClearance" (
    "id" TEXT NOT NULL,
    "personId" INTEGER NOT NULL,
    "type" "ClearanceType" NOT NULL,
    "number" TEXT,
    "expiresAt" DATE,
    "document" BYTEA,
    "documentName" TEXT,
    "documentType" TEXT,
    "documentSize" INTEGER,
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" INTEGER,
    "verificationNote" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonClearance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonClearance_type_expiresAt_idx" ON "PersonClearance"("type", "expiresAt");

-- CreateIndex
CREATE INDEX "PersonClearance_verifiedById_idx" ON "PersonClearance"("verifiedById");

-- CreateIndex
CREATE UNIQUE INDEX "PersonClearance_personId_type_key" ON "PersonClearance"("personId", "type");

-- AddForeignKey
ALTER TABLE "PersonClearance" ADD CONSTRAINT "PersonClearance_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonClearance" ADD CONSTRAINT "PersonClearance_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```
If the generated output differs from the above, the generated output wins (CI's `migrations` job diffs against schema.prisma).

- [ ] **Step 4: Regenerate client + local DB sanity**

```bash
npx prisma generate
npx prisma dev --detach && npm run db:push
```
Expected: "Your database is now in sync"; `grep -c PersonClearance src/lib/generated/prisma/models.ts` (or `ls src/lib/generated/prisma/models`) shows the new model.

- [ ] **Step 5: Failing rotation test.** In `__tests__/scripts/rotate-encryption-key.test.ts`, in the `CANONICAL` object after the line `user: ["totpSecret", "totpPendingSecret"],` add:
```ts
    // Child-safety clearances (src/lib/actions/clearance.ts): number, filename,
    // verification note are strings; `document` is the BYTEA blob (BLOB_FIELDS).
    personClearance: ["number", "documentName", "document", "verificationNote"],
```
Run: `npm test -- --testPathPatterns="rotate-encryption"` → FAIL (FIELDS lacks `personClearance`).

- [ ] **Step 6: Make it pass.** In `scripts/rotate-encryption-key.ts` FIELDS after the `user: [...]` entry add:
```ts
  // Child-safety clearances (src/lib/actions/clearance.ts). `document` is a
  // BYTEA blob like transactionAttachment.data — see BLOB_FIELDS.
  personClearance: ["number", "documentName", "document", "verificationNote"],
```
and in `BLOB_FIELDS` add `personClearance: ["document"],` after `transactionAttachment: ["data"],`.
Run: `npm test -- --testPathPatterns="rotate-encryption"` → PASS. If another test in that file pins `BLOB_FIELDS` exactly, update its expectation to include `personClearance: ["document"]`.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261006120000_person_clearance scripts/rotate-encryption-key.ts __tests__/scripts/rotate-encryption-key.test.ts
git commit -m "feat(people): PersonClearance schema, migration, key rotation

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Role helpers

**Files:** Modify `src/lib/roleGuard.ts` (after `canViewPeople`, ~line 54), `__tests__/lib/role-guard.test.ts`.

- [ ] **Step 1: Failing test.** In `__tests__/lib/role-guard.test.ts` add `canManageClearances, canViewClearanceStatus` to the import list from `@/lib/roleGuard`, and append inside the top-level `describe("role-guard", ...)` before its closing `})`:

```ts
  describe("canManageClearances", () => {
    it.each([UserRole.ADMIN, UserRole.PASTOR, UserRole.OFFICE_ADMIN])("%s can manage", (r) =>
      expect(canManageClearances(r)).toBe(true))
    it.each([UserRole.VIEWER, UserRole.AUDITOR, UserRole.EVENT_ORGANISER, undefined])("%s cannot manage", (r) =>
      expect(canManageClearances(r)).toBe(false))
  })

  describe("canViewClearanceStatus", () => {
    it.each([UserRole.ADMIN, UserRole.PASTOR, UserRole.OFFICE_ADMIN, UserRole.VIEWER])("%s can view status", (r) =>
      expect(canViewClearanceStatus(r)).toBe(true))
    it.each([UserRole.AUDITOR, UserRole.EVENT_ORGANISER, undefined])("%s sees nothing", (r) =>
      expect(canViewClearanceStatus(r)).toBe(false))
  })
```
Run: `npm test -- --testPathPatterns="role-guard"` → FAIL (not exported).

- [ ] **Step 2: Implement.** In `src/lib/roleGuard.ts` after the `canViewPeople` function add:

```ts
/**
 * Upload / replace / verify / remove WWCC and Safe Ministry clearances, and
 * download the document + see the number. Equal to canEdit (ADMIN | PASTOR |
 * OFFICE_ADMIN) by PO decision; kept as its own helper so the rule can diverge.
 */
export function canManageClearances(role: UserRole | undefined): boolean {
  return canEdit(role)
}

/**
 * See a clearance's STATUS BADGE only: managers (full detail) plus VIEWER
 * (badge only, never the number, document or note). AUDITOR and EVENT_ORGANISER
 * see nothing.
 */
export function canViewClearanceStatus(role: UserRole | undefined): boolean {
  return canManageClearances(role) || role === UserRole.VIEWER
}
```
Run: `npm test -- --testPathPatterns="role-guard"` → PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/roleGuard.ts __tests__/lib/role-guard.test.ts
git commit -m "feat(people): clearance role helpers

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Pure status calc (`clearanceStatus.ts`)

**Files:** Create `src/lib/clearanceStatus.ts`, `__tests__/lib/clearanceStatus.test.ts`.

- [ ] **Step 1: Failing test**

```ts
import { clearanceStatus, EXPIRING_WINDOW_DAYS, CLEARANCE_TYPE_LABELS } from "@/lib/clearanceStatus"

// "today" is the Sydney calendar date anchored at UTC midnight (sydneyToday()).
const TODAY = new Date("2026-10-06T00:00:00.000Z")
const day = (offset: number) => new Date(TODAY.getTime() + offset * 86_400_000)
const verified = new Date("2026-09-01T03:00:00.000Z")

describe("clearanceStatus", () => {
  it("is 60 days", () => expect(EXPIRING_WINDOW_DAYS).toBe(60))
  it("MISSING when there is no clearance", () => expect(clearanceStatus(null, TODAY)).toBe("MISSING"))
  it("EXPIRED when expiry is before today", () =>
    expect(clearanceStatus({ verifiedAt: verified, expiresAt: day(-1) }, TODAY)).toBe("EXPIRED"))
  it("EXPIRED beats UNVERIFIED", () =>
    expect(clearanceStatus({ verifiedAt: null, expiresAt: day(-30) }, TODAY)).toBe("EXPIRED"))
  it("expiry today is still valid -> EXPIRING", () =>
    expect(clearanceStatus({ verifiedAt: verified, expiresAt: day(0) }, TODAY)).toBe("EXPIRING"))
  it("EXPIRING at exactly 60 days", () =>
    expect(clearanceStatus({ verifiedAt: verified, expiresAt: day(60) }, TODAY)).toBe("EXPIRING"))
  it("EXPIRING beats UNVERIFIED", () =>
    expect(clearanceStatus({ verifiedAt: null, expiresAt: day(10) }, TODAY)).toBe("EXPIRING"))
  it("VERIFIED at 61 days out", () =>
    expect(clearanceStatus({ verifiedAt: verified, expiresAt: day(61) }, TODAY)).toBe("VERIFIED"))
  it("UNVERIFIED when valid but not verified", () =>
    expect(clearanceStatus({ verifiedAt: null, expiresAt: day(200) }, TODAY)).toBe("UNVERIFIED"))
  it("no expiry: UNVERIFIED / VERIFIED by verification only", () => {
    expect(clearanceStatus({ verifiedAt: null, expiresAt: null }, TODAY)).toBe("UNVERIFIED")
    expect(clearanceStatus({ verifiedAt: verified, expiresAt: null }, TODAY)).toBe("VERIFIED")
  })
  it("has labels for both types", () => {
    expect(CLEARANCE_TYPE_LABELS.WWCC).toBeTruthy()
    expect(CLEARANCE_TYPE_LABELS.SAFE_MINISTRY).toBeTruthy()
  })
})
```
Run: `npm test -- --testPathPatterns="clearanceStatus"` → FAIL (module missing).

- [ ] **Step 2: Implement `src/lib/clearanceStatus.ts`**

```ts
import { ClearanceType } from "@/lib/generated/prisma/enums"

// Pure + client-safe (no server-only imports). `today` MUST be the Sydney
// calendar date anchored at UTC midnight (`sydneyToday()` from src/lib/dates.ts)
// and `expiresAt` is a @db.Date (UTC midnight), so day arithmetic is exact.

/** Display/compliance state of one person's clearance of one type. */
export type ClearanceStatus = "MISSING" | "UNVERIFIED" | "VERIFIED" | "EXPIRING" | "EXPIRED"

/** A clearance is "expiring" when it lapses within this many days. */
export const EXPIRING_WINDOW_DAYS = 60

/** Human labels for each clearance type. */
export const CLEARANCE_TYPE_LABELS: Record<ClearanceType, string> = {
  WWCC: "Working With Children Check",
  SAFE_MINISTRY: "Safe Ministry",
}

/** Human labels for each status (badge text). */
export const CLEARANCE_STATUS_LABELS: Record<ClearanceStatus, string> = {
  MISSING: "Missing",
  UNVERIFIED: "Unverified",
  VERIFIED: "Verified",
  EXPIRING: `Expiring (${EXPIRING_WINDOW_DAYS} days)`,
  EXPIRED: "Expired",
}

const DAY_MS = 86_400_000

/**
 * Status of a clearance. Precedence: no row -> MISSING; past expiry -> EXPIRED;
 * within EXPIRING_WINDOW_DAYS of expiry -> EXPIRING (a clearance is valid
 * through its expiry date, so expiry == today is EXPIRING, not EXPIRED);
 * not verified -> UNVERIFIED; else VERIFIED. A row with no expiry date never
 * expires.
 * @param c the clearance (or null if the person has none of this type)
 * @param today Sydney calendar date at UTC midnight
 */
export function clearanceStatus(
  c: { verifiedAt: Date | null; expiresAt: Date | null } | null,
  today: Date,
): ClearanceStatus {
  if (!c) return "MISSING"
  if (c.expiresAt) {
    const daysLeft = Math.floor((c.expiresAt.getTime() - today.getTime()) / DAY_MS)
    if (daysLeft < 0) return "EXPIRED"
    if (daysLeft <= EXPIRING_WINDOW_DAYS) return "EXPIRING"
  }
  return c.verifiedAt ? "VERIFIED" : "UNVERIFIED"
}
```
Run: `npm test -- --testPathPatterns="clearanceStatus"` → PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/clearanceStatus.ts __tests__/lib/clearanceStatus.test.ts
git commit -m "feat(people): clearance status calculation

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Portal-URL setting (`clearanceSettings.ts`)

**Files:** Create `src/lib/clearanceSettings.ts`, `__tests__/lib/clearanceSettings.test.ts`.

- [ ] **Step 1: Failing test**

```ts
/** @jest-environment node */
jest.mock("@/lib/prisma", () => ({ prisma: { appSetting: { findUnique: jest.fn() } } }))

import { prisma } from "@/lib/prisma"
import { getWwccVerifyUrl, DEFAULT_WWCC_VERIFY_URL, WWCC_VERIFY_URL_KEY } from "@/lib/clearanceSettings"

const find = prisma.appSetting.findUnique as jest.Mock
beforeEach(() => jest.clearAllMocks())

it("reads the clearance.wwccVerifyUrl key", async () => {
  find.mockResolvedValue(null)
  await getWwccVerifyUrl()
  expect(find).toHaveBeenCalledWith({ where: { key: "clearance.wwccVerifyUrl" } })
  expect(WWCC_VERIFY_URL_KEY).toBe("clearance.wwccVerifyUrl")
})
it("defaults to the NSW OCG employer portal when unset", async () => {
  find.mockResolvedValue(null)
  expect(await getWwccVerifyUrl()).toBe("https://wwccemployer.ocg.nsw.gov.au/Login")
  expect(DEFAULT_WWCC_VERIFY_URL).toBe("https://wwccemployer.ocg.nsw.gov.au/Login")
})
it("defaults when blank", async () => {
  find.mockResolvedValue({ key: "k", value: "   " })
  expect(await getWwccVerifyUrl()).toBe(DEFAULT_WWCC_VERIFY_URL)
})
it("returns a valid https override", async () => {
  find.mockResolvedValue({ key: "k", value: "https://example.org/check-wwcc" })
  expect(await getWwccVerifyUrl()).toBe("https://example.org/check-wwcc")
})
it("rejects non-https / junk overrides (no javascript: or http: links)", async () => {
  for (const bad of ["javascript:alert(1)", "http://example.org", "not a url"]) {
    find.mockResolvedValue({ key: "k", value: bad })
    expect(await getWwccVerifyUrl()).toBe(DEFAULT_WWCC_VERIFY_URL)
  }
})
```
Run: `npm test -- --testPathPatterns="clearanceSettings"` → FAIL.

- [ ] **Step 2: Implement `src/lib/clearanceSettings.ts`**

```ts
import { prisma } from "@/lib/prisma"

/** AppSetting key holding an override for the WWCC verification portal URL. */
export const WWCC_VERIFY_URL_KEY = "clearance.wwccVerifyUrl"

/** NSW Office of the Children's Guardian employer portal. */
export const DEFAULT_WWCC_VERIFY_URL = "https://wwccemployer.ocg.nsw.gov.au/Login"

/**
 * URL of the portal where an admin checks a WWCC. Churches outside NSW can
 * override it via the AppSetting row `clearance.wwccVerifyUrl`. Only well-formed
 * https URLs are honoured (the value is rendered as a link, so a `javascript:`
 * or `http:` value must never reach the page) — anything else falls back to the
 * NSW default.
 */
export async function getWwccVerifyUrl(): Promise<string> {
  const row = await prisma.appSetting.findUnique({ where: { key: WWCC_VERIFY_URL_KEY } })
  const value = row?.value?.trim()
  if (!value) return DEFAULT_WWCC_VERIFY_URL
  try {
    const url = new URL(value)
    return url.protocol === "https:" ? url.toString() : DEFAULT_WWCC_VERIFY_URL
  } catch {
    return DEFAULT_WWCC_VERIFY_URL
  }
}
```
Run: `npm test -- --testPathPatterns="clearanceSettings"` → PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/clearanceSettings.ts __tests__/lib/clearanceSettings.test.ts
git commit -m "feat(people): configurable WWCC verify portal URL

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Server actions (`clearance.ts`)

**Files:** Create `src/lib/actions/clearance.ts`, `__tests__/actions/clearance.test.ts`.

- [ ] **Step 1: Write the failing test** `__tests__/actions/clearance.test.ts`

```ts
/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    person: { findUnique: jest.fn() },
    personClearance: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
  },
}))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { logAudit } from "@/lib/audit"
import {
  upsertClearance,
  verifyClearance,
  unverifyClearance,
  deleteClearance,
} from "@/lib/actions/clearance"

const mockAuth = auth as jest.Mock
const personFind = prisma.person.findUnique as jest.Mock
const find = prisma.personClearance.findUnique as jest.Mock
const create = prisma.personClearance.create as jest.Mock
const update = prisma.personClearance.update as jest.Mock
const updateMany = prisma.personClearance.updateMany as jest.Mock
const del = prisma.personClearance.delete as jest.Mock

const ADMIN = { user: { role: "ADMIN", id: "5" } }
const OFFICE = { user: { role: "OFFICE_ADMIN", id: "6" } }
const VIEWER = { user: { role: "VIEWER", id: "9" } }
const AUDITOR = { user: { role: "AUDITOR", id: "10" } }

const pngBytes = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const pngFile = (name = "wwcc.png") => new File([pngBytes()], name, { type: "image/png" })
const fd = (fields: Record<string, string>, file?: File) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  if (file) f.set("document", file)
  return f
}

const CID = "ckclearance000000000000001"
const UPDATED = new Date("2026-10-01T00:00:00.000Z")

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue(ADMIN)
  personFind.mockResolvedValue({ id: 3, archivedAt: null })
  find.mockResolvedValue(null)
  create.mockResolvedValue({ id: CID })
  update.mockResolvedValue({ id: CID })
  updateMany.mockResolvedValue({ count: 1 })
  del.mockResolvedValue({ id: CID })
})

describe("guards (every action)", () => {
  it.each([["VIEWER", VIEWER], ["AUDITOR", AUDITOR], ["anonymous", null]])("%s is Unauthorized", async (_n, s) => {
    mockAuth.mockResolvedValue(s)
    expect(await upsertClearance(3, "WWCC", fd({ expiresAt: "2027-01-01" }))).toEqual({ error: "Unauthorized" })
    expect(await verifyClearance(CID)).toEqual({ error: "Unauthorized" })
    expect(await unverifyClearance(CID)).toEqual({ error: "Unauthorized" })
    expect(await deleteClearance(CID)).toEqual({ error: "Unauthorized" })
    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(updateMany).not.toHaveBeenCalled()
    expect(del).not.toHaveBeenCalled()
  })

  it("OFFICE_ADMIN (canEdit) is allowed", async () => {
    mockAuth.mockResolvedValue(OFFICE)
    expect(await upsertClearance(3, "WWCC", fd({ expiresAt: "2027-01-01" }))).toBeUndefined()
  })

  it("is disabled in demo mode, before anything else", async () => {
    process.env.DEMO_MODE = "true"
    try {
      const r = await upsertClearance(3, "WWCC", fd({ expiresAt: "2027-01-01" }))
      expect(r && "error" in r).toBe(true)
      expect(mockAuth).not.toHaveBeenCalled()
      expect(create).not.toHaveBeenCalled()
    } finally {
      delete process.env.DEMO_MODE
    }
  })
})

describe("upsertClearance validation", () => {
  it("rejects an impossible expiry date", async () => {
    const r = await upsertClearance(3, "WWCC", fd({ expiresAt: "2027-02-30" }))
    expect(r).toEqual({ error: "Enter a valid expiry date." })
    expect(create).not.toHaveBeenCalled()
  })
  it("rejects an empty first submission", async () => {
    const r = await upsertClearance(3, "WWCC", fd({}))
    expect(r && "error" in r).toBe(true)
    expect(create).not.toHaveBeenCalled()
  })
  it("rejects an over-long number", async () => {
    const r = await upsertClearance(3, "WWCC", fd({ number: "X".repeat(41), expiresAt: "2027-01-01" }))
    expect(r && "error" in r).toBe(true)
  })
  it("rejects an unknown type", async () => {
    const r = await upsertClearance(3, "NOPE" as never, fd({ expiresAt: "2027-01-01" }))
    expect(r).toEqual({ error: "Not found" })
  })
  it("rejects a declared type outside JPEG/PNG/PDF", async () => {
    const txt = new File([new Uint8Array([1, 2])], "a.txt", { type: "text/plain" })
    const r = await upsertClearance(3, "WWCC", fd({ expiresAt: "2027-01-01" }, txt))
    expect(r && "error" in r).toBe(true)
    expect(create).not.toHaveBeenCalled()
  })
  it("rejects an oversized file without reading it into memory", async () => {
    const big = pngFile()
    Object.defineProperty(big, "size", { value: 5 * 1024 * 1024 })
    const spy = jest.spyOn(big, "arrayBuffer")
    const r = await upsertClearance(3, "WWCC", fd({ expiresAt: "2027-01-01" }, big))
    expect(r).toEqual({ error: "Document must be 4 MB or smaller." })
    expect(spy).not.toHaveBeenCalled()
  })
  it("rejects bad magic bytes (declared PDF, not a PDF)", async () => {
    const fake = new File([new Uint8Array([0, 1, 2, 3, 4])], "fake.pdf", { type: "application/pdf" })
    const r = await upsertClearance(3, "WWCC", fd({ expiresAt: "2027-01-01" }, fake))
    expect(r && "error" in r).toBe(true)
    expect(create).not.toHaveBeenCalled()
  })
  it("rejects when the sniffed type differs from the declared type", async () => {
    const mismatch = new File([pngBytes()], "x.pdf", { type: "application/pdf" })
    const r = await upsertClearance(3, "WWCC", fd({ expiresAt: "2027-01-01" }, mismatch))
    expect(r && "error" in r).toBe(true)
  })
  it("404s an archived or missing person", async () => {
    personFind.mockResolvedValue({ id: 3, archivedAt: new Date() })
    expect(await upsertClearance(3, "WWCC", fd({ expiresAt: "2027-01-01" }))).toEqual({ error: "Not found" })
    personFind.mockResolvedValue(null)
    expect(await upsertClearance(3, "WWCC", fd({ expiresAt: "2027-01-01" }))).toEqual({ error: "Not found" })
  })
})

describe("upsertClearance create", () => {
  it("encrypts number/filename/blob, stores UTC-midnight expiry, audits, revalidates", async () => {
    const r = await upsertClearance(3, "WWCC", fd({ number: " wwc0000000e ", expiresAt: "2029-03-15" }, pngFile("my wwcc.png")))
    expect(r).toBeUndefined()
    const data = create.mock.calls[0][0].data
    expect(data.personId).toBe(3)
    expect(data.type).toBe("WWCC")
    expect(data.number).toBe("enc:WWC0000000E")
    expect(data.expiresAt).toEqual(new Date("2029-03-15T00:00:00.000Z"))
    expect(data.documentName).toBe("enc:my wwcc.png")
    expect(data.documentType).toBe("image/png")
    expect(data.documentSize).toBe(pngBytes().length)
    expect(Buffer.isBuffer(data.document)).toBe(true)
    expect(data.document.toString("utf8")).toBe(`enc:${Buffer.from(pngBytes()).toString("base64")}`)
    expect(data.createdById).toBe(5)
    expect(logAudit).toHaveBeenCalledWith(5, "CLEARANCE_ADDED", "Person", 3, expect.objectContaining({ type: "WWCC" }))
    // Audit metadata must never carry the number.
    expect(JSON.stringify((logAudit as jest.Mock).mock.calls[0])).not.toContain("WWC0000000E")
    expect(revalidatePath).toHaveBeenCalledWith("/people/3")
  })

  it("Safe Ministry numbers are not upper-cased", async () => {
    await upsertClearance(3, "SAFE_MINISTRY", fd({ number: "cert-1", expiresAt: "2029-03-15" }))
    expect(create.mock.calls[0][0].data.number).toBe("enc:cert-1")
  })

  it("returns a friendly error when a concurrent create hits the unique key", async () => {
    create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }))
    const r = await upsertClearance(3, "WWCC", fd({ expiresAt: "2029-03-15" }))
    expect(r && "error" in r).toBe(true)
  })
})

describe("upsertClearance update", () => {
  const existing = {
    id: CID,
    number: "enc:WWC0000000E",
    expiresAt: new Date("2029-03-15T00:00:00.000Z"),
    verifiedAt: new Date("2026-09-01T00:00:00.000Z"),
  }
  beforeEach(() => find.mockResolvedValue(existing))

  it("changing the expiry clears verification and audits UPDATED", async () => {
    const r = await upsertClearance(3, "WWCC", fd({ number: "WWC0000000E", expiresAt: "2034-03-15" }))
    expect(r).toBeUndefined()
    const { where, data } = update.mock.calls[0][0]
    expect(where).toEqual({ id: CID })
    expect(data.expiresAt).toEqual(new Date("2034-03-15T00:00:00.000Z"))
    expect(data).toMatchObject({ verifiedAt: null, verifiedById: null, verificationNote: null })
    expect(data.document).toBeUndefined() // no new file -> existing document kept
    expect(logAudit).toHaveBeenCalledWith(5, "CLEARANCE_UPDATED", "Person", 3,
      expect.objectContaining({ type: "WWCC", verificationCleared: true, documentReplaced: false }))
    expect(create).not.toHaveBeenCalled()
  })

  it("changing the number clears verification", async () => {
    await upsertClearance(3, "WWCC", fd({ number: "WWC9999999E", expiresAt: "2029-03-15" }))
    expect(update.mock.calls[0][0].data).toMatchObject({ number: "enc:WWC9999999E", verifiedAt: null })
  })

  it("uploading a new document alone counts as a change", async () => {
    await upsertClearance(3, "WWCC", fd({ number: "WWC0000000E", expiresAt: "2029-03-15" }, pngFile()))
    const { data } = update.mock.calls[0][0]
    expect(data.documentType).toBe("image/png")
    expect(data.verifiedAt).toBeNull()
    expect(logAudit).toHaveBeenCalledWith(5, "CLEARANCE_UPDATED", "Person", 3, expect.objectContaining({ documentReplaced: true }))
  })

  it("an unchanged resubmit is a no-op (verification kept, no audit)", async () => {
    const r = await upsertClearance(3, "WWCC", fd({ number: "WWC0000000E", expiresAt: "2029-03-15" }))
    expect(r).toBeUndefined()
    expect(update).not.toHaveBeenCalled()
    expect(logAudit).not.toHaveBeenCalled()
  })
})

describe("verifyClearance", () => {
  const row = { id: CID, personId: 3, type: "WWCC", updatedAt: UPDATED }
  beforeEach(() => find.mockResolvedValue(row))

  it("marks verified by the actor, encrypts the note, audits, revalidates", async () => {
    const r = await verifyClearance(CID, "  checked on OCG portal  ")
    expect(r).toBeUndefined()
    const { where, data } = updateMany.mock.calls[0][0]
    expect(where).toEqual({ id: CID, updatedAt: UPDATED })
    expect(data.verifiedById).toBe(5)
    expect(data.verifiedAt).toBeInstanceOf(Date)
    expect(data.verificationNote).toBe("enc:checked on OCG portal")
    expect(logAudit).toHaveBeenCalledWith(5, "CLEARANCE_VERIFIED", "Person", 3,
      expect.objectContaining({ type: "WWCC", clearanceId: CID, hasNote: true }))
    expect(revalidatePath).toHaveBeenCalledWith("/people/3")
  })
  it("stores a null note when blank", async () => {
    await verifyClearance(CID)
    expect(updateMany.mock.calls[0][0].data.verificationNote).toBeNull()
  })
  it("rejects a note over 500 chars", async () => {
    const r = await verifyClearance(CID, "x".repeat(501))
    expect(r && "error" in r).toBe(true)
    expect(updateMany).not.toHaveBeenCalled()
  })
  it("404s an unknown or malformed id", async () => {
    find.mockResolvedValue(null)
    expect(await verifyClearance(CID)).toEqual({ error: "Not found" })
    expect(await verifyClearance("../bad id")).toEqual({ error: "Not found" })
  })
  it("errors when the row changed since it was loaded (stale verify)", async () => {
    updateMany.mockResolvedValue({ count: 0 })
    const r = await verifyClearance(CID)
    expect(r && "error" in r).toBe(true)
    expect(logAudit).not.toHaveBeenCalled()
  })
})

describe("unverifyClearance / deleteClearance", () => {
  beforeEach(() => find.mockResolvedValue({ id: CID, personId: 3, type: "SAFE_MINISTRY", updatedAt: UPDATED }))

  it("unverify clears the verification fields and audits", async () => {
    expect(await unverifyClearance(CID)).toBeUndefined()
    expect(update.mock.calls[0][0]).toEqual({
      where: { id: CID },
      data: { verifiedAt: null, verifiedById: null, verificationNote: null },
    })
    expect(logAudit).toHaveBeenCalledWith(5, "CLEARANCE_UNVERIFIED", "Person", 3, expect.objectContaining({ type: "SAFE_MINISTRY" }))
  })
  it("delete removes the row and audits REMOVED", async () => {
    expect(await deleteClearance(CID)).toBeUndefined()
    expect(del).toHaveBeenCalledWith({ where: { id: CID } })
    expect(logAudit).toHaveBeenCalledWith(5, "CLEARANCE_REMOVED", "Person", 3, expect.objectContaining({ type: "SAFE_MINISTRY" }))
    expect(revalidatePath).toHaveBeenCalledWith("/people/3")
  })
  it("both 404 a missing row", async () => {
    find.mockResolvedValue(null)
    expect(await unverifyClearance(CID)).toEqual({ error: "Not found" })
    expect(await deleteClearance(CID)).toEqual({ error: "Not found" })
  })
})
```
Run: `npm test -- --testPathPatterns="actions/clearance"` → FAIL (module missing).

- [ ] **Step 2: Implement `src/lib/actions/clearance.ts`**

```ts
"use server"

import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { canManageClearances } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { encrypt, safeDecrypt } from "@/lib/crypto"
import { isP2002, isRealCalendarDate, isValidPgId } from "@/lib/validation"
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES, sanitizeFilename, sniffContentType } from "@/lib/fileUpload"
import { assertNotDemo } from "@/lib/demoMode"
import { ClearanceType } from "@/lib/generated/prisma/enums"
import type { ActionResult } from "./types"

// WWCC / Safe Ministry clearances on a person. Storage mirrors
// TransactionAttachment (transactionAttachment.ts): the file is base64-encoded,
// AES-256-GCM encrypted and stored as UTF-8 bytes in a BYTEA column; number,
// filename and verification note are encrypted strings (encryption.md). One
// current row per person+type; a new upload replaces it and the audit log
// (CLEARANCE_*) is the history. Changing number, expiry or document clears the
// verification so it must be re-verified.

const MAX_NUMBER_LEN = 40
const MAX_NOTE_LEN = 500
const CLEARANCE_TYPES = new Set<string>(Object.values(ClearanceType))
// cuid ids: bound the alphabet/length before they reach the DB.
const CLEARANCE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

/** `YYYY-MM-DD` -> Date at UTC midnight (the app's date-only storage convention). */
function ymdToDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`)
}

/** Date -> `YYYY-MM-DD` (UTC), or null. */
function dateToYmd(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null
}

/**
 * Load the minimal row the verify/unverify/delete actions need. Null when the id
 * is malformed or the row does not exist (callers answer "Not found").
 */
async function loadClearance(clearanceId: string) {
  if (!CLEARANCE_ID_RE.test(clearanceId)) return null
  return prisma.personClearance.findUnique({
    where: { id: clearanceId },
    select: { id: true, personId: true, type: true, updatedAt: true },
  })
}

/**
 * Create or replace a person's clearance of `type`. Form fields: `number`
 * (optional), `expiresAt` (`yyyy-mm-dd`, optional), `document` (File, optional;
 * omitted on an edit keeps the stored document). Any change to number, expiry or
 * document clears verification. An unchanged resubmit is a no-op.
 * @param personId Person.id
 * @param type WWCC or SAFE_MINISTRY
 * @param formData submitted form
 */
export async function upsertClearance(
  personId: number,
  type: ClearanceType,
  formData: FormData,
): Promise<ActionResult> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!canManageClearances(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(personId) || !CLEARANCE_TYPES.has(type)) return { error: "Not found" }

  const numberRaw = String(formData.get("number") ?? "").trim()
  if (numberRaw.length > MAX_NUMBER_LEN) return { error: `Number must be ${MAX_NUMBER_LEN} characters or fewer.` }
  const number = numberRaw ? (type === ClearanceType.WWCC ? numberRaw.toUpperCase() : numberRaw) : null

  const expiryRaw = String(formData.get("expiresAt") ?? "").trim()
  if (expiryRaw && !isRealCalendarDate(expiryRaw)) return { error: "Enter a valid expiry date." }
  const expiresAt = expiryRaw ? ymdToDate(expiryRaw) : null

  // Validate the file BEFORE any DB read; size is checked before arrayBuffer()
  // so an oversized upload is never buffered (OOM DoS — security.md).
  const rawFile = formData.get("document")
  const file = rawFile instanceof File && rawFile.size > 0 ? rawFile : null
  let upload: { bytes: Buffer; contentType: string; name: string } | null = null
  if (file) {
    if (!ALLOWED_UPLOAD_TYPES.has(file.type)) return { error: "Document must be a JPEG, PNG or PDF." }
    if (file.size > MAX_UPLOAD_BYTES) return { error: "Document must be 4 MB or smaller." }
    const bytes = Buffer.from(await file.arrayBuffer())
    const sniffed = sniffContentType(bytes)
    // The sniffed type must match the declared one; it — not the client value —
    // is what we persist and later serve.
    if (!sniffed || sniffed !== file.type) return { error: "That file's contents don't match a JPEG, PNG or PDF." }
    upload = { bytes, contentType: sniffed, name: sanitizeFilename(file.name) }
  }

  const person = await prisma.person.findUnique({ where: { id: personId }, select: { id: true, archivedAt: true } })
  if (!person || person.archivedAt) return { error: "Not found" }

  const existing = await prisma.personClearance.findUnique({
    where: { personId_type: { personId, type } },
    select: { id: true, number: true, expiresAt: true, verifiedAt: true },
  })
  if (!existing && !number && !expiresAt && !upload) {
    return { error: "Enter an expiry date, number or document." }
  }

  const docData = upload
    ? {
        document: Buffer.from(encrypt(upload.bytes.toString("base64")), "utf8"),
        documentName: encrypt(upload.name),
        documentType: upload.contentType,
        documentSize: upload.bytes.length,
      }
    : {}
  const actor = actorId(session)

  if (!existing) {
    try {
      await prisma.personClearance.create({
        data: {
          personId,
          type,
          number: number ? encrypt(number) : null,
          expiresAt,
          ...docData,
          createdById: actor,
        },
      })
    } catch (e) {
      if (isP2002(e)) return { error: "This clearance was just added by someone else. Refresh and try again." }
      throw e
    }
    await logAudit(actor, "CLEARANCE_ADDED", "Person", personId, { type, documentReplaced: upload !== null })
    revalidatePath(`/people/${personId}`)
    return
  }

  const previousNumber = existing.number ? safeDecrypt(existing.number) : null
  const changed =
    upload !== null || previousNumber !== number || dateToYmd(existing.expiresAt) !== dateToYmd(expiresAt)
  if (!changed) return

  await prisma.personClearance.update({
    where: { id: existing.id },
    data: {
      number: number ? encrypt(number) : null,
      expiresAt,
      ...docData,
      verifiedAt: null,
      verifiedById: null,
      verificationNote: null,
    },
  })
  await logAudit(actor, "CLEARANCE_UPDATED", "Person", personId, {
    type,
    documentReplaced: upload !== null,
    verificationCleared: existing.verifiedAt !== null,
  })
  revalidatePath(`/people/${personId}`)
}

/**
 * Mark a clearance Verified by the acting user, with an optional note (e.g.
 * "Checked on OCG portal"). Uses an optimistic `updatedAt` guard so verifying a
 * row that was edited after the page loaded fails instead of vouching for new
 * content.
 * @param clearanceId PersonClearance.id
 * @param note optional free text, max 500 chars, stored encrypted
 */
export async function verifyClearance(clearanceId: string, note?: string): Promise<ActionResult> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!canManageClearances(session?.user?.role)) return { error: "Unauthorized" }

  const trimmed = (note ?? "").trim()
  if (trimmed.length > MAX_NOTE_LEN) return { error: `Note must be ${MAX_NOTE_LEN} characters or fewer.` }

  const row = await loadClearance(clearanceId)
  if (!row) return { error: "Not found" }

  const actor = actorId(session)
  const result = await prisma.personClearance.updateMany({
    where: { id: row.id, updatedAt: row.updatedAt },
    data: {
      verifiedAt: new Date(),
      verifiedById: actor,
      verificationNote: trimmed ? encrypt(trimmed) : null,
    },
  })
  if (result.count === 0) return { error: "This clearance changed. Refresh and try again." }

  await logAudit(actor, "CLEARANCE_VERIFIED", "Person", row.personId, {
    type: row.type,
    clearanceId: row.id,
    hasNote: trimmed.length > 0,
  })
  revalidatePath(`/people/${row.personId}`)
}

/**
 * Remove a clearance's verification (back to Unverified).
 * @param clearanceId PersonClearance.id
 */
export async function unverifyClearance(clearanceId: string): Promise<ActionResult> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!canManageClearances(session?.user?.role)) return { error: "Unauthorized" }

  const row = await loadClearance(clearanceId)
  if (!row) return { error: "Not found" }

  await prisma.personClearance.update({
    where: { id: row.id },
    data: { verifiedAt: null, verifiedById: null, verificationNote: null },
  })
  await logAudit(actorId(session), "CLEARANCE_UNVERIFIED", "Person", row.personId, {
    type: row.type,
    clearanceId: row.id,
  })
  revalidatePath(`/people/${row.personId}`)
}

/**
 * Permanently delete a clearance row (document included). The audit trail keeps
 * the fact that it existed.
 * @param clearanceId PersonClearance.id
 */
export async function deleteClearance(clearanceId: string): Promise<ActionResult> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!canManageClearances(session?.user?.role)) return { error: "Unauthorized" }

  const row = await loadClearance(clearanceId)
  if (!row) return { error: "Not found" }

  await prisma.personClearance.delete({ where: { id: row.id } })
  await logAudit(actorId(session), "CLEARANCE_REMOVED", "Person", row.personId, {
    type: row.type,
    clearanceId: row.id,
  })
  revalidatePath(`/people/${row.personId}`)
}
```

- [ ] **Step 3: Run, confirm PASS**

Run: `npm test -- --testPathPatterns="actions/clearance"` → PASS. Then `npx tsc --noEmit -p .` → no errors (fix any Prisma `Bytes` typing by keeping `Buffer`; `select` of `type` yields `ClearanceType`).

- [ ] **Step 4: Commit**

```bash
git add src/lib/actions/clearance.ts __tests__/actions/clearance.test.ts
git commit -m "feat(people): clearance server actions

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Document download route

**Files:** Create `src/app/api/people/[id]/clearances/[clearanceId]/route.ts`, `__tests__/api/clearance-route.test.ts`. Pattern copied from `src/app/api/accounting/transactions/[id]/attachments/[attachmentId]/route.ts`.

- [ ] **Step 1: Failing test**

```ts
/** @jest-environment node */
jest.mock("@/lib/prisma", () => ({ prisma: { personClearance: { findUnique: jest.fn() } } }))
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("@/lib/rateLimit", () => ({ rateLimit: jest.fn(() => true) }))

import { NextRequest } from "next/server"
import { GET } from "@/app/api/people/[id]/clearances/[clearanceId]/route"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { logAudit } from "@/lib/audit"
import { rateLimit } from "@/lib/rateLimit"

const find = prisma.personClearance.findUnique as jest.Mock
const mockAuth = auth as jest.Mock
const mockRate = rateLimit as jest.Mock
const CID = "ckclearance000000000000001"
const call = (id: string, clearanceId: string, headers: Record<string, string> = {}) =>
  GET(new NextRequest("http://test.local/", { headers }), { params: Promise.resolve({ id, clearanceId }) })

const blob = (raw: string) => Buffer.from(`enc:${Buffer.from(raw).toString("base64")}`, "utf8")
const row = (over: Record<string, unknown> = {}) => ({
  personId: 3,
  type: "WWCC",
  document: blob("PDFBYTES"),
  documentType: "application/pdf",
  documentName: "enc:wwcc.pdf",
  ...over,
})

beforeEach(() => {
  jest.clearAllMocks()
  mockRate.mockReturnValue(true)
  mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
})

it.each(["VIEWER", "AUDITOR", "EVENT_ORGANISER"])("404s %s without touching the DB", async (role) => {
  mockAuth.mockResolvedValue({ user: { role, id: "2" } })
  expect((await call("3", CID)).status).toBe(404)
  expect(find).not.toHaveBeenCalled()
})

it("404s an unauthenticated request", async () => {
  mockAuth.mockResolvedValue(null)
  expect((await call("3", CID)).status).toBe(404)
})

it("404s a non-numeric person id or a malformed clearance id without a DB read", async () => {
  expect((await call("abc", CID)).status).toBe(404)
  expect((await call("3", "../etc")).status).toBe(404)
  expect(find).not.toHaveBeenCalled()
})

it("404s when the clearance belongs to a different person (ownership mismatch)", async () => {
  find.mockResolvedValue(row({ personId: 99 }))
  expect((await call("3", CID)).status).toBe(404)
  expect(logAudit).not.toHaveBeenCalled()
})

it("404s a missing row and a row with no document", async () => {
  find.mockResolvedValue(null)
  expect((await call("3", CID)).status).toBe(404)
  find.mockResolvedValue(row({ document: null }))
  expect((await call("3", CID)).status).toBe(404)
})

it("429s when rate limited (30/min per user)", async () => {
  mockRate.mockReturnValue(false)
  expect((await call("3", CID)).status).toBe(429)
  expect(mockRate).toHaveBeenCalledWith("clearance:1", 30, 60_000)
})

it("decrypts and serves inline with no-store/nosniff, and audits with the client IP", async () => {
  find.mockResolvedValue(row())
  const res = await call("3", CID, { "x-forwarded-for": "203.0.113.9" })
  expect(res.status).toBe(200)
  expect(res.headers.get("Content-Type")).toBe("application/pdf")
  expect(res.headers.get("Content-Disposition")).toContain("inline")
  expect(res.headers.get("Content-Disposition")).toContain("wwcc.pdf")
  expect(res.headers.get("Cache-Control")).toBe("private, no-store")
  expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff")
  expect(await res.text()).toBe("PDFBYTES")
  expect(logAudit).toHaveBeenCalledWith(1, "CLEARANCE_VIEWED", "Person", 3,
    { type: "WWCC", clearanceId: CID }, "203.0.113.9")
})

it("forces download as octet-stream for a non-allowlisted stored type", async () => {
  find.mockResolvedValue(row({ documentType: "text/html" }))
  const res = await call("3", CID)
  expect(res.headers.get("Content-Type")).toBe("application/octet-stream")
  expect(res.headers.get("Content-Disposition")).toContain("attachment")
})
```
Run: `npm test -- --testPathPatterns="clearance-route"` → FAIL.

- [ ] **Step 2: Implement the route**

```ts
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { logAudit } from "@/lib/audit"
import { getClientIp } from "@/lib/clientIp"
import { canManageClearances } from "@/lib/roleGuard"
import { decrypt } from "@/lib/crypto"
import { rateLimit } from "@/lib/rateLimit"
import { parseRouteId } from "@/lib/validation"

const notFound = () => new NextResponse("Not found", { status: 404 })
const CLEARANCE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

// Only inert types render inline; anything else is forced to download as
// octet-stream so a spoofed stored type can't execute as stored XSS.
const INLINE_SAFE = new Set(["application/pdf", "image/png", "image/jpeg"])

/**
 * Serve a person's clearance document. Gated by canManageClearances
 * (ADMIN/PASTOR/OFFICE_ADMIN); every other caller — including VIEWER, who may
 * see the status badge but never the document — gets the same 404 as a missing
 * row, so the route can't be probed for existence. The clearance must belong to
 * the addressed person. Rate-limited (each hit decrypts a blob) and audited
 * (CLEARANCE_VIEWED, with client IP).
 */
export async function GET(
  req: NextRequest,
  props: { params: Promise<{ id: string; clearanceId: string }> },
) {
  const session = await auth()
  if (!canManageClearances(session?.user?.role)) return notFound()

  if (!rateLimit(`clearance:${actorId(session)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const { id, clearanceId } = await props.params
  const personId = parseRouteId(id)
  if (personId === null || !CLEARANCE_ID_RE.test(clearanceId)) return notFound()

  const row = await prisma.personClearance.findUnique({
    where: { id: clearanceId },
    select: { personId: true, type: true, document: true, documentType: true, documentName: true },
  })
  // Scope to the addressed person: a real clearance on someone else 404s like a missing one.
  if (row?.personId !== personId || !row.document || !row.documentType) return notFound()

  // Stored blob is base64 ciphertext (UTF-8 bytes); reverse to the raw file.
  const stored = (Buffer.isBuffer(row.document) ? row.document : Buffer.from(row.document as Uint8Array)).toString("utf8")
  const body = Buffer.from(decrypt(stored), "base64")
  const filename = row.documentName ? decrypt(row.documentName) : "clearance"
  const encoded = encodeURIComponent(filename)
  const asciiFallback = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_")
  const inline = INLINE_SAFE.has(row.documentType)

  await logAudit(
    actorId(session),
    "CLEARANCE_VIEWED",
    "Person",
    personId,
    { type: row.type, clearanceId },
    getClientIp(req),
  )

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": inline ? row.documentType : "application/octet-stream",
      "Cache-Control": "private, no-store",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`,
      "X-Content-Type-Options": "nosniff",
    },
  })
}
```
Run: `npm test -- --testPathPatterns="clearance-route"` → PASS.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/people/[id]/clearances" __tests__/api/clearance-route.test.ts
git commit -m "feat(people): clearance document download route

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: View model, `PersonClearances` UI, person page wiring

**Files:**
- Create: `src/lib/clearanceView.ts`, `__tests__/lib/clearanceView.test.ts`, `src/components/people/PersonClearances.tsx`, `__tests__/components/PersonClearances.test.tsx`
- Modify: `src/app/(dashboard)/people/[id]/page.tsx` (imports ~line 1-23; `PersonInfoCards` props ~66-82 and after the Pastoral card ~line 130; page body: after `givingYears` ~line 258 and the `<PersonInfoCards .../>` JSX ~line 290)

#### 8a. View model (server-side, role-filtered)

- [ ] **Step 1: Failing test** `__tests__/lib/clearanceView.test.ts`

```ts
/** @jest-environment node */
jest.mock("@/lib/crypto", () => ({ safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")) }))

import { buildClearanceCard } from "@/lib/clearanceView"
import { DEFAULT_WWCC_VERIFY_URL } from "@/lib/clearanceSettings"

jest.mock("@/lib/prisma", () => ({ prisma: {} }))

const TODAY = new Date("2026-10-06T00:00:00.000Z")
const wwcc = {
  id: "ckclearance000000000000001",
  type: "WWCC" as const,
  number: "enc:WWC0000000E",
  expiresAt: new Date("2029-03-15T00:00:00.000Z"),
  documentName: "enc:wwcc.pdf",
  documentType: "application/pdf",
  verifiedAt: new Date("2026-09-01T03:00:00.000Z"),
  verificationNote: "enc:checked on portal",
  verifiedBy: { name: "Test Admin" },
}
const base = { personId: 3, today: TODAY, wwccVerifyUrl: DEFAULT_WWCC_VERIFY_URL, ministryRoleCount: 1 }

describe("buildClearanceCard", () => {
  it("returns null for roles that cannot view status (AUDITOR, EVENT_ORGANISER, none)", () => {
    for (const role of ["AUDITOR", "EVENT_ORGANISER", undefined] as const) {
      expect(buildClearanceCard({ ...base, role, rows: [wwcc] })).toBeNull()
    }
  })

  it("manager gets full detail for both types, decrypted, with the portal URL", () => {
    const card = buildClearanceCard({ ...base, role: "OFFICE_ADMIN", rows: [wwcc] })!
    expect(card.canManage).toBe(true)
    expect(card.wwccVerifyUrl).toBe(DEFAULT_WWCC_VERIFY_URL)
    expect(card.rows.map((r) => r.type)).toEqual(["WWCC", "SAFE_MINISTRY"])
    expect(card.rows[0]).toMatchObject({
      clearanceId: wwcc.id,
      status: "VERIFIED",
      number: "WWC0000000E",
      expiresYmd: "2029-03-15",
      documentName: "wwcc.pdf",
      hasDocument: true,
      verifiedByName: "Test Admin",
      verificationNote: "checked on portal",
    })
    expect(card.rows[1]).toMatchObject({ type: "SAFE_MINISTRY", status: "MISSING" })
  })

  it("VIEWER gets the status badge ONLY — no number, doc, id, note, verifier or URL", () => {
    const card = buildClearanceCard({ ...base, role: "VIEWER", rows: [wwcc] })!
    expect(card.canManage).toBe(false)
    expect(card.wwccVerifyUrl).toBeNull()
    expect(card.rows).toEqual([
      { type: "WWCC", status: "VERIFIED" },
      { type: "SAFE_MINISTRY", status: "MISSING" },
    ])
    const json = JSON.stringify(card)
    for (const secret of ["WWC0000000E", wwcc.id, "wwcc.pdf", "Test Admin", "checked on portal"]) {
      expect(json).not.toContain(secret)
    }
  })

  it("VIEWER sees no card when the person has no ministry roles and no clearances", () => {
    expect(buildClearanceCard({ ...base, role: "VIEWER", rows: [], ministryRoleCount: 0 })).toBeNull()
  })
  it("VIEWER sees the card if a clearance exists even with no ministry roles", () => {
    expect(buildClearanceCard({ ...base, role: "VIEWER", rows: [wwcc], ministryRoleCount: 0 })).not.toBeNull()
  })
  it("managers always get the card (so they can add the first clearance)", () => {
    expect(buildClearanceCard({ ...base, role: "ADMIN", rows: [], ministryRoleCount: 0 })).not.toBeNull()
  })

  it("computes EXPIRED / UNVERIFIED from dates", () => {
    const expired = { ...wwcc, expiresAt: new Date("2026-10-01T00:00:00.000Z") }
    const unverified = { ...wwcc, type: "SAFE_MINISTRY" as const, verifiedAt: null, verifiedBy: null, verificationNote: null }
    const card = buildClearanceCard({ ...base, role: "ADMIN", rows: [expired, unverified] })!
    expect(card.rows[0].status).toBe("EXPIRED")
    expect(card.rows[1].status).toBe("UNVERIFIED")
    expect(card.rows[1].verifiedByName).toBeNull()
  })
})
```
Run: `npm test -- --testPathPatterns="clearanceView"` → FAIL.

- [ ] **Step 2: Implement `src/lib/clearanceView.ts`**

```ts
import { safeDecrypt } from "@/lib/crypto"
import { ClearanceType, type UserRole } from "@/lib/generated/prisma/enums"
import { canManageClearances, canViewClearanceStatus } from "@/lib/roleGuard"
import { clearanceStatus, type ClearanceStatus } from "@/lib/clearanceStatus"
import { formatSydneyDate } from "@/lib/dates"
import { APP_LOCALE } from "@/lib/appConfig"

/** One row of the Safeguarding card as sent to the client. */
export type ClearanceRowView = {
  type: ClearanceType
  status: ClearanceStatus
  // Manager-only fields below are ABSENT (not null) for a VIEWER, so they never
  // reach the browser. See buildClearanceCard.
  clearanceId?: string
  number?: string | null
  expiresYmd?: string | null
  expiresLabel?: string | null
  hasDocument?: boolean
  documentName?: string | null
  verifiedLabel?: string | null
  verifiedByName?: string | null
  verificationNote?: string | null
}

/** Everything `PersonClearances` needs. */
export type ClearanceCardData = {
  personId: number
  canManage: boolean
  wwccVerifyUrl: string | null
  rows: ClearanceRowView[]
}

/** The non-blob columns the person page selects (never `document`). */
export type ClearanceDbRow = {
  id: string
  type: ClearanceType
  number: string | null
  expiresAt: Date | null
  documentName: string | null
  documentType: string | null
  verifiedAt: Date | null
  verificationNote: string | null
  verifiedBy: { name: string } | null
}

const TYPE_ORDER: ClearanceType[] = [ClearanceType.WWCC, ClearanceType.SAFE_MINISTRY]

/**
 * Build the role-filtered Safeguarding card. Decryption happens only AFTER the
 * role gate and only for managers; a VIEWER receives `{type, status}` per row
 * and nothing else (client props are serialised to the browser). Returns null
 * when the role may not see clearances at all, or when a VIEWER would see an
 * empty card (person has no ministry roles and no clearance rows).
 * @param args.today Sydney calendar date at UTC midnight (`sydneyToday()`)
 * @param args.ministryRoleCount `person.ministryRoles.length` (OSS-47)
 */
export function buildClearanceCard(args: {
  role: UserRole | undefined
  personId: number
  rows: ClearanceDbRow[]
  today: Date
  wwccVerifyUrl: string
  ministryRoleCount: number
}): ClearanceCardData | null {
  const { role, personId, rows, today, wwccVerifyUrl, ministryRoleCount } = args
  if (!canViewClearanceStatus(role)) return null
  const canManage = canManageClearances(role)
  if (!canManage && ministryRoleCount === 0 && rows.length === 0) return null

  const views = TYPE_ORDER.map((type): ClearanceRowView => {
    const row = rows.find((r) => r.type === type) ?? null
    const status = clearanceStatus(row, today)
    if (!canManage || !row) return { type, status }
    return {
      type,
      status,
      clearanceId: row.id,
      number: row.number ? safeDecrypt(row.number) : null,
      expiresYmd: row.expiresAt ? row.expiresAt.toISOString().slice(0, 10) : null,
      expiresLabel: row.expiresAt ? row.expiresAt.toLocaleDateString(APP_LOCALE, { timeZone: "UTC" }) : null,
      hasDocument: row.documentType !== null,
      documentName: row.documentName ? safeDecrypt(row.documentName) : null,
      verifiedLabel: row.verifiedAt ? formatSydneyDate(row.verifiedAt) : null,
      verifiedByName: row.verifiedBy?.name ?? null,
      verificationNote: row.verificationNote ? safeDecrypt(row.verificationNote) : null,
    }
  })
  return { personId, canManage, wwccVerifyUrl: canManage ? wwccVerifyUrl : null, rows: views }
}
```
Run: `npm test -- --testPathPatterns="clearanceView"` → PASS. (The test keeps `jest.mock("@/lib/prisma")` because it imports `DEFAULT_WWCC_VERIFY_URL` from `clearanceSettings`, which imports prisma.)

Note for the executor: VIEWER-only `ClearanceRowView` for a missing manager row also omits fields; the component must treat absent fields as empty.

#### 8b. UI component

- [ ] **Step 3: Failing test** `__tests__/components/PersonClearances.test.tsx`

```tsx
import { render, screen, within, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { PersonClearances } from "@/components/people/PersonClearances"
import { verifyClearance, upsertClearance } from "@/lib/actions/clearance"

jest.mock("@/lib/actions/clearance", () => ({
  upsertClearance: jest.fn().mockResolvedValue(undefined),
  verifyClearance: jest.fn().mockResolvedValue(undefined),
  unverifyClearance: jest.fn().mockResolvedValue(undefined),
  deleteClearance: jest.fn().mockResolvedValue(undefined),
}))

const PORTAL = "https://wwccemployer.ocg.nsw.gov.au/Login"
const managerRows = [
  {
    type: "WWCC" as const,
    status: "UNVERIFIED" as const,
    clearanceId: "ckw",
    number: "WWC0000000E",
    expiresYmd: "2029-03-15",
    expiresLabel: "15/03/2029",
    hasDocument: true,
    documentName: "wwcc.pdf",
    verifiedLabel: null,
    verifiedByName: null,
    verificationNote: null,
  },
  {
    type: "SAFE_MINISTRY" as const,
    status: "UNVERIFIED" as const,
    clearanceId: "cks",
    number: null,
    expiresYmd: null,
    expiresLabel: null,
    hasDocument: false,
    documentName: null,
    verifiedLabel: null,
    verifiedByName: null,
    verificationNote: null,
  },
]
const manager = { personId: 3, canManage: true, wwccVerifyUrl: PORTAL, rows: managerRows }

beforeEach(() => jest.clearAllMocks())

it("VIEWER sees status badges only: no number, no buttons, no document link", () => {
  render(
    <PersonClearances
      personId={3}
      canManage={false}
      wwccVerifyUrl={null}
      rows={[{ type: "WWCC", status: "VERIFIED" }, { type: "SAFE_MINISTRY", status: "MISSING" }]}
    />,
  )
  expect(screen.getByText("Verified")).toBeInTheDocument()
  expect(screen.getByText("Missing")).toBeInTheDocument()
  expect(screen.queryByRole("button")).toBeNull()
  expect(screen.queryByRole("link")).toBeNull()
})

it("manager sees the number, expiry, and a link to the scoped document route", () => {
  render(<PersonClearances {...manager} />)
  const row = within(screen.getByTestId("clearance-WWCC"))
  expect(row.getByText("WWC0000000E")).toBeInTheDocument()
  expect(row.getByText(/15\/03\/2029/)).toBeInTheDocument()
  expect(row.getByRole("link", { name: /view document/i })).toHaveAttribute("href", "/api/people/3/clearances/ckw")
})

it("WWCC Verify opens a confirmation with the OCG portal link and calls verifyClearance with the note", async () => {
  const user = userEvent.setup()
  render(<PersonClearances {...manager} />)
  await user.click(within(screen.getByTestId("clearance-WWCC")).getByRole("button", { name: /^verify$/i }))
  const dialog = await screen.findByRole("dialog")
  const link = within(dialog).getByRole("link", { name: /check on ocg portal/i })
  expect(link).toHaveAttribute("href", PORTAL)
  expect(link).toHaveAttribute("target", "_blank")
  expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"))
  await user.type(within(dialog).getByLabelText(/note/i), "Checked on portal")
  await user.click(within(dialog).getByRole("button", { name: /confirm/i }))
  await waitFor(() => expect(verifyClearance).toHaveBeenCalledWith("ckw", "Checked on portal"))
})

it("Safe Ministry Verify has NO portal link", async () => {
  const user = userEvent.setup()
  const rows = [managerRows[0], { ...managerRows[1], number: "SM-1", expiresYmd: "2028-01-01", expiresLabel: "01/01/2028" }]
  render(<PersonClearances {...manager} rows={rows} />)
  await user.click(within(screen.getByTestId("clearance-SAFE_MINISTRY")).getByRole("button", { name: /^verify$/i }))
  const dialog = await screen.findByRole("dialog")
  expect(within(dialog).queryByRole("link", { name: /ocg portal/i })).toBeNull()
})

it("no Verify button when a clearance does not exist yet or is already verified", () => {
  const rows = [
    { ...managerRows[0], status: "VERIFIED" as const, verifiedLabel: "Tue 6 Oct 2026", verifiedByName: "Test Admin" },
    { type: "SAFE_MINISTRY" as const, status: "MISSING" as const },
  ]
  render(<PersonClearances {...manager} rows={rows} />)
  expect(screen.queryByRole("button", { name: /^verify$/i })).toBeNull()
  expect(screen.getByText(/Test Admin/)).toBeInTheDocument()
  expect(within(screen.getByTestId("clearance-WWCC")).getByRole("button", { name: /unverify/i })).toBeInTheDocument()
})

it("submitting the add form calls upsertClearance(personId, type, FormData)", async () => {
  const user = userEvent.setup()
  render(<PersonClearances {...manager} rows={[{ type: "WWCC", status: "MISSING" }, managerRows[1]]} />)
  const row = within(screen.getByTestId("clearance-WWCC"))
  await user.click(row.getByRole("button", { name: /^add$/i }))
  await user.type(row.getByLabelText(/number/i), "WWC0000000E")
  await user.click(row.getByRole("button", { name: /^save$/i }))
  await waitFor(() => expect(upsertClearance).toHaveBeenCalledWith(3, "WWCC", expect.any(FormData)))
})
```
Run: `npm test -- --testPathPatterns="PersonClearances"` → FAIL. (If `@testing-library/user-event` is not installed, check `package.json`; if absent use `fireEvent` from RTL instead and adapt `user.click/type` to `fireEvent.click/change`.)

- [ ] **Step 4: Implement `src/components/people/PersonClearances.tsx`**

```tsx
"use client"

import { useState, useTransition } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { CLEARANCE_STATUS_LABELS, CLEARANCE_TYPE_LABELS, type ClearanceStatus } from "@/lib/clearanceStatus"
import type { ClearanceCardData, ClearanceRowView } from "@/lib/clearanceView"
import { deleteClearance, unverifyClearance, upsertClearance, verifyClearance } from "@/lib/actions/clearance"

// Design-token classes only (no raw palette — eslint-raw-palette rule).
const STATUS_BADGE: Record<ClearanceStatus, { variant: "default" | "secondary" | "destructive" | "outline"; className?: string }> = {
  MISSING: { variant: "outline" },
  UNVERIFIED: { variant: "secondary" },
  VERIFIED: { variant: "outline", className: "border-income/50 text-income" },
  EXPIRING: { variant: "outline", className: "border-warning text-warning-foreground bg-warning/20" },
  EXPIRED: { variant: "destructive" },
}

/** Status pill for one clearance. */
function StatusBadge({ status }: Readonly<{ status: ClearanceStatus }>) {
  const { variant, className } = STATUS_BADGE[status]
  return <Badge variant={variant} className={className}>{CLEARANCE_STATUS_LABELS[status]}</Badge>
}

/**
 * Confirmation dialog for marking a clearance Verified, with an optional note.
 * WWCC only: a "Check on OCG portal" link so the admin can look the number up
 * before confirming. Safe Ministry has no portal link.
 */
function VerifyDialog({
  row,
  wwccVerifyUrl,
  open,
  onOpenChange,
}: Readonly<{
  row: ClearanceRowView
  wwccVerifyUrl: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}>) {
  const [note, setNote] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const label = CLEARANCE_TYPE_LABELS[row.type]

  /** Run the verify action; close on success, keep the dialog open on error. */
  function confirm() {
    setError(null)
    startTransition(async () => {
      const result = await verifyClearance(row.clearanceId ?? "", note)
      if (result && "error" in result) {
        setError(result.error)
        return
      }
      setNote("")
      onOpenChange(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Verify {label}?</DialogTitle>
          <DialogDescription>
            Confirm you have checked this clearance
            {row.type === "WWCC" ? " against the issuing portal" : ""}. Editing the number, expiry or
            document later will clear this verification.
          </DialogDescription>
        </DialogHeader>
        {row.type === "WWCC" && wwccVerifyUrl && (
          <a
            href={wwccVerifyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-primary underline"
          >
            Check on OCG portal ↗
          </a>
        )}
        <div className="space-y-1">
          <label htmlFor={`verify-note-${row.type}`} className="text-sm font-medium">Note (optional)</label>
          <Textarea
            id={`verify-note-${row.type}`}
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Checked on the OCG portal, status Current"
          />
        </div>
        <FormFeedback state={error ? { error } : undefined} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button type="button" onClick={confirm} disabled={pending}>{pending ? "Verifying…" : "Confirm"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Add / replace form (number, expiry, optional document). */
function ClearanceForm({
  personId,
  row,
  onDone,
}: Readonly<{ personId: number; row: ClearanceRowView; onDone: () => void }>) {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const id = `clearance-${row.type}`

  /** Submit via the action (its signature isn't useActionState-shaped). */
  function submit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    setError(null)
    startTransition(async () => {
      const result = await upsertClearance(personId, row.type, formData)
      if (result && "error" in result) {
        setError(result.error)
        return
      }
      onDone()
    })
  }

  return (
    <form onSubmit={submit} className="mt-3 grid gap-3 sm:grid-cols-2">
      <div>
        <label htmlFor={`${id}-number`} className="text-sm font-medium">Number</label>
        <input
          id={`${id}-number`}
          name="number"
          defaultValue={row.number ?? ""}
          maxLength={40}
          autoComplete="off"
          className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
        />
      </div>
      <div>
        <label htmlFor={`${id}-expiry`} className="text-sm font-medium">Expiry date</label>
        <input
          id={`${id}-expiry`}
          name="expiresAt"
          type="date"
          defaultValue={row.expiresYmd ?? ""}
          className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
        />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor={`${id}-doc`} className="text-sm font-medium">
          Document {row.hasDocument ? "(leave empty to keep the current file)" : ""}
        </label>
        <input
          id={`${id}-doc`}
          name="document"
          type="file"
          accept="image/png,image/jpeg,application/pdf"
          aria-describedby={`${id}-hint`}
          className="mt-1 block text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-primary-foreground"
        />
        <p id={`${id}-hint`} className="mt-1 text-xs text-muted-foreground">JPEG, PNG or PDF, up to 4 MB.</p>
      </div>
      <div className="sm:col-span-2 flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone} disabled={pending}>Cancel</Button>
      </div>
      <FormFeedback state={error ? { error } : undefined} className="sm:col-span-2" />
    </form>
  )
}

/** One clearance type's row: badge, details, and (managers) actions. */
function ClearanceRow({
  personId,
  canManage,
  wwccVerifyUrl,
  row,
}: Readonly<{ personId: number; canManage: boolean; wwccVerifyUrl: string | null; row: ClearanceRowView }>) {
  const [editing, setEditing] = useState(false)
  const [verifyOpen, setVerifyOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const exists = row.clearanceId !== undefined
  const verified = row.verifiedLabel != null

  /** Run unverify; surface an error inline. */
  function unverify() {
    setActionError(null)
    startTransition(async () => {
      const result = await unverifyClearance(row.clearanceId ?? "")
      if (result && "error" in result) setActionError(result.error)
    })
  }

  return (
    <li data-testid={`clearance-${row.type}`} className="rounded-lg border border-border bg-card px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{CLEARANCE_TYPE_LABELS[row.type]}</span>
          <StatusBadge status={row.status} />
        </div>
        {canManage && !editing && (
          <div className="flex flex-wrap items-center gap-1">
            {row.hasDocument && (
              <a
                href={`/api/people/${personId}/clearances/${row.clearanceId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary underline px-2"
              >
                View document
              </a>
            )}
            {exists && !verified && (
              <Button type="button" size="sm" variant="outline" onClick={() => setVerifyOpen(true)}>Verify</Button>
            )}
            {exists && verified && (
              <Button type="button" size="sm" variant="ghost" onClick={unverify} disabled={pending}>Unverify</Button>
            )}
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
              {exists ? "Update" : "Add"}
            </Button>
            {exists && (
              <DeleteConfirmButton
                onConfirm={() => deleteClearance(row.clearanceId ?? "")}
                title="Remove clearance?"
                description={`The ${CLEARANCE_TYPE_LABELS[row.type]} record and its document will be permanently removed.`}
                triggerLabel="Remove"
                confirmLabel="Remove"
                pendingLabel="Removing…"
              />
            )}
          </div>
        )}
      </div>

      {canManage && exists && (
        <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">Number</dt><dd>{row.number ?? "—"}</dd></div>
          <div><dt className="text-muted-foreground">Expires</dt><dd>{row.expiresLabel ?? "No expiry"}</dd></div>
          {verified && (
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Verified</dt>
              <dd>
                {row.verifiedByName ? `${row.verifiedByName}, ` : ""}{row.verifiedLabel}
                {row.verificationNote ? ` — ${row.verificationNote}` : ""}
              </dd>
            </div>
          )}
        </dl>
      )}

      {actionError && <FormFeedback state={{ error: actionError }} className="mt-2" />}
      {canManage && editing && (
        <ClearanceForm personId={personId} row={row} onDone={() => setEditing(false)} />
      )}
      {canManage && exists && (
        <VerifyDialog row={row} wwccVerifyUrl={wwccVerifyUrl} open={verifyOpen} onOpenChange={setVerifyOpen} />
      )}
    </li>
  )
}

/**
 * Safeguarding card body: one row per clearance type (WWCC, Safe Ministry).
 * Managers (canEdit roles) get number/expiry/verification detail plus upload,
 * view-document, verify and remove. Everyone else gets the status badge only —
 * the server never sends them anything more (see buildClearanceCard).
 */
export function PersonClearances({ personId, canManage, wwccVerifyUrl, rows }: Readonly<ClearanceCardData>) {
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <ClearanceRow
          key={row.type}
          personId={personId}
          canManage={canManage}
          wwccVerifyUrl={wwccVerifyUrl}
          row={row}
        />
      ))}
    </ul>
  )
}
```
Run: `npm test -- --testPathPatterns="PersonClearances"` → PASS. If a jsdom/Radix issue arises (`hasPointerCapture`/`scrollIntoView` not a function), check `jest.setup.ts` and how `__tests__/components/DeleteConfirmButton.test.tsx` handles Radix dialogs; mirror it. Then `npm run lint` on the new files (`npx eslint src/components/people/PersonClearances.tsx src/lib/clearanceView.ts`) → clean.

#### 8c. Person page wiring

- [ ] **Step 5: Edit `src/app/(dashboard)/people/[id]/page.tsx`**

Imports — change the roleGuard import line to add the helpers, and add new imports after `import { parseRouteId } from "@/lib/validation"`:
```ts
import { canEdit, isAdmin, canSeePastoralNotes, canAccessAccounting, canViewPeople, canManageClearances, canViewClearanceStatus } from "@/lib/roleGuard"
```
```ts
import { PersonClearances } from "@/components/people/PersonClearances"
import { buildClearanceCard, type ClearanceCardData } from "@/lib/clearanceView"
import { DEFAULT_WWCC_VERIFY_URL, getWwccVerifyUrl } from "@/lib/clearanceSettings"
import { sydneyToday } from "@/lib/dates"
```

`PersonInfoCards`: add `clearanceCard` to the destructured params, the type, and render. Change the signature block:
```tsx
function PersonInfoCards({
  person,
  displayPerson,
  dob,
  showPastoralNotes,
  clearanceCard,
}: Readonly<{
```
and after `showPastoralNotes: boolean` (end of the prop type) add `  clearanceCard: ClearanceCardData | null`. Then immediately after the closing `)}` of the `{showPastoralNotes && ( <Card>…Pastoral… </Card> )}` block and before the closing `</div>` of the grid, add:
```tsx
      {clearanceCard && (
        <Card className="md:col-span-2">
          <CardHeader><CardTitle className="text-base">Safeguarding</CardTitle></CardHeader>
          <CardContent>
            <PersonClearances {...clearanceCard} />
          </CardContent>
        </Card>
      )}
```

Page body: after the `const userCanSeeGiving = ...` line, add:
```ts
  // Safeguarding card. Gate BEFORE querying/decrypting: AUDITOR/EVENT_ORGANISER
  // get nothing; VIEWER gets status badges only (buildClearanceCard strips the
  // rest). Never select the `document` blob here.
  const clearanceRows = canViewClearanceStatus(session?.user?.role)
    ? await prisma.personClearance.findMany({
        where: { personId: person.id },
        select: {
          id: true,
          type: true,
          number: true,
          expiresAt: true,
          documentName: true,
          documentType: true,
          verifiedAt: true,
          verificationNote: true,
          verifiedBy: { select: { name: true } },
        },
      })
    : []
  const wwccVerifyUrl = canManageClearances(session?.user?.role)
    ? await getWwccVerifyUrl()
    : DEFAULT_WWCC_VERIFY_URL
  const clearanceCard = buildClearanceCard({
    role: session?.user?.role,
    personId: person.id,
    rows: clearanceRows,
    today: sydneyToday(),
    wwccVerifyUrl,
    ministryRoleCount: person.ministryRoles.length,
  })
```
and pass `clearanceCard={clearanceCard}` to the `<PersonInfoCards ... />` JSX (after `showPastoralNotes={showPastoralNotes}`).

- [ ] **Step 6: Typecheck + related suites**

```bash
npx tsc --noEmit -p .
npm test -- --testPathPatterns="clearance|person|PersonClearances|people"
```
Expected: no TS errors; all PASS. If a pre-existing people page test (e.g. under `__tests__/app/`) mocks prisma without `personClearance`, add `personClearance: { findMany: jest.fn().mockResolvedValue([]) }` to that mock.

- [ ] **Step 7: Commit**

```bash
git add src/lib/clearanceView.ts __tests__/lib/clearanceView.test.ts src/components/people/PersonClearances.tsx __tests__/components/PersonClearances.test.tsx "src/app/(dashboard)/people/[id]/page.tsx"
git commit -m "feat(people): Safeguarding card with verify flow on person page

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Docs (website + README + rules), same PR

**Files (Modify):** `website/src/content/docs/docs/people-and-families.md`, `roles-and-permissions.md`, `data-encryption.md`, `privacy-and-audit-log.md`, `README.md`, `.claude/rules/encryption.md`, `.claude/rules/data-model.md`. (`scheduled-jobs.md` is OSS-49's digest — do NOT touch here.)

- [ ] **Step 1: `people-and-families.md`** — insert this section immediately before the line `## How it works`:

```md
### Safeguarding clearances (WWCC and Safe Ministry)

Each person's page has a **Safeguarding** card with one row for the **Working With Children Check (WWCC)** and one for the **Safe Ministry** certificate. Staff (ADMIN, PASTOR, OFFICE_ADMIN) can:

- **Add / Update** — record the number and expiry date and upload the document (JPEG, PNG or PDF, up to 4 MB). A new upload replaces the previous one; the audit log keeps the history.
- **Verify** — after checking the clearance (for a WWCC, on the issuing portal — the dialog has a **Check on OCG portal ↗** link, default the NSW Office of the Children's Guardian employer portal), click **Verify** and add an optional note. The card then shows who verified it and when. **Editing the number, expiry or document clears the verification**, so it must be checked again.
- **View document**, **Unverify** and **Remove**.

Status badges: **Missing**, **Unverified**, **Verified**, **Expiring** (expires within 60 days) and **Expired**. People tagged with a ministry role (see ministry roles above) are the ones who need a clearance; staff can add one for anyone.

The portal link is the app setting `clearance.wwccVerifyUrl` (an `https://` URL). Outside NSW, add or edit that row in the `AppSetting` table to point at your state's check; if unset the NSW URL is used.
```

Also in the same file's role table, change the `VIEWER` row text to `Read-only list/detail views and the clearance status badge only (never the number or document), no pastoral notes, no edit actions`.

- [ ] **Step 2: `roles-and-permissions.md`** — in the feature × role matrix, after the row beginning `| Pastoral notes (view)` add:
```md
| Safeguarding clearances — upload, verify, view document and number | Yes | Yes | Yes | No | No | No |
| Safeguarding clearances — status badge only | Yes | Yes | Yes | No | Yes | No |
```
and in the helper table after the `canViewPeople` row add:
```md
| `canManageClearances` | ADMIN \| PASTOR \| OFFICE_ADMIN (same as `canEdit`) — upload, verify, view/download the document and number |
| `canViewClearanceStatus` | `canManageClearances` plus VIEWER (badge only) |
```

- [ ] **Step 3: `data-encryption.md`** — in the "Encrypted fields" paragraph change `and transaction\nattachment filenames and file contents.` to `transaction\nattachment filenames and file contents, and child-safety clearance (WWCC / Safe Ministry) numbers, document files, filenames and verification notes.` (keep the surrounding sentence grammatical: `..., DGR (tax-deductible) receipt donor email, transaction attachment filenames and file contents, and child-safety clearance (WWCC / Safe Ministry) numbers, document files, filenames and verification notes.`).

- [ ] **Step 4: `privacy-and-audit-log.md`** — after the paragraph that ends `...never the raw, client-spoofable` sentence block (the "Audit log." paragraph), add a new paragraph:
```md
**Clearance records.** WWCC / Safe Ministry changes are audited as `CLEARANCE_ADDED`, `CLEARANCE_UPDATED`, `CLEARANCE_VERIFIED`, `CLEARANCE_UNVERIFIED` and `CLEARANCE_REMOVED` against the person. Every time a clearance document is opened, `CLEARANCE_VIEWED` is recorded with the client IP. The audit entries carry the clearance type and id only — never the WWC number, note or file contents. The document route answers `404` to anyone who may not manage clearances (including read-only VIEWER accounts), and is rate-limited.
```

- [ ] **Step 5: `README.md`** — (a) in "Core features", change the Families bullet to end `..., soft-archive, role-gated pastoral notes, and WWCC / Safe Ministry clearance tracking (encrypted document, expiry, verified-by).`; (b) in the Encryption paragraph (`### Encryption`) add `clearance numbers and documents` to the list: `... pastoral notes, transaction descriptions, receipt destinations, registration contact details, and child-safety clearance numbers/documents.`; (c) in the roles table change the `VIEWER` row to `Read-only people/families/events (clearance status badge only) — no pastoral notes, no accounting`.

- [ ] **Step 6: `.claude/rules/encryption.md`** — in the "Encrypted fields" list after the `User:` bullet add:
```md
- `PersonClearance`: number, documentName, verificationNote, and `document` (BYTEA of `encrypt(base64)`, same as `TransactionAttachment.data`) — `src/lib/actions/clearance.ts`; rotated via `scripts/rotate-encryption-key.ts` FIELDS `personClearance` + BLOB_FIELDS
```
`.claude/rules/data-model.md` — under `## People & Families` add a bullet: `- \`PersonClearance\` (one per person+\`ClearanceType\`: WWCC | SAFE_MINISTRY): encrypted number/document, \`expiresAt @db.Date\`, verifiedAt/verifiedBy/note. Editing number/expiry/document clears verification. Status via \`src/lib/clearanceStatus.ts\`; role helpers \`canManageClearances\` / \`canViewClearanceStatus\`.`

- [ ] **Step 7: Verify nothing stale.** Run `grep -rn "clearance" -i website/src/content/docs/docs README.md | head -20` — expect the new text; confirm no doc claims VIEWER sees "no" clearance info.

- [ ] **Step 8: Commit**

```bash
git add website/src/content/docs/docs README.md .claude/rules/encryption.md .claude/rules/data-model.md
git commit -m "docs: WWCC and Safe Ministry clearances

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
(`.claude/` is globally git-ignored; if `git add` of `.claude/rules/*` is refused, that is expected — skip them, they are local-only.)

---

### Task 10: Self-review, verify, push, PR

- [ ] **Step 1: Spec coverage checklist** (open `.claude/tickets/OSS-48.md` and tick each): schema + migration + cascade (T2); `fileUpload.ts` shared by both callers (T1); four actions with demo + `canEdit` guard + audit + revalidate + verification reset (T6); route 404 non-manager, ownership check, 30/min, no-store/nosniff, `CLEARANCE_VIEWED` with IP (T7); Safeguarding card, badges, upload/replace, view, verify, OCG link from setting (T4, T5, T8); VIEWER badge only / AUDITOR+EVENT_ORGANISER none (T3, T8); number decrypted via `safeDecrypt` after role gate (T8; the ticket named `personDetailView.ts`, but decrypting inside `buildClearanceCard` keeps the gate and the VIEWER-strip in one tested place — mention in PR); tests (T1-T8); docs (T9). Placeholder scan: `grep -n "TODO\|TBD\|FIXME" src/lib/clearance*.ts src/lib/actions/clearance.ts src/components/people/PersonClearances.tsx` → none. Type/name consistency: `verifyClearance(clearanceId, note)` used identically in actions, component, tests.

- [ ] **Step 2: JSDoc check** — every new function (incl. non-exported helpers) has a JSDoc block; add any missing.

- [ ] **Step 3: Full touched-suite run + lint + types**

```bash
npm test -- --testPathPatterns="clearance|fileUpload|transaction-attachment|TransactionAttachments|role-guard|rotate-encryption|PersonClearances|person|people"
npm run lint
npx tsc --noEmit -p .
```
Expected: all PASS, lint clean, no TS errors. Optional manual smoke (Verify section of the ticket): `npx prisma dev --detach && npm run db:push && ALLOW_DEMO_SEED=true npm run db:seed && npm run dev`; as admin open a person, add WWCC with a small PDF, Verify, View document; as viewer confirm only badges and that `/api/people/<id>/clearances/<id>` returns 404.

- [ ] **Step 4: Push and open PR**

```bash
git push -u origin feat/child-safety-clearances
gh pr create --title "feat(people): WWCC and Safe Ministry clearances on profile" --body "$(cat <<'EOF'
## Summary
- New `PersonClearance` (WWCC / Safe Ministry): number, expiry, encrypted document (JPEG/PNG/PDF, 4 MB), verified-by/at/note. One current row per person+type; editing number/expiry/document clears verification.
- Safeguarding card on the person page: status badge (Missing / Unverified / Verified / Expiring <=60d / Expired), upload/replace, view document, Verify dialog (optional note; WWCC has a "Check on OCG portal" link from `AppSetting clearance.wwccVerifyUrl`, default NSW), Unverify, Remove.
- Visibility: ADMIN/PASTOR/OFFICE_ADMIN full; VIEWER badge only (server strips number/id/note from props; document route 404s); AUDITOR/EVENT_ORGANISER nothing. New `canManageClearances` / `canViewClearanceStatus`.
- Document route `/api/people/[id]/clearances/[clearanceId]`: 404 for non-managers and ownership mismatch, 30/min limit, no-store/nosniff, `CLEARANCE_VIEWED` audit with IP.
- Refactor: `sniffContentType`/`sanitizeFilename`/limits moved to `src/lib/fileUpload.ts` (transaction attachments unchanged, tests green).
- Key rotation covers number, documentName, document, verificationNote.
- Docs: website (people-and-families, roles-and-permissions, data-encryption, privacy-and-audit-log) + README.
- Schema notes: `personId`/`verifiedById`/`createdById` are `Int` (Person/User ids are Int); `verificationNote` is encrypted.

## Migration
Adds `ClearanceType` enum + `PersonClearance` table (`..._person_clearance`). **Needs human-reviewed PROD_VERSION bump** (St Mark prod) — do not let auto-upgrade take it.

## Test plan
- [x] `npm test` touched suites (clearance, fileUpload, transaction-attachment, role-guard, rotate-encryption, PersonClearances), lint, tsc
- [ ] Local smoke: admin adds + verifies + views a PDF; viewer sees badge only, doc URL 404
- Follow-up: OSS-49 (compliance list + monthly digest)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr comment --body "@codex review"
```

- [ ] **Step 5: STOP.** Do not merge. Report the PR URL; merge needs the PO (also: read all reviews/CodeRabbit per the review-findings rule, post a disposition table, and wait for CodeRabbit to review the head SHA).
