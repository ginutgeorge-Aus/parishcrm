---
title: "Financial Reports"
description: "All accounting reports live under /accounting/reports/*, are visible to anyone with canViewAccounting (ADMIN, PASTOR, AUDITOR, OFFICE_ADMIN), and log a…"
---

All accounting reports live under `/accounting/reports/*`, are visible to anyone with `canViewAccounting` (ADMIN, PASTOR, AUDITOR, OFFICE_ADMIN), and log a `VIEW_FINANCIAL_REPORT` audit entry on every page load (a CSV/PDF export logs a separate `EXPORT_FINANCIAL_REPORT`/`EXPORT_...` entry). Every report has a print-friendly view (a `PrintButton` that triggers the browser's print dialog against print-specific styling, or in the P&L's case a dedicated `(print)` route-group page), and most support a CSV download for spreadsheet work.

## Using it

| Report | What it shows | Notes |
|--------|----------------|-------|
| **Profit & Loss** (`/accounting/reports/pl`) | Income and expense by category (grouped like the chart of accounts) for a financial year, with an optional monthly breakdown | Has a dedicated print layout at `/accounting/pl/print` |
| **Balance Sheet** (`/accounting/reports/balance-sheet`) | Each payment account's book balance "as at" a chosen date (opening balance + all income − all expenses since) | Date-pickable; "book balance" — see the note in [Reconciliation](/parishcrm/docs/reconciliation/) about why this can differ from the reconciliation page's figure for the same account |
| **Cash Flow** (`/accounting/reports/cash-flow`) | Operating cash in/out by account group for a financial year | Same account-grouping structure as the P&L |
| **Trial Balance** (`/accounting/reports/trial-balance`) | Every account's FY total, for a basic debit/credit sanity check | |
| **General Ledger** (`/accounting/reports/general-ledger`) | A single account's full transaction history for a FY, with a running balance | Pick the account from the dropdown, or arrive via a "transaction count" link from the Chart of Accounts page |
| **Budget vs Actual** (`/accounting/reports/budget-vs-actual`) | See [Budgets](/parishcrm/docs/budgets/) | |
| **Fund Report** (`/accounting/reports/funds`) | Income/expense/net per [fund](/parishcrm/docs/accounting-overview/) for a FY, including an "unassigned" bucket for entries with no fund | |
| **Giving Summary** (`/accounting/reports/giving-summary`) | Per-family total giving for a FY — the basis for tax receipting | Donor email is only shown to roles that can also view people (`canViewPeople`) — AUDITOR is accounting-only and never sees decrypted donor email, on screen or in the export |
| **Dues** (`/accounting/reports/dues`) | Per-family subscription/membership-dues payment status for a FY, with an "owing only" filter | Matches against a specific seeded income account by its account code |
| **Reconciliation report** (`/accounting/reports/reconciliation`) | Printable snapshot of the reconciliation equation for one statement date | The day-to-day working version is [Reconciliation](/parishcrm/docs/reconciliation/) |

CSV exports (e.g. the transaction list, giving summary) prefix any cell starting with `=`, `+`, `-`, or `@` with a leading apostrophe — a standard defence against formula injection when a spreadsheet later opens the file.

## How it works

### Account grouping

Most reports share one helper, `groupByAccountGroup` (`src/lib/reports/accountGrouping.ts`), which buckets accounts by their `AccountGroup` (falling back to an "Other"/ungrouped bucket) and sorts by the group's configured sort order — so every report presents categories in the same order as the chart of accounts.

### Account universe: active-or-has-activity

FY reports don't simply filter to `isActive: true` accounts — an account that was deactivated partway through the year would then silently vanish from that year's report even though it has real transactions in it. Instead the account query is `isActive OR has a transaction in this FY` (the Budget vs Actual report additionally includes an account with a budget row for the year, even with zero transactions, so a budgeted-but-unused category still shows a variance). The internal transfer clearing account used by petty-cash-to-bank transfers is excluded everywhere by its account code — it isn't real income or expense, just a bookkeeping bridge between the cash and bank ledgers, and including it would inflate expense totals.

### Aggregation strategy

Annual totals are summed **in the database** via `transaction.groupBy` — never pulled into JS row-by-row — which is why these reports stay fast regardless of how many transactions a parish accumulates over the years. Monthly P&L breakdowns and the General Ledger's running balance are the exception: they genuinely need every row in order, so they're streamed in keyset-paginated batches (bounding memory to one batch at a time) rather than loaded all at once. The General Ledger additionally caps at a fixed row ceiling per account per year with a "truncated" notice, as a defensive limit rather than something expected to be hit in normal parish-scale use.

### Money precision

Every report accumulates figures in **integer cents** throughout its computation and only converts to a dollar string at the point of display — the same convention described in [Accounting Overview](/parishcrm/docs/accounting-overview/). This matters most here because these reports sum across potentially hundreds of transactions; doing that arithmetic in floating-point dollars would risk the kind of cent-level drift that makes a report look "off by a cent" for no discoverable reason.

### FY selection

Every report clamps a `?year=` query parameter to a sane bounded range (roughly year 2000 through a decade past the current financial year) and falls back to the current FY on anything outside that or malformed — so a stray or hand-edited URL parameter can't trigger an unbounded or nonsensical query.

## Configuration

No dedicated environment variables beyond the financial-year/locale/currency settings described in [Accounting Overview](/parishcrm/docs/accounting-overview/).
