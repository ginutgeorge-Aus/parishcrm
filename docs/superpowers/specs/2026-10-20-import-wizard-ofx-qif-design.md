# Bank Import Wizard + OFX/QIF — Design

Date: 2026-10-20
Status: approved (brainstorm), pending spec review
Inspiration: MoneyMatter (`letehaha/budget-tracker`) import wizard.

## Goal

Replace the current single-screen bank import (`/accounting/import`) with a 4-step wizard in the
existing ParishCRM theme, and add OFX/QFX and QIF as import formats alongside ANZ PDF. AI-powered
import is a **separate follow-up spec** (spec 2); this spec only reserves a disabled "coming soon"
card for it.

## Scope

In:
- Wizard UI: top stepper, Source → Upload → Review → Done.
- OFX 1.x (SGML) + 2.x (XML) and QFX parser; QIF parser.
- Bank-account auto-match from the file's account number.
- "Possible duplicate" soft flag for cross-format overlaps.
- Responsive review (table on ≥md, stacked row cards on phone).

Out (YAGNI / later):
- Generic bank CSV with column mapper (declined — AI import covers messy formats).
- Multi-file upload (declined — one file per run, as today).
- AI import (spec 2).
- Any change to commit semantics, splits, petty-cash transfer logic, or permissions.

## UI

Theme: existing tokens only (`--primary` slate-800, `--background` slate-50, white `--card`,
`--income`/`--expense`/`--warning`/`--success`, Public Sans). No new colours.

Components in `src/components/accounting/import/`:

| Component | Responsibility |
|---|---|
| `ImportWizard.tsx` | Step state + top stepper (collapses to "Step n of 4" on phone). Persists `step` + `source` in the existing sessionStorage draft. |
| `SourceStep.tsx` | 4 selectable cards: ANZ statement (PDF), OFX/QFX, QIF, AI import (disabled, "coming soon"). |
| `UploadStep.tsx` | Per-source export instructions, single-file drop zone (`accept` per source), parsed-file summary (rows, period, masked account), bank-account select pre-filled from auto-match. Replaces `BankUploadStep.tsx`. |
| `ReviewSummary.tsx` | Stat tiles: Rows, Need category, Duplicates, In / Out totals. |
| `ReviewFilterTabs.tsx` | All · Needs category · Matched member · Duplicates · Skipped (counts in each). Filtering is view-only; it never changes row state. |
| `BankReviewTable.tsx` | Existing table, split into row/split-editor subcomponents (file is 839 lines today) and restyled; phone layout = stacked row cards. Footer: "N rows still need a category" + "Import N transactions". |
| `DoneStep.tsx` | Imported / skipped / duplicate counts, link to Transactions, "Import another file". |

Selected bank account in Upload sets the default `paymentAccountId` on every row (rows remain
individually editable as today).

`BankImportClient.tsx` becomes a thin host for `ImportWizard`; matching (`matchPerson`), draft
merge (`mergeDraftSelections`) and confirm call stay as-is.

## Parsers

Both implement the existing `BankStatementParser` contract and output `ParseResult` / `ParsedRow`.

- `src/lib/bankParsers/ofx.ts` — no new dependency. Detect by `OFXHEADER:` or `<OFX>`. Handles
  SGML (unclosed tags) and XML. Reads `BANKACCTFROM/ACCTID` (or `CCACCTFROM`), each `STMTTRN`
  (`FITID`, `DTPOSTED`, `TRNAMT`, `NAME`, `MEMO`), `DTSTART`/`DTEND` for period. Sign of `TRNAMT`
  → `INCOME`/`EXPENSE`; amount stored as positive 2-dp string validated by the money regex
  (no `parseFloat`). `DTPOSTED` `YYYYMMDD[HHMMSS[.xxx]][tz]` → date-only, Sydney wall-clock rule
  per `.claude/rules/database.md`.
- `src/lib/bankParsers/qif.ts` — Detect by `!Type:Bank` / `!Type:CCard` header. Records split on
  `^`; fields `D` date, `T`/`U` amount, `P` payee, `M` memo, `N` number. Date order: infer from
  any day > 12; if every date in the file is ambiguous, parse result carries
  `dateFormatAmbiguous: true` and Upload shows a DD/MM vs MM/DD toggle (default DD/MM, AU) that
  re-parses. QIF has no account number → auto-match not possible; user picks account.
