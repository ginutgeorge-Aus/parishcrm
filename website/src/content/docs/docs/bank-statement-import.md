---
title: "Bank Statement Import"
description: "Rather than keying every bank transaction by hand, an ADMIN or PASTOR can upload a bank statement or export file and review/confirm the parsed rows before they're posted…"
---

Rather than keying every bank transaction by hand, an ADMIN or PASTOR can upload a bank statement or export file and review/confirm the parsed rows before they're posted to the [Transactions](/parishcrm/docs/transactions/) ledger. Out of the box the app ships an **ANZ** (Australian bank) parser; the parser layer is pluggable so another bank's format can be added without touching the review UI or the confirm/import logic.

## Using it

From `/accounting/import`, the import is a four-step wizard: **1 Source → 2 Upload → 3 Review → 4 Done**.

1. **Source** — pick the kind of file your bank gave you (ANZ PDF, OFX/QFX or QIF). An "AI import" option is shown as coming soon.
2. **Upload** — drop in the file (max 50 MB, one file) and choose the ParishCRM bank account. The page shows how many rows were read, the date range and the last four digits of the account. For OFX and ANZ files the bank account is chosen for you from the file, and the app remembers your choice for next time. If a file is the wrong type, you are told to go back and pick the right source.
3. **Review** — at the top, tiles show the number of rows, how many still need a category, how many are duplicates, and the money in and out of the rows that will be imported. Filter tabs (All, Needs category, Matched member, Duplicates, Skipped) only change what you see; they never change your choices. Each row has an editable category (only categories matching the row's income/expense direction are offered), and the app attempts to **auto-match a member**: it scans the statement text for a first+last name match against the congregation, falling back to each person's optional "banking name" alias (set on their profile — useful when someone's bank transfer reference doesn't match their legal name).
   - A row already in the ledger is marked **DUPLICATE** and skipped.
   - A row with the same date, amount and direction as an existing transaction (for example one you keyed in by hand, or imported earlier from a PDF) is marked **POSSIBLE DUPLICATE** and left unticked. Tick it if it really is a new transaction.
   - **Split a line**, if one bank transaction actually covers multiple categories or donors (e.g. a single transfer that's part tithe, part building fund) — each allocation becomes its own ledger row sharing the same underlying bank reference, and the amounts must add up to the line total exactly (checked in integer cents) before it can be confirmed.
   - **Confirm** — posts the accepted rows as transactions in one all-or-nothing operation; a per-row problem (inactive/wrong-type category, an invalid split) fails the whole batch with the offending row identified, rather than partially importing. The Import button is at the top and again at the bottom of a long list.
4. **Done** — shows how many rows were imported, skipped and duplicates, with a link to the transactions list or a button to import another file.

Your in-progress review (category choices, matched members, skipped rows) is kept in the browser between page loads until you actually import, so navigating away and back doesn't lose your work.

**Roles**: uploading, reviewing, and confirming an import is ADMIN/PASTOR only (`canAccessAccounting`) — the same gate as manually entering a transaction.

## How it works

### Parser architecture

`src/lib/bankParsers/` defines a small `BankStatementParser` interface (`{ id, detect(text), parse(text) }`); a registry tries each adapter in a fixed order and uses the first one whose `detect()` matches. The OFX/QFX and QIF parsers (`ofx.ts`, `qif.ts`) are also pure text parsers; the upload route picks the parser from the source chosen in step 1 and rejects a file that looks like a different format. The ANZ-specific parsing logic (`src/lib/anzParser.ts`) is pure — it takes extracted PDF text and returns rows, no I/O — which is what makes it independently unit-testable and lets a second bank's parser be added later as another adapter.

PDF text extraction uses `unpdf`; the ANZ format handles both a plain statement layout and a "Business Extra"/transaction-report layout with an inline `blank` placeholder marking which of the two amount columns (deposit vs. withdrawal) a figure belongs to.

### Two-step API (`src/app/api/import/bank-statement/`)

- **`POST /` (parse)** — authenticated, rate-limited (10 requests/minute per user), caps the file at 50 MB and the parsed row count at 1000 rows. For PDFs it validates the actual PDF magic bytes rather than trusting the declared content type; for OFX/QIF it checks the text looks like the chosen format. Returns the parsed rows plus a list of rows that already look like duplicates of ledger rows — nothing is written yet.
- **`POST /confirm` (commit)** — re-validates every row's category (exists, active, and the right income/expense type) and every split's allocation and party references *before* inserting anything, so a bad row rejects the whole import rather than leaving it half-posted. Final de-duplication happens here too, against the same content-based key.

### Duplicate detection

Each imported row gets a `bankRef` built from the bank, account, date, amount, a description fragment, and the running balance (the balance figure is what prevents two same-day, same-amount transactions from colliding on the same key). A separate **content key** (independent of exactly which parser produced the row) lets the importer recognise "this same statement line was already imported once, even via a different statement format," so re-uploading an overlapping date range doesn't double-post.

### Member auto-match

`matchPerson()` runs two passes over the statement text: first a whole-word match on each person's first+last name, then — only if that finds nothing — a match against their optional `bankingName` alias. Both passes enforce a word-boundary match (so, for example, a shorter surname can't accidentally match as a substring of a longer one) and are case-insensitive.

## Configuration

No dedicated environment variables. The 50 MB upload cap, 1000-row parse cap, and 10 req/min rate limit are fixed in the route code, not configurable via settings.
