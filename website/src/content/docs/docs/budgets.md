---
title: "Budgets"
description: "An annual budget can be set per account (category), and compared against actual income/expense for the year on the Budget vs Actual report."
---

An annual budget can be set per account (category), and compared against actual income/expense for the year on the Budget vs Actual report.

## Using it

**`/accounting/budget`** — ADMIN only. A single form lists every active account (income and expense) for the selected financial year with an editable budget amount; a "copy from last year" helper pre-fills the form from the prior FY's saved budgets so you're adjusting rather than starting from scratch each year. Only active accounts can carry a budget — this keeps the budget form and the report in sync; if you need to budget against an account you're about to retire, budget it before deactivating it (a budget row survives an account being deactivated later, so its actuals still compare correctly against last year's figure).

**`/accounting/reports/budget-vs-actual`** — visible to `canViewAccounting` (ADMIN, PASTOR, AUDITOR, OFFICE_ADMIN). Shows budget, actual, and variance for every account with a budget or activity in the year, grouped the same way as the chart of accounts, with income and expense section subtotals and a net budget/actual/variance line. Accounting editors (ADMIN/PASTOR) can attach a short **note** to any flagged variance line — e.g. explaining why utilities ran over — which then shows on the report for anyone reviewing it.

## How it works

### Data model

`Budget` (`prisma/schema.prisma`): unique on `(year, accountId)`, `amount` (`Decimal(10,2)`), optional `note`. There's no separate budget-period concept — a budget is always a whole-financial-year figure per account.

### Save path (`src/lib/actions/budget.ts::upsertBudgets`)

All submitted rows for a year are validated and upserted in a single database transaction. Validation happens before any write: each amount is checked against a decimal-places regex (never `parseFloat`'d before hitting the database — the validated string goes straight to the `Decimal` column, avoiding binary-float rounding drift across possibly hundreds of account rows) and range-checked; every referenced account must currently be active or the whole save is rejected. Saving revalidates both the budget-entry page and the Budget vs Actual report so the report never shows a stale figure right after a save.

### Budget vs Actual query (`src/lib/reports/budgetVsActualQuery.ts`)

Actuals are summed server-side via a grouped aggregate over the `Transaction` table for the FY's date range (see [Accounting Overview](/parishcrm/docs/accounting-overview/) for how the FY range is derived). The account set for the report is deliberately wider than "just active accounts": it also includes any account that's inactive but either has activity in the FY *or* has a budget row for the FY, so a category that was deactivated mid-year — or one that was budgeted but never actually used — doesn't silently disappear from the report and skew the section totals. The internal transfer clearing account used by petty-cash-to-bank transfers is excluded from all totals, since it isn't a real income/expense category.

Every subtotal and variance figure is accumulated in integer cents and only converted to a dollar amount at the very end, for the same reason described in [Accounting Overview](/parishcrm/docs/accounting-overview/) — it keeps a wide budget with many small accounts from drifting by a cent due to floating-point summation.

## Configuration

No dedicated environment variables. Budget years follow the financial-year configuration described in [Accounting Overview](/parishcrm/docs/accounting-overview/).
