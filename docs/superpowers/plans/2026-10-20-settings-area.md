# Settings Area Redesign (OSS-315) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge App Settings (`/settings`) and Accounting Settings (`/accounting/settings`) into one `/settings` area with a left tab list, one page per tab, each a MoneyMatter-style card of label/description/control rows.

**Architecture:** `src/app/(dashboard)/settings/layout.tsx` (server) builds the visible tab list from `getEnabledFeatures()` via a pure `buildSettingsTabs()` and renders a client `<SettingsTabs>` (sticky list on md+, `Select` below md) inside an `UnsavedChangesProvider`. Each tab is its own page that calls `requireSettingsTab(href)` (admin + tab-visible check) and fetches only its own data. Existing forms keep their actions; only markup moves into new `SettingsCard` / `SettingsRow` / `SettingsSubgroup` building blocks.

**Tech Stack:** Next.js 16 App Router (server components + Server Actions), React 19, Tailwind, shadcn/Radix (`Select`, `Switch`, `Label`), Jest 30 + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-20-settings-area-design.md`

## Global Constraints

- No change to any Server Action's logic, validation or auth. Only `revalidatePath` strings change.
- No new settings.
- `/users` and `/verify` stay where they are.
- Both guard layers: `settings/layout.tsx` redirects non-admins to `/`, **and** every page calls `requireSettingsTab` (layouts don't re-run on client navigation between siblings). Server Actions keep their guards.
- A hidden (feature-off) tab's route redirects to `/settings`.
- Many users are on phones: verify every tab at **375px** and **≥1920px**. Below `md` the tab list is a full-width `Select` labelled "Settings section".
- JSDoc on every new or changed function, exported or not.
- Money rule unchanged: no `parseFloat`/`Number()` on money anywhere.
- Tests live in both `src/**/__tests__/` and root `__tests__/`. Pre-push: run the touched suites by basename (`npm test -- --testPathPatterns="settings"`) plus `npm run lint`. No local `npm run build` (CI builds).
- Feature/behaviour PR: update website docs (`website/src/content/docs/docs/`) and stale README claims in the same PR.
- Branch `feat/settings-area` off `main` (after #365 merges). Two PRs:
  - **PR1** (Tasks 1–8): area, layout, building blocks, guard, Church + System tabs, sidebar/checklist links, docs. Tab list has **no Accounting group** (its routes don't exist yet).
  - **PR2** (Tasks 9–13): Accounting tabs, funds move, `next.config` redirects, old-route removal, link updates, docs. Stack PR2 on PR1, rebase `--onto main` after PR1 merges.

## File Structure

**New (PR1)**
- `src/components/settings/settingsTabs.ts`: pure tab definitions, `buildSettingsTabs`, `activeSettingsHref`.
- `src/components/settings/unsavedChanges.tsx`: `UnsavedChangesProvider`, `useUnsavedChanges`, `useUnsavedGuard`, `useFormDirty`.
- `src/components/settings/SettingsTabs.tsx`: client tab list (desktop nav + mobile Select).
- `src/components/settings/ui/SettingsCard.tsx`, `SettingsRow.tsx`, `SettingsSubgroup.tsx`: building blocks.
- `src/lib/settingsAccess.ts`: `requireSettingsTab(href)`.
- `src/app/(dashboard)/settings/layout.tsx`
- `src/app/(dashboard)/settings/{branding,email,members,receipts,security,about}/page.tsx`
- Tests next to each in `__tests__/`.

**New (PR2)**
- `src/app/(dashboard)/settings/accounting/{page.tsx, accounts/, period-lock/, petty-cash/, invoices/}`
- `src/app/(dashboard)/settings/accounting/funds/**` (moved from `accounting/settings/funds/**`)
- `redirects.mjs` (repo root): `legacyRedirects` list imported by `next.config.mjs`.

**Modified:** `settings/page.tsx` (becomes General), `settings/features|audit-log|usage/page.tsx`, the settings form components, `src/lib/actions/{branding,emailTemplates,receiptSettings,settings,paymentAccount,invoiceSettings,accountingSettings,fund}.ts` (revalidate strings only), `src/components/layout/sidebar/navData.ts`, `src/lib/setupChecklist.ts`, accounting report/reconciliation/petty-cash/dashboard links, `next.config.mjs`, docs.

**Deleted:** `src/components/settings/SettingsNav.tsx` + `__tests__/SettingsNav.test.tsx` (PR1); `src/app/(dashboard)/accounting/settings/**` (PR2).

---

# PR1: settings area, Church + System tabs

### Task 1: Tab model (`settingsTabs.ts`)

**Files:**
- Create: `src/components/settings/settingsTabs.ts`
- Test: `src/components/settings/__tests__/settingsTabs.test.ts`

**Interfaces:**
- Produces:
  - `type SettingsTab = Readonly<{ href: string; label: string }>`
  - `type SettingsTabGroup = Readonly<{ label: string; tabs: readonly SettingsTab[] }>`
  - `buildSettingsTabs(features: ReadonlySet<FeatureKey>): SettingsTabGroup[]`
  - `activeSettingsHref(pathname: string, hrefs: readonly string[]): string | null`
  - `isSettingsTabVisible(href: string, features: ReadonlySet<FeatureKey>): boolean`

- [ ] **Step 1: Write the failing test**

```ts
import { activeSettingsHref, buildSettingsTabs, isSettingsTabVisible } from "../settingsTabs"
import type { FeatureKey } from "@/lib/features"

const on = (...keys: FeatureKey[]) => new Set<FeatureKey>(keys)
const hrefs = (features: Set<FeatureKey>) => buildSettingsTabs(features).flatMap((g) => g.tabs.map((t) => t.href))

describe("buildSettingsTabs", () => {
  it("lists groups in order: Church, System", () => {
    expect(buildSettingsTabs(on()).map((g) => g.label)).toEqual(["Church", "System"])
  })

  it("shows the always-on tabs with no features", () => {
    expect(hrefs(on())).toEqual([
      "/settings", "/settings/branding", "/settings/email", "/settings/features",
      "/settings/security", "/settings/audit-log", "/settings/usage", "/settings/about",
    ])
  })

  it.each<[FeatureKey]>([["welcomeLetter"], ["memberships"]])("shows Members when %s is on", (k) => {
    expect(hrefs(on(k))).toContain("/settings/members")
  })

  it.each<[FeatureKey]>([["receipts"], ["dgrReceipts"]])("shows Receipts when %s is on", (k) => {
    expect(hrefs(on(k))).toContain("/settings/receipts")
  })

  it("hides Members and Receipts when their features are off", () => {
    expect(hrefs(on("events"))).not.toEqual(expect.arrayContaining(["/settings/members"]))
    expect(hrefs(on("events"))).not.toEqual(expect.arrayContaining(["/settings/receipts"]))
  })
})

describe("isSettingsTabVisible", () => {
  it("is false for a feature-off tab and for unknown hrefs", () => {
    expect(isSettingsTabVisible("/settings/members", on())).toBe(false)
    expect(isSettingsTabVisible("/settings/nope", on())).toBe(false)
  })
  it("is true for a shown tab", () => {
    expect(isSettingsTabVisible("/settings/members", on("memberships"))).toBe(true)
  })
})

describe("activeSettingsHref", () => {
  const all = ["/settings", "/settings/branding", "/settings/audit-log"]
  it("matches exactly", () => expect(activeSettingsHref("/settings", all)).toBe("/settings"))
  it("picks the longest separator-bounded prefix", () => {
    expect(activeSettingsHref("/settings/branding", all)).toBe("/settings/branding")
    expect(activeSettingsHref("/settings/audit-log/123", all)).toBe("/settings/audit-log")
  })
  it("does not match a non-separator prefix", () => {
    expect(activeSettingsHref("/settings/brandingx", ["/settings/branding"])).toBeNull()
  })
  it("returns null outside the area", () => expect(activeSettingsHref("/users", all)).toBeNull())
})
```

- [ ] **Step 2: Run, expect FAIL** ("Cannot find module '../settingsTabs'")

Run: `npm test -- --testPathPatterns="settingsTabs"`

- [ ] **Step 3: Implement**

```ts
import type { FeatureKey } from "@/lib/features"

export type SettingsTab = Readonly<{ href: string; label: string }>
export type SettingsTabGroup = Readonly<{ label: string; tabs: readonly SettingsTab[] }>

/** A tab, shown only when one of `anyOf` is on (always shown when omitted). */
type TabDef = SettingsTab & Readonly<{ anyOf?: readonly FeatureKey[] }>
/** A group; `anyOf` gates every tab in it on top of each tab's own rule. */
type GroupDef = Readonly<{ label: string; anyOf?: readonly FeatureKey[]; tabs: readonly TabDef[] }>

const GROUPS: readonly GroupDef[] = [
  {
    label: "Church",
    tabs: [
      { href: "/settings", label: "General" },
      { href: "/settings/branding", label: "Branding" },
      { href: "/settings/email", label: "Email" },
      { href: "/settings/members", label: "Members", anyOf: ["welcomeLetter", "memberships"] },
      { href: "/settings/receipts", label: "Receipts", anyOf: ["receipts", "dgrReceipts"] },
      { href: "/settings/features", label: "Features" },
    ],
  },
  {
    label: "System",
    tabs: [
      { href: "/settings/security", label: "Security" },
      { href: "/settings/audit-log", label: "Audit Log" },
      { href: "/settings/usage", label: "App Usage" },
      { href: "/settings/about", label: "About" },
    ],
  },
]

