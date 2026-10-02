---
title: "Petty Cash"
description: "Petty cash tracks physical cash handled outside the bank — cash offerings collected at a service, small cash expenses — as a series of weekly sessions, each…"
---

Petty cash tracks physical cash handled outside the bank — cash offerings collected at a service, small cash expenses — as a series of weekly **sessions**, each with a named custodian, that get closed out with an optional physical cash count. Every receipt, expense, and transfer inside a session is mirrored automatically into the main [Transactions](/parishcrm/docs/transactions/) ledger, so petty cash activity shows up in the P&L and every other report without a separate reconciliation step.

## Using it

**`/accounting/petty-cash`** lists sessions (open and closed). A session for the most recent Sunday is opened automatically the first time an ADMIN/PASTOR visits the page in a given week — under a configured default custodian — seeded with whatever cash balance the prior session closed with (not zero), so an un-banked float carries forward instead of vanishing from the books. If no default custodian is configured, the page shows a banner instead of auto-opening anything.

Inside an open session (`/accounting/petty-cash/sessions/[id]`):
- **Receipts** — cash coming in (e.g. a cash offering), posted against an income category, optionally tagged to a donor (for giving credit) and a service type (a simple lookup list, e.g. "Sunday Service", "Wedding") and a [fund](/parishcrm/docs/accounting-overview/).
- **Expenses** — cash going out, posted against an expense category, with a payee and description.
- **Transfers** — recording cash physically deposited to the bank; unlike receipts/expenses (which are always dated to the session's own date), a transfer keeps a separately-entered date, since the bank deposit often happens a few days after the session. A transfer can't exceed the session's current cash balance.

A near-identical repeat entry (same date/amount/category/donor or payee) is flagged as a likely duplicate and needs a second confirmation to post — the same double-entry guard used on the main transaction form.

**Closing a session** (ADMIN/PASTOR) locks it — no further receipts/expenses/transfers. Optionally enter the counted physical cash; if it differs from the system-calculated balance, a note explaining the variance is required before the close is accepted. Once closed, the count and variance are frozen permanently.

**Bulk CSV import** (`/accounting/petty-cash/import`, ADMIN only) lets a backlog of receipts/expenses be loaded from a spreadsheet in one pass — rows are grouped into (and auto-create) the correct weekly sessions, donors are matched by name/banking-name with an override picker for anything ambiguous, and rows matching an already-imported entry are skipped.

**Print** — a closed (or open) session has a printable summary at its print route, showing every receipt/expense/transfer and the running/closing balance, useful for a physical cash-count sign-off sheet.

**Roles**: creating/editing receipts, expenses and transfers, and closing a session, is ADMIN/PASTOR (`canAccessAccounting`) — deliberately without a stricter per-entry-owner restriction, since petty cash is treated as a collaborative, fully-audited task among trusted staff. **Deleting** anything, or deleting a whole (empty) session, is ADMIN only. Viewing is `canViewAccounting`.

## How it works

### Data model and the ledger mirror

`PettyCashSession` (`OPEN`/`CLOSED`, `custodianId`, `openingBalance`, and — set on close — `countedCash`/`closingVariance`) owns `PettyCashReceipt`, `PettyCashExpense`, and `PettyCashTransfer` rows. Each of those, in turn, is 1:1-linked to a mirrored row in the main `Transaction` table (posted against the parish's single active `CASH`-kind payment account, or the shared internal "transfer" clearing account for a bank deposit) — deleting the petty-cash entry cascades to delete its mirror, and every ledger-facing report simply sees these as ordinary transactions. This mirroring is why the P&L, Balance Sheet, and other reports never need special-case petty-cash logic.

### Running balance

`calcRunningBalance()` (`src/lib/pettyCashLedger.ts`, pure — no database access) computes a session's current cash-in-hand as opening balance + receipts − expenses − transfers. It's used both to show the live balance on the session page and, server-side, to validate that a transfer never exceeds what's actually on hand.

### Concurrency and locking

Editing or deleting a petty cash entry re-asserts, inside the same database transaction as the write, that the session is still open and that its mirrored ledger row isn't already reconciled — closing a session or reconciling its mirror can race a concurrent edit, and this re-check inside the transaction (rather than only before it) is what prevents that race from landing an edit into an already-closed or already-reconciled record. A transfer's balance check is similarly done inside a serializable transaction so two concurrent transfers can't both pass the same "enough cash on hand" check and together overdraw the float.

### Closing with a cash count

`closeSession` recomputes the system balance server-side (never trusts a client-submitted figure) and compares it, in integer cents, against the entered physical count. The close itself is an atomic conditional update (only succeeds if the session is still `OPEN`), so two people closing the same session at once can't both "win" and overwrite each other's count/variance/notes.

### Import dedup

The CSV importer stamps each created row with an immutable `importKey` at creation time and checks new rows against it on any later re-import — this is what lets an operator re-upload a corrected or overlapping CSV without double-posting rows that were already imported.

## Configuration

The default petty-cash custodian (used by the weekly auto-open) is set in Accounting Settings, not via an environment variable. No dedicated environment variables.
