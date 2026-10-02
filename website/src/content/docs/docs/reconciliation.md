---
title: "Reconciliation"
description: "Reconciliation is how the parish confirms its ledger agrees with what the bank actually shows. ParishCRM supports it two ways: an interactive working page for…"
---

Reconciliation is how the parish confirms its ledger agrees with what the bank actually shows. ParishCRM supports it two ways: an interactive working page for tying out a date range transaction-by-transaction, and a "reconcile on save" shortcut where saving a statement's closing balance automatically marks every matching transaction reconciled if the books already balance.

## Using it

**`/accounting/reconciliation`** — pick a payment account and a date range (defaults to the current financial year to today). The page shows:
- A summary of reconciled vs. pending transactions (count, income, expense) for the range.
- A **reconciliation equation**: opening balance (as of the account's configured opening-balance date) + income − expenses over the period = calculated balance. Below it, an editable field for the bank statement's **closing balance** for the selected end date.
- A transaction list for the range, with a running balance column when the view isn't filtered by status and the range starts on or after the opening-balance date. Each row can be toggled reconciled/unreconciled individually, or a selection can be bulk-reconciled at once.

**Saving a statement balance**: enter the bank statement's closing balance for the end date and save. If it matches the calculated book balance exactly (compared to the cent), every unreconciled transaction in the period is automatically marked reconciled and the app tells you how many. If it doesn't match, the app tells you the calculated balance, the difference, and leaves everything unreconciled — nothing is silently forced to balance.

There is a second, **printable snapshot** version of this same equation at `/accounting/reports/reconciliation` for a fixed statement date (used when you just need the printed page for a file, rather than the interactive working view).

**Roles**: viewing is `canViewAccounting` (ADMIN, PASTOR, AUDITOR, OFFICE_ADMIN); toggling/saving is `canAccessAccounting` (ADMIN, PASTOR).

## How it works

### Book balance vs. bank balance

This is intentional and documented on both pages because it regularly confuses new users: the [Balance Sheet](/parishcrm/docs/financial-reports/) shows the **book balance** — every transaction since the opening-balance date, regardless of whether it's reconciled. The reconciliation equation on this page uses the *same* book-balance formula (that's what "Calculated Balance" is). Only the underlying transaction list's reconciled/pending split cares about the `reconciled` flag. The two pages showing the same account can legitimately display different totals if you're looking at "book balance as of today" vs. "book balance as of the last statement date" — they aren't disagreeing, they're answering different questions.

### `AccountOpeningBalance`

One row per payment account (`amount`, `asOfDate`), set by an ADMIN in Accounting Settings. It's the anchor every book-balance calculation (reconciliation, balance sheet) sums forward from — there is no "balance before this date" concept, by design; everything before the opening-balance date is out of scope for the ledger.

### `ReconciliationStatement`

One row per `(paymentAccount, statementDate)` — the closing balance you entered for that date, persisted so the page pre-fills on reload rather than asking again. Saving it (`saveStatementBalance`, `src/lib/actions/reconciliation.ts`) and deciding whether to auto-reconcile run inside a single serializable database transaction, so a concurrent import or entry landing in the same window can't create a half-applied reconcile (the statement saved but the transactions not updated, or vice versa) — a conflicting concurrent write is retried automatically rather than surfacing as an error.

### Reconcile-on-save and the period lock

Before auto-reconciling, the save checks whether **any part of the range it's about to touch** (from the opening-balance date through to the statement date) falls in a locked accounting period — not just the statement date itself. If it does, the statement is still saved, but the transactions are left unreconciled and the response explains why, so a closed period is never silently reopened by a later reconcile.

### Editing/deleting a reconciled transaction

Once a transaction is reconciled, [editing or deleting it](/parishcrm/docs/transactions/) is blocked — you have to un-reconcile it here first. This exists so a period that was confirmed to balance against a bank statement can't be quietly edited afterward without that imbalance being visible.

## Configuration

No dedicated environment variables.