/**
 * True when `anyOf` is unset or at least one of its features is on.
 * @param anyOf features of which one must be on
 * @param features enabled features
 */
function shown(anyOf: readonly FeatureKey[] | undefined, features: ReadonlySet<FeatureKey>): boolean {
  return !anyOf || anyOf.some((k) => features.has(k))
}

/**
 * Visible settings tabs, grouped, for the enabled features. Empty groups are dropped.
 * @param features enabled features (from `getEnabledFeatures()`)
 */
export function buildSettingsTabs(features: ReadonlySet<FeatureKey>): SettingsTabGroup[] {
  return GROUPS.filter((g) => shown(g.anyOf, features))
    .map((g) => ({
      label: g.label,
      tabs: g.tabs.filter((t) => shown(t.anyOf, features)).map(({ href, label }) => ({ href, label })),
    }))
    .filter((g) => g.tabs.length > 0)
}

/**
 * Whether the tab at `href` is visible for these features.
 * @param href tab href exactly as defined (e.g. "/settings/members")
 * @param features enabled features
 */
export function isSettingsTabVisible(href: string, features: ReadonlySet<FeatureKey>): boolean {
  return buildSettingsTabs(features).some((g) => g.tabs.some((t) => t.href === href))
}

/**
 * The tab href to highlight: the longest href that equals `pathname` or is a
 * "/"-bounded prefix of it (same rule as the sidebar), so nested pages such as
 * "/settings/audit-log/123" highlight their parent tab.
 * @param pathname current pathname
 * @param hrefs candidate tab hrefs
 */
export function activeSettingsHref(pathname: string, hrefs: readonly string[]): string | null {
  let best: string | null = null
  for (const h of hrefs) {
    const hit = pathname === h || pathname.startsWith(`${h}/`)
    if (hit && (best === null || h.length > best.length)) best = h
  }
  return best
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `npm test -- --testPathPatterns="settingsTabs"`

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/settingsTabs.ts src/components/settings/__tests__/settingsTabs.test.ts
git commit -m "feat(settings): tab model for the settings area"
```

---

### Task 2: Unsaved-changes guard (`unsavedChanges.tsx`)

**Files:**
- Create: `src/components/settings/unsavedChanges.tsx`
- Test: `src/components/settings/__tests__/unsavedChanges.test.tsx`

**Interfaces:**
- Produces:
  - `UnsavedChangesProvider({ children })`: client context provider.
  - `useUnsavedChanges(): { hasUnsaved: () => boolean }`
  - `useUnsavedGuard(dirty: boolean): void`: registers dirty state and sets `beforeunload` while dirty.
  - `useFormDirty(): { ref: (form: HTMLFormElement | null) => void | (() => void); dirty: boolean }`: FormData snapshot vs initial; calls `useUnsavedGuard` itself.
  - `DISCARD_PROMPT = "Discard unsaved changes?"`

- [ ] **Step 1: Write the failing test**

```tsx
import { act, fireEvent, render, screen } from "@testing-library/react"
import { UnsavedChangesProvider, useFormDirty, useUnsavedChanges, useUnsavedGuard } from "../unsavedChanges"

let probe: () => boolean = () => false
/** Exposes hasUnsaved() to the test. */
function Probe() {
  probe = useUnsavedChanges().hasUnsaved
  return null
}
/** A guard driven by a prop. */
function Guarded({ dirty }: { dirty: boolean }) {
  useUnsavedGuard(dirty)
  return null
}
/** A plain form using useFormDirty. */
function DirtyForm() {
  const { ref, dirty } = useFormDirty()
  return (
    <form ref={ref} onSubmit={(e) => e.preventDefault()}>
      <input aria-label="Name" name="name" defaultValue="a" />
      <button type="submit">Save</button>
      <output>{dirty ? "dirty" : "clean"}</output>
    </form>
  )
}

it("tracks registered dirty state and clears it on unmount", () => {
  const { rerender, unmount } = render(<UnsavedChangesProvider><Probe /><Guarded dirty={false} /></UnsavedChangesProvider>)
  expect(probe()).toBe(false)
  rerender(<UnsavedChangesProvider><Probe /><Guarded dirty /></UnsavedChangesProvider>)
  expect(probe()).toBe(true)
  rerender(<UnsavedChangesProvider><Probe /></UnsavedChangesProvider>)
  expect(probe()).toBe(false)
  unmount()
})

it("sets beforeunload only while dirty", () => {
  const add = jest.spyOn(window, "addEventListener")
  const { rerender } = render(<UnsavedChangesProvider><Guarded dirty={false} /></UnsavedChangesProvider>)
  expect(add).not.toHaveBeenCalledWith("beforeunload", expect.any(Function))
  rerender(<UnsavedChangesProvider><Guarded dirty /></UnsavedChangesProvider>)
  expect(add).toHaveBeenCalledWith("beforeunload", expect.any(Function))
  add.mockRestore()
})

it("useFormDirty: dirty after an edit, clean when reverted or submitted", () => {
  render(<UnsavedChangesProvider><Probe /><DirtyForm /></UnsavedChangesProvider>)
  const input = screen.getByLabelText("Name")
  expect(screen.getByText("clean")).toBeInTheDocument()
  fireEvent.input(input, { target: { value: "b" } })
  expect(screen.getByText("dirty")).toBeInTheDocument()
  expect(probe()).toBe(true)
  fireEvent.input(input, { target: { value: "a" } })
  expect(screen.getByText("clean")).toBeInTheDocument()
  fireEvent.input(input, { target: { value: "c" } })
  act(() => { fireEvent.submit(input.closest("form")!) })
  expect(screen.getByText("clean")).toBeInTheDocument()
})

it("works without a provider (hasUnsaved is false)", () => {
  render(<Probe />)
  expect(probe()).toBe(false)
})
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npm test -- --testPathPatterns="unsavedChanges"`

- [ ] **Step 3: Implement**

```tsx
"use client"

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react"

export const DISCARD_PROMPT = "Discard unsaved changes?"

type Registry = Readonly<{ set: (id: string, dirty: boolean) => void; hasUnsaved: () => boolean }>
const UnsavedContext = createContext<Registry | null>(null)

/**
 * Holds which settings forms on the current page have unsaved edits, so the
 * tab list can confirm before navigating away.
 * @param props.children settings tabs + page
 */
export function UnsavedChangesProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const dirtyIds = useRef(new Set<string>())
  const value = useMemo<Registry>(
    () => ({
      set: (id, dirty) => {
        if (dirty) dirtyIds.current.add(id)
        else dirtyIds.current.delete(id)
      },
      hasUnsaved: () => dirtyIds.current.size > 0,
    }),
    [],
  )
  return <UnsavedContext.Provider value={value}>{children}</UnsavedContext.Provider>
}

/** Read side for the tab list: `hasUnsaved()` is false outside a provider. */
export function useUnsavedChanges(): Readonly<{ hasUnsaved: () => boolean }> {
  const ctx = useContext(UnsavedContext)
  return { hasUnsaved: ctx?.hasUnsaved ?? (() => false) }
}

/**
 * Registers this form's dirty state and, while dirty, asks the browser to
 * confirm reloads/closes (`beforeunload`). Unregisters on unmount.
 * @param dirty whether the form has unsaved edits
 */
export function useUnsavedGuard(dirty: boolean): void {
  const ctx = useContext(UnsavedContext)
  const id = useId()
  useEffect(() => {
    ctx?.set(id, dirty)
    return () => ctx?.set(id, false)
  }, [ctx, id, dirty])
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [dirty])
}

/**
 * Serialised form values for comparison (files compare by name).
 * @param form the form element
 */
function snapshot(form: HTMLFormElement): string {
  return JSON.stringify([...new FormData(form)].map(([k, v]) => [k, typeof v === "string" ? v : v.name]))
}

/**
 * Dirty tracking for an uncontrolled `<form>`: compares current values to the
 * values when the form mounted. A submit re-baselines (optimistic). A remount
 * (the forms' `key` changes after revalidation) takes a fresh baseline.
 * Attach `ref` to the `<form>`.
 */
export function useFormDirty(): { ref: (form: HTMLFormElement | null) => void | (() => void); dirty: boolean } {
  const [dirty, setDirty] = useState(false)
  useUnsavedGuard(dirty)
  const ref = useCallback((form: HTMLFormElement | null) => {
    if (!form) return
    let initial = snapshot(form)
    setDirty(false)
    const check = () => setDirty(snapshot(form) !== initial)
    const saved = () => {
      initial = snapshot(form)
      setDirty(false)
    }
    form.addEventListener("input", check)
    form.addEventListener("change", check)
    form.addEventListener("submit", saved)
    return () => {
      form.removeEventListener("input", check)
      form.removeEventListener("change", check)
      form.removeEventListener("submit", saved)
    }
  }, [])
  return { ref, dirty }
}
```

For forms that keep values in React state (no `<form>` values to snapshot), compare state with the initial props:

```tsx
useUnsavedGuard(JSON.stringify(fields) !== JSON.stringify(initialFields))
```

- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit**: `git commit -m "feat(settings): unsaved-changes guard"`

---

### Task 3: Tab list component (`SettingsTabs.tsx`)

**Files:**
- Create: `src/components/settings/SettingsTabs.tsx`
- Test: `src/components/settings/__tests__/SettingsTabs.test.tsx`

**Interfaces:**
- Consumes: `SettingsTabGroup`, `activeSettingsHref` (Task 1); `useUnsavedChanges`, `DISCARD_PROMPT` (Task 2).
- Produces: `SettingsTabs({ groups }: { groups: readonly SettingsTabGroup[] })`.

- [ ] **Step 1: Write the failing test**

Radix `Select` doesn't open in jsdom, so the test swaps it for a native `<select>` stub that keeps the same `value`/`onValueChange` contract.

```tsx
import { fireEvent, render, screen, within } from "@testing-library/react"
import { SettingsTabs } from "../SettingsTabs"
import { UnsavedChangesProvider, useUnsavedGuard } from "../unsavedChanges"

