# Settings area redesign — one area, left tabs, card rows

Date: 2026-10-20
Status: approved (PO)
Inspiration: MoneyMatter (`letehaha/budget-tracker`) settings pages.
Depends on: `2026-10-20-app-shell-redesign-design.md` (shared pill style, `dropdown-menu`).

## Goal

Merge App Settings (`/settings`, one long anchor-nav page) and Accounting Settings
(`/accounting/settings`, stacked cards) into one `/settings` area with a left tab list. Each tab
is its own page with one MoneyMatter-style card: big title + subtitle, then rows with label and
description on the left and the control on the right.

## Non-goals

- No change to any Server Action's logic, validation or auth.
- No new settings.
- Users (`/users`) and Release Checks (`/verify`) stay where they are (different role gates).

## 1. Routes

All under `src/app/(dashboard)/settings/`, sharing `settings/layout.tsx`.

| Group | Tab | Route | Content (existing component) | Shown when |
|---|---|---|---|---|
| Church | General | `/settings` | `ChurchInfoForm`, `AppSettingsForm` | always |
| | Branding | `/settings/branding` | `BrandingForm` | always |
| | Email | `/settings/email` | birthday/anniversary forms, `AutoEmailToggles` (feature `celebrations`), `EmailTemplatesSection` | always |
| | Members | `/settings/members` | `LetterSettingsForm`, `MembershipSettingsForm` | `welcomeLetter` or `memberships` |
| | Receipts | `/settings/receipts` | `ReceiptSettingsSection` | `receipts` or `dgrReceipts` |
| | Features | `/settings/features` | `FeaturesForm` (page exists) | always |
| Accounting | Opening Balances | `/settings/accounting` | `OpeningBalanceForm` | always |
| | Payment Accounts | `/settings/accounting/accounts` | `PaymentAccountsManager` | always |
| | Period Lock | `/settings/accounting/period-lock` | `PeriodLockForm` | always |
| | Petty Cash | `/settings/accounting/petty-cash` | `PettyCashCustodianForm` | `pettyCash` |
| | Invoices | `/settings/accounting/invoices` | `InvoiceSettingsForm` | `invoices` |
| | Funds | `/settings/accounting/funds` (+ `new`, `[id]/edit`) | moved from `/accounting/settings/funds` | always |
| System | Security | `/settings/security` | `ActivityFeed` | always |
| | Audit Log | `/settings/audit-log` | page exists | always |
| | App Usage | `/settings/usage` | page exists | always |
| | About | `/settings/about` | version + git SHA | always |

- A hidden tab's route also redirects to `/settings` (a direct link to a feature-off tab must not
  render its form).
