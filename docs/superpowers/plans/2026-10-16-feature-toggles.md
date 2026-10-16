# Feature Toggles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an ADMIN tick which features their church uses (Settings → Features, plus a first-run prompt); off features are hidden and blocked, data kept.

**Architecture:** Pure code registry (`src/lib/features.ts`) + overrides stored as JSON in one `AppSetting` row (`features`). A `server-only` helper (`src/lib/featureFlags.ts`) resolves the enabled set once per request and exposes page/action/job guards. Spec: `docs/superpowers/specs/2026-10-16-feature-toggles-design.md`.

**Tech Stack:** Next.js 16 App Router + Server Actions, Prisma 7 (`AppSetting`), Jest 30, zod, shadcn/Radix UI.

## Global Constraints

- No Prisma schema change / no migration (one `AppSetting` row only).
- Every existing feature `defaultOn: true` — an install with no `features` row behaves exactly as today.
- Data is never deleted when a feature is off.
- Off ⇒ hidden in nav/dashboard AND blocked: pages `notFound()`, Server Actions return `{ error: FEATURE_OFF_MESSAGE }`, public API routes 404, scheduler jobs skip. Stripe webhook still returns 200.
- `FEATURE_OFF_MESSAGE = "This feature is turned off. An admin can enable it in Settings → Features."`
- Only ADMIN can read the Features page or write overrides; every write is audited (`logAudit`).
- DEMO_MODE: writes blocked via `assertNotDemo()`; never shows the first-run prompt.
- JSDoc on every new/changed function. Mobile-first UI: verify at 375px and ≥1920px.
- Pre-push: touched-suite tests + `npm run lint`; no local `npm run build`.
- Public repo: synthetic data only in tests.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/features.ts` (new) | Registry, `FeatureKey`, `resolveFeatures`, `parseOverrides` — pure, client-safe |
| `src/lib/featureFlags.ts` (new) | `server-only`: `getEnabledFeatures` (React `cache`), `isFeatureOn`, `requireFeature`, `featureGuard`, `skipIfFeatureOff` |
| `src/lib/actions/features.ts` (new) | `saveFeatures` Server Action (ADMIN, audit, revalidate), `finishFeatureOnboarding` |
| `src/app/(dashboard)/settings/features/page.tsx` (new) | Features page (server) |
| `src/components/settings/FeaturesForm.tsx` (new) | Checklist form (client) |
| `src/components/layout/sidebar/navData.ts` | `NavFlags.features`, per-item feature gating |
| `src/components/layout/Sidebar.tsx`, `src/app/(dashboard)/layout.tsx` | Pass enabled features down; skip off-feature badge counts; first-run redirect (PR 2) |
| Feature route `layout.tsx` files (new, one per segment) | `requireFeature` |
| Feature Server Action files | `featureGuard` first line |
| Public API routes, `schedulerRunner.ts` | Feature skip |
| `src/lib/actions/setup.ts` | Write onboarding flag (PR 2) |
| `website/src/content/docs/docs/features.md` (new), `README.md` | Docs |

## Feature → surface map (used by Tasks 4–6)

| Key | Route segments to guard | Action files | API / jobs |
|---|---|---|---|
| `celebrations` | `(dashboard)/people/birthdays`, `(dashboard)/people/anniversaries` | `birthday.ts`, `anniversary.ts` | job `celebrations`, `api/cron/send-celebrations` |
| `clearances` | `(dashboard)/people/clearances` | `clearance.ts` | `api/people/[id]/clearances*`, `api/clearances/export`, job `clearanceDigest`, `api/cron/send-clearance-digest` |
| `familyUpdates` | `(dashboard)/families/updates`, `(public)/family` | `familyUpdate.ts` | — |
| `memberships` | `(dashboard)/memberships`, `(public)/membershipform` | `membership.ts` | — |
| `welcomeLetter` | `(dashboard)/welcome-letter` | — | `api/welcome-letter/preview` |
| `sundaySchool` | `(dashboard)/sunday-school`, `(organiser)/my-classes` | `sundaySchool.ts`, `sundaySchoolAttendance.ts` | — |
| `events` | `(dashboard)/events`, `(organiser)/my-events`, `(public)/e` | `event.ts`, `eventForm.ts`, `registration.ts`, `waitlist.ts`, `eventCheckout.ts`, `eventAccess.ts` | `api/events/[slug]/*`, jobs `reminders` + `checkouts`, `api/cron/send-reminders`, event branch of `api/stripe/webhook`, website event sync |
| `accounting` | `(dashboard)/accounting` (whole segment) | `transaction.ts`, `transactionReconcile.ts`, `account.ts`, `accountGroup.ts`, `fund.ts`, `pettyCash*.ts`, `receipt.ts`, `invoice*.ts` | `api/accounting/*`, `api/import/bank-statement*` |
| `reconciliation` | `accounting/reconciliation`, `accounting/reports/reconciliation` | `reconciliation.ts`, `transactionReconcile.ts` | — |
| `bankImport` | `accounting/import` | (bank import action file) | `api/import/bank-statement*` |
| `pettyCash` | `accounting/petty-cash` | `pettyCash*.ts` | — |
| `dues` | `accounting/dues` | — | — |
| `receipts` | `accounting/send-receipts`, `accounting/receipt-audit` | `receipt.ts` (non-DGR exports) | — |
| `dgrReceipts` | `accounting/dgr-receipts` | DGR exports in `receipt.ts` | — |
| `invoices` | `accounting/invoices`, `accounting/customers` | `invoice.ts`, `invoiceSend.ts`, `invoiceVoid.ts`, `invoicePayment.ts` | — |
| `budget` | `accounting/budget`, `accounting/reports/budget-vs-actual` | (budget action file) | — |

> Before Task 5, re-grep each row (`ls src/lib/actions | grep -i <area>`) — files may have moved since 2026-10-16. Where an action file serves two features (e.g. `receipt.ts`), guard per exported function, not per file.

---

# PR 1 — registry, Settings → Features, enforcement

Branch: `feat/feature-toggles`. Card: OSS-309 (#309) (see board).

### Task 1: Registry + resolution (pure)

**Files:**
- Create: `src/lib/features.ts`
- Test: `src/lib/__tests__/features.test.ts`

**Interfaces:**
- Produces: `type FeatureKey`, `type FeatureDef`, `FEATURES: readonly FeatureDef[]`, `FEATURE_KEYS: readonly FeatureKey[]`, `parseOverrides(raw: string | null | undefined): Partial<Record<FeatureKey, boolean>>`, `resolveFeatures(overrides): Set<FeatureKey>`, `FEATURE_OFF_MESSAGE: string`, `FEATURES_SETTING_KEY = "features"`, `FEATURES_ONBOARDING_KEY = "features.onboarding"`.

- [ ] **Step 1: Write the failing test**

```ts
import { FEATURES, FEATURE_KEYS, parseOverrides, resolveFeatures } from "@/lib/features"

describe("features registry", () => {
  it("every parent/requires refers to a known key", () => {
    for (const f of FEATURES) {
      if (f.parent) expect(FEATURE_KEYS).toContain(f.parent)
      for (const r of f.requires ?? []) expect(FEATURE_KEYS).toContain(r)
    }
  })

  it("all features on with no overrides", () => {
    expect(resolveFeatures({}).size).toBe(FEATURE_KEYS.length)
  })

  it("explicit false turns a feature off", () => {
    expect(resolveFeatures({ events: false }).has("events")).toBe(false)
  })

  it("parent off turns children off even when child is explicitly on", () => {
    const on = resolveFeatures({ accounting: false, budget: true })
    expect(on.has("budget")).toBe(false)
    expect(on.has("invoices")).toBe(false)
  })

  it("requires: dues off when memberships off", () => {
    expect(resolveFeatures({ memberships: false }).has("dues")).toBe(false)
  })
})

describe("parseOverrides", () => {
  it("returns {} for null, empty and corrupt JSON", () => {
    expect(parseOverrides(null)).toEqual({})
    expect(parseOverrides("")).toEqual({})
    expect(parseOverrides("{not json")).toEqual({})
    expect(parseOverrides("[1,2]")).toEqual({})
  })

  it("keeps known boolean keys, drops unknown keys and non-booleans", () => {
    expect(parseOverrides('{"events":false,"bogus":false,"budget":"no"}')).toEqual({ events: false })
  })
})
```

- [ ] **Step 2: Run it — expect FAIL (module not found)**

Run: `npm test -- --testPathPatterns="features.test"`

- [ ] **Step 3: Implement**

```ts
/**
 * Feature registry — the single list of toggleable features. Pure and
 * client-safe (no DB): the server reader lives in featureFlags.ts.
 */
