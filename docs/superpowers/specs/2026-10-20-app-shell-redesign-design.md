# App shell redesign — light sidebar + top bar

Date: 2026-10-20
Status: approved (PO)
Inspiration: MoneyMatter (`letehaha/budget-tracker`) app shell.
Follow-on spec: `2026-10-20-settings-area-design.md` (builds on this shell).

## Goal

Make the dashboard shell look and feel like MoneyMatter: a light sidebar with pill-style active
items and icon groups, plus a top bar with a quick-add menu and icon buttons. Keep ParishCRM's
primary colour (church branding still applies). Page content is not restyled.

## Non-goals

- No change to page bodies (they already sit on `bg-muted` with white cards).
- No new data queries. The bell reuses the pending counts the layout already loads.
- No global search (follow-up issue).
- No light/dark theme switch (follow-up issue; dark mode keeps following the OS).

## 1. Sidebar

Files: `src/components/layout/Sidebar.tsx`, `sidebar/SidebarGroup.tsx`, `sidebar/SidebarLink.tsx`,
`sidebar/navData.ts`.

- **Surface:** `bg-card text-foreground border-r border-border` replaces `bg-primary
  text-primary-foreground`. Every `white/10`, `primary-foreground/*` class swaps to semantic
  tokens (`border-border`, `text-muted-foreground`, `hover:bg-muted`). Dark mode then follows the
  existing dark card token.
- **Header:** logo (expanded) or crest (rail) sits directly on the card — the white wrapper box and
  its `no-restricted-syntax` suppressions go. Collapse button stays at the top right.
- **Active item:** `rounded-lg bg-primary/10 text-primary font-medium`. The gold left border
  (`border-l-2 border-gold`) is removed.
- **Idle item:** `text-muted-foreground hover:bg-muted hover:text-foreground`, `rounded-lg`,
  `py-2`.
- **Group header:** a full-size row like a link — icon, label in normal case (`text-sm`), chevron
  on the right (`ChevronRight` rotating 90° when open, `motion-reduce` respected). `NavGroup` gains
  a required `icon` for non-headless groups: Community → `Users`, Accounting → `Landmark`,
  Settings → `Settings`. A group containing the active page shows `text-foreground font-medium`
  (not the pill — the pill marks only the active link).
- **Sub-items:** the open panel is indented with a guide line: `ml-[1.125rem] border-l
  border-border pl-2`. Accounting `subLabel` captions stay, inside that block, as
  `text-[11px] uppercase tracking-wide text-muted-foreground/70`.
- **Badges:** pending pill stays `bg-warning text-warning-foreground`; informational pill becomes
  `bg-muted text-muted-foreground`. Collapsed-group pending total unchanged.
- **Footer:** replaces the Feedback + Sign out buttons with a **user chip**: initial avatar
  (`bg-primary/10 text-primary`), name and role (truncated), chevron. It opens a Radix
  `DropdownMenu` (new `src/components/ui/dropdown-menu.tsx`, shadcn style over `radix-ui`) with
  My Account (`/account`), Help (`/help`), separator, Sign out. Version text stays under it
  (expanded only). On the rail, the chip shows only the avatar with a tooltip.
- **Kept as is:** icon rail + its localStorage key, mobile drawer (dialog, focus trap, inert main,
  Escape handling), open-group persistence, single most-specific active match.

## 2. Top bar

New `src/components/layout/TopBar.tsx` (client component), rendered by
`src/app/(dashboard)/layout.tsx` inside the content column, above `<main>`. Layout changes to a
column: `<div className="flex min-w-0 flex-1 flex-col"><TopBar/><main/></div>`.

- **Surface:** `sticky top-0 z-30 h-14 bg-card border-b border-border`, `print:hidden`.
- **Left — "+ New" split button:** primary button, label "New", `Plus` icon, opens a
  `DropdownMenu`. Entries are built by a pure `buildQuickAddItems({ role, features })` in
  `src/components/layout/topbar/quickAdd.ts` (unit-tested):

  | Entry | Route | Shown when |
  |---|---|---|
  | Person | `/people/new` | `canEdit(role)` |
  | Family | `/families/new` | `canEdit(role)` |
  | Event | `/events/new` | `canEdit(role)` and feature `events` |
  | Transaction | `/accounting/transactions/new` | `canAccessAccounting(role)` |

  No entries → button not rendered (VIEWER, AUDITOR).
- **Right — icon buttons** (`variant="outline" size="icon"`, each with `aria-label` and tooltip):
  - **Feedback:** existing `FeedbackDialog` (gains an `variant="icon"` mode; the sidebar no longer
    renders it).
  - **Bell:** `Bell` icon with a small red dot when the pending total > 0. `DropdownMenu` lists
    Family Updates (`/families/updates`) and Membership Forms (`/memberships`) with counts, only
    the non-zero ones; empty state "You're all caught up". Counts come from layout props
    (`pendingUpdates`, `membershipPending`) — same gating as today. Release Checks is not in the
    bell (informational, stays a sidebar badge).
  - **Settings:** `Settings` icon linking to `/settings`, shown only when `isAdmin(role)`.
- **Mobile (< md):** this bar replaces the coloured mobile header in `Sidebar.tsx`. Left:
  hamburger (still controls the drawer — the drawer state moves to a small context
  `ShellProvider` in `src/components/layout/ShellContext.tsx` so TopBar and Sidebar share it),
  crest, church name. Right: "+" icon-only quick-add, bell. Feedback moves into the quick-add
  menu below a separator at this width; Settings stays reachable through the drawer.
- `main` loses its mobile `pt-16` (the bar is now in normal flow, not fixed).

## 3. Recommendations folded in

- User chip menu (above) — matches MoneyMatter's footer and frees the Settings group from
  My Account/Help clutter later.
- Quick-add menu built from a pure role+feature function, so it can't drift from page guards.
- Semantic tokens only in the shell — removes the five `no-restricted-syntax` suppressions for
  white logo boxes.

Follow-up issues to file (not this PR): global search (cmdk is already a dependency),
light/dark/system theme switch in the user chip menu.

## 4. Testing

- `Sidebar.test.tsx`: active link has `aria-current="page"` and the pill classes; group button
  `aria-expanded` toggles; user chip menu shows Sign out and calls `logout`.
- `navData` test: every non-headless group has an icon.
- New `quickAdd.test.ts`: entries per role (ADMIN, PASTOR, OFFICE_ADMIN, AUDITOR, VIEWER) and with
  `events` off.
- New `TopBar.test.tsx`: bell dot and links per counts, empty state, Settings icon admin-only,
  New button hidden with no entries.
- `layout.test.tsx`: TopBar rendered with counts.
- Manual: 375px and ≥1920px, light and dark OS theme, keyboard through drawer and menus.

## 5. Docs

Update `website/src/content/docs/docs/dashboard.md` (navigation section + screenshot) and any
README screenshot claim made stale, in the same PR.