- Registry: `PARSERS` gains `ofxParser`, `qifParser`. Upload route branches on extension/MIME:
  `.pdf` → `unpdf` text as today; `.ofx`/`.qfx`/`.qif` → UTF-8 decode (fallback latin1) → registry.
  The selected `source` is sent with the upload; a detect mismatch returns a clear error
  ("This looks like a QIF file — go back and choose QIF").

## Dedup

- bankRef formats (fit the existing `acct_date_amount_desc_suffix` shape):
  - OFX: `OFX_<acct>_<yyyymmdd>_<amount>_<desc>_<fitid>`
  - QIF: `QIF_<acct>_<yyyymmdd>_<amount>_<desc>_<n>` where `acct` = last 4 of the chosen
    `PaymentAccount` mapping (or its id) and `n` = occurrence index of identical lines in the file.
- `contentKeyFromBankRef` prefix regex extended to `ANZ|ANZTR|OFX|QIF`, so exact content-key dedup
  works across all formats at both upload flag time and commit recheck (`bankImportConfirm.ts`).
- New **possible duplicate** soft flag at upload: same account + date + amount as an existing
  transaction but different description key. Row shows a warning chip and starts **unticked**;
  user can tick it to import. Commit-time dedup is unchanged (exact keys only), so this never
  silently drops a row.

## Account auto-match

- `AppSetting` key `bankImport.accountMap` → JSON `{ "<last4>": <paymentAccountId> }`. No schema
  migration.
- Read at upload for OFX (and ANZ PDF, which also yields an account number); written on successful
  confirm for the account used. Stale ids (deleted/inactive account) are ignored.
- Only the last 4 digits are stored or displayed (`••• 4821`).

## Error handling

| Case | Behaviour |
|---|---|
| Wrong file type for chosen source | 400 with source-specific message; stay on Upload. |
| File parses to 0 rows | Error "No transactions found in this file". |
| > 1000 rows / > 50 MB | Existing limits and messages. |
| Malformed OFX/QIF record | Row skipped, added to `ParseResult.errors`; Upload summary shows "3 lines couldn't be read" with details expander. Import still allowed. |
| Non-AUD currency in OFX `CURDEF` | Blocking error (single-currency app). |
| QIF ambiguous dates | DD/MM vs MM/DD toggle, re-parse. |
| Confirm fails | Stay on Review, existing error toast; draft kept. |

Security unchanged: same routes, `canAccessAccounting`, rate limits, audit `IMPORT_BANK_STATEMENT`,
zod at confirm, client FKs re-validated. Parsers are pure functions over text — no XML entity
expansion (hand-rolled tag scan, no DOMParser/XML lib), so no XXE surface.

## Testing

- Unit (Jest, pure): `ofx.test.ts` (SGML, XML, QFX, credit card, negative/positive amounts, timezone
  suffixes, missing FITID, CURDEF), `qif.test.ts` (Bank/CCard, `T` vs `U`, ambiguous dates, `^`
  edge cases, blank memo), registry detection order, `contentKeyFromBankRef` new prefixes,
  possible-duplicate classifier, accountMap read/write. Fixtures synthetic only (public repo).
- Component (jsdom): wizard step navigation, source → accept attribute, filter tabs counts,
  disabled AI card, phone card layout render.
- Existing bank import suites must stay green (ANZ parsing, confirm, draft).
- Manual: `/qa` pass at 375px and ≥1920px (many phone users).

## Docs

Same PR: update the website bank-import docs page (`website/src/content/docs/docs/`) with the
wizard + OFX/QIF export steps, fix stale "PDFs/CSVs" wording in `src/lib/features.ts:45`, and
update `.claude/rules/bank-import.md`.

## Delivery

Likely 2 PRs to keep reviews small:
1. Parsers + dedup + accountMap + route branching (backend, fully unit-tested).
2. Wizard UI + docs.