export const FEATURES_SETTING_KEY = "features"
export const FEATURES_ONBOARDING_KEY = "features.onboarding"
export const FEATURE_OFF_MESSAGE = "This feature is turned off. An admin can enable it in Settings → Features."

export type FeatureKey =
  | "celebrations" | "clearances" | "familyUpdates" | "memberships" | "welcomeLetter"
  | "sundaySchool" | "events" | "accounting"
  | "reconciliation" | "bankImport" | "pettyCash" | "dues" | "receipts" | "dgrReceipts" | "invoices" | "budget"

export type FeatureDef = {
  key: FeatureKey
  label: string
  description: string
  parent?: FeatureKey
  requires?: FeatureKey[]
  defaultOn: boolean
  /** Shown as a warning on the Features page when this feature has public links. */
  publicWarning?: string
}

export const FEATURES: readonly FeatureDef[] = [
  { key: "celebrations", label: "Birthdays & anniversaries", description: "Celebration lists, dashboard tiles and greeting emails.", defaultOn: true },
  { key: "clearances", label: "Child-safety clearances", description: "Track Working With Children checks and expiry digests.", defaultOn: true },
  { key: "familyUpdates", label: "Family self-updates", description: "Families update their own details via a private link.", defaultOn: true, publicWarning: "Existing update links will stop working." },
  { key: "memberships", label: "Membership forms", description: "Public membership application form and review inbox.", defaultOn: true, publicWarning: "The public membership form will stop working." },
  { key: "welcomeLetter", label: "Welcome letters", description: "Generate welcome letters for new families.", defaultOn: true },
  { key: "sundaySchool", label: "Sunday School", description: "Classes, teachers and attendance.", defaultOn: true },
  { key: "events", label: "Events", description: "Events, registrations, check-in and online payments.", defaultOn: true, publicWarning: "Public event pages and registration links will stop working." },
  { key: "accounting", label: "Accounting", description: "Transactions, accounts, funds and financial reports.", defaultOn: true },
  { key: "reconciliation", parent: "accounting", label: "Bank reconciliation", description: "Match transactions to bank statements.", defaultOn: true },
  { key: "bankImport", parent: "accounting", label: "Bank import", description: "Import bank statement PDFs/CSVs.", defaultOn: true },
  { key: "pettyCash", parent: "accounting", label: "Petty cash", description: "Petty cash sessions and counts.", defaultOn: true },
  { key: "dues", parent: "accounting", requires: ["memberships"], label: "Subscription dues", description: "Track member subscription dues.", defaultOn: true },
  { key: "receipts", parent: "accounting", label: "Giving receipts", description: "Email giving receipts and keep a send log.", defaultOn: true },
  { key: "dgrReceipts", parent: "accounting", label: "DGR receipts", description: "Tax-deductible (DGR) donation receipts.", defaultOn: true },
  { key: "invoices", parent: "accounting", label: "Invoices", description: "Invoices and customers.", defaultOn: true },
  { key: "budget", parent: "accounting", label: "Budget", description: "Annual budget and budget-vs-actual report.", defaultOn: true },
]

