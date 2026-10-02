---
title: "Accounting Overview"
description: "ParishCRM includes a full double-entry-style accounting module for a single parish: a chart of accounts, a transaction ledger, bank statement import, petty…"
---

ParishCRM includes a full double-entry-style accounting module for a single parish: a chart of accounts, a transaction ledger, bank statement import, petty cash, budgets, tax-deductible giving receipts, and a set of financial reports. It is not a general ledger package — it models exactly what a small parish office needs: track income and expenses against categories, reconcile bank statements, track giving per family for receipting, and produce year-end reports for the parish council or auditor.

## Using it

All accounting screens live under **Accounting** in the sidebar, visible only to roles with accounting access. Who can do what:

| Role | Can view accounting | Can enter/edit transactions | Can manage settings (accounts, opening balances, period lock) |
|------|---------------------|------------------------------|-----------------------------------------------------------------|
| ADMIN | Yes | Yes | Yes |
| PASTOR | Yes | Yes | No (view-only for settings) |
| OFFICE_ADMIN | Yes (read-only) | No | No |
| AUDITOR | Yes (read-only) | No | No |
| VIEWER | No | No | No |
| EVENT_ORGANISER | No | No | No |

This maps to two helper checks used throughout the module: **`canViewAccounting`** (ADMIN, PASTOR, AUDITOR, OFFICE_ADMIN — read paths, reports, transaction list) and **`canAccessAccounting`** (ADMIN, PASTOR only — creating/editing/deleting transactions, petty cash entries, sending receipts). A smaller set of destructive or structural actions (deleting a transaction, editing the chart of accounts, opening balances, the period lock, payment accounts, funds, budgets) are **ADMIN only**.

The Accounting landing page (`/accounting`) is a dashboard: current balance per payment account (bank/cash), a quick summary of the current financial year's income vs. expenses, and links into every sub-area below.

Sub-areas, each documented on its own page:

- [Transactions](/parishcrm/docs/transactions/) — the ledger: entering, editing, categories (chart of accounts), funds, notes, attachments.
- [Bank Statement Import](/parishcrm/docs/bank-statement-import/) — uploading an ANZ PDF statement, auto-matching members, splitting a line across categories.
- [Reconciliation](/parishcrm/docs/reconciliation/) — matching the ledger to a bank statement, the reconciliation equation, period lock.
- [Budgets](/parishcrm/docs/budgets/) — annual budgets per account and the Budget vs Actual report.
- [Financial Reports](/parishcrm/docs/financial-reports/) — P&L, Balance Sheet, Cash Flow, Trial Balance, General Ledger, Giving Summary, Dues, Funds.
- [Receipts](/parishcrm/docs/receipts/) — emailed transaction receipts, annual DGR (tax-deductible) donation receipts, and the receipt audit trail.
- [Petty Cash](/parishcrm/docs/petty-cash/) — weekly cash sessions, receipts/expenses/transfers, closing with a physical cash count.

## How it works

### Chart of accounts

- **`AccountGroup`** (`prisma/schema.prisma`): a named, typed (`INCOME`/`EXPENSE`) bucket used purely for grouping/sort order on reports — e.g. "Offerings", "Facilities". Unique on `(name, type)`. Managed at `/accounting/accounts/groups`, ADMIN only.
- **`Account`**: the actual category a transaction posts against — `code` (unique, e.g. `4001`), `name`, `type`, optional `groupId`, `isActive`. New codes auto-increment within a type's range (`4xxx` for income, `5xxx` for expense) if left blank. An account's type must match its group's type. Deactivating an account keeps its history intact everywhere (reports still include inactive accounts that have transactions in the period); deleting one is blocked while any transaction, budget, or petty-cash entry still references it.
- Managed at `/accounting/accounts` (view: `canViewAccounting`; edit/delete: ADMIN).

### Payment accounts and funds

- **`PaymentAccount`**: a bank or cash account transactions are posted against (`kind`: `BANK` or `CASH`). Exactly one can be the default; only one active `CASH` account is allowed at a time (petty cash posts against it). Managed in Accounting Settings, ADMIN only.
- **`Fund`**: an optional secondary tag (e.g. "Building Fund", "Missions") independent of the account/category, so a gift or expense can be tracked both by category and by fund. The "General" fund cannot be renamed or deleted. A fund can't be deleted while any transaction or petty-cash entry still references it.

### Money handling

All money columns are `Decimal(10,2)`. The codebase never round-trips a dollar value through a JS float: form input is validated against a decimal-places regex, then either the validated string is passed straight to Prisma, or amounts are summed in **integer cents** (`toCents`/`centsToNumber`/`sumCents` in `src/lib/formatting.ts`) before converting back to dollars for display. This avoids IEEE-754 drift accumulating across many small transactions, which would otherwise show up as reconciliation "off by a cent" mismatches.

### Financial year

The FY start month is configurable per install via `APP_FY_START_MONTH` (`src/lib/appConfig.ts`), defaulting to July (Australian FY). `currentFYYear()` and `fyDateRange()` (`src/lib/fiscalYear.ts`) derive the FY from the parish's configured local time, not the server clock — the server typically runs UTC, so a naive server-clock check would flip the financial year hours early or late at the FY boundary. All FY-scoped reports and DGR receipts use these two helpers.

### Locking a period

An ADMIN can set an **accounting lock date** (Accounting Settings → Period Lock). Any transaction, petty-cash entry, or reconciliation statement dated on or before that date becomes read-only — no create, edit, or delete — enforced server-side in every relevant action (`assertUnlocked` / `isDateLocked` in `src/lib/accountingLock.ts`), not just hidden in the UI. This is how a parish "closes the books" for a period after it's been reviewed.

### Audit trail

Every accounting mutation — and every read of donor-identifying data (receipt sends, decrypted email addresses) — is written to an append-only `AuditLog` via `logAudit()` (`src/lib/audit.ts`). Report page loads log `VIEW_FINANCIAL_REPORT`; CSV/PDF exports log `EXPORT_FINANCIAL_REPORT`/`EXPORT_TRANSACTION_CSV`. This lets an AUDITOR (or the parish council) answer "who looked at what, and when."

## Configuration

| Variable | Purpose |
|----------|---------|
| `APP_FY_START_MONTH` | Financial year start month, 1–12 (default 7 = July) |
| `APP_TIMEZONE` | IANA timezone used to derive "today" and the FY boundary (default `Australia/Sydney`) |
| `APP_CURRENCY` | ISO-4217 currency code used for formatting (default `AUD`) |
| `APP_LOCALE` | BCP-47 locale for money/date formatting (default `en-AU`) |
| `CHURCH_NAME`, `CHURCH_ADDRESS`, `CHURCH_ABN`, `CHURCH_WEBSITE` | Fallback parish identity used on receipts/reports until an ADMIN fills in Settings → Church Information, which then takes precedence |
