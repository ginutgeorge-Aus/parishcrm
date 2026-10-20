# App Shell Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the dashboard shell like MoneyMatter — light sidebar with pill active items, icon group rows and a user menu, plus a new top bar with quick-add, notifications bell, feedback and settings.

**Architecture:** Restyle the existing `Sidebar`/`SidebarGroup`/`SidebarLink` in place (keep all a11y behaviour). Add a `TopBar` client component rendered by the dashboard layout above `<main>`. Mobile drawer state moves into a tiny `ShellContext` so the top bar's hamburger and the sidebar's drawer share it. Quick-add entries come from a pure role+feature function.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4 semantic tokens, `radix-ui` (DropdownMenu, Tooltip), lucide-react, Jest 30 + Testing Library.

Spec: `docs/superpowers/specs/2026-10-20-app-shell-redesign-design.md`

## Global Constraints

- Keep ParishCRM primary colour; active item = `bg-primary/10 text-primary font-medium`.
- Semantic tokens only (`bg-card`, `border-border`, `text-muted-foreground`, `hover:bg-muted`); the only raw `bg-white` left is the logo/crest backing (existing eslint suppression comments stay on those).
- No new data queries; bell uses existing `pendingUpdates` / `membershipPending` props.
- Every new/changed function gets a JSDoc comment.
- Mobile: verify at 375px; desktop: ≥1920px. Desktop-only tweaks scoped to `md:`+.
- Tests run via `npm test -- --testPathPatterns=<basename>` (never bare `npx jest`). Tests exist in both root `__tests__/` and colocated `__tests__/` — update both.
- Branch: `feat/moneymatter-shell` (already created, specs committed).

## File map

| File | Change |
|---|---|
| `src/components/layout/topbar/quickAdd.ts` | new — pure `buildQuickAddItems` |
| `src/components/layout/sidebar/navData.ts` | `NavGroup.icon`; icons on Community/Accounting/Settings |
| `src/components/layout/sidebar/SidebarLink.tsx` | pill styles |
| `src/components/layout/sidebar/SidebarGroup.tsx` | icon row header, rotating chevron, guide-line panel |
| `src/components/ui/dropdown-menu.tsx` | new — shadcn-style wrapper over `radix-ui` |
| `src/components/layout/sidebar/UserMenu.tsx` | new — footer user chip + menu |
| `src/components/layout/ShellContext.tsx` | new — mobile drawer state |
| `src/components/layout/Sidebar.tsx` | light surfaces, footer → UserMenu, mobile header removed, uses ShellContext |
| `src/components/layout/FeedbackDialog.tsx` | single icon-button trigger |
| `src/components/layout/TopBar.tsx` | new |
| `src/app/(dashboard)/layout.tsx` | ShellProvider + TopBar wiring |
| docs: `dashboard.md`, `feedback-widget.md` (+ grep hits) | navigation text |

---

### Task 1: Quick-add entries (pure function)

**Files:**
- Create: `src/components/layout/topbar/quickAdd.ts`
- Test: `src/components/layout/topbar/__tests__/quickAdd.test.ts`

**Interfaces:**
- Produces: `type QuickAddItem = { href: string; label: string; icon: React.ElementType }`; `buildQuickAddItems(role: UserRole | undefined, features?: ReadonlySet<FeatureKey>): QuickAddItem[]`

- [ ] **Step 1: Write the failing test**

```ts
import { buildQuickAddItems } from "../quickAdd"
import type { FeatureKey } from "@/lib/features"
import type { UserRole } from "@/lib/generated/prisma/enums"

const labels = (role: string | undefined, features?: ReadonlySet<FeatureKey>) =>
  buildQuickAddItems(role as UserRole | undefined, features).map((i) => i.label)

it("gives ADMIN and PASTOR every entry", () => {
  expect(labels("ADMIN")).toEqual(["Person", "Family", "Event", "Transaction"])
  expect(labels("PASTOR")).toEqual(["Person", "Family", "Event", "Transaction"])
})

it("gives OFFICE_ADMIN people/family/event but no transaction", () => {
  expect(labels("OFFICE_ADMIN")).toEqual(["Person", "Family", "Event"])
})

it("gives read-only roles nothing", () => {
  expect(labels("VIEWER")).toEqual([])
  expect(labels("AUDITOR")).toEqual([])
  expect(labels("EVENT_ORGANISER")).toEqual([])
  expect(labels(undefined)).toEqual([])
})

it("drops Event when the events feature is off and Transaction when accounting is off", () => {
  const on = new Set<FeatureKey>(["accounting"])
  expect(labels("ADMIN", on)).toEqual(["Person", "Family", "Transaction"])
  expect(labels("ADMIN", new Set<FeatureKey>())).toEqual(["Person", "Family"])
})

it("links each entry to its create page", () => {
  expect(buildQuickAddItems("ADMIN" as UserRole).map((i) => i.href)).toEqual([
    "/people/new", "/families/new", "/events/new", "/accounting/transactions/new",
  ])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPatterns=quickAdd`
