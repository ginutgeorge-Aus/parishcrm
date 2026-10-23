---
title: "Choosing Features"
description: "App Settings → Features (ADMIN only) lets a church turn on just the parts of ParishCRM it uses. Switched-off features are hidden and blocked; their data is kept."
---

ParishCRM ships many modules. A small church that only wants a member
directory doesn't need events, accounting or Sunday School cluttering the
sidebar. **App Settings → Features** (`/settings/features`, `ADMIN` role only)
lets you tick the features your church uses and come back later to switch
more on.

## First-time setup

When the first administrator is created through the `/setup` page, signing in
takes them straight to Settings → Features with a short welcome note instead
of the dashboard. **Save** applies their choices; **Keep defaults** leaves
everything on. Either one ends the prompt and opens the dashboard; until then,
opening the dashboard brings them back here. Other roles never see the prompt,
and neither do existing installs, admins created with
`scripts/create-admin-user.ts`, or the public demo.

## Using it

Sign in as an `ADMIN` and open **App Settings** from the sidebar, then the **Features** tab. Flip the
switches you want and press **Save**. The change applies to every user:
pages of a switched-off feature are blocked within a few seconds of saving.
Someone who already has the app open may need to refresh before the menu
links disappear.

Accounting features sit indented under **Accounting**. While Accounting is
off they are greyed out with "Needs Accounting", and **Subscription dues**
also needs **Membership forms**. Their own on/off choice is remembered, so
switching the parent back on restores them.

People, families, users, settings, the audit log, CSV import and help are
core and can't be switched off.

## What "off" means

A switched-off feature is **hidden and blocked**:

- its sidebar links, dashboard tiles and settings sections disappear;
- its pages, print pages and export links return "not found". This also
  applies to someone who already has one of the feature's pages open: their
  next click inside it shows "not found" (within a few seconds of the switch);
- its actions refuse with "This feature is turned off. An admin can enable
  it in Settings → Features." Public forms (membership, family update, event
  checkout) instead show a plain "no longer available" or "not found" message;
- its scheduled jobs (event reminders, celebration emails, the clearance
  digest) skip. A skipped run doesn't count; turning the feature back on
  during that job's open window still runs it for the period. The clearance
  digest's window is the first seven days of the Sydney month.

**Your data is never deleted.** Switching a feature back on restores
everything exactly as it was.

Event organisers aren't left stuck when Events is off: their home page sends
them to their Sunday School classes, or shows a short notice if Sunday School
is off too. The organiser menu hides the Events and Classes links when their
feature is off.

Card payments already in progress still settle when Events is off: the
Stripe webhook and the checkout sweep keep running, so a family that was
mid-checkout still gets their registration.

## Features with public links

Turning these off shows a warning first, because links you have already
shared stop working:

| Feature | What stops working |
|---|---|
| Events | Public event pages (`/e/…`) and registration links |
| Membership forms | The public membership application form |
| Family self-updates | Update links already emailed to families |

## The list

| Feature | Covers |
|---|---|
| Birthdays & anniversaries | Celebration lists, dashboard tiles and greeting emails |
| Child-safety clearances | Working With Children checks and expiry digests |
| Family self-updates | Families update their own details via a private link |
| Membership forms | Public membership application form and review inbox |
| Welcome letters | Welcome letters for new families |
| Sunday School | Classes, teachers and attendance |
| Events | Events, registrations, check-in and online payments |
| Accounting | Transactions, accounts, funds and financial reports |
| ↳ Bank reconciliation | Matching transactions to bank statements |
| ↳ Bank import | Importing bank statement PDFs/CSVs |
| ↳ Petty cash | Petty cash sessions and counts |
| ↳ Subscription dues | Member subscription dues (also needs Membership forms) |
| ↳ Giving receipts | Emailed giving receipts and the send log |
| ↳ DGR receipts | Tax-deductible (DGR) donation receipts |
| ↳ Invoices | Invoices and customers |
| ↳ Budget | Annual budget and the budget-vs-actual report |

Accounting-wide reports (P&L, balance sheet, trial balance, cash flow,
general ledger, giving summary, funds) stay available whenever Accounting is
on.

## How it works

The choices are stored as one `AppSetting` row (`features`) holding only the
values that differ from the defaults. A new install, or one upgraded from an
older version, has no row, so everything is on. Every save is recorded in the
audit log as `UPDATE_FEATURES` with the before and after values. Saving is
disabled in the public demo.