export const FEATURE_KEYS: readonly FeatureKey[] = FEATURES.map((f) => f.key)
const BY_KEY = new Map(FEATURES.map((f) => [f.key, f]))

/**
 * Parse the stored overrides JSON. Anything malformed falls back to {} (registry
 * defaults) — a bad row must never lock an admin out of the app.
 */
export function parseOverrides(raw: string | null | undefined): Partial<Record<FeatureKey, boolean>> {
  if (!raw) return {}
  let data: unknown
  try { data = JSON.parse(raw) } catch { return {} }
  if (!data || typeof data !== "object" || Array.isArray(data)) return {}
  const out: Partial<Record<FeatureKey, boolean>> = {}
  for (const [k, v] of Object.entries(data)) {
    if (BY_KEY.has(k as FeatureKey) && typeof v === "boolean") out[k as FeatureKey] = v
  }
  return out
}

/**
 * Resolve which features are on: own override ?? default, AND parent on, AND
 * every `requires` on.
 */
export function resolveFeatures(overrides: Partial<Record<FeatureKey, boolean>>): Set<FeatureKey> {
  const memo = new Map<FeatureKey, boolean>()
  const on = (key: FeatureKey): boolean => {
    const hit = memo.get(key)
    if (hit !== undefined) return hit
    const def = BY_KEY.get(key)!
    const v = (overrides[key] ?? def.defaultOn)
      && (!def.parent || on(def.parent))
      && (def.requires ?? []).every(on)
    memo.set(key, v)
    return v
  }
  return new Set(FEATURE_KEYS.filter(on))
}
```

- [ ] **Step 4: Run — expect PASS.** `npm test -- --testPathPatterns="features.test"`
- [ ] **Step 5: Commit** — `feat(features): add feature registry and resolver`

### Task 2: Server helpers

**Files:**
- Create: `src/lib/featureFlags.ts`
- Test: `src/lib/__tests__/featureFlags.test.ts`

**Interfaces:**
- Consumes: Task 1 exports.
- Produces: `getEnabledFeatures(): Promise<Set<FeatureKey>>` (React `cache`), `isFeatureOn(key): Promise<boolean>`, `requireFeature(key): Promise<void>` (calls `notFound()`), `featureGuard(key): Promise<{ error: string } | null>`, `skipIfFeatureOff<T>(key, fn: () => Promise<T>): Promise<T | { skipped: "feature off" }>`, `readRawOverrides(): Promise<Partial<Record<FeatureKey, boolean>>>`.

- [ ] **Step 1: Write the failing test**

```ts
jest.mock("server-only", () => ({}))
jest.mock("@/lib/prisma", () => ({ prisma: { appSetting: { findUnique: jest.fn() } } }))
jest.mock("next/navigation", () => ({ notFound: jest.fn(() => { throw new Error("NEXT_NOT_FOUND") }) }))

import { prisma } from "@/lib/prisma"
import { featureGuard, isFeatureOn, requireFeature, skipIfFeatureOff } from "@/lib/featureFlags"
import { FEATURE_OFF_MESSAGE } from "@/lib/features"

const findUnique = prisma.appSetting.findUnique as jest.Mock
const stored = (o: object | null) => findUnique.mockResolvedValue(o && { key: "features", value: JSON.stringify(o) })

beforeEach(() => findUnique.mockReset())

it("defaults on when no row", async () => {
  stored(null)
  expect(await isFeatureOn("events")).toBe(true)
})

it("requireFeature throws notFound when off", async () => {
  stored({ events: false })
  await expect(requireFeature("events")).rejects.toThrow("NEXT_NOT_FOUND")
})

it("featureGuard returns error result when off, null when on", async () => {
  stored({ budget: false })
  expect(await featureGuard("budget")).toEqual({ error: FEATURE_OFF_MESSAGE })
  expect(await featureGuard("events")).toBeNull()
})

it("skipIfFeatureOff does not call fn when off", async () => {
  stored({ events: false })
  const fn = jest.fn()
  expect(await skipIfFeatureOff("events", fn)).toEqual({ skipped: "feature off" })
  expect(fn).not.toHaveBeenCalled()
})
```

Note: React `cache` is a no-op outside a render, so each call re-reads — fine for tests.

- [ ] **Step 2: Run — expect FAIL.** `npm test -- --testPathPatterns="featureFlags.test"`
- [ ] **Step 3: Implement**

```ts
import "server-only"
import { cache } from "react"
import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import {
  FEATURES_SETTING_KEY, FEATURE_OFF_MESSAGE, parseOverrides, resolveFeatures, type FeatureKey,
} from "@/lib/features"

