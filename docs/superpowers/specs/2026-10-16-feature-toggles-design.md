# Feature toggles — design

Date: 2026-10-16 · Status: approved (PO) · Plan: `docs/superpowers/plans/2026-10-16-feature-toggles.md`

## Problem

ParishCRM now ships many modules (events, memberships, Sunday School, clearances, a large accounting
suite, …). A small church that only wants a member directory sees all of it — the sidebar, dashboard and
settings are noisy. Admins need to tick the features they use and come back later to switch more on.

All code ships in one build, so "install later" means **switch a feature on/off at runtime**, not a
separate install.

## Decisions (PO, 2026-10-16)

| Question | Decision |
|---|---|
| Where to choose | Both: first-run prompt for new churches **and** Settings → Features at any time |
| Granularity | Top-level modules + sub-features under Accounting |
| What "off" means | Hidden **and** blocked (pages, actions, public endpoints, scheduled jobs). Data never deleted; switching back on restores everything |

## Approach

**Code registry + one `AppSetting` row.** Rejected: a new `FeatureToggle` table (needs a migration → a
human-reviewed prod bump, no benefit) and env vars (church config lives in the DB; admins can't edit
env).

### Registry — `src/lib/features.ts` (pure, no DB)

```ts
type FeatureKey = "events" | "memberships" | "sundaySchool" | ...
type FeatureDef = {
  key: FeatureKey
  label: string
  description: string        // one line, shown on the Features page
  parent?: FeatureKey        // child is off whenever parent is off
  requires?: FeatureKey[]    // other features that must be on
  defaultOn: boolean         // used when the DB has no override
}
```

Features:

| Key | Parent | Requires | Covers |
|---|---|---|---|
| `celebrations` | — | — | Birthdays, anniversaries pages + dashboard tiles + celebration emails |
| `clearances` | — | — | Child-safety clearances |
| `familyUpdates` | — | — | Public family self-update form + review inbox |
| `memberships` | — | — | Public membership application form + review |
| `welcomeLetter` | — | — | Welcome letter generator |
| `sundaySchool` | — | — | Classes + attendance |
| `events` | — | — | Events, registrations, check-in, organiser area, public event pages, Stripe event payments, website sync |
| `accounting` | — | — | Whole accounting area (overview, transactions, reports, settings) |
| `reconciliation` | accounting | — | Reconciliation + its report |
| `bankImport` | accounting | — | ANZ PDF/CSV bank import |
| `pettyCash` | accounting | — | Petty cash sessions |
| `dues` | accounting | memberships | Subscription dues |
| `receipts` | accounting | — | Send receipts + receipt audit log |
| `dgrReceipts` | accounting | — | DGR receipts |
| `invoices` | accounting | — | Invoices + customers |
| `budget` | accounting | — | Budget + budget-vs-actual report |

Core, never toggleable: dashboard, people, families, users, settings, audit log, CSV import, help.

All existing features: `defaultOn: true`. Future features may ship `defaultOn: false` so they stay quiet
until an admin opts in.

### Storage

`AppSetting` key `features` = JSON object of overrides only, e.g. `{"events":false,"budget":false}`.
Missing key / unparseable JSON → registry defaults (fail-open to defaults, log a warning). Unknown keys
in the JSON are ignored.

Resolution (`resolveFeatures(overrides)`, pure): `on(k) = (overrides[k] ?? def.defaultOn) && on(parent)
&& every(on(r) for r in requires)`.

### Server helpers — `src/lib/featureFlags.ts` (`server-only`)

- `getEnabledFeatures()` — reads the row once per request (`React.cache`), returns `Set<FeatureKey>`.
- `isFeatureOn(key)` → boolean.
- `requireFeature(key)` — for pages; calls `notFound()` when off.
- `featureGuard(key)` — for Server Actions; returns `null` when on, else the standard `ActionResult` error
  `"This feature is turned off. An admin can enable it in Settings → Features."`.
