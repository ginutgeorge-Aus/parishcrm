---
title: "Bank Statement Import"
description: "Rather than keying every bank transaction by hand, an ADMIN or PASTOR can upload a bank statement PDF and review/confirm the parsed rows before they're posted…"
---

Rather than keying every bank transaction by hand, an ADMIN or PASTOR can upload a bank statement PDF and review/confirm the parsed rows before they're posted to the [Transactions](/parishcrm/docs/transactions/) ledger. Out of the box the app ships an **ANZ** (Australian bank) parser; the parser layer is pluggable so another bank's format can be added without touching the review UI or the confirm/import logic.

## Using it

From `/accounting/import`:

1. **Upload** a bank statement PDF (max 50 MB). The app extracts the text and tries each registered parser's `detect()` in turn — the first one that recognises the format parses it into rows (date, amount, description, direction).
2. **Review** — each parsed row is shown with an editable category (only categories matching the row's income/expense direction are offered), and the app attempts to **auto-match a member**: it scans the statement text for a first+last name match against the congregation, falling back to each person's optional "banking name" alias (set on their profile — useful when someone's bank transfer reference doesn't match their legal name). A row already present in the ledger (by a content-based duplicate key, not just an exact re-upload) is flagged and pre-skipped.
3. **Split a line**, if one bank transaction actually covers multiple categories or donors (e.g. a single transfer that's part tithe, part building fund) — each allocation becomes its own ledger row sharing the same underlying bank reference, and the amounts must add up to the line total exactly (checked in integer cents) before it can be confirmed.
4. **Confirm** — posts the accepted rows as transactions in one all-or-nothing operation; a per-row problem (inactive/wrong-type category, an invalid split) fails the whole batch with the offending row identified, rather than partially importing.

Your in-progress review (category choices, matched members, skipped rows) is kept in the browser between page loads until you actually import, so navigating away and back doesn't lose your work.

**Roles**: uploading, reviewing, and confirming an import is ADMIN/PASTOR only (`canAccessAccounting`) — the same gate as manually entering a transaction.

## How it works

### Parser architecture

`src/lib/bankParsers/` defines a small `BankStatementParser` interface (`{ id, detect(text), parse(text) }`); a registry tries each adapter in a fixed order and uses the first one whose `detect()` matches. The ANZ-specific parsing logic (`src/lib/anzParser.ts`) is pure — it takes extracted PDF text and returns rows, no I/O — which is what makes it independently unit-testable and lets a second bank's parser be added later as another adapter.

PDF text extraction uses `unpdf`; the ANZ format handles both a plain statement layout and a "Business Extra"/transaction-report layout with an inline `blank` placeholder marking which of the two amount columns (deposit vs. withdrawal) a figure belongs to.

### Two-step API (`src/app/api/import/bank-statement/`)

- **`POST /` (parse)** — authenticated, rate-limited (10 requests/minute per user), caps the PDF at 50 MB and the parsed row count at 1000 rows. Validates the actual PDF magic bytes rather than trusting the declared content type. Returns the parsed rows plus a list of rows that already look like duplicates of ledger rows — nothing is written yet.
- **`POST /confirm` (commit)** — re-validates every row's category (exists, active, and the right income/expense type) and every split's allocation and party references *before* inserting anything, so a bad row rejects the whole import rather than leaving it half-posted. Final de-duplication happens here too, against the same content-based key.

### Duplicate detection

Each imported row gets a `bankRef` built from the bank, account, date, amount, a description fragment, and the running balance (the balance figure is what prevents two same-day, same-amount transactions from colliding on the same key). A separate **content key** (independent of exactly which parser produced the row) lets the importer recognise "this same statement line was already imported once, even via a different statement format," so re-uploading an overlapping date range doesn't double-post.

### Member auto-match

`matchPerson()` runs two passes over the statement text: first a whole-word match on each person's first+last name, then — only if that finds nothing — a match against their optional `bankingName` alias. Both passes enforce a word-boundary match (so, for example, a shorter surname can't accidentally match as a substring of a longer one) and are case-insensitive.

## Configuration

No dedicated environment variables. The 50 MB upload cap, 1000-row parse cap, and 10 req/min rate limit are fixed in the route code, not configurable via settings.