/** Stored overrides only (no defaults applied). Used by the Features page. */
export async function readRawOverrides(): Promise<Partial<Record<FeatureKey, boolean>>> {
  const row = await prisma.appSetting.findUnique({ where: { key: FEATURES_SETTING_KEY } })
  return parseOverrides(row?.value)
}

/** Enabled feature set, read once per request. */
export const getEnabledFeatures = cache(async (): Promise<Set<FeatureKey>> =>
  resolveFeatures(await readRawOverrides()))

/** True when `key` is on. */
export async function isFeatureOn(key: FeatureKey): Promise<boolean> {
  return (await getEnabledFeatures()).has(key)
}

/** Page/layout guard: 404 when the feature is off. */
export async function requireFeature(key: FeatureKey): Promise<void> {
  if (!(await isFeatureOn(key))) notFound()
}

/** Server Action guard: `{ error }` when off, else null. Call first, before auth/DB work. */
export async function featureGuard(key: FeatureKey): Promise<{ error: string } | null> {
  return (await isFeatureOn(key)) ? null : { error: FEATURE_OFF_MESSAGE }
}

/** Scheduler/cron wrapper: runs fn only when the feature is on. */
export async function skipIfFeatureOff<T>(key: FeatureKey, fn: () => Promise<T>): Promise<T | { skipped: "feature off" }> {
  return (await isFeatureOn(key)) ? fn() : { skipped: "feature off" }
}
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `feat(features): add server-side feature flag helpers`

### Task 3: Save action + Settings → Features page

**Files:**
- Create: `src/lib/actions/features.ts`, `src/app/(dashboard)/settings/features/page.tsx`, `src/components/settings/FeaturesForm.tsx`
- Modify: `src/components/layout/sidebar/navData.ts` (add "Features" link under Settings, `show: isAdmin`, icon `ToggleRight`), `src/app/(dashboard)/settings/page.tsx` (one-line link card "Choose features →")
- Test: `src/lib/actions/__tests__/features.test.ts`, `src/components/settings/__tests__/FeaturesForm.test.tsx`

**Interfaces:**
- Consumes: `readRawOverrides`, `FEATURES`, `resolveFeatures`, `FEATURES_SETTING_KEY`, `FEATURES_ONBOARDING_KEY`.
- Produces: `saveFeatures(overrides: Record<string, boolean>): Promise<ActionResultWithSuccess>`; `FeaturesForm({ initial: Partial<Record<FeatureKey, boolean>>, welcome?: boolean })`.

- [ ] **Step 1: Failing action tests** (mock `@/auth`, `@/lib/prisma`, `@/lib/audit`, `next/cache` as in `src/lib/actions/__tests__/settings*.test.ts`):

```ts
it("rejects non-admin", async () => {
  mockSession("PASTOR")
  expect(await saveFeatures({ events: false })).toEqual({ error: "Forbidden" })
  expect(prisma.appSetting.upsert).not.toHaveBeenCalled()
})

it("rejects unknown keys", async () => {
  mockSession("ADMIN")
  expect(await saveFeatures({ bogus: false } as never)).toEqual({ error: "Unknown feature: bogus" })
})

it("stores only overrides differing from default, audits, clears onboarding flag", async () => {
  mockSession("ADMIN")
  findUnique.mockResolvedValue(null)
  const res = await saveFeatures({ events: false, budget: true })
  expect(res).toEqual({ success: "Features saved" })
  expect(prisma.appSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({
    where: { key: "features" }, update: { value: '{"events":false}' },
  }))
  expect(prisma.appSetting.deleteMany).toHaveBeenCalledWith({ where: { key: "features.onboarding" } })
  expect(logAudit).toHaveBeenCalledWith("u1", "UPDATE_FEATURES", "AppSetting", "features",
    { before: {}, after: { events: false } })
})

it("blocked in demo mode", async () => { /* set DEMO_MODE=true → assertNotDemo result */ })
```

- [ ] **Step 2: Run — FAIL.** `npm test -- --testPathPatterns="actions/__tests__/features"`
- [ ] **Step 3: Implement action**

```ts
"use server"

import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { isAdmin } from "@/lib/roleGuard"
import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { revalidatePath } from "next/cache"
import { assertNotDemo } from "@/lib/demoMode"
import { readRawOverrides } from "@/lib/featureFlags"
import { FEATURES, FEATURES_ONBOARDING_KEY, FEATURES_SETTING_KEY, type FeatureKey } from "@/lib/features"
import type { ActionResultWithSuccess } from "./types"

const DEFAULTS = new Map(FEATURES.map((f) => [f.key, f.defaultOn]))

/**
 * Save the admin's feature choices. Stores only values that differ from the
 * registry default, so future default changes still reach untouched features.
 * Also completes first-run onboarding.
 */
export async function saveFeatures(input: Record<string, boolean>): Promise<ActionResultWithSuccess> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Forbidden" }

  const next: Partial<Record<FeatureKey, boolean>> = {}
  for (const [k, v] of Object.entries(input)) {
    if (!DEFAULTS.has(k as FeatureKey)) return { error: `Unknown feature: ${k}` }
    if (typeof v !== "boolean") return { error: `Invalid value for ${k}` }
    if (v !== DEFAULTS.get(k as FeatureKey)) next[k as FeatureKey] = v
  }
  const before = await readRawOverrides()
  const value = JSON.stringify(next)
  await prisma.$transaction([
    prisma.appSetting.upsert({ where: { key: FEATURES_SETTING_KEY }, create: { key: FEATURES_SETTING_KEY, value }, update: { value } }),
    prisma.appSetting.deleteMany({ where: { key: FEATURES_ONBOARDING_KEY } }),
  ])
  await logAudit(actorId(session), "UPDATE_FEATURES", "AppSetting", FEATURES_SETTING_KEY, { before, after: next })
  revalidatePath("/", "layout")
  return { success: "Features saved" }
}
```