Expected: FAIL — `Cannot find module '../quickAdd'`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { User, Users, CalendarDays, ArrowLeftRight } from "lucide-react"
import { canAccessAccounting, canEdit } from "@/lib/roleGuard"
import type { UserRole } from "@/lib/generated/prisma/enums"
import type { FeatureKey } from "@/lib/features"

export type QuickAddItem = { href: string; label: string; icon: React.ElementType }

/**
 * Entries for the top bar's "+ New" menu. Gates mirror the create pages'
 * own guards (canEdit for people/families/events, canAccessAccounting for
 * transactions) so the menu never offers a page that would redirect.
 * `features` omitted = all on.
 */
export function buildQuickAddItems(role: UserRole | undefined, features?: ReadonlySet<FeatureKey>): QuickAddItem[] {
  const on = (k: FeatureKey) => !features || features.has(k)
  const editor = canEdit(role)
  const items: (QuickAddItem & { show: boolean })[] = [
    { href: "/people/new", label: "Person", icon: User, show: editor },
    { href: "/families/new", label: "Family", icon: Users, show: editor },
    { href: "/events/new", label: "Event", icon: CalendarDays, show: editor && on("events") },
    { href: "/accounting/transactions/new", label: "Transaction", icon: ArrowLeftRight, show: canAccessAccounting(role) && on("accounting") },
  ]
  return items.filter((i) => i.show).map(({ show: _show, ...i }) => i)
}
```

`canEdit`/`canAccessAccounting` take `UserRole | undefined`, hence the param type.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPatterns=quickAdd`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/topbar
git commit -m "feat(shell): quick-add entries by role and feature"
```

---

### Task 2: Sidebar visual restyle (links, groups, group icons)

**Files:**
- Modify: `src/components/layout/sidebar/navData.ts` (type at line 19, groups at lines ~59/71/105)
- Modify: `src/components/layout/sidebar/SidebarLink.tsx`
- Modify: `src/components/layout/sidebar/SidebarGroup.tsx`
- Test: `__tests__/components/sidebar/navData.test.ts`, `__tests__/components/sidebar/SidebarLink.test.tsx`, `__tests__/components/sidebar/SidebarGroup.test.tsx`

**Interfaces:**
- Produces: `NavGroup = { label: string; items: NavEntry[]; headless?: boolean; icon?: React.ElementType }`

- [ ] **Step 1: Write failing tests**

Append to `__tests__/components/sidebar/navData.test.ts` (reuse the file's existing flags helper — read its top 22 lines and use the same `ALL`/flags object it builds):

```ts
it("gives every collapsible group a header icon", () => {
  for (const g of buildNavGroups(allTrueFlags)) {
    if (!g.headless) expect(g.icon).toBeDefined()
  }
})
```
(`allTrueFlags` is defined at the top of that file.)

Append to `__tests__/components/sidebar/SidebarLink.test.tsx` (reuse its existing render helper/item fixture):

```ts
it("marks the active link with the primary pill, not a gold border", () => {
  renderLink({ active: true })
  const link = screen.getByRole("link")
  expect(link).toHaveAttribute("aria-current", "page")
  expect(link).toHaveClass("bg-primary/10", "text-primary")
  expect(link).not.toHaveClass("border-gold")
})
```
(`renderLink` = the file's existing helper; if it renders inline, copy its render call with `active`.)

Append to `__tests__/components/sidebar/SidebarGroup.test.tsx` (reuse its group fixture):

```ts
it("indents the open panel with a guide line and rotates the chevron", () => {
  renderGroup({ isOpen: true })
  const button = screen.getByRole("button", { name: /accounting/i })
  const panel = document.getElementById(button.getAttribute("aria-controls")!)!
  expect(panel).toHaveClass("border-l")
  expect(button.querySelector("svg.rotate-90")).not.toBeNull()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPatterns="navData|SidebarLink|SidebarGroup"`
Expected: the 3 new tests FAIL; existing ones pass.

- [ ] **Step 3: Implement**

`navData.ts`:
- Add `Church, Calculator, Settings` to the lucide import.
- Type: `export type NavGroup = { label: string; items: NavEntry[]; headless?: boolean; icon?: React.ElementType }` with a comment `// \`icon\` is shown on collapsible group headers; headless groups have none.`
- Community group: add `icon: Church,`; Accounting: `icon: Calculator,`; Settings: `icon: Settings,`.

`SidebarLink.tsx` — replace the tone consts and className:

```tsx
  const dotTone = badgeInformational ? "bg-muted-foreground" : "bg-warning"
  const pillTone = badgeInformational ? "bg-muted text-muted-foreground" : "bg-warning text-warning-foreground"
```
```tsx
      className={cn(
        "flex items-center gap-3 rounded-lg text-sm transition-colors",
        collapsed ? "justify-center px-2 py-2" : "px-3 py-2",
        active
          ? "bg-primary/10 font-medium text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
```

`SidebarGroup.tsx` — imports: `import { ChevronRight } from "lucide-react"` (drop `ChevronDown`). Replace the header button + panel:

```tsx
  const Icon = group.icon

  return (
    <div>
      <button
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className={cn(
          "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors hover:bg-muted",
          hasActive ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
        )}
      >
        {Icon ? <Icon className="w-4 h-4 shrink-0" aria-hidden="true" /> : null}
        <span className="flex flex-1 items-center gap-2">
          {group.label}
          {!isOpen && pending > 0 ? (
            <span className="rounded-full bg-warning px-1.5 text-[10px] font-semibold text-warning-foreground">
              {pending}<span className="sr-only"> pending</span>
            </span>
          ) : null}
        </span>
        <ChevronRight
          className={cn("w-4 h-4 transition-transform motion-reduce:transition-none", isOpen && "rotate-90")}
          aria-hidden="true"
        />
      </button>

      {/* Always rendered so aria-controls resolves while collapsed. Indented
          with a guide line so sub-items read as children of the header. */}
      <div id={panelId} hidden={!isOpen} className="mt-0.5 ml-[1.125rem] space-y-0.5 border-l border-border pl-2">
        {entries}
      </div>
    </div>
  )
```

Sub-label `<p>` className → `"px-3 pt-2 pb-0.5 text-[11px] uppercase tracking-wide text-muted-foreground/70"`.

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPatterns="navData|SidebarLink|SidebarGroup"`
Expected: all PASS. If an old test asserted `bg-white/15` or the ChevronDown, update it to the new class (`bg-muted`) — don't delete coverage.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/sidebar __tests__/components/sidebar
git commit -m "feat(shell): pill links and icon group rows in sidebar"
```

---

### Task 3: DropdownMenu primitive + sidebar user menu + light sidebar surfaces

**Files:**
- Create: `src/components/ui/dropdown-menu.tsx`
- Create: `src/components/layout/sidebar/UserMenu.tsx`
- Modify: `src/components/layout/Sidebar.tsx` (footer lines ~297-325, aside/drawer/header classes)
- Test: `src/components/layout/sidebar/__tests__/UserMenu.test.tsx`, `__tests__/components/Sidebar.test.tsx`

**Interfaces:**
- Produces: `DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator` from `@/components/ui/dropdown-menu`; `UserMenu({ collapsed }: { collapsed: boolean })`; `formatRole(role?: string): string`.

- [ ] **Step 1: Create the primitive (no test — `src/components/ui/**` is excluded from coverage)**

```tsx
"use client"

import * as React from "react"
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

/** Root of a Radix dropdown menu. */
function DropdownMenu(props: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

/** Element that opens the menu (use `asChild` with a Button). */
function DropdownMenuTrigger(props: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

/** Portalled menu panel, styled like PopoverContent. */
function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-48 overflow-hidden rounded-lg bg-popover p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

/** One selectable row; use `asChild` with a Link for navigation. */
function DropdownMenuItem({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(
        "flex cursor-default items-center gap-2 rounded-md px-2 py-2 outline-hidden select-none focus:bg-muted focus:text-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        className
      )}
      {...props}
    />
  )
}

/** Non-interactive caption inside the menu. */
function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      className={cn("px-2 py-1.5 text-xs font-medium text-muted-foreground", className)}
      {...props}
    />
  )
}

/** Thin divider between item groups. */
function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

export {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
}
```

Verify `radix-ui` exports `DropdownMenu`: `node -e "console.log(typeof require('radix-ui').DropdownMenu)"` → `object`.

- [ ] **Step 2: Write the failing UserMenu test**

`src/components/layout/sidebar/__tests__/UserMenu.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react"
import { TooltipProvider } from "@/components/ui/tooltip"
import { UserMenu, formatRole } from "../UserMenu"
import { logout } from "@/lib/actions/session"

jest.mock("@/lib/actions/session", () => ({ logout: jest.fn() }))
jest.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { name: "Demo Admin", role: "OFFICE_ADMIN" } } }),
}))

const renderMenu = (collapsed = false) =>
  render(<TooltipProvider><UserMenu collapsed={collapsed} /></TooltipProvider>)

it("formats roles for display", () => {
  expect(formatRole("OFFICE_ADMIN")).toBe("Office admin")
  expect(formatRole(undefined)).toBe("")
})

it("shows name and role on the chip and opens a menu with account, help and sign out", () => {
  renderMenu()
  const trigger = screen.getByRole("button", { name: /account menu/i })
  expect(trigger).toHaveTextContent("Demo Admin")
  expect(trigger).toHaveTextContent("Office admin")
  fireEvent.keyDown(trigger, { key: "Enter" })
  expect(screen.getByRole("menuitem", { name: /my account/i })).toHaveAttribute("href", "/account")
  expect(screen.getByRole("menuitem", { name: /help/i })).toHaveAttribute("href", "/help")
  fireEvent.click(screen.getByRole("menuitem", { name: /sign out/i }))
  expect(logout).toHaveBeenCalled()
})

it("shows only the avatar when collapsed", () => {
  renderMenu(true)
  const trigger = screen.getByRole("button", { name: /account menu/i })
  expect(trigger).not.toHaveTextContent("Demo Admin")
  expect(trigger).toHaveTextContent("D")
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- --testPathPatterns=UserMenu`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement UserMenu**

`src/components/layout/sidebar/UserMenu.tsx`:

```tsx
"use client"

import Link from "next/link"
import { useSession } from "next-auth/react"
import { ChevronsUpDown, HelpCircle, LogOut, MonitorSmartphone } from "lucide-react"
import { logout } from "@/lib/actions/session"
import { cn } from "@/lib/utils"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

/** "OFFICE_ADMIN" → "Office admin"; undefined → "". */
export function formatRole(role?: string): string {
  if (!role) return ""
  const words = role.toLowerCase().split("_")
  return [words[0][0].toUpperCase() + words[0].slice(1), ...words.slice(1)].join(" ")
}

/**
 * Sidebar footer chip (avatar, name, role) opening a menu with My Account,
 * Help and Sign out. On the collapsed rail only the avatar shows, with a
 * tooltip.
 */
export function UserMenu({ collapsed }: Readonly<{ collapsed: boolean }>) {
  const { data: session } = useSession()
  const name = session?.user?.name ?? ""
  const role = formatRole(session?.user?.role)
  const initial = (name.trim()[0] ?? "?").toUpperCase()

  const trigger = (
    <DropdownMenuTrigger
      aria-label="Account menu"
      className={cn(
        "flex w-full items-center gap-3 rounded-lg text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        collapsed ? "justify-center p-1.5" : "px-2 py-2"
      )}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary" aria-hidden="true">
        {initial}
      </span>
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-foreground">{name}</span>
            <span className="block truncate text-xs text-muted-foreground">{role}</span>
          </span>
          <ChevronsUpDown className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </>
      )}
    </DropdownMenuTrigger>
  )

  return (
    <DropdownMenu>
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side="right">{name || "Account"}</TooltipContent>
        </Tooltip>
      ) : trigger}
      <DropdownMenuContent side={collapsed ? "right" : "top"} align="start" className="w-56">
        {name ? <DropdownMenuLabel className="truncate">{name}</DropdownMenuLabel> : null}
        <DropdownMenuItem asChild>
          <Link href="/account"><MonitorSmartphone aria-hidden="true" />My Account</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/help"><HelpCircle aria-hidden="true" />Help</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => logout()}>
          <LogOut aria-hidden="true" />Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

Note the trigger is `DropdownMenuTrigger` rendered directly (it is a button), so `TooltipTrigger asChild` wraps it.

- [ ] **Step 5: Run UserMenu tests**

Run: `npm test -- --testPathPatterns=UserMenu`
Expected: PASS. If `keyDown Enter` doesn't open in jsdom, use `await userEvent.setup().click(trigger)` (`@testing-library/user-event` is installed) and make the test `async`.

- [ ] **Step 6: Wire UserMenu + light surfaces into Sidebar.tsx**

In `src/components/layout/Sidebar.tsx`:
- Imports: remove `LogOut` and `logout` and `FeedbackDialog`; add `import { UserMenu } from "@/components/layout/sidebar/UserMenu"`.
- Replace the footer (the `px-3 py-4 border-t border-white/10` block and the version block) with:

```tsx
        <div className="px-2 py-3 border-t border-border">
          <UserMenu collapsed={collapsed} />
          {!collapsed && (
            <p className="px-2 pt-2 text-xs text-muted-foreground">
              {process.env.NEXT_PUBLIC_APP_VERSION ?? "dev"}
            </p>
          )}
        </div>
```
- Class swaps (exact):
  - drawer: `bg-primary text-primary-foreground` → `bg-card text-foreground border-r border-border`
  - aside: `bg-primary text-primary-foreground` → `bg-card text-foreground border-r border-border`
  - every `border-white/10` → `border-border`
  - close + collapse buttons: `text-primary-foreground/60 hover:text-primary-foreground` → `text-muted-foreground hover:text-foreground`
  - logo wrapper: `rounded-lg bg-white p-2 shadow-sm` → `rounded-lg bg-white p-2` (keep its eslint-disable comment)
- Leave the mobile top bar for now (Task 4 moves it).

- [ ] **Step 7: Update Sidebar tests**

In `__tests__/components/Sidebar.test.tsx` replace the test `"keeps a Feedback trigger rendered when the desktop rail is collapsed"` with:

```tsx
it("keeps the account menu reachable when the desktop rail is collapsed", () => {
  mockRole = "ADMIN"
  render(<Sidebar churchName="Example Church" />)
  fireEvent.click(screen.getByRole("button", { name: /collapse sidebar/i }))
  expect(screen.getAllByRole("button", { name: /account menu/i }).length).toBeGreaterThan(0)
})
```
Remove the now-unused `FeedbackDialog` mock in that file.

- [ ] **Step 8: Run the sidebar suites**

Run: `npm test -- --testPathPatterns="Sidebar|UserMenu"`
Expected: PASS (both root and colocated `Sidebar.test.tsx`).

- [ ] **Step 9: Commit**

```bash
git add src/components/ui/dropdown-menu.tsx src/components/layout __tests__/components/Sidebar.test.tsx
git commit -m "feat(shell): light sidebar with user menu footer"
```

---

### Task 4: ShellContext, FeedbackDialog icon trigger, TopBar

**Files:**
- Create: `src/components/layout/ShellContext.tsx`
- Create: `src/components/layout/TopBar.tsx`
- Modify: `src/components/layout/Sidebar.tsx` (mobile state + mobile header)
- Modify: `src/components/layout/FeedbackDialog.tsx` (signature + trigger at lines ~115-138)
- Test: `src/components/layout/__tests__/TopBar.test.tsx`, `__tests__/components/FeedbackDialog.test.tsx`, `__tests__/components/Sidebar.test.tsx`, `src/components/layout/__tests__/Sidebar.test.tsx`

**Interfaces:**
- Consumes: `buildQuickAddItems` (Task 1), DropdownMenu (Task 3).
- Produces: `ShellProvider({ children })`, `useShell(): { mobileOpen: boolean; setMobileOpen: (open: boolean) => void; menuButtonRef: React.RefObject<HTMLButtonElement | null>; drawerId: string }`; `TopBar(props: { churchName: string; pendingUpdates?: number; membershipPending?: number; features?: FeatureKey[] })`; `FeedbackDialog()` (no props).

- [ ] **Step 1: ShellContext**

```tsx
"use client"

import { createContext, useContext, useId, useMemo, useRef, useState } from "react"

type Shell = {
  mobileOpen: boolean
  setMobileOpen: (open: boolean) => void
  /** The top bar's hamburger; the drawer returns focus here on close. */
  menuButtonRef: React.RefObject<HTMLButtonElement | null>
  /** id of the mobile drawer, for the hamburger's aria-controls. */
  drawerId: string
}

const ShellContext = createContext<Shell | null>(null)

/** Shares the mobile drawer's open state between TopBar and Sidebar. */
export function ShellProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const drawerId = useId()
  const value = useMemo(() => ({ mobileOpen, setMobileOpen, menuButtonRef, drawerId }), [mobileOpen, drawerId])
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>
}

/** Shell state; throws outside ShellProvider so a missing provider fails loudly. */
export function useShell(): Shell {
  const ctx = useContext(ShellContext)
  if (!ctx) throw new Error("useShell must be used within ShellProvider")
  return ctx
}
```

- [ ] **Step 2: Sidebar uses the context and drops its mobile header**

In `Sidebar.tsx`:
- Remove `Menu` from the lucide import; add `import { useShell } from "@/components/layout/ShellContext"`.
- Replace `const [mobileOpen, setMobileOpen] = useState(false)`, `const drawerId = useId()` and `const menuButtonRef = useRef<HTMLButtonElement>(null)` with `const { mobileOpen, setMobileOpen, menuButtonRef, drawerId } = useShell()`. Drop `useId` from the react import if now unused.
- Delete the whole `{/* Mobile top bar */}` `<div className="md:hidden print:hidden fixed top-0 …">…</div>` block.
- The `TooltipProvider` wrapper stays.

- [ ] **Step 3: FeedbackDialog single icon trigger**

Change signature to `export function FeedbackDialog() {` and replace the `{collapsed ? (…) : (…)}` trigger block with:

```tsx
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button variant="outline" size="icon" aria-label="Feedback">
              <MessageSquarePlus aria-hidden="true" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Feedback</TooltipContent>
      </Tooltip>
```
Update its JSDoc: `/** Feedback icon button (top bar) opening the bug/feature/idea dialog. Needs a TooltipProvider ancestor. */`

In `__tests__/components/FeedbackDialog.test.tsx`: wrap every `render(<FeedbackDialog />)` as `render(<TooltipProvider><FeedbackDialog /></TooltipProvider>)` (import already exists), and rename the `"collapsed variant…"` test to `"renders an icon-only Feedback trigger with a tooltip"` with `<FeedbackDialog />` (no prop).

- [ ] **Step 4: Write the failing TopBar test**

`src/components/layout/__tests__/TopBar.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react"
import { TopBar } from "../TopBar"
import { ShellProvider } from "../ShellContext"
import type { FeatureKey } from "@/lib/features"

let mockRole: string | undefined = "ADMIN"
jest.mock("next-auth/react", () => ({ useSession: () => ({ data: mockRole ? { user: { role: mockRole } } : undefined }) }))
jest.mock("next/navigation", () => ({ usePathname: () => "/" }))
jest.mock("@/lib/actions/feedback", () => ({ submitFeedback: jest.fn() }))

afterEach(() => { mockRole = "ADMIN" })

const renderBar = (props: Partial<React.ComponentProps<typeof TopBar>> = {}) =>
  render(<TopBar churchName="Example Church" {...props} />, { wrapper: ShellProvider })

it("opens the New menu with role-allowed entries", () => {
  renderBar()
  fireEvent.keyDown(screen.getAllByRole("button", { name: /^new$/i })[0], { key: "Enter" })
  expect(screen.getByRole("menuitem", { name: "Transaction" })).toHaveAttribute("href", "/accounting/transactions/new")
  expect(screen.getByRole("menuitem", { name: "Person" })).toHaveAttribute("href", "/people/new")
})

it("hides the New button when the role can add nothing", () => {
  mockRole = "VIEWER"
  renderBar()
  expect(screen.queryAllByRole("button", { name: /^new$/i })).toHaveLength(0)
})

it("drops entries for features that are off", () => {
  renderBar({ features: ["accounting"] as FeatureKey[] })
  fireEvent.keyDown(screen.getAllByRole("button", { name: /^new$/i })[0], { key: "Enter" })
  expect(screen.queryByRole("menuitem", { name: "Event" })).toBeNull()
})

it("bell shows a dot and links only the non-zero counts", () => {
  renderBar({ pendingUpdates: 2, membershipPending: 0 })
  const bell = screen.getByRole("button", { name: "Notifications (2 pending)" })
  fireEvent.keyDown(bell, { key: "Enter" })
  expect(screen.getByRole("menuitem", { name: /family updates/i })).toHaveAttribute("href", "/families/updates")
  expect(screen.queryByRole("menuitem", { name: /membership forms/i })).toBeNull()
})

it("bell shows an all-caught-up state with no counts", () => {
  renderBar()
  fireEvent.keyDown(screen.getByRole("button", { name: "Notifications" }), { key: "Enter" })
  expect(screen.getByText(/all caught up/i)).toBeInTheDocument()
})

it("shows the Settings link to admins only", () => {
  renderBar()
  expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings")
  mockRole = "PASTOR"
  renderBar()
  expect(screen.getAllByRole("link", { name: "Settings" })).toHaveLength(1)
})

it("hamburger toggles the shared drawer state", () => {
  renderBar()
  const menu = screen.getByRole("button", { name: "Open menu" })
  expect(menu).toHaveAttribute("aria-expanded", "false")
  fireEvent.click(menu)
  expect(menu).toHaveAttribute("aria-expanded", "true")
})
```

- [ ] **Step 5: Run to verify it fails**

Run: `npm test -- --testPathPatterns=TopBar`
Expected: FAIL — module not found.

- [ ] **Step 6: Implement TopBar**

`src/components/layout/TopBar.tsx`:

```tsx
"use client"

import { useMemo } from "react"
import Image from "next/image"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { Bell, Inbox, Menu, Plus, Settings, UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { FeedbackDialog } from "@/components/layout/FeedbackDialog"
import { useShell } from "@/components/layout/ShellContext"
import { buildQuickAddItems } from "@/components/layout/topbar/quickAdd"
import { isAdmin } from "@/lib/roleGuard"
import type { FeatureKey } from "@/lib/features"

/**
 * Sticky bar above page content: hamburger + crest + church name on mobile,
 * "+ New" quick-add menu, then Feedback, notifications bell and (admins)
 * Settings on the right.
 */
export function TopBar({
  churchName,
  pendingUpdates = 0,
  membershipPending = 0,
  features,
}: Readonly<{
  churchName: string
  pendingUpdates?: number
  membershipPending?: number
  /** Enabled features (array: Sets don't cross the server→client boundary); omitted = all on. */
  features?: FeatureKey[]
}>) {
  const { data: session } = useSession()
  const role = session?.user?.role
  const { mobileOpen, setMobileOpen, menuButtonRef, drawerId } = useShell()

  const featureSet = useMemo(() => (features ? new Set(features) : undefined), [features])
  const quickAdd = useMemo(() => buildQuickAddItems(role, featureSet), [role, featureSet])

  const notices = [
    { href: "/families/updates", label: "Family Updates", icon: Inbox, count: pendingUpdates },
    { href: "/memberships", label: "Membership Forms", icon: UserPlus, count: membershipPending },
  ].filter((n) => n.count > 0)
  const pending = notices.reduce((sum, n) => sum + n.count, 0)

  return (
    <TooltipProvider>
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-card px-4 print:hidden md:px-8">
        <button
          ref={menuButtonRef}
          onClick={() => setMobileOpen(true)}
          className="-ml-2.5 p-2.5 text-muted-foreground hover:text-foreground md:hidden"
          aria-label="Open menu"
          aria-expanded={mobileOpen}
          aria-controls={drawerId}
        >
          <Menu className="w-5 h-5" />
        </button>
        <span className="flex min-w-0 items-center gap-2 md:hidden">
          {/* eslint-disable-next-line no-restricted-syntax -- white backdrop is intentional: crest artwork, must stay white in dark mode */}
          <span className="flex items-center rounded bg-white p-0.5">
            <Image src="/api/branding/crest" alt="" width={128} height={145} className="h-8 w-auto" unoptimized />
          </span>
          <span className="truncate font-display text-base font-semibold tracking-tight">{churchName}</span>
        </span>

        {quickAdd.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-label="New" className="ml-auto md:ml-0">
                <Plus aria-hidden="true" />
                <span className="hidden md:inline">New</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {quickAdd.map(({ href, label, icon: Icon }) => (
                <DropdownMenuItem key={href} asChild>
                  <Link href={href}><Icon aria-hidden="true" />{label}</Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <div className={quickAdd.length > 0 ? "flex items-center gap-2 md:ml-auto" : "ml-auto flex items-center gap-2"}>
          <FeedbackDialog />
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="relative"
                    aria-label={pending > 0 ? `Notifications (${pending} pending)` : "Notifications"}
                  >
                    <Bell aria-hidden="true" />
                    {pending > 0 ? (
                      <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-destructive" aria-hidden="true" />
                    ) : null}
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">Notifications</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>Needs attention</DropdownMenuLabel>
              {notices.length === 0 ? (
                <p className="px-2 py-3 text-sm text-muted-foreground">You&apos;re all caught up.</p>
              ) : (
                notices.map(({ href, label, icon: Icon, count }) => (
                  <DropdownMenuItem key={href} asChild>
                    <Link href={href}>
                      <Icon aria-hidden="true" />
                      <span className="flex-1">{label}</span>
                      <span className="rounded-full bg-warning px-2 py-0.5 text-xs font-semibold text-warning-foreground">{count}</span>
                    </Link>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {isAdmin(role) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button asChild variant="outline" size="icon" className="hidden md:inline-flex">
                  <Link href="/settings" aria-label="Settings"><Settings aria-hidden="true" /></Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Settings</TooltipContent>
            </Tooltip>
          )}
        </div>
      </header>
    </TooltipProvider>
  )
}
```

Note: the menu item accessible name for the bell rows includes the count ("Family Updates 2") — the test uses a regex, so that's fine. `hidden md:inline-flex` keeps the Settings link in the DOM, so the admin-only test still finds it.

- [ ] **Step 7: Move the drawer Escape test to render both**

In `__tests__/components/Sidebar.test.tsx`:
- Add `import { ShellProvider } from "@/components/layout/ShellContext"` and `import { TopBar } from "@/components/layout/TopBar"`; mock feedback action: `jest.mock("@/lib/actions/feedback", () => ({ submitFeedback: jest.fn() }))`.
- Every `render(<Sidebar … />)` → `render(<Sidebar … />, { wrapper: ShellProvider })` (`rerender` keeps the wrapper).
- In the Escape test render `<><TopBar churchName="Example Church" /><Sidebar churchName="Example Church" /></>` with the wrapper; the assertions stay the same.

In `src/components/layout/__tests__/Sidebar.test.tsx` add `{ wrapper: ShellProvider }` to its render.

- [ ] **Step 8: Run the suites**

Run: `npm test -- --testPathPatterns="TopBar|Sidebar|FeedbackDialog|UserMenu"`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/components/layout __tests__/components
git commit -m "feat(shell): top bar with quick-add, bell, feedback, settings"
```

---

### Task 5: Layout wiring

**Files:**
- Modify: `src/app/(dashboard)/layout.tsx:43-60`
- Test: `src/app/(dashboard)/__tests__/layout.test.tsx`

**Interfaces:**
- Consumes: `ShellProvider`, `TopBar` (Task 4).

- [ ] **Step 1: Write the failing test**

In `layout.test.tsx` add mocks next to the Sidebar mock:

```ts
jest.mock("@/components/layout/TopBar", () => ({ TopBar: () => null }))
jest.mock("@/components/layout/ShellContext", () => ({ ShellProvider: ({ children }: { children: React.ReactNode }) => children }))
```
Generalise the walker and add a test:

```ts
/** Depth-first search of the element tree for the first element whose props pass `match`. */
function findProps(tree: unknown, match: (p: Record<string, unknown>) => boolean): Record<string, unknown> | undefined {
  const el = tree as { props?: Record<string, unknown> } | null
  if (!el || typeof el !== "object") return undefined
  if (el.props && match(el.props)) return el.props
  const kids = el.props?.children
  for (const k of Array.isArray(kids) ? kids : [kids]) {
    const found = findProps(k, match)
    if (found) return found
  }
  return undefined
}

it("passes the pending counts and church name to the top bar", async () => {
  mockAuth.mockResolvedValue({ user: { role: "ADMIN" } })
  mockGroupBy.mockResolvedValue([])
  const tree = await DashboardLayout({ children: null })
  const top = findProps(tree, (p) => "churchName" in p && !("verifyPending" in p))
  expect(top).toMatchObject({ churchName: "Test Church", pendingUpdates: 0, membershipPending: 0 })
  expect(Array.isArray(top?.features)).toBe(true)
})
```
(Keep `sidebarProps` as `(t) => findProps(t, (p) => "verifyPending" in p)` so existing tests are untouched.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --testPathPatterns="\(dashboard\)/__tests__/layout"`
Expected: new test FAIL (`top` undefined).

- [ ] **Step 3: Implement**

Layout imports: add `import { TopBar } from "@/components/layout/TopBar"` and `import { ShellProvider } from "@/components/layout/ShellContext"`. Replace the inner `<div className="flex flex-1">…</div>`:

```tsx
      <ShellProvider>
        <div className="flex flex-1">
          <Sidebar churchName={churchName} pendingUpdates={pendingUpdates} verifyPending={verifyPending} membershipPending={membershipPending} features={[...features]} />
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar churchName={churchName} pendingUpdates={pendingUpdates} membershipPending={membershipPending} features={[...features]} />
            <main id="main-content" className="min-w-0 flex-1 bg-muted p-4 md:p-8">{children}</main>
          </div>
        </div>
      </ShellProvider>
```
(`pt-16` / `md:pt-8` dropped — the top bar is in normal flow now.)

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPatterns="layout"`
Expected: PASS.

- [ ] **Step 5: Check sticky offsets that assumed the old fixed mobile bar**

Run: `grep -rn "top-14\|scroll-mt-32\|pt-16" src --include=*.tsx | grep -v __tests__`
For each hit inside a dashboard page: the main column now scrolls with a 56px sticky top bar on **all** widths, so `md:top-0` sticky elements must become `top-14` at every width (e.g. `SettingsNav`: `sticky top-14 md:top-0` → `sticky top-14`; `scroll-mt-32 md:scroll-mt-16` → `scroll-mt-32`). Change only those classes.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(dashboard)" src/components
git commit -m "feat(shell): render top bar in dashboard layout"
```

---

### Task 6: Verify, docs, follow-ups, PR

**Files:**
- Modify: `website/src/content/docs/docs/dashboard.md`, `website/src/content/docs/docs/feedback-widget.md`, plus any grep hit below.

- [ ] **Step 1: Full checks**

Run: `npm run lint && npx tsc --noEmit && npm test -- --testPathPatterns="Sidebar|SidebarGroup|SidebarLink|navData|TopBar|UserMenu|quickAdd|FeedbackDialog|layout"`
Expected: no lint/type errors; all PASS.

- [ ] **Step 2: Manual check in the browser**

Start dev (`DISABLE_OTP=true npm run dev`, demo seed `admin@example.com`). Use the `run` skill to drive it. Check at 375px and 1920px, OS light and dark:
- sidebar pill on Dashboard; open Accounting → guide line + rotated chevron; collapse rail → icons + user avatar.
- user menu → My Account, Help, Sign out work.
- top bar New menu (admin 4 entries; log in as `secretary@example.com` → OFFICE_ADMIN no Transaction).
- bell dot when a family update is pending; caught-up state otherwise.
- mobile: hamburger opens drawer, Escape closes, focus returns to hamburger.
- `/settings` jump links don't hide under the top bar.

- [ ] **Step 3: Docs**

Run: `grep -rn -i "sidebar\|sign out\|feedback button" website/src/content/docs/docs/ README.md`
Update every sentence that says Feedback or Sign out lives in the sidebar footer: Feedback → "the speech-bubble button in the top bar"; Sign out → "your name at the bottom of the sidebar → Sign out". In `dashboard.md` add a short "Navigation" paragraph: top bar (New menu by role, bell for family updates and membership forms, Settings for admins), sidebar groups, user menu.

- [ ] **Step 4: Commit docs**

```bash
git add website README.md
git commit -m "docs: top bar and sidebar user menu"
```

- [ ] **Step 5: Follow-ups already on board as drafts (OSS-316 search, OSS-317 theme) — no public issues without PO OK**

- [ ] **Step 6: Push and open PR**

```bash
git push -u origin feat/moneymatter-shell
gh pr create --title "feat: MoneyMatter-style app shell (light sidebar + top bar)" --body "<summary, screenshots 375px + 1920px, test plan>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```
Add the PR to the board. This is ≥150 logic lines → risky tier per CLAUDE.md: `/code-review high`, wait for a CodeRabbit review of head, disposition table before merge.