const push = jest.fn()
let pathname = "/settings"
jest.mock("next/navigation", () => ({ usePathname: () => pathname, useRouter: () => ({ push }) }))
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))
jest.mock("@/components/ui/select", () => {
  const Ctx = require("react").createContext({}) as React.Context<{ onValueChange?: (v: string) => void; value?: string }>
  return {
    Select: ({ value, onValueChange, children }: { value?: string; onValueChange: (v: string) => void; children: React.ReactNode }) => (
      <Ctx.Provider value={{ value, onValueChange }}>{children}</Ctx.Provider>
    ),
    SelectTrigger: ({ children, ...p }: { children: React.ReactNode }) => <div {...p}>{children}</div>,
    SelectValue: () => null,
    SelectContent: ({ children }: { children: React.ReactNode }) => {
      const { value, onValueChange } = require("react").useContext(Ctx)
      return <select aria-label="Settings section" value={value} onChange={(e) => onValueChange?.(e.target.value)}>{children}</select>
    },
    SelectGroup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    SelectLabel: () => null,
    SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
  }
})

const groups = [
  { label: "Church", tabs: [{ href: "/settings", label: "General" }, { href: "/settings/branding", label: "Branding" }] },
  { label: "System", tabs: [{ href: "/settings/audit-log", label: "Audit Log" }] },
]

/** Marks the page dirty. */
function Dirty() {
  useUnsavedGuard(true)
  return null
}

const nav = () => screen.getByRole("navigation", { name: "Settings sections" })

beforeEach(() => {
  push.mockReset()
  pathname = "/settings"
})

it("renders group captions and marks the active tab", () => {
  pathname = "/settings/audit-log/42"
  render(<SettingsTabs groups={groups} />)
  expect(screen.getByText("Church")).toBeInTheDocument()
  expect(screen.getByRole("link", { name: "Audit Log" })).toHaveAttribute("aria-current", "page")
  expect(screen.getByRole("link", { name: "General" })).not.toHaveAttribute("aria-current")
})

it("mobile select navigates with router.push", () => {
  render(<SettingsTabs groups={groups} />)
  fireEvent.change(screen.getByLabelText("Settings section"), { target: { value: "/settings/branding" } })
  expect(push).toHaveBeenCalledWith("/settings/branding")
})