(Adjust `actorId(session)` / `logAudit` metadata arg to the exact signatures at `src/lib/actor.ts` and `src/lib/audit.ts:5`; adjust test mocks accordingly.)

- [ ] **Step 4: Page** — `src/app/(dashboard)/settings/features/page.tsx`:

```tsx
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { isAdmin } from "@/lib/roleGuard"
import { readRawOverrides } from "@/lib/featureFlags"
import { FeaturesForm } from "@/components/settings/FeaturesForm"

export const dynamic = "force-dynamic"

/** Settings → Features: ADMIN picks which features this church uses. */
export default async function FeaturesPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) redirect("/")
  const [{ welcome }, initial] = await Promise.all([searchParams, readRawOverrides()])
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">Features</h1>
      <FeaturesForm initial={initial} welcome={welcome === "1"} />
    </div>
  )
}
```

- [ ] **Step 5: Form** — `FeaturesForm.tsx` (`"use client"`): local state `Record<FeatureKey, boolean>` initialised from `initial[k] ?? def.defaultOn`; derived `effective = resolveFeatures(state)`. Render top-level features as rows (shadcn `Switch` + label + description, full-width, `min-h-11` touch target); children indented under their parent (`pl-6`), switch `disabled` with helper text "Needs Accounting" / "Needs Membership forms" when the parent or a `requires` is not in `effective`. When a feature with `publicWarning` is toggled from on→off, show the warning inline (`text-amber-700`). `welcome` → banner at top: "Pick what your church needs. You can change this any time in Settings → Features." Save button calls `saveFeatures(state)` in `useTransition`, toast on result (use the toast helper the other settings forms use).

  Form test: renders all top-level labels; toggling Accounting off disables the Budget switch; Save calls `saveFeatures` with the state object; welcome banner shown only with `welcome`.

- [ ] **Step 6: Run tests — PASS.** `npm test -- --testPathPatterns="features"`
- [ ] **Step 7: Commit** — `feat(settings): add Settings → Features page`

### Task 4: Hide off features in nav and dashboard

**Files:**
- Modify: `src/components/layout/sidebar/navData.ts`, `src/components/layout/Sidebar.tsx`, `src/app/(dashboard)/layout.tsx`, `src/app/(dashboard)/page.tsx`
- Test: `src/components/layout/sidebar/__tests__/navData.test.ts` (extend if exists, else create)