- `saveFeatures(input)` (Server Action in `src/lib/actions/features.ts`) — ADMIN only, rejects DEMO_MODE,
  zod-validates keys against the registry, writes the row and `logAuditTx` (`resourceType: "AppSetting"`,
  old → new diff) in one transaction, revalidates the layout.

### Enforcement points

1. **Sidebar:** `NavFlags` gets `features: Set<FeatureKey>`; each nav item's `show` ANDs its feature.
2. **Dashboard home:** widgets for an off feature are not rendered (and their queries are skipped).
3. **Pages:** each feature's route segment calls `requireFeature` in its `layout.tsx` (one call per
   segment, not per page).
4. **Server Actions:** every exported action in a feature's action files checks the feature first.
5. **Public/organiser/print routes + API routes:** public event pages, registration, new Stripe event
   checkouts, membership apply, family update form, website event sync, and the feature's `(print)`
   pages → 404/`notFound` when off. The **Stripe webhook is not gated**: payments, refunds and disputes
   for checkouts that already exist still settle (a customer mid-checkout when Events is turned off
   must still get their registration).
6. **Scheduler jobs + cron routes:** jobs tied to a feature skip (log "skipped: feature off"); a skip is
   not recorded as the period's success. The checkout sweep is not gated (it settles in-flight checkouts).
7. **Settings sub-sections** owned by a feature (e.g. accounting settings, email templates for events)
   hide when off.

Accounting-wide reports that aggregate across sub-features (P&L, balance sheet) stay available while
`accounting` is on — sub-toggles only hide the sub-feature's own screens.

### Settings → Features page — `/settings/features` (ADMIN only)

Grouped checklist (switch + label + description). Children render indented under their parent and are
disabled (greyed, with "needs Accounting") while the parent/requirement is off. Single Save button →
`saveFeatures`. Mobile-first (many phone users): full-width rows at 375px. Linked from the
Settings sidebar group and from the App Settings page.

### First-run prompt

- The first-admin setup action writes `AppSetting` `features.onboarding = "pending"`.
- Dashboard home page (not the layout, which also wraps `/settings/features`): if the user is ADMIN and
  the flag is `pending`, redirect to `/settings/features?welcome=1`. Page load does not clear it; Save or
  "Keep defaults" (`finishFeatureOnboarding`, DEMO_MODE-blocked) does.
- Welcome banner: "Pick what your church needs. You can change this any time in Settings → Features."
- Existing installs never have the flag → never prompted. DEMO_MODE: never prompted, all on.

## Error handling

- Corrupt JSON → defaults + `console.warn`; Features page shows defaults and Save overwrites.
- Turning off a feature with in-flight data (e.g. open event registrations) is allowed; the page shows
  a one-line warning on features with public surfaces ("Public registration links will stop working").
- Non-admin calling `saveFeatures` → standard forbidden result.

## Testing

- `features.test.ts`: defaults, overrides, parent cascade, `requires`, unknown keys, corrupt JSON.
- `featureFlags.test.ts`: per-request caching, `requireFeature` → notFound, action guard result.
- `navData` test: items hidden per feature.
- Settings page/action tests: ADMIN gate, audit log written, validation.
- One representative guard test per enforcement kind (page layout, action, public API, scheduler job).
- First-run: setup sets flag; redirect only for ADMIN with pending flag; Save clears it.

## Docs

Website docs page `website/src/content/docs/docs/` (new "Choosing features" page) + README feature-list
note, in the PR that ships the Settings page.

## Delivery

- **PR 1 (OSS-309 (#309)):** registry, helpers, Settings → Features page, all enforcement points, docs.
- **PR 2 (OSS-310 (#310)):** first-run prompt + onboarding flag.

## Out of scope

Per-role or per-user feature visibility (roles already cover that); deleting data of an off feature;
per-feature licensing.