describe("dirty guard", () => {
  const confirm = jest.spyOn(window, "confirm")
  afterEach(() => confirm.mockReset())

  it("blocks a desktop link click when the user cancels", () => {
    confirm.mockReturnValue(false)
    render(<UnsavedChangesProvider><SettingsTabs groups={groups} /><Dirty /></UnsavedChangesProvider>)
    const link = screen.getByRole("link", { name: "Branding" })
    const event = new MouseEvent("click", { bubbles: true, cancelable: true })
    link.dispatchEvent(event)
    expect(confirm).toHaveBeenCalledWith("Discard unsaved changes?")
    expect(event.defaultPrevented).toBe(true)
  })

  it("blocks a mobile select change when the user cancels, allows it on OK", () => {
    confirm.mockReturnValue(false)
    render(<UnsavedChangesProvider><SettingsTabs groups={groups} /><Dirty /></UnsavedChangesProvider>)
    const select = screen.getByLabelText("Settings section")
    fireEvent.change(select, { target: { value: "/settings/branding" } })
    expect(confirm).toHaveBeenCalledWith("Discard unsaved changes?")
    expect(push).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    fireEvent.change(select, { target: { value: "/settings/audit-log" } })
    expect(push).toHaveBeenCalledWith("/settings/audit-log")
  })

  it("does not ask when nothing is dirty", () => {
    render(<UnsavedChangesProvider><SettingsTabs groups={groups} /></UnsavedChangesProvider>)
    within(nav()).getByRole("link", { name: "Branding" }).click()
    expect(confirm).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npm test -- --testPathPatterns="SettingsTabs"`

- [ ] **Step 3: Implement**

```tsx
"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { activeSettingsHref, type SettingsTabGroup } from "./settingsTabs"
import { DISCARD_PROMPT, useUnsavedChanges } from "./unsavedChanges"

/**
 * Settings area tab list: a sticky grouped list on md+, a full-width Select
 * below md. Both paths go through one `confirmLeave`, so unsaved edits are
 * never dropped silently.
 * @param props.groups visible tab groups (from `buildSettingsTabs`)
 */
export function SettingsTabs({ groups }: Readonly<{ groups: readonly SettingsTabGroup[] }>) {
  const pathname = usePathname()
  const router = useRouter()
  const { hasUnsaved } = useUnsavedChanges()
  const active = activeSettingsHref(pathname, groups.flatMap((g) => g.tabs.map((t) => t.href)))

  /**
   * Confirms leaving the current tab if a form is dirty. With an event (link
   * click) it cancels the click on "Cancel"; without one (Select) it pushes.
   * @param href target tab
   * @param event the link click, when navigating by link
   */
  const confirmLeave = (href: string, event?: React.MouseEvent) => {
    if (href === active) return
    if (hasUnsaved() && !window.confirm(DISCARD_PROMPT)) {
      event?.preventDefault()
      return
    }
    if (!event) router.push(href)
  }

  return (
    <>
      <div className="md:hidden">
        <Select value={active ?? undefined} onValueChange={(href) => confirmLeave(href)}>
          <SelectTrigger aria-label="Settings section" className="w-full">
            <SelectValue placeholder="Settings section" />
          </SelectTrigger>
          <SelectContent>
            {groups.map((g) => (
              <SelectGroup key={g.label}>
                <SelectLabel>{g.label}</SelectLabel>
                {g.tabs.map((t) => (
                  <SelectItem key={t.href} value={t.href}>{t.label}</SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>
      <nav aria-label="Settings sections" className="sticky top-[4.5rem] hidden w-[220px] shrink-0 space-y-5 self-start md:block">
        {groups.map((g) => (
          <div key={g.label}>
            <p className="px-3 pb-1 text-xs uppercase text-muted-foreground">{g.label}</p>
            <ul className="space-y-0.5">
              {g.tabs.map((t) => {
                const isActive = t.href === active
                return (
                  <li key={t.href}>
                    <Link
                      href={t.href}
                      aria-current={isActive ? "page" : undefined}
                      onClick={(e) => confirmLeave(t.href, e)}
                      className={cn(
                        "block rounded-md px-3 py-2 text-sm",
                        isActive ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      {t.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>
    </>
  )
}
```

Check `cn` lives at `@/lib/utils` (`grep -n "export function cn" src/lib/utils.ts`). If it lives elsewhere, use that import.

- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit**: `git commit -m "feat(settings): tab list with mobile select and unsaved guard"`

---

### Task 4: Building blocks (`SettingsCard`, `SettingsRow`, `SettingsSubgroup`)

**Files:**
- Create: `src/components/settings/ui/SettingsCard.tsx`, `SettingsRow.tsx`, `SettingsSubgroup.tsx`
- Test: `src/components/settings/ui/__tests__/settingsUi.test.tsx`

**Interfaces:**
- Produces:
  - `SettingsCard({ title: string; description?: React.ReactNode; children; footer?: React.ReactNode })`: `<section aria-label={title}>`.
  - `SettingsRow({ label: React.ReactNode; description?: React.ReactNode; htmlFor?: string; children })`
  - `SettingsSubgroup({ title: string; description?: React.ReactNode; children })`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react"
import { SettingsCard } from "../SettingsCard"
import { SettingsRow } from "../SettingsRow"
import { SettingsSubgroup } from "../SettingsSubgroup"

it("SettingsCard renders a labelled section with title, description, body and footer", () => {
  render(
    <SettingsCard title="General" description="Church details" footer={<button>Save</button>}>
      <p>body</p>
    </SettingsCard>,
  )
  const card = screen.getByRole("region", { name: "General" })
  expect(card).toContainElement(screen.getByRole("heading", { name: "General" }))
  expect(card).toHaveTextContent("Church details")
  expect(card).toContainElement(screen.getByRole("button", { name: "Save" }))
})

it("SettingsCard omits the footer when none is given", () => {
  const { container } = render(<SettingsCard title="X"><p>b</p></SettingsCard>)
  expect(container.querySelectorAll("section > div")).toHaveLength(2) // header + body
})

it("SettingsRow associates its label with the control", () => {
  render(<SettingsRow label="Church name" description="On receipts" htmlFor="n"><input id="n" /></SettingsRow>)
  expect(screen.getByLabelText("Church name")).toBeInTheDocument()
  expect(screen.getByText("On receipts")).toBeInTheDocument()
})

it("SettingsSubgroup renders its heading and rows", () => {
  render(<SettingsSubgroup title="Templates"><SettingsRow label="A"><span /></SettingsRow></SettingsSubgroup>)
  expect(screen.getByRole("heading", { name: "Templates" })).toBeInTheDocument()
  expect(screen.getByText("A")).toBeInTheDocument()
})
```

- [ ] **Step 2: Run, expect FAIL**: `npm test -- --testPathPatterns="settingsUi"`
- [ ] **Step 3: Implement**

`SettingsCard.tsx`:

```tsx
/**
 * One settings tab's card: big title + subtitle, a divided body of rows, and
 * an optional right-aligned footer (usually the Save button). Wrap the card in
 * the `<form>` when the footer submits it.
 * @param props.title card heading (also the region's accessible name)
 * @param props.description subtitle under the heading
 * @param props.footer footer content, e.g. a submit button
 */
export function SettingsCard({
  title,
  description,
  children,
  footer,
}: Readonly<{ title: string; description?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }>) {
  return (
    <section aria-label={title} className="rounded-xl border border-border bg-card">
      <div className="p-6">
        <h2 className="text-2xl font-semibold text-foreground">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="divide-y divide-border border-t border-border px-6">{children}</div>
      {footer && <div className="flex justify-end border-t border-border p-4">{footer}</div>}
    </section>
  )
}
```

`SettingsRow.tsx`:

```tsx
import { Label } from "@/components/ui/label"

/**
 * One setting: label + description on the left, control on the right (md+);
 * stacked and full width below md.
 * @param props.label setting name
 * @param props.description helper text
 * @param props.htmlFor id of the control, so the label is clickable
 */
export function SettingsRow({
  label,
  description,
  htmlFor,
  children,
}: Readonly<{ label: React.ReactNode; description?: React.ReactNode; htmlFor?: string; children: React.ReactNode }>) {
  return (
    <div className="flex flex-col gap-3 py-5 md:flex-row md:items-center md:justify-between md:gap-8">
      <div className="md:max-w-[60%]">
        {htmlFor ? (
          <Label htmlFor={htmlFor} className="text-sm font-medium text-foreground">{label}</Label>
        ) : (
          <p className="text-sm font-medium text-foreground">{label}</p>
        )}
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="w-full md:w-auto md:shrink-0">{children}</div>
    </div>
  )
}
```

`SettingsSubgroup.tsx`:

```tsx
/**
 * A titled, bordered box of `SettingsRow`s inside a card (email templates,
 * receipt sub-settings, nested feature toggles).
 * @param props.title subgroup heading
 * @param props.description helper text under the heading
 */
export function SettingsSubgroup({
  title,
  description,
  children,
}: Readonly<{ title: string; description?: React.ReactNode; children: React.ReactNode }>) {
  return (
    <div className="py-5">
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      <div className="mt-3 divide-y divide-border rounded-lg border border-border px-4">{children}</div>
    </div>
  )
}
```

- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit**: `git commit -m "feat(settings): card, row and subgroup building blocks"`

---

### Task 5: Access helper + layout

**Files:**
- Create: `src/lib/settingsAccess.ts`, `src/app/(dashboard)/settings/layout.tsx`
- Test: `src/lib/__tests__/settingsAccess.test.ts`, `src/app/(dashboard)/settings/__tests__/layout.test.tsx`

**Interfaces:**
- Consumes: `buildSettingsTabs`, `isSettingsTabVisible` (Task 1); `SettingsTabs` (Task 3); `UnsavedChangesProvider` (Task 2).
- Produces: `requireSettingsTab(href: string): Promise<{ features: Set<FeatureKey> }>`. Redirects `/` for non-admins and `/settings` for a hidden tab. Every settings page calls it first, with its own tab href (nested pages pass the parent tab's href).

- [ ] **Step 1: Write the failing tests**

`src/lib/__tests__/settingsAccess.test.ts`:

```ts
jest.mock("next/navigation", () => ({ redirect: jest.fn((to: string) => { throw new Error(`NEXT_REDIRECT ${to}`) }) }))
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/featureFlags", () => ({ getEnabledFeatures: jest.fn() }))

import { auth } from "@/auth"
import { getEnabledFeatures } from "@/lib/featureFlags"
import { requireSettingsTab } from "@/lib/settingsAccess"

const mockAuth = auth as unknown as jest.Mock
const mockFeatures = getEnabledFeatures as jest.Mock

beforeEach(() => {
  mockAuth.mockResolvedValue({ user: { role: "ADMIN" } })
  mockFeatures.mockResolvedValue(new Set())
})

it.each(["PASTOR", "OFFICE_ADMIN", "VIEWER", undefined])("redirects role %s to /", async (role) => {
  mockAuth.mockResolvedValue(role ? { user: { role } } : null)
  await expect(requireSettingsTab("/settings")).rejects.toThrow("NEXT_REDIRECT /")
})

it("redirects a feature-off tab to /settings", async () => {
  await expect(requireSettingsTab("/settings/members")).rejects.toThrow("NEXT_REDIRECT /settings")
})

it("returns the features for a visible tab", async () => {
  mockFeatures.mockResolvedValue(new Set(["memberships"]))
  await expect(requireSettingsTab("/settings/members")).resolves.toEqual({ features: new Set(["memberships"]) })
})
```

`settings/__tests__/layout.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server"

jest.mock("next/navigation", () => ({ redirect: jest.fn(() => { throw new Error("NEXT_REDIRECT") }) }))
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/featureFlags", () => ({ getEnabledFeatures: jest.fn().mockResolvedValue(new Set(["memberships"])) }))
jest.mock("@/components/DemoNotice", () => ({ DemoNotice: () => null }))
jest.mock("@/components/settings/SettingsTabs", () => ({
  SettingsTabs: ({ groups }: { groups: { tabs: { href: string }[] }[] }) => (
    <i data-c="tabs">{groups.flatMap((g) => g.tabs.map((t) => t.href)).join(",")}</i>
  ),
}))

import { auth } from "@/auth"
import SettingsLayout from "@/app/(dashboard)/settings/layout"

const mockAuth = auth as unknown as jest.Mock

it("redirects non-admins", async () => {
  mockAuth.mockResolvedValue({ user: { role: "PASTOR" } })
  await expect(SettingsLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT")
})

it("renders the heading, the feature-filtered tabs and the page", async () => {
  mockAuth.mockResolvedValue({ user: { role: "ADMIN" } })
  const html = renderToStaticMarkup(await SettingsLayout({ children: <p>page</p> }))
  expect(html).toContain("<h1")
  expect(html).toContain("Settings")
  expect(html).toContain("/settings/members")
  expect(html).not.toContain("/settings/receipts")
  expect(html).toContain("<p>page</p>")
})
```

- [ ] **Step 2: Run, expect FAIL**: `npm test -- --testPathPatterns="settingsAccess|settings/__tests__/layout"`
- [ ] **Step 3: Implement**

`src/lib/settingsAccess.ts`:

```ts
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { isAdmin } from "@/lib/roleGuard"
import { getEnabledFeatures } from "@/lib/featureFlags"
import { isSettingsTabVisible } from "@/components/settings/settingsTabs"
import type { FeatureKey } from "@/lib/features"

/**
 * Page-level guard for every settings tab: ADMIN only (else "/"), and the tab
 * must be visible for the enabled features (else "/settings"), so a direct
 * link to a feature-off tab never renders its form. Runs in each page because
 * the shared layout doesn't re-run on client navigation between tabs.
 * @param href the page's tab href (nested pages pass their parent tab)
 */
export async function requireSettingsTab(href: string): Promise<{ features: Set<FeatureKey> }> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) redirect("/")
  const features = await getEnabledFeatures()
  if (!isSettingsTabVisible(href, features)) redirect("/settings")
  return { features }
}
```

`src/app/(dashboard)/settings/layout.tsx`:

```tsx
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { isAdmin } from "@/lib/roleGuard"
import { getEnabledFeatures } from "@/lib/featureFlags"
import { DemoNotice } from "@/components/DemoNotice"
import { buildSettingsTabs } from "@/components/settings/settingsTabs"
import { SettingsTabs } from "@/components/settings/SettingsTabs"
import { UnsavedChangesProvider } from "@/components/settings/unsavedChanges"

/**
 * Settings area shell: heading, feature-filtered tab list (left on md+,
 * Select below) and the active tab's page. ADMIN only.
 * @param props.children the active settings tab page
 */
export default async function SettingsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) redirect("/")
  const groups = buildSettingsTabs(await getEnabledFeatures())
  return (
    <UnsavedChangesProvider>
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
        <DemoNotice />
        <div className="flex flex-col gap-4 md:flex-row md:gap-8">
          <SettingsTabs groups={groups} />
          <div className="min-w-0 max-w-3xl flex-1 space-y-6">{children}</div>
        </div>
      </div>
    </UnsavedChangesProvider>
  )
}
```

- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit**: `git commit -m "feat(settings): shared layout and per-tab access guard"`

---

### Task 6: Church tabs (General, Branding, Email, Members, Receipts, Features) + form markup

**Files:**
- Modify: `src/app/(dashboard)/settings/page.tsx` (becomes General), `settings/features/page.tsx`
- Create: `settings/branding/page.tsx`, `settings/email/page.tsx`, `settings/members/page.tsx`, `settings/receipts/page.tsx`
- Modify components: `ChurchInfoForm`, `AppSettingsForm`, `BrandingForm`, `BirthdayEmailForm`, `AnniversaryEmailForm`, `AutoEmailToggles`, `EmailTemplatesSection` / `EmailTemplateForm`, `LetterSettingsForm`, `MembershipSettingsForm`, `ReceiptSettingsSection`, `FeaturesForm`
- Modify actions (revalidate strings only): `branding.ts:78,99` → `/settings/branding`; `emailTemplates.ts:154,175` → `/settings/email`; `settings.ts:308` (updateBirthdayTemplate), `:400` (updateAnniversaryTemplate), `:485` (updateAutoEmailFlags) → `/settings/email`; `receiptSettings.ts:57,76` → `/settings/receipts`; `settings.ts:595` (updateLetterSettings), `:650` (updateMembershipSettings, keep `/membershipform`) → `/settings/members`. `upsertSetting` (`:185`) and `updateChurchInfo` (`:250`) stay `/settings`.
- Delete: `src/components/settings/SettingsNav.tsx`, `src/components/settings/__tests__/SettingsNav.test.tsx`
- Tests: rewrite `settings/__tests__/page.test.tsx`; create `__tests__/page.test.tsx` under branding, email, members, receipts; update `features/__tests__/page.test.tsx`; update existing component tests touched by the markup change; update action tests asserting the moved paths (`grep -rn 'toHaveBeenCalledWith("/settings")' __tests__ src --include=*.test.*`: `__tests__/actions/settings.test.ts:88,235` must still match the action at that line; change any that now assert email/members/receipts/branding paths).

**Interfaces:**
- Consumes: `requireSettingsTab` (Task 5), `SettingsCard`/`SettingsRow`/`SettingsSubgroup` (Task 4), `useFormDirty`/`useUnsavedGuard` (Task 2).

**Conversion pattern** (apply to every `<form>`-based component). Shown for `ChurchInfoForm`:

```tsx
export function ChurchInfoForm({ churchName, churchAddress, churchABN, churchEmail, churchWebsite }: Readonly<Props>) {
  const [state, formAction, isPending, keep] = useKeepFormValues(updateChurchInfo)
  const { ref } = useFormDirty()

  return (
    // key remounts the uncontrolled inputs (and the dirty baseline) when revalidated props change
    <form
      ref={ref}
      action={formAction}
      key={JSON.stringify([churchName, churchAddress, churchABN, churchEmail, churchWebsite])}
    >
      <SettingsCard
        title="Church information"
        description="Displayed on donation receipts sent to members."
        footer={<Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Save church information"}</Button>}
      >
        <SettingsRow label="Church name" htmlFor="church-name">
          <Input id="church-name" name="churchName" type="text" required
            defaultValue={keep("churchName", churchName)} placeholder={DEFAULT_CHURCH_NAME}
            className="md:w-80" maxLength={200} />
        </SettingsRow>
        {/* …one SettingsRow per field, same attributes as today, className="md:w-80" replacing "mt-1"… */}
        <FormFeedback state={state} />
      </SettingsCard>
    </form>
  )
}
```

Rules:
- Drop the component's own `<section>`/`<h3>`/intro `<p>`. The card title and description replace them, using the same wording.
- Keep every `id`, `name`, `defaultValue`, `keep(...)`, validation attribute and button label. Tests target labels and roles, so they keep passing.
- Input classes: `className="md:w-80"` instead of `mt-1`. Textareas (email bodies, letter templates) go full width: put them under the row, not in the right column. Use `<SettingsRow label=… htmlFor=…><span /></SettingsRow>` followed by the textarea in a `py-5` div, or put the textarea straight into the card body with its `Label`.
- `FormFeedback` stays inside the form, last in the card body.

**Per-component row lists:**

| Component | Card title / description | Rows | Save model | Dirty |
|---|---|---|---|---|
| `ChurchInfoForm` | "Church information" / current intro | Church name, Address, ABN, Email, Website | footer Save | `useFormDirty` |
| `AppSettingsForm` | One card "App settings" | Its 5 forms stay separate: each becomes one `<form>` holding one `SettingsRow` (Notification email address; Secretary email address(es), only when `showMembership`; Idle timeout; Card fee percent; Card fee fixed, both only when `showCardFee`). The row's control is the input plus its small inline `Save` button (`flex gap-2`). The old `<h3>` text goes into the row description. | inline Save per row | `useFormDirty` per form |
| `BrandingForm` | "Branding" / current intro | One row per slot (label = slot name, control = file input + Upload + Reset) | per-slot upload (unchanged) | none (uploads are immediate) |
| `BirthdayEmailForm`, `AnniversaryEmailForm` | Rendered inside the Email page's "Blessing emails" card as `SettingsSubgroup` "Birthday email template" / "Anniversary email template" | Subject (row), Body (full-width textarea), action buttons (Save template, Send test) right-aligned at the bottom | Save button | `useFormDirty` |
| `AutoEmailToggles` | Subgroup "Automated blessing emails" | Birthday email (Switch), Anniversary email (Switch) | keep current (check: if each Switch saves on change, it's instant-save; leave it) | none if instant-save, else state vs props |
| `EmailTemplatesSection` + `EmailTemplateForm` | Card "Email templates" / current intro; template picker stays as is | per template: Subject row, Body full width, Save/Reset | Save button | `useFormDirty` in `EmailTemplateForm` |
| `LetterSettingsForm` | Card "Welcome letter" | `SettingsSubgroup` "General fund account" (bank, BSB, account, account name, fund label), "Building fund account" (same 5), "Signer" (name, title); then templates (intro, contributions, closing) full-width textareas | footer Save | `useFormDirty` |
| `MembershipSettingsForm` | Card "Membership" | Parish fields (Switch replacing the checkbox; keep `name`/`id`, and since `Switch` doesn't post form values by default, add a hidden input mirroring its state or keep the native checkbox styled; **keep the checkbox** if unsure, no new save semantics), Minimum monthly dues, Home address label, Arrival date label | footer Save | `useFormDirty` |
| `ReceiptSettingsSection` | Card "Tax receipt" / current intro | one row per entry in its field list (`f.label` / `f.settingKey`) | footer Save (`type="button" onClick={save}`) | `useUnsavedGuard(JSON.stringify(fields) !== JSON.stringify(<initial fields from props>))` |
| `FeaturesForm` | Card "Features" / "Choose which parts of ParishCRM your church uses." | one row per top-level feature with its `Switch`; child features (those with `parent`) in a `SettingsSubgroup` under their parent | footer Save (current button) | `useUnsavedGuard(JSON.stringify(state) !== JSON.stringify(<initial state>))` |

- [ ] **Step 1: Write the failing page tests.** Shared mock header for each page test (names per page):

```tsx
import { renderToStaticMarkup } from "react-dom/server"

jest.mock("@/lib/settingsAccess", () => ({ requireSettingsTab: jest.fn() }))
import { requireSettingsTab } from "@/lib/settingsAccess"
const mockRequire = requireSettingsTab as jest.Mock

/** Stub component that prints its name and JSON props. */
const stub = (name: string) => ({ [name]: (p: object) => <i data-c={name}>{JSON.stringify(p)}</i> })
```

General (`settings/__tests__/page.test.tsx`), replacing the old file:

```tsx
jest.mock("@/lib/prisma", () => ({ prisma: { appSetting: { findMany: jest.fn().mockResolvedValue([]) } } }))
jest.mock("@/components/settings/ChurchInfoForm", () => stub("ChurchInfoForm"))
jest.mock("@/components/settings/AppSettingsForm", () => stub("AppSettingsForm"))
import GeneralSettingsPage from "@/app/(dashboard)/settings/page"

it("guards with its own tab href", async () => {
  mockRequire.mockResolvedValue({ features: new Set() })
  await GeneralSettingsPage()
  expect(mockRequire).toHaveBeenCalledWith("/settings")
})

it("propagates the guard's redirect", async () => {
  mockRequire.mockRejectedValue(new Error("NEXT_REDIRECT"))
  await expect(GeneralSettingsPage()).rejects.toThrow("NEXT_REDIRECT")
})

it("renders church info and app settings, gating membership and card fee", async () => {
  mockRequire.mockResolvedValue({ features: new Set(["memberships"]) })
  const html = renderToStaticMarkup(await GeneralSettingsPage())
  expect(html).toContain('data-c="ChurchInfoForm"')
  expect(html).toContain("&quot;showMembership&quot;:true")
  expect(html).toContain("&quot;showCardFee&quot;:false")
})
```

Write the same three cases for each new page:
- **branding**: href `/settings/branding`; renders `BrandingForm`.
- **email**: href `/settings/email`. With `celebrations` on, renders Birthday/Anniversary/AutoEmailToggles; with it off, only `EmailTemplatesSection`. Assert `keys` equals `visibleEmailTemplateKeys(features)` (mock `@/lib/emailTemplates` partially with `jest.requireActual`).
- **members**: href `/settings/members`. `welcomeLetter` only → Letter but not Membership; `memberships` only → the reverse.
- **receipts**: href `/settings/receipts`; renders `ReceiptSettingsSection` with mocked `getReceiptSettings()`.
- **features**: href `/settings/features`; renders `FeaturesForm` with `initial` from mocked `readRawOverrides` and `welcome` from `searchParams`.

Mock data fetchers exactly as the current `settings/__tests__/page.test.tsx` does (`@/lib/actions/settings`, `@/lib/emailTemplateStore`, `@/lib/letterSettings`, `@/lib/membershipSettings`, `@/lib/receiptSettings`). Copy those mock blocks into the page test that needs them.

- [ ] **Step 2: Run, expect FAIL**: `npm test -- --testPathPatterns="app/\\(dashboard\\)/settings"`

- [ ] **Step 3: Implement the pages.** Each page is `export const dynamic = "force-dynamic"` if the current page sets it (check the old `page.tsx`; keep it consistent), with a JSDoc line.

`settings/page.tsx` (General). Move the `appSetting` key list and `get()` helper **verbatim** from the current file:

```tsx
import { prisma } from "@/lib/prisma"
import { requireSettingsTab } from "@/lib/settingsAccess"
import { ChurchInfoForm } from "@/components/settings/ChurchInfoForm"
import { AppSettingsForm } from "@/components/settings/AppSettingsForm"

/** Settings → General: church identity and app-wide settings. */
export default async function GeneralSettingsPage() {
  const { features } = await requireSettingsTab("/settings")
  const rows = await prisma.appSetting.findMany({ where: { key: { in: [/* same 10 keys as today */] } } })
  // const get = … (same helper as today)
  return (
    <>
      <ChurchInfoForm churchName={get("churchName")} /* …same props as today */ />
      <AppSettingsForm /* …same props as today */ showMembership={features.has("memberships")} showCardFee={features.has("events")} />
    </>
  )
}
```

`settings/branding/page.tsx`:

```tsx
import { requireSettingsTab } from "@/lib/settingsAccess"
import { BrandingForm } from "@/components/settings/BrandingForm"

/** Settings → Branding: logo, letterhead and other brand images. */
export default async function BrandingSettingsPage() {
  await requireSettingsTab("/settings/branding")
  return <BrandingForm />
}
```

`settings/email/page.tsx`:

```tsx
import { requireSettingsTab } from "@/lib/settingsAccess"
import { getAnniversaryTemplate, getAutoEmailFlags, getBirthdayTemplate } from "@/lib/actions/settings"
import { getEmailTemplate } from "@/lib/emailTemplateStore"
import { EMAIL_TEMPLATE_KEYS, visibleEmailTemplateKeys, type EmailTemplateFields, type EmailTemplateKey } from "@/lib/emailTemplates"
import { BirthdayEmailForm } from "@/components/settings/BirthdayEmailForm"
import { AnniversaryEmailForm } from "@/components/settings/AnniversaryEmailForm"
import { AutoEmailToggles } from "@/components/settings/AutoEmailToggles"
import { EmailTemplatesSection } from "@/components/settings/EmailTemplatesSection"
import { SettingsCard } from "@/components/settings/ui/SettingsCard"

/** Settings → Email: blessing emails (when Celebrations is on) and system email templates. */
export default async function EmailSettingsPage() {
  const { features } = await requireSettingsTab("/settings/email")
  const celebrations = features.has("celebrations")
  const [birthday, anniversary, autoFlags, templateList] = await Promise.all([
    celebrations ? getBirthdayTemplate() : null,
    celebrations ? getAnniversaryTemplate() : null,
    celebrations ? getAutoEmailFlags() : null,
    Promise.all(EMAIL_TEMPLATE_KEYS.map(getEmailTemplate)),
  ])
  const templates = Object.fromEntries(EMAIL_TEMPLATE_KEYS.map((k, i) => [k, templateList[i]])) as Record<EmailTemplateKey, EmailTemplateFields>
  return (
    <>
      {birthday && anniversary && autoFlags && (
        <SettingsCard title="Blessing emails" description="Birthday and anniversary emails sent to members.">
          <AutoEmailToggles birthday={autoFlags.birthday} anniversary={autoFlags.anniversary} />
          <BirthdayEmailForm subject={birthday.subject} body={birthday.body} />
          <AnniversaryEmailForm subject={anniversary.subject} body={anniversary.body} />
        </SettingsCard>
      )}
      <EmailTemplatesSection templates={templates} keys={visibleEmailTemplateKeys(features)} />
    </>
  )
}
```

Check the current page's `templates` record construction and `getAutoEmailFlags()` field names, and match them exactly. The code above assumes `{ birthday, anniversary }`.

`settings/members/page.tsx`:

```tsx
import { requireSettingsTab } from "@/lib/settingsAccess"
import { getLetterSettings } from "@/lib/letterSettings"
import { getMembershipSettings } from "@/lib/membershipSettings"
import { LetterSettingsForm } from "@/components/settings/LetterSettingsForm"
import { MembershipSettingsForm } from "@/components/settings/MembershipSettingsForm"

/** Settings → Members: welcome letter and membership form settings, per enabled feature. */
export default async function MembersSettingsPage() {
  const { features } = await requireSettingsTab("/settings/members")
  const [letter, membership] = await Promise.all([
    features.has("welcomeLetter") ? getLetterSettings() : null,
    features.has("memberships") ? getMembershipSettings() : null,
  ])
  return (
    <>
      {letter && <LetterSettingsForm settings={letter} />}
      {membership && <MembershipSettingsForm settings={membership} />}
    </>
  )
}
```

`settings/receipts/page.tsx`:

```tsx
import { requireSettingsTab } from "@/lib/settingsAccess"
import { getReceiptSettings } from "@/lib/receiptSettings"
import { ReceiptSettingsSection } from "@/components/settings/ReceiptSettingsSection"

/** Settings → Receipts: tax receipt wording and DGR details. */
export default async function ReceiptSettingsPage() {
  await requireSettingsTab("/settings/receipts")
  return <ReceiptSettingsSection settings={await getReceiptSettings()} />
}
```

`settings/features/page.tsx`: replace the `auth()`/`isAdmin` lines with `await requireSettingsTab("/settings/features")`, keep `readRawOverrides` + `searchParams`, drop the `<h2>` and `<DemoNotice />` (the layout renders both), and return `<FeaturesForm initial={initial} welcome={welcome === "1"} />`.

If the old `settings/page.tsx` used `senderAddress` (`@/lib/mailConfig`) for a prop, move that prop to whichever page renders the consuming component. Grep the old file for `senderAddress(` before deleting its body.

- [ ] **Step 4: Convert the component markup** per the table, update each component's existing tests (by role/label), and change the revalidate strings listed above.
- [ ] **Step 5: Delete `SettingsNav`** and its test. `grep -rn "SettingsNav" src __tests__` must print nothing.
- [ ] **Step 6: Run**: `npm test -- --testPathPatterns="settings|branding|emailTemplates|receiptSettings|Membership|Letter|Features"`. Expect PASS.
- [ ] **Step 7: Commit** (two commits: pages + guard, then component markup): `feat(settings): church tabs as separate pages`, `refactor(settings): card-row markup for church forms`

---

### Task 7: System tabs (Security, Audit Log, App Usage, About)

**Files:**
- Create: `settings/security/page.tsx`, `settings/about/page.tsx` (+ `__tests__/page.test.tsx` each)
- Modify: `settings/audit-log/page.tsx`, `settings/usage/page.tsx`, `usage/__tests__/page.test.tsx`, `src/components/dashboard/ActivityFeed.tsx` (or its actual path: `grep -rln "export function ActivityFeed" src`)

- [ ] **Step 1: Failing tests** (same mock header as Task 6):
  - security: guard href `/settings/security`; renders `ActivityFeed` with `isAdmin: true` and the mocked `auditLog.findMany` (take 10) / `registration.findMany` (take 5) results. Copy those two `findMany` argument objects verbatim from the old page.
  - about: guard href `/settings/about`. With `NEXT_PUBLIC_APP_VERSION="v1.10.0"` and `NEXT_PUBLIC_GIT_SHA="abcdef1234"`, html contains `v1.10.0` and `abcdef1` but not `abcdef12`. With neither set, it contains `dev` and no "Build" row.
  - usage and audit-log: assert `requireSettingsTab` is called with `/settings/usage` / `/settings/audit-log` (update the existing usage test's auth mocks to the `settingsAccess` mock).
- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement**

`settings/security/page.tsx`:

```tsx
import { prisma } from "@/lib/prisma"
import { requireSettingsTab } from "@/lib/settingsAccess"
import { ActivityFeed } from "@/components/dashboard/ActivityFeed"
import { SettingsCard } from "@/components/settings/ui/SettingsCard"

/** Settings → Security: recent audit entries and registrations. */
export default async function SecuritySettingsPage() {
  await requireSettingsTab("/settings/security")
  const [auditEntries, registrations] = await Promise.all([
    prisma.auditLog.findMany({ /* same args as old settings page */ }),
    prisma.registration.findMany({ /* same args as old settings page */ }),
  ])
  return (
    <SettingsCard title="Security" description="Recent changes and registrations across the app.">
      <div className="py-5">
        <ActivityFeed isAdmin auditEntries={auditEntries} registrations={registrations} />
      </div>
    </SettingsCard>
  )
}
```

In `ActivityFeed`, drop the outer `Card`/`CardHeader`/`CardTitle "Recent Activity"` chrome only when rendered here. If `ActivityFeed` is also used on the dashboard (`grep -rn "<ActivityFeed" src`), don't change it: render it inside the card as is. Otherwise replace the Card chrome with a plain `<div>` and update its test.

`settings/about/page.tsx`:

```tsx
import { requireSettingsTab } from "@/lib/settingsAccess"
import { SettingsCard } from "@/components/settings/ui/SettingsCard"
import { SettingsRow } from "@/components/settings/ui/SettingsRow"

const GIT_SHA_DISPLAY_LENGTH = 7

/** Settings → About: the release and build this instance runs. */
export default async function AboutSettingsPage() {
  await requireSettingsTab("/settings/about")
  const sha = process.env.NEXT_PUBLIC_GIT_SHA
  return (
    <SettingsCard title="About" description="The ParishCRM release this site runs.">
      <SettingsRow label="Version">
        <span className="text-sm">{process.env.NEXT_PUBLIC_APP_VERSION ?? "dev"}</span>
      </SettingsRow>
      {sha && (
        <SettingsRow label="Build">
          <code className="text-sm">{sha.slice(0, GIT_SHA_DISPLAY_LENGTH)}</code>
        </SettingsRow>
      )}
    </SettingsCard>
  )
}
```

`audit-log/page.tsx` and `usage/page.tsx`: replace their `auth()` + `isAdmin` redirect with `await requireSettingsTab("/settings/audit-log")` / `("/settings/usage")`, drop their own top `<h2>` (and `DemoNotice`/back link if present), and wrap the existing content in `<SettingsCard title="Audit Log" description="…existing intro…">` / `"App Usage"` with the body in a `py-5` div. Keep their `?days=` / filter links unchanged.

- [ ] **Step 4: Run, expect PASS**: `npm test -- --testPathPatterns="settings/(security|about|usage|audit-log)|ActivityFeed"`
- [ ] **Step 5: Commit**: `feat(settings): system tabs (security, audit log, usage, about)`

---

### Task 8: Sidebar, setup checklist, docs (PR1)

**Files:**
- Modify: `src/components/layout/sidebar/navData.ts:116-118`, `src/lib/setupChecklist.ts:67,74` and its test, Sidebar/navData tests that list the removed items
- Docs: `website/src/content/docs/docs/settings-and-branding.md`, `membership-applications.md:43`, `membership-letters.md:39`, `choosing-features.md:8`

- [ ] **Step 1: Update tests first.** In the setup-checklist test (`grep -rln "settings#" __tests__ src`), expect `"/settings"` and `"/settings/branding"`. In navData/Sidebar tests (`grep -rn '"Features"\|"Audit Log"' __tests__ src --include=*.test.*`), expect the items gone. Run, expect FAIL.
- [ ] **Step 2: Implement**
  - `navData.ts`: keep `{ href: "/settings", label: "App Settings", … }`; delete the `Features` (`/settings/features`) and `Audit Log` (`/settings/audit-log`) items. The sidebar's longest-match rule then keeps "App Settings" active on every `/settings/*` page. Leave "Accounting Settings" (`/accounting/settings`) for PR2.
  - `setupChecklist.ts`: `/settings#general` → `/settings`, `/settings#branding` → `/settings/branding`.
  - `TopBar.tsx` gear link stays `/settings` (its test already asserts that).
  - `grep -rn 'settings#' src website` must print nothing.
- [ ] **Step 3: Docs.** `settings-and-branding.md`: describe the tab list (Church: General, Branding, Email, Members, Receipts, Features; System: Security, Audit Log, App Usage, About), the mobile section picker, and the "Discard unsaved changes?" prompt; give each tab's URL; say Members/Receipts only appear when their features are on. Fix the deep links in the other three pages (e.g. membership secretary email → Settings → General; welcome letter → Settings → Members). Grep `website/src/content/docs/docs` for "App Settings" and update wording.
- [ ] **Step 4: Verify.** `npm test -- --testPathPatterns="settings|setupChecklist|Sidebar|navData|TopBar"` and `npm run lint`, both green. Then the manual pass: `npx prisma dev --detach`, `next dev` with `DISABLE_OTP=true`. As admin@example.com, at 375px and 1920px: open every tab, save each form once, edit a field and switch tabs (desktop link and mobile select) to see the confirm, open `/settings/members` with Members' features off and confirm it lands on `/settings`.
- [ ] **Step 5: Commit**: `docs(settings): new settings area layout and links`. Open PR1 (title `feat(settings): one settings area with left tabs (OSS-315, part 1)`), add it to the board.

---

# PR2: accounting tabs, funds move, redirects

Branch `feat/settings-area-accounting` off `feat/settings-area`.

### Task 9: Accounting tab group

**Files:** Modify `src/components/settings/settingsTabs.ts` + its test.

- [ ] **Step 1: Failing tests** (add to `settingsTabs.test.ts`):

```ts
it("adds an Accounting group between Church and System when accounting is on", () => {
  expect(buildSettingsTabs(on("accounting")).map((g) => g.label)).toEqual(["Church", "Accounting", "System"])
  expect(buildSettingsTabs(on("accounting")).find((g) => g.label === "Accounting")!.tabs.map((t) => t.href)).toEqual([
    "/settings/accounting", "/settings/accounting/accounts", "/settings/accounting/period-lock", "/settings/accounting/funds",
  ])
})

it("shows Petty Cash and Invoices only with their features", () => {
  const acct = buildSettingsTabs(on("accounting", "pettyCash", "invoices")).find((g) => g.label === "Accounting")!
  expect(acct.tabs.map((t) => t.label)).toEqual(["Opening Balances", "Payment Accounts", "Period Lock", "Petty Cash", "Invoices", "Funds"])
})

it("hides the whole Accounting group when accounting is off", () => {
  expect(buildSettingsTabs(on("pettyCash", "invoices")).map((g) => g.label)).toEqual(["Church", "System"])
})

it("highlights Funds on a nested fund page", () => {
  const all = hrefs(on("accounting"))
  expect(activeSettingsHref("/settings/accounting/funds/7/edit", all)).toBe("/settings/accounting/funds")
  expect(activeSettingsHref("/settings/accounting", all)).toBe("/settings/accounting")
})
```

- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement.** Insert between Church and System in `GROUPS`:

```ts
  {
    label: "Accounting",
    anyOf: ["accounting"],
    tabs: [
      { href: "/settings/accounting", label: "Opening Balances" },
      { href: "/settings/accounting/accounts", label: "Payment Accounts" },
      { href: "/settings/accounting/period-lock", label: "Period Lock" },
      { href: "/settings/accounting/petty-cash", label: "Petty Cash", anyOf: ["pettyCash"] },
      { href: "/settings/accounting/invoices", label: "Invoices", anyOf: ["invoices"] },
      { href: "/settings/accounting/funds", label: "Funds" },
    ],
  },
```

The group-level `anyOf: ["accounting"]` replaces the `/accounting/*` prefix gate the old route had (see Spec gaps below). Also update the earlier "no features" expectations: the Accounting group must be absent.

- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit**: `feat(settings): accounting tab group`

---

### Task 10: Accounting pages + revalidate paths

**Files:**
- Create: `settings/accounting/page.tsx` (Opening Balances), `accounting/accounts/page.tsx`, `accounting/period-lock/page.tsx`, `accounting/petty-cash/page.tsx`, `accounting/invoices/page.tsx`, each with `__tests__/page.test.tsx`
- Modify components: `OpeningBalanceForm`, `PaymentAccountsManager`, `PeriodLockForm`, `PettyCashCustodianForm`, `InvoiceSettingsForm` (markup only)
- Modify actions: `accountingSettings.ts:77` (upsertOpeningBalance, keep `"/"`) → `/settings/accounting`; `accountingSettings.ts:117` (setAccountingLockDate) → `/settings/accounting/period-lock`; `paymentAccount.ts:20` helper → **both** `/settings/accounting/accounts` and `/settings/accounting` (Opening Balances lists payment accounts); `invoiceSettings.ts:37` → `/settings/accounting/invoices` (keep `/accounting/invoices`); `settings.ts:526` (updatePettyCashCustodian) → `/settings/accounting/petty-cash` (keep `/accounting/petty-cash`).
- Modify tests: `__tests__/actions/accounting-settings.test.ts:104` and any other path assertion found by `grep -rn '/accounting/settings' __tests__ src --include=*.test.*`.

- [ ] **Step 1: Failing tests** (Task 6 mock header; mock `@/lib/prisma`, `@/lib/paymentAccounts`, `@/lib/accountingLock`, `@/lib/invoiceSettings`, `@/lib/actions/settings` as the current `accounting/settings/__tests__/page.test.tsx` does):
  - Opening Balances: guard `/settings/accounting`; passes `accounts` and a `balancesByAccountId` built from `accountOpeningBalance.findMany`.
  - Payment Accounts: guard `/settings/accounting/accounts`; `PaymentAccountsManager` gets `getPaymentAccounts()`.
  - Period Lock: guard `/settings/accounting/period-lock`; `currentLockDate` from `getAccountingLockDate()` (string or null, same conversion as today).
  - Petty Cash: guard `/settings/accounting/petty-cash`; people list (`take: PERSON_PICKER_CAP`) plus the custodian appended when not in the list; `currentId`.
  - Invoices: guard `/settings/accounting/invoices`; `initial` from `getInvoiceSettings()`.
  - Action tests: assert the new path strings.
- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement.** Move each data fetch **verbatim** from `accounting/settings/page.tsx` into its own page (the `balancesByAccountId` Map, the custodian-not-in-list fetch, the lock-date conversion). Pattern:

```tsx
import { requireSettingsTab } from "@/lib/settingsAccess"
import { getAccountingLockDate } from "@/lib/accountingLock"
import { PeriodLockForm } from "@/components/accounting/PeriodLockForm"

/** Settings → Accounting → Period Lock: date before which transactions are locked. */
export default async function PeriodLockSettingsPage() {
  await requireSettingsTab("/settings/accounting/period-lock")
  const lockDate = await getAccountingLockDate()
  return <PeriodLockForm currentLockDate={/* same conversion as old page */ lockDate} />
}
```

Component markup (Task 6 conversion pattern):

| Component | Card | Rows | Dirty |
|---|---|---|---|
| `OpeningBalanceForm` | "Opening balances" / "Starting balance of each bank and cash account." | one `SettingsRow` per account (label = account name), control = the existing per-account amount input + Save | `useFormDirty` per row form |
| `PaymentAccountsManager` | "Payment accounts" | full-width manager inside a `py-5` div (list, not rows) | none |
| `PeriodLockForm` | "Period lock" / current help text | Lock date (date input) | `useFormDirty` |
| `PettyCashCustodianForm` | "Petty cash" / "Who a new petty cash float opens under by default." | Default custodian (person select) | `useFormDirty` |
| `InvoiceSettingsForm` | "Invoices" | GST registered (existing control), then each invoice-detail field as a row | `useUnsavedGuard(JSON.stringify({ gst, details }) !== JSON.stringify({ gst: initial.<gst field>, details: initial.<details> }))` with the field names it uses today |

- [ ] **Step 4: Run, expect PASS**: `npm test -- --testPathPatterns="settings/accounting|accounting-settings|paymentAccount|invoiceSettings|OpeningBalance|PeriodLock|PettyCash"`
- [ ] **Step 5: Commit**: `feat(settings): accounting tabs as separate pages`

---

### Task 11: Move Funds under settings

**Files:**
- Move: `src/app/(dashboard)/accounting/settings/funds/{page.tsx,new/page.tsx,[id]/edit/page.tsx}` → `src/app/(dashboard)/settings/accounting/funds/…`
- Modify: `src/lib/actions/fund.ts:21` → `/settings/accounting/funds`; `__tests__/app/accounting-edit-pages-id-guard.test.tsx:26` import path.

- [ ] **Step 1:** `git mv` the three files. In the test, change the import to `@/app/(dashboard)/settings/accounting/funds/[id]/edit/page` and add a case asserting `requireSettingsTab` is called with `/settings/accounting/funds` (mock `@/lib/settingsAccess`). Run, expect FAIL.
- [ ] **Step 2: Implement.** In all three pages:
  - Replace `auth()` + `isAdmin` + `redirect("/accounting/settings…")` with `await requireSettingsTab("/settings/accounting/funds")`.
  - `funds/page.tsx`: drop the "← Back to Settings" link (the tab list replaces it); `New fund` → `/settings/accounting/funds/new`; Edit → `/settings/accounting/funds/${f.id}/edit` (both occurrences); wrap the list in `<SettingsCard title="Funds" description="…" footer={<Button asChild><Link href="/settings/accounting/funds/new">New fund</Link></Button>}>`.
  - `new` / `[id]/edit`: any post-save `redirect`/`router.push` inside `FundForm` or the `createFund`/`updateFund` actions to `/accounting/settings/funds` → `/settings/accounting/funds`. Grep: `grep -rn "accounting/settings/funds" src`.
  - `fund.ts:21` revalidate string.
- [ ] **Step 3: Run, expect PASS**: `npm test -- --testPathPatterns="fund|accounting-edit-pages"`
- [ ] **Step 4: Commit**: `refactor(settings): move funds under /settings/accounting`

---

### Task 12: Redirects, old-route removal, link updates

**Files:**
- Create: `redirects.mjs` (repo root), `__tests__/config/redirects.test.ts`
- Modify: `next.config.mjs`
- Delete: `src/app/(dashboard)/accounting/settings/` (page, loading, `__tests__`)
- Modify links: `src/app/(dashboard)/page.tsx:369`, `accounting/reports/reconciliation/page.tsx:59,261`, `accounting/reports/cash-flow/page.tsx:203`, `accounting/reports/balance-sheet/page.tsx:207`, `accounting/petty-cash/page.tsx:87`, `accounting/reconciliation/page.tsx:129,171`, `src/components/layout/sidebar/navData.ts:102`, `src/lib/setupChecklist.ts:95` (+ its test)

- [ ] **Step 1: Failing test**

```ts
import { legacyRedirects } from "../../redirects.mjs"

it("permanently redirects the old accounting settings routes", () => {
  expect(legacyRedirects).toEqual([
    { source: "/accounting/settings", destination: "/settings/accounting", permanent: true },
    { source: "/accounting/settings/funds/:path*", destination: "/settings/accounting/funds/:path*", permanent: true },
  ])
})
```

Run: `npm test -- --testPathPatterns="config/redirects"`. Expect FAIL. If Jest can't import `.mjs` (transform error rather than "module not found"), name the file `redirects.cjs` with `module.exports = { legacyRedirects }`, load it in `next.config.mjs` via `createRequire(import.meta.url)("./redirects.cjs")`, and `require` it in the test.

- [ ] **Step 2: Implement**

`redirects.mjs`:

```js
/**
 * Old URLs kept working after routes move (permanent 308s). Imported by
 * next.config.mjs; unit-tested in __tests__/config/redirects.test.ts.
 */
export const legacyRedirects = [
  { source: "/accounting/settings", destination: "/settings/accounting", permanent: true },
  { source: "/accounting/settings/funds/:path*", destination: "/settings/accounting/funds/:path*", permanent: true },
]
```

`next.config.mjs`: `import { legacyRedirects } from "./redirects.mjs"`, then add to `nextConfig`, next to `async headers()`:

```js
  /** Permanent redirects for moved routes (see redirects.mjs). */
  async redirects() {
    return legacyRedirects
  },
```

Check `node_modules/next/dist/docs/` for the `redirects` config page before writing (Next 16, per the repo CLAUDE.md).

Delete `src/app/(dashboard)/accounting/settings/` entirely. Update every link listed above to its new tab: reconciliation/report "set up payment accounts" links → `/settings/accounting/accounts`; opening-balance prompts → `/settings/accounting`; petty-cash page custodian link → `/settings/accounting/petty-cash`; dashboard link → match its text (opening balances → `/settings/accounting`). `navData.ts:102` → `/settings/accounting`, and keep its `show: isAdmin && acct`. `setupChecklist.ts:95` → `/settings/accounting/accounts`. `__tests__/components/sidebar/SidebarGroup.test.tsx:16` is a fixture string: leave it.

`grep -rn "accounting/settings" src website` must print nothing.

- [ ] **Step 3: Run**: `npm test -- --testPathPatterns="redirects|setupChecklist|navData|Sidebar|reconciliation|balance-sheet|cash-flow|petty-cash|dashboard"`. Expect PASS. Then `npm run lint`.
- [ ] **Step 4: Commit**: `feat(settings): redirect and remove /accounting/settings`

---

### Task 13: Docs + QA (PR2)

- [ ] **Step 1:** `settings-and-branding.md`: add the Accounting group (Opening Balances, Payment Accounts, Period Lock, Petty Cash, Invoices, Funds) with URLs, plus a note that `/accounting/settings` links still work (redirect). `grep -rn "Accounting Settings\|accounting/settings" website/src/content/docs/docs README.md` and update every hit.
- [ ] **Step 2:** Manual pass (dev DB, `DISABLE_OTP=true`, 375px + 1920px): each accounting tab saves once; `/accounting/settings` and `/accounting/settings/funds/1/edit` redirect; with Accounting off, `/settings/accounting/*` lands on `/settings` and the group is gone; create and edit a fund end to end.
- [ ] **Step 3: Commit**: `docs(settings): accounting tabs`. Open PR2 `feat(settings): accounting tabs in the settings area (OSS-315, part 2)`, add it to the board.

---

## Spec gaps resolved here

1. **Accounting gate.** The old `/accounting/settings` sat under the `/accounting` prefix, so it was gated on the `accounting` feature (and by the #348 middleware prefix). The spec marks the accounting tabs "always". This plan gates the whole Accounting group on `accounting` (Task 9), so an accounting-off church never sees those tabs and their routes redirect to `/settings`.
2. **Church-tab revalidation.** Spec §3 maps only the accounting actions. Church actions that revalidated `/settings` now point at their own tab (Task 6 list). Otherwise a save on `/settings/email` would refresh only General.
3. **Payment accounts revalidate both** `/settings/accounting/accounts` and `/settings/accounting`, since Opening Balances lists them.