**Interfaces:**
- Consumes: `getEnabledFeatures`, `FeatureKey`.
- Produces: `NavFlags.features: ReadonlySet<FeatureKey>`; `Sidebar` prop `features: FeatureKey[]` (array — Sets aren't serialisable across the server→client boundary).

- [ ] **Step 1: Failing test**

```ts
import { buildNavGroups, flattenNavItems } from "@/components/layout/sidebar/navData"
import { resolveFeatures } from "@/lib/features"

const base = { isAccounting: true, isAccountingViewer: true, isAdmin: true, isEditor: true, canUsers: true, canViewPeople: true, pendingUpdates: 0, verifyPending: 0, membershipPending: 0 }
const visible = (features: ReturnType<typeof resolveFeatures>) =>
  buildNavGroups({ ...base, features }).flatMap((g) => flattenNavItems(g.items)).filter((i) => i.show).map((i) => i.href)

it("hides events and budget when off", () => {
  const hrefs = visible(resolveFeatures({ events: false, budget: false }))
  expect(hrefs).not.toContain("/events")
  expect(hrefs).not.toContain("/accounting/budget")
  expect(hrefs).not.toContain("/accounting/reports/budget-vs-actual")
  expect(hrefs).toContain("/accounting/transactions")
})

it("accounting off hides the whole group", () => {
  expect(visible(resolveFeatures({ accounting: false })).some((h) => h.startsWith("/accounting"))).toBe(false)
})
```

- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** — in `buildNavGroups` add `const on = (k: FeatureKey) => flags.features.has(k)` and AND each item's `show` per the surface map, e.g. `show: canViewPeople && on("celebrations")` for Birthdays/Anniversaries, `isEditor && on("clearances")`, `canViewPeople && on("sundaySchool")`, `isEditor && on("familyUpdates")`, `isEditor && on("memberships")`, `isEditor && on("welcomeLetter")`, `canViewPeople && on("events")`; every accounting item `&& on("accounting")` plus its sub-key (Reconciliation + Reconciliation Report → `reconciliation`, Bank Import → `bankImport`, Petty Cash → `pettyCash`, Subscription Dues → `dues`, Send Receipts + Receipt Audit Log → `receipts`, DGR Receipts → `dgrReceipts`, Invoices + Customers → `invoices`, Budget + Budget vs Actual → `budget`).
- [ ] **Step 4: Wire through** — `layout.tsx`: add `getEnabledFeatures()` to the first `Promise.all`; skip `countPendingFamilyUpdates()` unless `familyUpdates` on and the membership count unless `memberships` on; pass `features={[...features]}` to `Sidebar`. `Sidebar.tsx`: new prop `features: FeatureKey[]`, `const featureSet = useMemo(() => new Set(features), [features])`, pass into `buildNavGroups` and the `useMemo` deps.
- [ ] **Step 5: Dashboard** — in `src/app/(dashboard)/page.tsx` fetch `getEnabledFeatures()` and wrap each widget + its query: `BirthdayWidget`/`AnniversaryWidget`/`MarriageAnniversaryWidget` → `celebrations`; upcoming-events tile → `events`; membership tile → `memberships`; family-updates tile → `familyUpdates`; account balances + giving trend → `accounting`; open petty cash tile → `pettyCash`. Skip the query, not just the render (`on("events") ? query() : Promise.resolve(null)`).
- [ ] **Step 6: Run nav + dashboard tests — PASS.** `npm test -- --testPathPatterns="navData|Sidebar|dashboard"`
- [ ] **Step 7: Commit** — `feat(features): hide off features in sidebar and dashboard`

### Task 5: Block pages and Server Actions

**Files:**
- Create: one `layout.tsx` per route segment in the surface map (e.g. `src/app/(dashboard)/events/layout.tsx`)
- Modify: every action file in the surface map
- Test: `src/lib/__tests__/featureGuards.test.ts` (static coverage test) + one behaviour test per kind

**Interfaces:**
- Consumes: `requireFeature`, `featureGuard`.

- [ ] **Step 1: Write the static coverage test first (fails)** — guarantees no segment/action is missed and new ones get flagged:

```ts
import fs from "node:fs"
import path from "node:path"

// Segment → feature. Keep in sync with the plan's surface map.
const GUARDED_LAYOUTS: Record<string, string> = {
  "src/app/(dashboard)/events/layout.tsx": "events",
  "src/app/(organiser)/my-events/layout.tsx": "events",
  "src/app/(public)/e/layout.tsx": "events",
  "src/app/(dashboard)/memberships/layout.tsx": "memberships",
  "src/app/(public)/membershipform/layout.tsx": "memberships",
  "src/app/(dashboard)/sunday-school/layout.tsx": "sundaySchool",
  "src/app/(organiser)/my-classes/layout.tsx": "sundaySchool",
  "src/app/(dashboard)/welcome-letter/layout.tsx": "welcomeLetter",
  "src/app/(dashboard)/people/clearances/layout.tsx": "clearances",
  "src/app/(dashboard)/people/birthdays/layout.tsx": "celebrations",
  "src/app/(dashboard)/people/anniversaries/layout.tsx": "celebrations",
  "src/app/(dashboard)/families/updates/layout.tsx": "familyUpdates",
  "src/app/(public)/family/layout.tsx": "familyUpdates",
  "src/app/(dashboard)/accounting/layout.tsx": "accounting",
  "src/app/(dashboard)/accounting/reconciliation/layout.tsx": "reconciliation",
  "src/app/(dashboard)/accounting/reports/reconciliation/layout.tsx": "reconciliation",
  "src/app/(dashboard)/accounting/import/layout.tsx": "bankImport",
  "src/app/(dashboard)/accounting/petty-cash/layout.tsx": "pettyCash",
  "src/app/(dashboard)/accounting/dues/layout.tsx": "dues",
  "src/app/(dashboard)/accounting/send-receipts/layout.tsx": "receipts",
  "src/app/(dashboard)/accounting/receipt-audit/layout.tsx": "receipts",
  "src/app/(dashboard)/accounting/dgr-receipts/layout.tsx": "dgrReceipts",
  "src/app/(dashboard)/accounting/invoices/layout.tsx": "invoices",
  "src/app/(dashboard)/accounting/customers/layout.tsx": "invoices",
  "src/app/(dashboard)/accounting/budget/layout.tsx": "budget",
  "src/app/(dashboard)/accounting/reports/budget-vs-actual/layout.tsx": "budget",
}

it.each(Object.entries(GUARDED_LAYOUTS))("%s calls requireFeature(%s)", (file, key) => {
  const src = fs.readFileSync(path.join(process.cwd(), file), "utf8")
  expect(src).toContain(`requireFeature("${key}")`)
})

// Action file → feature. Every exported async function must call featureGuard(key).
const GUARDED_ACTIONS: Record<string, string> = {
  "src/lib/actions/event.ts": "events",
  "src/lib/actions/eventForm.ts": "events",
  "src/lib/actions/registration.ts": "events",
  "src/lib/actions/waitlist.ts": "events",
  "src/lib/actions/eventCheckout.ts": "events",
  "src/lib/actions/eventAccess.ts": "events",
  "src/lib/actions/membership.ts": "memberships",
  "src/lib/actions/sundaySchool.ts": "sundaySchool",
  "src/lib/actions/sundaySchoolAttendance.ts": "sundaySchool",
  "src/lib/actions/clearance.ts": "clearances",
  "src/lib/actions/familyUpdate.ts": "familyUpdates",
  "src/lib/actions/birthday.ts": "celebrations",
  "src/lib/actions/anniversary.ts": "celebrations",
  "src/lib/actions/reconciliation.ts": "reconciliation",
  "src/lib/actions/invoice.ts": "invoices",
  "src/lib/actions/invoiceSend.ts": "invoices",
  "src/lib/actions/invoiceVoid.ts": "invoices",
  "src/lib/actions/invoicePayment.ts": "invoices",
  // + pettyCash*.ts → "pettyCash", budget + bank import action files (confirm names via ls)
}

it.each(Object.entries(GUARDED_ACTIONS))("%s: every exported action guards %s", (file, key) => {
  const src = fs.readFileSync(path.join(process.cwd(), file), "utf8")
  const exported = src.match(/export async function \w+/g) ?? []
  const guards = src.match(new RegExp(`featureGuard\\("${key}"\\)`, "g")) ?? []
  expect(guards.length).toBeGreaterThanOrEqual(exported.length)
})
```

Before writing the test, run `ls src/lib/actions | grep -iE "petty|budget|import|bank"` and add those files to `GUARDED_ACTIONS`. Accounting-wide action files (`transaction.ts`, `account.ts`, `accountGroup.ts`, `fund.ts`) guard `"accounting"`. For `receipt.ts`, guard each export with `receipts` or `dgrReceipts` as appropriate and exclude it from the count-based check (assert per-function names instead).

- [ ] **Step 2: Run — FAIL.** `npm test -- --testPathPatterns="featureGuards"`
- [ ] **Step 3: Add layouts** — every file follows the same shape (only the key changes):

```tsx
import { requireFeature } from "@/lib/featureFlags"

/** Blocks this segment when the events feature is off. */
export default async function EventsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireFeature("events")
  return children
}
```

If a segment already has a `layout.tsx`, add the `await requireFeature(...)` line at the top of the existing component instead.

- [ ] **Step 4: Guard actions** — first line inside each exported action, before `auth()`:

```ts
const off = await featureGuard("events")
if (off) return off
```

For actions whose return type isn't `ActionResult`-compatible (e.g. returns data or `{ success: true }` unions), widen the return type with `| { error: string }` and check the caller handles `error` (most already do). Public registration actions (`registration.ts`, `waitlist.ts`, `eventCheckout.ts`) are included.

- [ ] **Step 5: Behaviour tests** — one each: render `EventsLayout` with `features` stored `{events:false}` → throws `NEXT_NOT_FOUND`; call one events action (pick the simplest existing tested one, reuse its test's mocks) with events off → `{ error: FEATURE_OFF_MESSAGE }` and Prisma not called.
- [ ] **Step 6: Run full touched suites — PASS.** `npm test -- --testPathPatterns="featureGuards|event|membership|sundaySchool|clearance|familyUpdate|birthday|anniversary|invoice|pettyCash|reconciliation|budget"` (existing action tests mock Prisma's `appSetting.findUnique` only sometimes — where an existing test breaks because `findUnique` isn't mocked, add `jest.mock("@/lib/featureFlags", () => ({ featureGuard: jest.fn().mockResolvedValue(null) }))` to that test file).
- [ ] **Step 7: Commit** — `feat(features): block pages and actions of off features`

### Task 6: Public API routes, Stripe webhook, scheduler

**Files:**
- Modify: `src/app/api/events/[slug]/*/route.ts`, `src/app/api/welcome-letter/preview/route.ts`, `src/app/api/people/[id]/clearances*/route.ts`, `src/app/api/clearances/export/route.ts`, `src/app/api/accounting/**/route.ts`, `src/app/api/import/bank-statement*/route.ts`, `src/app/api/cron/{send-reminders,send-celebrations,send-clearance-digest}/route.ts`, `src/app/api/stripe/webhook/route.ts`, website event sync entry (grep `event-webhook` / `docs/event-webhook.md`), `src/lib/schedulerRunner.ts`
- Test: `src/lib/__tests__/schedulerRunner.test.ts` (extend), one route test

- [ ] **Step 1: Failing scheduler test** — with `DEFAULT_JOBS` exported (add `export`), mock `@/lib/featureFlags` so `isFeatureOn("events")` → false; call `DEFAULT_JOBS.reminders(now)`; expect `{ skipped: "feature off" }` and `@/lib/reminderSweep` not imported/called. Same for `celebrations` and `clearanceDigest`.
- [ ] **Step 2: Implement scheduler** — wrap entries:

```ts
const gated = (key: FeatureKey, fn: Jobs[JobName]): Jobs[JobName] => async (now) =>
  (await import("@/lib/featureFlags")).skipIfFeatureOff(key, () => fn(now))

export const DEFAULT_JOBS: Jobs = {
  reminders: gated("events", async (now) => (await import("@/lib/reminderSweep")).runReminderSweep(now)),
  checkouts: gated("events", async () => (await import("@/lib/checkoutSweep")).sweepExpiredCheckouts()),
  celebrations: gated("celebrations", async (now) => (await import("@/lib/celebrationSweep")).runCelebrationSweep(now)),
  errorDigest: async (now) => (await import("@/lib/errorDigest")).runErrorDigestOncePerWeek(now),
  clearanceDigest: gated("clearances", async (now) => (await import("@/lib/clearanceDigest")).runClearanceDigest(now)),
}
```

`countsOnly` drops the string so logs show `result: {}` — acceptable; the job is recorded as a success for the period, which is correct (nothing to do).

Note: `checkouts` releases expired held seats — if events was turned off mid-checkout those seats stay held until events is turned back on, then the sweep runs. Acceptable (data kept).

- [ ] **Step 3: API routes** — first lines of each handler, after the method's existing rate-limit/auth only if those must still run (otherwise first):

```ts
if (!(await isFeatureOn("events"))) return new Response("Not found", { status: 404 })
```

Cron routes: return `Response.json({ skipped: "feature off" })` with 200 (external cron must not alert).

- [ ] **Step 4: Stripe webhook** — after signature verification, for event-registration checkout events: `if (!(await isFeatureOn("events"))) return Response.json({ received: true, skipped: "feature off" })`. Signature verification still runs first. Add a test case to the existing webhook test.
- [ ] **Step 5: Run — PASS.** `npm test -- --testPathPatterns="schedulerRunner|webhook|cron|api/events"`
- [ ] **Step 6: Commit** — `feat(features): skip jobs and public endpoints of off features`

### Task 7: Settings sub-sections + docs, then PR

**Files:**
- Modify: `src/app/(dashboard)/settings/page.tsx` — hide `BirthdayEmailForm`, `AnniversaryEmailForm`, `AutoEmailToggles` when `celebrations` off; `LetterSettingsForm` when `welcomeLetter` off; `MembershipSettingsForm` when `memberships` off; `ReceiptSettingsSection` when `receipts` and `dgrReceipts` both off.
- Create: `website/src/content/docs/docs/features.md` (match frontmatter of a sibling page)
- Modify: `README.md` (features section: one line "Turn on only what you need — Settings → Features")

- [ ] **Step 1:** Implement the settings section gating (`getEnabledFeatures()` in the page's existing `Promise.all`).
- [ ] **Step 2:** Docs page: what Features does, the list (label + description, generated by hand from `FEATURES`), "turning a feature off hides it and blocks it; your data is kept", public-link warnings, "only admins can change this".
- [ ] **Step 3:** Run `npm test -- --testPathPatterns="settings"` + `npm run lint`.
- [ ] **Step 4:** Manual check via `/run` or `/qa`: toggle Events off → sidebar loses Events, `/events` 404s, `/e/<slug>` 404s; toggle Accounting off → Budget switch greyed; 375px and 1920px screenshots of the Features page.
- [ ] **Step 5: Commit** — `docs(features): document Settings → Features`
- [ ] **Step 6: PR** — title `feat(settings): choose which features your church uses`. Body links spec + plan + closes OSS-309 (#309) issue. Add to board. Risk class: ≥150 logic lines → wait for CodeRabbit per merge gate.

---

# PR 2 — first-run prompt

Branch: `feat/feature-onboarding` (after PR 1 merges). Card: OSS-310 (#310).

### Task 8: Onboarding flag + redirect

**Files:**
- Modify: `src/lib/actions/setup.ts`, `src/app/(dashboard)/layout.tsx`, `src/components/settings/FeaturesForm.tsx`
- Create: `finishFeatureOnboarding` in `src/lib/actions/features.ts`
- Test: `src/lib/actions/__tests__/setup.test.ts` (extend), `src/app/(dashboard)/__tests__/layout.test.tsx` (extend or create), `src/lib/actions/__tests__/features.test.ts` (extend)

**Interfaces:**
- Consumes: `FEATURES_ONBOARDING_KEY`, `saveFeatures` (already deletes the flag).
- Produces: `finishFeatureOnboarding(): Promise<ActionResultWithSuccess>` (ADMIN; deletes the flag without changing overrides — the "Keep defaults" button).

- [ ] **Step 1: Failing tests**
  - setup: successful `createFirstAdmin` creates `AppSetting { key: "features.onboarding", value: "pending" }` inside the same transaction as the user insert.
  - layout: ADMIN + flag `pending` + current path not `/settings/features` → `redirect("/settings/features?welcome=1")`; non-ADMIN or no flag → no redirect; `DEMO_MODE=true` → no redirect.
  - `finishFeatureOnboarding`: non-admin → Forbidden; admin → `deleteMany` on the flag, audited `FINISH_FEATURE_ONBOARDING`.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement setup** — inside the existing serializable `$transaction` after `tx.user.create`:

```ts
await tx.appSetting.upsert({
  where: { key: FEATURES_ONBOARDING_KEY },
  create: { key: FEATURES_ONBOARDING_KEY, value: "pending" },
  update: { value: "pending" },
})
```

(The callback returns the user — restructure to `const u = await tx.user.create(...); await tx.appSetting.upsert(...); return u`.)

- [ ] **Step 4: Implement redirect** — layout can't read the pathname directly; read it from the `x-pathname`-style header if middleware already sets one (grep `src/middleware.ts`), otherwise do the redirect in `src/app/(dashboard)/page.tsx` (the dashboard home, where a new admin lands after login) instead of the layout — simpler and avoids a redirect loop. Prefer the dashboard-home option; update the layout test target accordingly.

```ts
if (isAdmin(role) && !isDemoMode()) {
  const flag = await prisma.appSetting.findUnique({ where: { key: FEATURES_ONBOARDING_KEY } })
  if (flag?.value === "pending") redirect("/settings/features?welcome=1")
}
```

- [ ] **Step 5: Form** — when `welcome`, show a secondary "Keep defaults" button calling `finishFeatureOnboarding()` then `router.push("/")`; Save also `router.push("/")` when `welcome`.
- [ ] **Step 6: Run — PASS.** `npm test -- --testPathPatterns="setup|features|dashboard"` + lint.
- [ ] **Step 7: Docs** — add "First-time setup asks you to pick features" to `website/src/content/docs/docs/features.md` and the self-hosting first-run section in `docs/self-hosting.md`.
- [ ] **Step 8: Commit + PR** — `feat(setup): ask new churches which features they need`. Touches setup (auth-adjacent) → risky class → wait for CodeRabbit.

---

## Self-review notes

- Spec coverage: registry ✔ T1; storage/resolution ✔ T1–2; helpers ✔ T2; nav/dashboard ✔ T4; pages/actions ✔ T5; public/API/Stripe/scheduler/cron ✔ T6; settings sub-sections + docs ✔ T7; Features page + audit ✔ T3; first-run ✔ T8; corrupt JSON ✔ T1; public-link warning ✔ T3; DEMO_MODE ✔ T3/T8.
- St Mark prod: no `features` row → identical behaviour; no migration, no new env → safe auto-upgrade.
