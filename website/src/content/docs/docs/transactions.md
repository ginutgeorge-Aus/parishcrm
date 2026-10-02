---
title: "Transactions"
description: "The transaction ledger (/accounting/transactions) is the single source of truth for the parish's income and expenses. Every dollar recorded anywhere in the…"
---

The transaction ledger (`/accounting/transactions`) is the single source of truth for the parish's income and expenses. Every dollar recorded anywhere in the accounting module — a manually keyed offering, a bank-import row, a petty cash receipt or expense — ends up as a row in the same `Transaction` table, so every report simply queries this one ledger.

## Using it

**List (`/accounting/transactions`)** — visible to anyone with `canViewAccounting` (ADMIN, PASTOR, AUDITOR, OFFICE_ADMIN). Filterable by date range, category (account), family, payment account, fund, reconciled status, and free-text search; paginated with income/expense/net totals for the current filter. "Export CSV" downloads the filtered list. Viewing the list, and exporting it, are both written to the audit trail.

**New transaction (`/accounting/transactions/new`)** — ADMIN/PASTOR only (`canAccessAccounting`). Fields:
- Date, amount, type (income/expense), category (account — filtered to the matching type)
- Payment account (which bank account it posted to or from — cash accounts are not selectable here; petty cash entries are created from the [Petty Cash](/parishcrm/docs/petty-cash/) pages instead)
- Fund (optional)
- Family/person — linking a family automatically marks the transaction as "giving" (this can never be set directly; it's always derived from whether a family is attached)
- Reference, description, notes (a free-text field for internal notes — encrypted at rest since it can carry personal detail)

If a transaction with the same date, amount, category, payment account, family, and description already exists, the form warns about a likely duplicate and requires a second submit to post it anyway — this catches an accidental double-entry of the same Sunday offering without hard-blocking a genuine repeat.

**Editing/deleting** a transaction is blocked once it's **reconciled** — the Reconciliation page's un-reconcile toggle must be used first, so a period that was marked balanced can't silently drift out of balance. Editing/deleting is also blocked for a date in a locked period (see [Accounting Overview](/parishcrm/docs/accounting-overview/)), and delete is further blocked for anything still inside the mandatory retention window (a fixed multi-year floor, independent of the admin-configurable period lock — old financial records are kept for statutory retention even after the books are otherwise closed).

**Attachments** — on a transaction's detail page, ADMIN/PASTOR can attach a receipt or invoice (JPEG/PNG/PDF, up to 4 MB, up to 20 files per transaction). The file's actual bytes are checked against its declared type (not just trusted), then encrypted at rest and served back only through an authenticated route.

**Petty cash rows are read-only here** — a transaction created from a petty cash receipt/expense/transfer shows a note directing you to edit it via the petty cash session instead, so the mirrored ledger row and the petty cash entry never drift apart.

## How it works

### Data model

`Transaction` (`prisma/schema.prisma`): `date`, `amount` (`Decimal(10,2)`), `type` (`INCOME`/`EXPENSE`), `accountId`, optional `familyId`/`personId`, `isGiving` (always derived as `!!familyId`, never accepted from client input), `paymentAccountId`, `reference`, `bankRef` (unique — the bank-import dedup key), `reconciled`, `notes`, `description`, optional `fundId`, and nullable FK links back to the originating `PettyCashReceipt`/`PettyCashExpense`/`PettyCashTransfer` row (cascade-deleted with it).

`description` and `notes` are AES-256-GCM encrypted at rest (see the encryption notes in [Accounting Overview](/parishcrm/docs/accounting-overview/)) since either can carry a donor's name or other personal detail; every read path decrypts with a "safe" decrypt that degrades to returning the raw value rather than throwing on a legacy/corrupt row.

### Server actions (`src/lib/actions/transaction.ts`)

- `createTransaction` / `updateTransaction` / `deleteTransaction` — each independently re-checks role, period lock (on both the stored **and** the submitted date, for edits — otherwise a transaction could be re-dated into a locked period), and validates the category (`validateAccount`: must exist, be the right type, and — for a create — be active) and payment account (must exist and be `BANK`-kind; petty cash/`CASH`-kind accounts can only be posted to by the petty cash actions).
- **Optimistic concurrency**: the edit form submits the row's last-seen `updatedAt`; the update is conditioned on it still matching, so two people editing the same transaction can't silently clobber each other — the loser is told to reload.
- A manual create/edit can never flip `reconciled` through this path — that field is stripped from the form payload; reconciling only happens via the dedicated toggle/bulk-reconcile actions on the [Reconciliation](/parishcrm/docs/reconciliation/) page, which emit their own audit entries.

### Reports invalidation

Because every report page (P&L, Balance Sheet, Budget vs Actual, Funds) derives its figures live from the `Transaction` table, every mutation revalidates not just the transaction list but each of those report paths too — otherwise a cached report page could show stale figures right after an edit.

## Configuration

No dedicated environment variables — behaviour follows the financial-year and money-formatting configuration described in [Accounting Overview](/parishcrm/docs/accounting-overview/).