- Each page fetches only its own data (today's `Promise.all` is split per page).

## 2. Access

- `settings/layout.tsx` redirects non-admins to `/` (`isAdmin`). Every page keeps its own
  `isAdmin` check too (layouts don't re-run on client navigation between siblings), and every
  Server Action keeps its guard — both layers, per `.claude/rules/server-actions.md`.

## 3. Redirects and links

- `next.config` `redirects()` (permanent): `/accounting/settings` → `/settings/accounting`,
  `/accounting/settings/funds/:path*` → `/settings/accounting/funds/:path*`.
- Old anchors in `src/lib/setupChecklist.ts`: `/settings#general` → `/settings`,
  `/settings#branding` → `/settings/branding`. Grep for any other `#<section>` links.
- `revalidatePath("/accounting/settings…")` calls in `src/lib/actions/{accountingSettings,
  paymentAccount,fund,invoiceSettings,settings}.ts` move to the new paths. Links in
  reconciliation, reports, petty cash and dashboard pages update to the new routes.
- `navData.ts`: "App Settings" → `/settings`, "Accounting Settings" → `/settings/accounting`;
  "Features", "Audit Log", "App Usage" leave the sidebar (now tabs). The most-specific-match rule
  keeps one item active.
- `SettingsNav.tsx` (anchor nav) is deleted.

## 4. Layout

`settings/layout.tsx` (server) builds the visible tab list from `getEnabledFeatures()` through a
pure `buildSettingsTabs(features)` in `src/components/settings/settingsTabs.ts`, and renders
`<SettingsTabs>` (client, needs `usePathname`).

- **≥ md:** two columns. Left: sticky (`top-[4.5rem]`, under the top bar) 220px list, group
  captions (`text-xs uppercase text-muted-foreground`), items using the shell's pill style
  (`bg-primary/10 text-primary` active, `aria-current="page"`). Right: `max-w-3xl` content.
- **< md:** a full-width `Select` labelled "Settings section" at the top; choosing navigates with
  `router.push`. Items grouped with `SelectGroup` + `SelectLabel`.
- Active tab = the longest tab href that is a separator-bounded prefix of the pathname (same rule
  as the sidebar), so `/settings/accounting/funds/new` highlights Funds, not Opening Balances.

## 5. Building blocks

New `src/components/settings/ui/`:

- `SettingsCard({ title, description, children, footer? })` — `rounded-xl border bg-card`;
  header `p-6` with `text-2xl font-semibold` title and `text-muted-foreground` subtitle; divider;
  body `px-6` with `divide-y divide-border` rows; optional footer `p-4 border-t flex justify-end`
  for a Save button.
- `SettingsRow({ label, description, htmlFor?, children })` — `flex flex-col gap-3 py-5
  md:flex-row md:items-center md:justify-between md:gap-8`; text block `md:max-w-[60%]`;
  control right-aligned on md+, full width below.
- `SettingsSubgroup({ title, description, children })` — a heading + a `rounded-lg border
  divide-y` box of `SettingsRow`s (inner padding `px-4`). Used for email templates, receipt
  sub-settings, and nested feature toggles.

## 6. Forms

Markup-only changes; actions, validation, `useKeepFormValues` and `FormFeedback` stay.

- **Text/number/select fields** (church info, emails, idle timeout, card fee, invoices, letter,
  opening balances): one `SettingsRow` per field, input on the right (`md:w-80`). One Save button
  in the card footer per form. A card holding two forms (General: church info + app settings) uses
  two cards stacked, each with its own Save.
- **On/off settings** (`AutoEmailToggles`, `FeaturesForm`, `MembershipSettingsForm` switches):
  `Switch` in the row. Keep each form's current save model — instant-save where it already
  auto-saves, Save button where it doesn't. Confirm per form during planning; no new save
  semantics.
- **Managers/lists** (`PaymentAccountsManager`, funds list, `ActivityFeed`, audit log): rendered
  full width inside the card body, not as rows.
- **Unsaved edits:** forms with dirty state register with a small `useUnsavedGuard(dirty)` hook
  that sets `beforeunload` and intercepts in-app tab clicks in `SettingsTabs` with a confirm
  ("Discard unsaved changes?"). Dirty state comes from the form's existing values-vs-initial
  comparison; add one where missing.

## 7. Testing

- `settingsTabs.test.ts`: tab list per feature combination; group order; hidden tabs.
- `SettingsTabs.test.tsx`: active tab for nested paths; mobile select navigates; dirty guard
  confirms.
- Per-page tests: non-admin redirect; feature-off tab redirects to `/settings`; existing form
  tests updated for new markup (by role/label, not class).
- `next.config` redirects asserted in a unit test of the exported `redirects()` list.
- Move existing `accounting/settings/__tests__` and `settings/__tests__` with their pages.
- Manual: 375px and ≥1920px, every tab, save each form once on the dev DB.

## 8. Docs

Update `website/src/content/docs/docs/settings-and-branding.md` (new layout, tab names, URLs) and
every docs page that links `/settings#…` or `/accounting/settings` (`membership-applications`,
`membership-letters`, `choosing-features`, `installation`, `index`, others found by grep), in the
same PR.

## 9. Delivery

Separate branch `feat/settings-area` off `main` after the shell PR merges. Likely two PRs if the
diff passes ~600 lines: (1) area + layout + building blocks + Church/System tabs, (2) Accounting
tabs + redirects + old-route removal.
