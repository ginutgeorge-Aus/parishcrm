# Bank Import Wizard + OFX/QIF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OFX/QFX and QIF bank imports and replace the single-screen bank import with a 4-step wizard (Source → Upload → Review → Done) in the existing ParishCRM theme.

**Architecture:** Two pure text parsers (`ofx.ts`, `qif.ts`) emit the existing `ParseResult`/`ParsedRow` shape, so the review table, dedup and confirm pipeline are reused unchanged. The upload route dispatches by a `source` form field (PDF path untouched). The client `BankImportClient` becomes the wizard host with a stepper and new Source/Upload/Done steps; the review table gains summary tiles, filter tabs and a "possible duplicate" chip.

**Tech Stack:** Next.js 16 App Router, TypeScript, Prisma 7, Jest 30 (+ Testing Library), shadcn/ui components in `src/components/ui/`, Tailwind theme tokens.

**Spec:** `docs/superpowers/specs/2026-10-20-import-wizard-ofx-qif-design.md`

## Global Constraints

- Public AGPL repo: fixtures are synthetic only — no real names, account numbers, or bank data.
- Money: never `parseFloat`/`Number()` on amounts (semgrep blocks it). Amounts are 2-dp strings matching `MONEY_DECIMAL_RE` (`src/lib/validation.ts`); compare with `toCents` (`src/lib/formatting.ts`).
- Dates: `YYYY-MM-DD` date-only strings, validated with `isRealCalendarDate` (`src/lib/validation.ts`).
- No new npm dependencies. No XML library / DOMParser (no XXE surface).
- No schema migration. Account auto-match lives in `AppSetting` key `bankImport.accountMap`; only the last 4 digits are stored or displayed.
- Theme tokens only (`bg-primary`, `bg-background`, `bg-card`, `text-income`, `text-expense`, `text-warning`, `text-success`, `border`). No new colours.
- Permissions unchanged: `canAccessAccounting`, `featureNotFound("bankImport")`/`featureGuard("bankImport")`, existing rate limits, 1000-row cap, 50 MB cap, demo caps.
- Parser error text can contain payee names (member PII): log counts only, never raw text.
- JSDoc on every new/changed function, exported or not.
- Test command: `npm test -- --testPathPatterns="<basename>"` (tests live in both `src/**/__tests__` and root `__tests__/`).
- Branch: `feat/import-wizard-ofx-qif` (spec already committed there). Two PRs: Tasks 1–6 (backend) then Tasks 7–12 (UI + docs). PR titles use Conventional Commits.

## Deviations from spec (decided while planning)

- **Registry unchanged.** `anzStatement.detect` is a catch-all fallback, so OFX/QIF are dispatched by the `source` field in the route instead of being added to `PARSERS`. The route still runs each parser's `detect()` and returns a "looks like X" error on mismatch.
- **No `ImportWizard.tsx` file.** `BankImportClient.tsx` already owns all wizard state; it becomes the wizard host (avoids moving tested state logic).
- **`BankReviewTable.tsx` is not structurally split** this round. It gains a view-only filter, summary tiles and a chip; its mobile card layout already exists (`md:hidden`). A split would be refactor-only churn on an 839-line, well-tested file.
- **Possible-duplicate matching ignores account.** OFX `ACCTID` (often BSB+account) and ANZ PDF account numbers don't share a format, so the soft flag matches date + amount + type against *all* existing transactions in the window (including manual entries). Over-flagging is safe: the row stays visible with a chip, just unticked.

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/lib/anzParser.ts` | Modify | `ParseResult` gains `fatalError?`, `dateFormatAmbiguous?`; `contentKeyFromBankRef` accepts `OFX_`/`QIF_` |
| `src/lib/bankParsers/ofx.ts` | Create | Pure OFX 1.x/2.x/QFX parser + detect |
| `src/lib/bankParsers/qif.ts` | Create | Pure QIF parser + detect, date-order inference |
| `src/lib/bankParsers/amount.ts` | Create | Shared signed-amount → `{amount, type}` normaliser |
| `src/lib/bankPossibleDuplicate.ts` | Create | Pure possible-duplicate classifier |
| `src/lib/bankAccountMap.ts` | Create | Account suffix + `AppSetting` map read/write |
| `src/lib/actions/bankImport.ts` | Create | Server action `rememberBankImportAccount` |
| `src/lib/importSources.ts` | Create | Source config (label, accept, export help) shared by UI + route |
| `src/app/api/import/bank-statement/route.ts` | Modify | Source dispatch, text decode, new response fields |
| `src/lib/bankTypes.ts` | Modify | `ReviewRow.isPossibleDuplicate?` |
| `src/lib/bankImportDraft.ts` | Modify | Accept optional `isPossibleDuplicate` in draft validation |
| `src/lib/bankReviewFilter.ts` | Create | Pure filter predicates + stats |
| `src/components/accounting/import/ImportStepper.tsx` | Create | Top stepper |
| `src/components/accounting/import/SourceStep.tsx` | Create | Source cards |
| `src/components/accounting/import/UploadStep.tsx` | Create | Upload + account pick (replaces `BankUploadStep.tsx`) |
| `src/components/accounting/import/ReviewSummary.tsx` | Create | Stat tiles |
| `src/components/accounting/import/ReviewFilterTabs.tsx` | Create | Filter pills |
| `src/components/accounting/import/DoneStep.tsx` | Create | Result summary |
| `src/components/accounting/BankReviewTable.tsx` | Modify | Mount summary/tabs, filter rows, possible-dup chip, footer hint |
| `src/components/accounting/BankImportClient.tsx` | Modify | Wizard host |
| `src/components/accounting/BankUploadStep.tsx` | Delete | Replaced by `UploadStep.tsx` |
| `src/app/(dashboard)/accounting/import/page.tsx` | Modify | Subtitle copy |
| `src/lib/features.ts` | Modify | Stale "PDFs/CSVs" description |
| `website/src/content/docs/docs/bank-statement-import.md` | Modify | Wizard + OFX/QIF docs |
| `.claude/rules/bank-import.md` | Modify | (local-only, gitignored) note new parsers/route dispatch |

---

## PR 1 — Parsers + backend

### Task 1: Shared amount normaliser + `ParseResult` extensions

**Files:**
- Create: `src/lib/bankParsers/amount.ts`
- Modify: `src/lib/anzParser.ts:24-29` (`ParseResult`)
- Test: `__tests__/lib/bankParsers/amount.test.ts`

**Interfaces:**
- Produces: `normaliseSignedAmount(raw: string): { amount: string; type: "INCOME" | "EXPENSE" } | null` — `amount` is positive 2-dp; `null` for malformed or zero.
- Produces: `ParseResult.fatalError?: string`, `ParseResult.dateFormatAmbiguous?: boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/bankParsers/amount.test.ts
import { normaliseSignedAmount } from "@/lib/bankParsers/amount"

describe("normaliseSignedAmount", () => {
  it.each([
    ["-312.40", { amount: "312.40", type: "EXPENSE" }],
    ["200", { amount: "200.00", type: "INCOME" }],
    ["+86.1", { amount: "86.10", type: "INCOME" }],
    ["-1,234.50", { amount: "1234.50", type: "EXPENSE" }],
    [" 0.05 ", { amount: "0.05", type: "INCOME" }],
  ])("normalises %s", (raw, expected) => {
    expect(normaliseSignedAmount(raw)).toEqual(expected)
  })

  it.each(["", "abc", "1.234", "0", "-0.00", "1.2.3", "12,34"])("rejects %s", (raw) => {
    expect(normaliseSignedAmount(raw)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPatterns="bankParsers/amount"`
Expected: FAIL — `Cannot find module '@/lib/bankParsers/amount'`

- [ ] **Step 3: Implement**

```ts
// src/lib/bankParsers/amount.ts

// Thousands separators must sit on 3-digit groups so "12,34" (a European
// decimal comma) is rejected rather than read as 1234.
const SIGNED_AMOUNT_RE = /^([+-]?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/

/**
 * Convert a signed bank amount string ("-312.40", "200", "+1,234.5") into the
 * positive 2-dp `amount` + INCOME/EXPENSE `type` that `ParsedRow` uses. String
 * arithmetic only — never parseFloat — so no binary-float rounding. Returns
 * null for malformed input or a zero amount (a zero line can't be posted).
 */
export function normaliseSignedAmount(raw: string): { amount: string; type: "INCOME" | "EXPENSE" } | null {
  const m = SIGNED_AMOUNT_RE.exec(raw.trim())
  if (!m) return null
  const [, sign, whole, frac = ""] = m
  const intPart = whole.replace(/,/g, "").replace(/^0+(?=\d)/, "")
  const amount = `${intPart}.${(frac + "00").slice(0, 2)}`
  if (/^0+\.00$/.test(amount)) return null
  return { amount, type: sign === "-" ? "EXPENSE" : "INCOME" }
}
```

In `src/lib/anzParser.ts`, extend `ParseResult`:

```ts
export type ParseResult = {
  rows: ParsedRow[]
  period: { from: string; to: string }
  accountNumber: string
  errors: string[]
  // Whole-file rejection with a user-facing message (e.g. non-AUD currency,
  // multi-account OFX). When set, rows is empty and the route returns 400 with it.
  fatalError?: string
  // QIF only: every date in the file read the same as DD/MM and MM/DD, so the
  // parser used the caller's/default order and the UI must let the user confirm.
  dateFormatAmbiguous?: boolean
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPatterns="bankParsers/amount|anzParser"`
Expected: PASS (anzParser suite unaffected — fields are optional)

- [ ] **Step 5: Commit**

```bash
git add src/lib/bankParsers/amount.ts src/lib/anzParser.ts __tests__/lib/bankParsers/amount.test.ts
git commit -m "feat(bank-import): signed amount normaliser + ParseResult fields"
```

---

### Task 2: OFX/QFX parser

**Files:**
- Create: `src/lib/bankParsers/ofx.ts`
- Test: `__tests__/lib/bankParsers/ofx.test.ts`

**Interfaces:**
- Consumes: `normaliseSignedAmount` (Task 1), `bankRefContentKey(accountNumber, date, amount, description)` from `@/lib/anzParser`, `isRealCalendarDate` from `@/lib/validation`, `BankStatementParser` from `./types`.
- Produces: `detectOfx(text: string): boolean`, `parseOfx(text: string): ParseResult`, `ofxParser: BankStatementParser` (`id: "ofx"`).
- bankRef format: `OFX_<contentKey>_<fitidAlnum|S<n>>` — suffix never contains `_`, so `contentKeyFromBankRef` can drop it as the last segment.

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/lib/bankParsers/ofx.test.ts
import { detectOfx, parseOfx } from "@/lib/bankParsers/ofx"
import { bankRefContentKey } from "@/lib/anzParser"

// Synthetic OFX 1.x (SGML: leaf tags are not closed).
const SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>AUD
<BANKACCTFROM><BANKID>012345<ACCTID>000111222333<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260901000000
<DTEND>20260930000000
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260902120000.000[+10:AEST]
<TRNAMT>200.00
<FITID>2026090201-A
<NAME>TRANSFER FROM J CITIZEN
<MEMO>Tithe
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260903
<TRNAMT>-312.4
<FITID>2026090302
<NAME>EXAMPLE ENERGY
</STMTTRN>
</BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`

// Synthetic OFX 2.x (XML: every tag closed), credit-card account.
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="211"?>
<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS>
<CURDEF>AUD</CURDEF>
<CCACCTFROM><ACCTID>4000-0000-0000-9999</ACCTID></CCACCTFROM>
<BANKTRANLIST>
<STMTTRN><DTPOSTED>20260905</DTPOSTED><TRNAMT>-86.10</TRNAMT><FITID>X1</FITID><NAME>EXAMPLE GROCER</NAME><MEMO>Card 9999</MEMO></STMTTRN>
</BANKTRANLIST>
</CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`

describe("detectOfx", () => {
  it("detects SGML header, XML header and bare <OFX>", () => {
    expect(detectOfx(SGML)).toBe(true)
    expect(detectOfx(XML)).toBe(true)
    expect(detectOfx("<OFX><BANKMSGSRSV1>")).toBe(true)
  })
  it("rejects QIF and plain text", () => {
    expect(detectOfx("!Type:Bank\nD01/09/2026\n^")).toBe(false)
    expect(detectOfx("hello")).toBe(false)
  })
})

describe("parseOfx", () => {
  it("parses SGML rows, period and account", () => {
    const r = parseOfx(SGML)
    expect(r.fatalError).toBeUndefined()
    expect(r.accountNumber).toBe("000111222333")
    expect(r.period).toEqual({ from: "2026-09-01", to: "2026-09-30" })
    expect(r.errors).toEqual([])
    expect(r.rows).toHaveLength(2)
    expect(r.rows[0]).toMatchObject({
      date: "2026-09-02",
      description: "TRANSFER FROM J CITIZEN",
      details: "Tithe",
      amount: "200.00",
      type: "INCOME",
    })
    expect(r.rows[1]).toMatchObject({ date: "2026-09-03", amount: "312.40", type: "EXPENSE", details: "" })
  })

  it("builds OFX_ bankRef from content key + sanitised FITID", () => {
    const row = parseOfx(SGML).rows[0]
    const key = bankRefContentKey("000111222333", "2026-09-02", "200.00", "TRANSFER FROM J CITIZEN")
    expect(row.dedupKey).toBe(key)
    expect(row.bankRef).toBe(`OFX_${key}_2026090201A`)
  })

  it("parses XML credit-card statements and strips account separators", () => {
    const r = parseOfx(XML)
    expect(r.accountNumber).toBe("4000000000009999")
    expect(r.rows[0]).toMatchObject({ date: "2026-09-05", amount: "86.10", type: "EXPENSE", description: "EXAMPLE GROCER" })
    // No DTSTART/DTEND → period from row dates.
    expect(r.period).toEqual({ from: "2026-09-05", to: "2026-09-05" })
  })

  it("falls back to a per-content-key sequence when FITID is missing", () => {
    const text = SGML.replace("<FITID>2026090302\n", "")
    const row = parseOfx(text).rows[1]
    expect(row.bankRef).toBe(`OFX_${row.dedupKey}_S1`)
  })

  it("uses MEMO as description when NAME is absent", () => {
    const text = XML.replace("<NAME>EXAMPLE GROCER</NAME>", "")
    expect(parseOfx(text).rows[0]).toMatchObject({ description: "Card 9999", details: "" })
  })

  it("skips malformed transactions into errors", () => {
    const text = SGML.replace("<TRNAMT>-312.4", "<TRNAMT>abc").replace("<DTPOSTED>20260902120000.000[+10:AEST]", "<DTPOSTED>20260231")
    const r = parseOfx(text)
    expect(r.rows).toHaveLength(0)
    expect(r.errors).toHaveLength(2)
  })

  it("rejects non-AUD currency", () => {
    const r = parseOfx(SGML.replace("<CURDEF>AUD", "<CURDEF>USD"))
    expect(r.rows).toEqual([])
    expect(r.fatalError).toBe("This file is in USD. Only AUD statements can be imported.")
  })

  it("rejects files with more than one account", () => {
    const two = SGML.replace("</STMTRS>", "</STMTRS><STMTRS><BANKACCTFROM><ACCTID>999</BANKACCTFROM></STMTRS>")
    expect(parseOfx(two).fatalError).toBe("This file contains more than one account. Export one account at a time.")
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- --testPathPatterns="bankParsers/ofx"`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// src/lib/bankParsers/ofx.ts
import { bankRefContentKey, type ParsedRow, type ParseResult } from "@/lib/anzParser"
import { isRealCalendarDate } from "@/lib/validation"
import { normaliseSignedAmount } from "./amount"
import type { BankStatementParser } from "./types"

type Tag = { close: boolean; name: string; value: string }

// One regex scan covers both OFX 1.x SGML (unclosed leaf tags) and 2.x XML:
// each tag's value is the text up to the next "<". Hand-rolled on purpose — no
// XML parser means no entity expansion / XXE surface.
const TAG_RE = /<(\/?)([A-Za-z0-9.]+)>([^<]*)/g

/** Tokenise OFX into a flat list of open/close tags with their trimmed text value. */
function tokenise(text: string): Tag[] {
  const tags: Tag[] = []
  for (const m of text.matchAll(TAG_RE)) {
    tags.push({ close: m[1] === "/", name: m[2].toUpperCase(), value: m[3].trim() })
  }
  return tags
}

/** "20260902120000.000[+10:AEST]" → "2026-09-02"; null if not a real date. */
function ofxDate(raw: string | undefined): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(raw ?? "")
  if (!m) return null
  const iso = `${m[1]}-${m[2]}-${m[3]}`
  return isRealCalendarDate(iso) ? iso : null
}

/** True when the text is an OFX/QFX document (SGML header, XML PI, or bare <OFX>). */
export function detectOfx(text: string): boolean {
  const head = text.slice(0, 2000)
  return /OFXHEADER\s*[:=]/i.test(head) || /<OFX>/i.test(head)
}

/**
 * Parse an OFX 1.x/2.x or QFX statement into ParsedRows. Single-account,
 * AUD-only: anything else is a `fatalError`. Malformed transactions are
 * skipped into `errors` (count-only logging happens in the route).
 */
export function parseOfx(text: string): ParseResult {
  const tags = tokenise(text)
  const empty = (fatalError: string): ParseResult => ({ rows: [], period: { from: "", to: "" }, accountNumber: "", errors: [], fatalError })

  const currency = tags.find((t) => !t.close && t.name === "CURDEF")?.value.toUpperCase()
  if (currency && currency !== "AUD") return empty(`This file is in ${currency}. Only AUD statements can be imported.`)

  const accountIds = tags.filter((t) => !t.close && t.name === "ACCTID").map((t) => t.value)
  if (new Set(accountIds).size > 1) return empty("This file contains more than one account. Export one account at a time.")
  const accountNumber = (accountIds[0] ?? "").replace(/[^A-Za-z0-9]/g, "")

  // Group leaf values per STMTTRN. A record ends at </STMTTRN>, the next
  // <STMTTRN>, or </BANKTRANLIST> (SGML files sometimes omit </STMTTRN>).
  const records: Record<string, string>[] = []
  let current: Record<string, string> | null = null
  for (const t of tags) {
    if (t.name === "STMTTRN") {
      if (current) records.push(current)
      current = t.close ? null : {}
      continue
    }
    if (t.close && t.name === "BANKTRANLIST") {
      if (current) records.push(current)
      current = null
      continue
    }
    if (current && !t.close && t.value) current[t.name] = t.value
  }
  if (current) records.push(current)

  const rows: ParsedRow[] = []
  const errors: string[] = []
  const seqByKey = new Map<string, number>()
  records.forEach((rec, i) => {
    const date = ofxDate(rec.DTPOSTED)
    const signed = normaliseSignedAmount(rec.TRNAMT ?? "")
    const name = rec.NAME ?? ""
    const memo = rec.MEMO ?? ""
    const description = name || memo
    if (!date || !signed || !description) {
      errors.push(`Transaction ${i + 1}: unreadable date, amount or description`)
      return
    }
    const dedupKey = bankRefContentKey(accountNumber, date, signed.amount, description)
    const fitid = (rec.FITID ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 64)
    let suffix = fitid
    if (!suffix) {
      const n = (seqByKey.get(dedupKey) ?? 0) + 1
      seqByKey.set(dedupKey, n)
      suffix = `S${n}`
    }
    rows.push({
      date,
      description,
      details: name && memo && memo !== name ? memo : "",
      amount: signed.amount,
      type: signed.type,
      bankRef: `OFX_${dedupKey}_${suffix}`,
      dedupKey,
    })
  })

  const dates = rows.map((r) => r.date).sort()
  const from = ofxDate(tags.find((t) => !t.close && t.name === "DTSTART")?.value) ?? dates[0] ?? ""
  const to = ofxDate(tags.find((t) => !t.close && t.name === "DTEND")?.value) ?? dates.at(-1) ?? ""
  return { rows, period: { from, to }, accountNumber, errors }
}

export const ofxParser: BankStatementParser = { id: "ofx", detect: detectOfx, parse: parseOfx }
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPatterns="bankParsers/ofx"`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/bankParsers/ofx.ts __tests__/lib/bankParsers/ofx.test.ts
git commit -m "feat(bank-import): OFX/QFX parser"
```

---

### Task 3: QIF parser

**Files:**
- Create: `src/lib/bankParsers/qif.ts`
- Test: `__tests__/lib/bankParsers/qif.test.ts`

**Interfaces:**
- Consumes: `normaliseSignedAmount` (Task 1), `bankRefContentKey`, `isRealCalendarDate`.
- Produces: `type QifDateOrder = "DMY" | "MDY"`, `detectQif(text: string): boolean`, `parseQif(text: string, opts: { accountKey: string; dateOrder?: QifDateOrder }): ParseResult`.
- `accountKey` is `PA<paymentAccountId>` (QIF has no account number); `ParseResult.accountNumber` is always `""`.
- bankRef: `QIF_<contentKey>_<n>`, `n` = 1-based occurrence of that content key in the file.

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/lib/bankParsers/qif.test.ts
import { detectQif, parseQif } from "@/lib/bankParsers/qif"
import { bankRefContentKey } from "@/lib/anzParser"

const BANK = `!Type:Bank
D25/09/2026
T200.00
PTRANSFER FROM J CITIZEN
MTithe
^
D03/09/2026
T-312.40
PEXAMPLE ENERGY
N1001
^
`

describe("detectQif", () => {
  it("detects Bank and CCard headers", () => {
    expect(detectQif(BANK)).toBe(true)
    expect(detectQif("!Type:CCard\nD1/1/26\n^")).toBe(true)
  })
  it("rejects other types and OFX", () => {
    expect(detectQif("!Type:Invst\n^")).toBe(false)
    expect(detectQif("<OFX>")).toBe(false)
  })
})

describe("parseQif", () => {
  const opts = { accountKey: "PA7" }

  it("parses rows and infers DD/MM when a day > 12 appears", () => {
    const r = parseQif(BANK, opts)
    expect(r.dateFormatAmbiguous).toBeUndefined()
    expect(r.accountNumber).toBe("")
    expect(r.rows).toHaveLength(2)
    expect(r.rows[0]).toMatchObject({ date: "2026-09-25", amount: "200.00", type: "INCOME", description: "TRANSFER FROM J CITIZEN", details: "Tithe" })
    expect(r.rows[1]).toMatchObject({ date: "2026-09-03", amount: "312.40", type: "EXPENSE", details: "" })
    expect(r.period).toEqual({ from: "2026-09-03", to: "2026-09-25" })
  })

  it("builds QIF_ bankRef with the account key and an occurrence index", () => {
    const dup = BANK + BANK.replace("!Type:Bank\n", "")
    const rows = parseQif(dup, opts).rows
    const key = bankRefContentKey("PA7", "2026-09-25", "200.00", "TRANSFER FROM J CITIZEN")
    expect(rows[0].bankRef).toBe(`QIF_${key}_1`)
    expect(rows[2].bankRef).toBe(`QIF_${key}_2`)
    expect(rows[0].dedupKey).toBe(key)
  })

  it("infers MM/DD when a second component > 12 appears", () => {
    const us = BANK.replace("D25/09/2026", "D09/25/2026").replace("D03/09/2026", "D09/03/2026")
    expect(parseQif(us, opts).rows.map((r) => r.date)).toEqual(["2026-09-25", "2026-09-03"])
  })

  it("flags ambiguity and defaults to DD/MM, honouring an explicit order", () => {
    const amb = BANK.replace("D25/09/2026", "D05/09/2026")
    const r = parseQif(amb, opts)
    expect(r.dateFormatAmbiguous).toBe(true)
    expect(r.rows[0].date).toBe("2026-09-05")
    const us = parseQif(amb, { ...opts, dateOrder: "MDY" })
    expect(us.dateFormatAmbiguous).toBeUndefined()
    expect(us.rows[0].date).toBe("2026-05-09")
  })

  it("rejects a file mixing DD/MM and MM/DD evidence", () => {
    const mixed = BANK.replace("D03/09/2026", "D09/25/2026")
    expect(parseQif(mixed, opts).fatalError).toBe("Dates in this file use mixed formats and can't be read reliably.")
  })

  it("handles 2-digit and apostrophe years, ISO dates, and U amounts", () => {
    const text = "!Type:CCard\nD5/9'26\nU-1,234.50\nPA\n^\nD2026-09-30\nT10\nPB\n^\n"
    const rows = parseQif(text, opts).rows
    expect(rows.map((r) => [r.date, r.amount, r.type])).toEqual([
      ["2026-09-05", "1234.50", "EXPENSE"],
      ["2026-09-30", "10.00", "INCOME"],
    ])
  })

  it("skips records with bad date/amount/payee into errors", () => {
    const bad = "!Type:Bank\nD31/02/2026\nT1\nPX\n^\nD01/09/2026\nTabc\nPY\n^\nD02/09/2026\nT5\n^\n"
    const r = parseQif(bad, opts)
    expect(r.rows).toEqual([])
    expect(r.errors).toHaveLength(3)
  })

  it("tolerates CRLF and a missing trailing ^", () => {
    const text = "!Type:Bank\r\nD25/09/2026\r\nT1.00\r\nPX\r\n"
    expect(parseQif(text, opts).rows).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- --testPathPatterns="bankParsers/qif"`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// src/lib/bankParsers/qif.ts
import { bankRefContentKey, type ParsedRow, type ParseResult } from "@/lib/anzParser"
import { isRealCalendarDate } from "@/lib/validation"
import { normaliseSignedAmount } from "./amount"

export type QifDateOrder = "DMY" | "MDY"

type RawRecord = { D?: string; T?: string; U?: string; P?: string; M?: string }
type DateParts = { a: number; b: number; year: number } | { iso: string }

/** True when the text starts with a QIF Bank or CCard type header. */
export function detectQif(text: string): boolean {
  return /^\s*!Type:(Bank|CCard)\b/i.test(text.slice(0, 200))
}

/** Split a QIF date ("25/09/2026", "5/9'26", "2026-09-30") into components. */
function splitDate(raw: string): DateParts | null {
  const s = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { iso: s }
  const m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-]|')\s*(\d{2}|\d{4})$/.exec(s)
  if (!m) return null
  const y = Number.parseInt(m[3], 10)
  return { a: Number.parseInt(m[1], 10), b: Number.parseInt(m[2], 10), year: m[3].length === 2 ? 2000 + y : y }
}

/** Resolve split date parts to ISO under the given order; null if not a real date. */
function toIso(p: DateParts, order: QifDateOrder): string | null {
  if ("iso" in p) return isRealCalendarDate(p.iso) ? p.iso : null
  const [day, month] = order === "DMY" ? [p.a, p.b] : [p.b, p.a]
  const iso = `${p.year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  return isRealCalendarDate(iso) ? iso : null
}

/** Split QIF text into records of first-letter field codes; split lines (S/E/$) and others are ignored. */
function readRecords(text: string): RawRecord[] {
  const records: RawRecord[] = []
  let cur: RawRecord = {}
  let has = false
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("!")) continue
    if (line.startsWith("^")) {
      if (has) records.push(cur)
      cur = {}
      has = false
      continue
    }
    const code = line[0] as keyof RawRecord
    if (code === "D" || code === "T" || code === "U" || code === "P" || code === "M") {
      cur[code] = line.slice(1).trim()
      has = true
    }
  }
  if (has) records.push(cur)
  return records
}

/**
 * Parse a QIF Bank/CCard export. QIF has no account number, so the caller
 * passes `accountKey` (`PA<paymentAccountId>`) for the bankRef. Date order is
 * inferred from any component > 12; when nothing disambiguates, `dateOrder`
 * (default DD/MM, AU) is used and `dateFormatAmbiguous` is set unless the
 * caller chose the order explicitly.
 */
export function parseQif(text: string, opts: { accountKey: string; dateOrder?: QifDateOrder }): ParseResult {
  const records = readRecords(text)
  const parts = records.map((r) => (r.D ? splitDate(r.D) : null))

  const slashParts = parts.filter((p): p is { a: number; b: number; year: number } => !!p && !("iso" in p))
  const dmyEvidence = slashParts.some((p) => p.a > 12)
  const mdyEvidence = slashParts.some((p) => p.b > 12)
  if (dmyEvidence && mdyEvidence) {
    return { rows: [], period: { from: "", to: "" }, accountNumber: "", errors: [], fatalError: "Dates in this file use mixed formats and can't be read reliably." }
  }
  let order: QifDateOrder = opts.dateOrder ?? "DMY"
  let ambiguous = false
  if (dmyEvidence) order = "DMY"
  else if (mdyEvidence) order = "MDY"
  else if (slashParts.length > 0 && !opts.dateOrder) ambiguous = true

  const rows: ParsedRow[] = []
  const errors: string[] = []
  const seqByKey = new Map<string, number>()
  records.forEach((rec, i) => {
    const p = parts[i]
    const date = p ? toIso(p, order) : null
    const signed = normaliseSignedAmount(rec.T ?? rec.U ?? "")
    const payee = rec.P ?? ""
    const memo = rec.M ?? ""
    const description = payee || memo
    if (!date || !signed || !description) {
      errors.push(`Record ${i + 1}: unreadable date, amount or payee`)
      return
    }
    const dedupKey = bankRefContentKey(opts.accountKey, date, signed.amount, description)
    const n = (seqByKey.get(dedupKey) ?? 0) + 1
    seqByKey.set(dedupKey, n)
    rows.push({
      date,
      description,
      details: payee && memo && memo !== payee ? memo : "",
      amount: signed.amount,
      type: signed.type,
      bankRef: `QIF_${dedupKey}_${n}`,
      dedupKey,
    })
  })

  const dates = rows.map((r) => r.date).sort()
  return {
    rows,
    period: { from: dates[0] ?? "", to: dates.at(-1) ?? "" },
    accountNumber: "",
    errors,
    ...(ambiguous ? { dateFormatAmbiguous: true } : {}),
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPatterns="bankParsers/qif"`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/bankParsers/qif.ts __tests__/lib/bankParsers/qif.test.ts
git commit -m "feat(bank-import): QIF parser with date-order inference"
```

---

### Task 4: Cross-format content key for OFX/QIF bankRefs

**Files:**
- Modify: `src/lib/anzParser.ts` (`contentKeyFromBankRef`, ~line 184)
- Test: `__tests__/lib/anzParser.test.ts` (append a `describe`)

**Interfaces:**
- Produces: `contentKeyFromBankRef("OFX_…" | "QIF_…")` returns the content key, so upload flagging (`route.ts::findDuplicateBankRefs`) and commit recheck (`bankImportConfirm.ts::isDuplicate`) dedup OFX/QIF re-imports with no further changes.

- [ ] **Step 1: Write the failing test** (append to `__tests__/lib/anzParser.test.ts`)

```ts
describe("contentKeyFromBankRef — OFX/QIF", () => {
  it("recovers the content key from OFX and QIF refs", () => {
    const key = bankRefContentKey("000111222333", "2026-09-02", "200.00", "TRANSFER FROM J CITIZEN")
    expect(contentKeyFromBankRef(`OFX_${key}_2026090201A`)).toBe(key)
    expect(contentKeyFromBankRef(`OFX_${key}_S1`)).toBe(key)
    const qkey = bankRefContentKey("PA7", "2026-09-02", "200.00", "X")
    expect(contentKeyFromBankRef(`QIF_${qkey}_2`)).toBe(qkey)
    expect(contentKeyFromBankRef(`QIF_${qkey}_2#3`)).toBe(qkey)
  })

  it("still rejects unknown prefixes", () => {
    expect(contentKeyFromBankRef("CSV_1_20260902_1.00_X_1")).toBeNull()
  })
})
```

(Ensure `bankRefContentKey` and `contentKeyFromBankRef` are in the file's existing import from `@/lib/anzParser`; add them if not.)

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- --testPathPatterns="anzParser"`
Expected: FAIL — `contentKeyFromBankRef(...)` returns `null`

- [ ] **Step 3: Implement** — in `contentKeyFromBankRef`, change the prefix regex and its comment:

```ts
// Recover the cross-format content key from a stored bankRef of any imported
// format (ANZ_, ANZTR_, OFX_, QIF_). Returns null for a manually-keyed ref or
// a petty-cash paired leg (XFER_OUT_*), which have no bank-line content key.
// Split-sibling suffixes ("#2", "#3" …) are stripped first.
export function contentKeyFromBankRef(bankRef: string): string | null {
  if (bankRef.startsWith("XFER_OUT_")) return null
  const prefix = /^(?:ANZ(?:TR)?|OFX|QIF)_/.exec(bankRef)
```

(rest of the function unchanged)

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPatterns="anzParser|bankImportConfirm|bank-statement"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/anzParser.ts __tests__/lib/anzParser.test.ts
git commit -m "feat(bank-import): dedup content key for OFX/QIF refs"
```

---

### Task 5: Possible-duplicate classifier + account map

**Files:**
- Create: `src/lib/bankPossibleDuplicate.ts`
- Create: `src/lib/bankAccountMap.ts`
- Create: `src/lib/actions/bankImport.ts`
- Test: `__tests__/lib/bankPossibleDuplicate.test.ts`, `__tests__/lib/bankAccountMap.test.ts`, `__tests__/lib/actions/bankImport.test.ts`

**Interfaces:**
- Produces: `findPossibleDuplicates(rows: Pick<ParsedRow, "bankRef" | "date" | "amount" | "type">[], exactDuplicateRefs: Set<string>, existing: { date: Date; amount: { toString(): string }; type: string }[]): string[]` → bankRefs.
- Produces: `BANK_ACCOUNT_MAP_KEY = "bankImport.accountMap"`, `accountSuffix(accountNumber: string): string | null`, `parseAccountMap(raw: string | null | undefined): Record<string, number>`, `suggestPaymentAccountId(accountNumber: string): Promise<number | null>`.
- Produces: server action `rememberBankImportAccount(accountNumber: string, paymentAccountId: number): Promise<{ error: string } | { success: true }>`.

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/lib/bankPossibleDuplicate.test.ts
import { findPossibleDuplicates } from "@/lib/bankPossibleDuplicate"

const row = (bankRef: string, date: string, amount: string, type: "INCOME" | "EXPENSE" = "INCOME") => ({ bankRef, date, amount, type })
const tx = (date: string, amount: string, type = "INCOME") => ({ date: new Date(`${date}T00:00:00.000Z`), amount: { toString: () => amount }, type })

describe("findPossibleDuplicates", () => {
  it("flags same date + amount + type", () => {
    expect(findPossibleDuplicates([row("A", "2026-09-02", "200.00")], new Set(), [tx("2026-09-02", "200")])).toEqual(["A"])
  })
  it("ignores different date, amount or direction", () => {
    const rows = [row("A", "2026-09-03", "200.00"), row("B", "2026-09-02", "200.01"), row("C", "2026-09-02", "200.00", "EXPENSE")]
    expect(findPossibleDuplicates(rows, new Set(), [tx("2026-09-02", "200.00")])).toEqual([])
  })
  it("skips rows already exact duplicates", () => {
    expect(findPossibleDuplicates([row("A", "2026-09-02", "1.00")], new Set(["A"]), [tx("2026-09-02", "1.00")])).toEqual([])
  })
  it("consumes each existing transaction once", () => {
    const rows = [row("A", "2026-09-02", "5.00"), row("B", "2026-09-02", "5.00")]
    expect(findPossibleDuplicates(rows, new Set(), [tx("2026-09-02", "5.00")])).toEqual(["A"])
  })
})
```

```ts
// __tests__/lib/bankAccountMap.test.ts
/** @jest-environment node */
import { accountSuffix, parseAccountMap, suggestPaymentAccountId, BANK_ACCOUNT_MAP_KEY } from "@/lib/bankAccountMap"
import { prisma } from "@/lib/prisma"

jest.mock("@/lib/prisma", () => ({
  prisma: { appSetting: { findUnique: jest.fn() }, paymentAccount: { findFirst: jest.fn() } },
}))

describe("accountSuffix", () => {
  it("returns the last 4 digits", () => {
    expect(accountSuffix("0123-4567 4821")).toBe("4821")
  })
  it("returns null when fewer than 4 digits", () => {
    expect(accountSuffix("")).toBeNull()
    expect(accountSuffix("12a")).toBeNull()
  })
})

describe("parseAccountMap", () => {
  it("keeps only 4-digit keys with positive int values", () => {
    expect(parseAccountMap('{"4821":3,"12":4,"9999":-1,"1111":"x"}')).toEqual({ "4821": 3 })
  })
  it("returns {} for null or corrupt JSON", () => {
    expect(parseAccountMap(null)).toEqual({})
    expect(parseAccountMap("{nope")).toEqual({})
    expect(parseAccountMap("[1]")).toEqual({})
  })
})

describe("suggestPaymentAccountId", () => {
  beforeEach(() => jest.clearAllMocks())

  it("returns the mapped id when the account is an active BANK", async () => {
    ;(prisma.appSetting.findUnique as jest.Mock).mockResolvedValue({ key: BANK_ACCOUNT_MAP_KEY, value: '{"4821":3}' })
    ;(prisma.paymentAccount.findFirst as jest.Mock).mockResolvedValue({ id: 3 })
    await expect(suggestPaymentAccountId("000111224821")).resolves.toBe(3)
    expect(prisma.paymentAccount.findFirst).toHaveBeenCalledWith({ where: { id: 3, kind: "BANK", isActive: true }, select: { id: true } })
  })
  it("returns null for stale ids, unmapped suffixes, or no account number", async () => {
    ;(prisma.appSetting.findUnique as jest.Mock).mockResolvedValue({ value: '{"4821":3}' })
    ;(prisma.paymentAccount.findFirst as jest.Mock).mockResolvedValue(null)
    await expect(suggestPaymentAccountId("4821")).resolves.toBeNull()
    await expect(suggestPaymentAccountId("5555")).resolves.toBeNull()
    await expect(suggestPaymentAccountId("")).resolves.toBeNull()
  })
})
```

```ts
// __tests__/lib/actions/bankImport.test.ts
/** @jest-environment node */
jest.mock("@/lib/featureFlags")
import { rememberBankImportAccount } from "@/lib/actions/bankImport"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    appSetting: { findUnique: jest.fn(), upsert: jest.fn() },
    paymentAccount: { findFirst: jest.fn() },
  },
}))

describe("rememberBankImportAccount", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    ;(prisma.paymentAccount.findFirst as jest.Mock).mockResolvedValue({ id: 3 })
    ;(prisma.appSetting.findUnique as jest.Mock).mockResolvedValue({ value: '{"1111":2}' })
  })

  it("rejects roles without accounting access", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "AUDITOR" } })
    await expect(rememberBankImportAccount("000111224821", 3)).resolves.toEqual({ error: "Unauthorized" })
    expect(prisma.appSetting.upsert).not.toHaveBeenCalled()
  })

  it("rejects a non-BANK or inactive account", async () => {
    ;(prisma.paymentAccount.findFirst as jest.Mock).mockResolvedValue(null)
    await expect(rememberBankImportAccount("000111224821", 3)).resolves.toEqual({ error: "Invalid bank account" })
  })

  it("rejects an account number without 4 digits", async () => {
    await expect(rememberBankImportAccount("12", 3)).resolves.toEqual({ error: "Invalid account number" })
  })

  it("merges the last-4 mapping into the stored map", async () => {
    await expect(rememberBankImportAccount("000111224821", 3)).resolves.toEqual({ success: true })
    expect(prisma.appSetting.upsert).toHaveBeenCalledWith({
      where: { key: "bankImport.accountMap" },
      create: { key: "bankImport.accountMap", value: '{"1111":2,"4821":3}' },
      update: { value: '{"1111":2,"4821":3}' },
    })
  })
})
```

Check `__mocks__` for `@/lib/featureFlags` (used by `jest.mock("@/lib/featureFlags")` in existing tests) returns `featureGuard → null`; if the auto-mock returns `undefined`, that is also falsy and fine.

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- --testPathPatterns="bankPossibleDuplicate|bankAccountMap|actions/bankImport"`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement**

```ts
// src/lib/bankPossibleDuplicate.ts
import type { ParsedRow } from "@/lib/anzParser"
import { toCents } from "@/lib/formatting"

/**
 * Soft cross-format duplicate check: a parsed row whose date + amount + direction
 * equals an existing transaction (any source, incl. manual entry) but which was
 * NOT an exact/content-key duplicate. Catches the same bank line imported first
 * from a PDF and again from OFX/QIF, where descriptions/account formats differ.
 * Each existing transaction can vouch for at most one row, so two genuine
 * identical lines against one prior entry flag only one. Returns bankRefs.
 */
export function findPossibleDuplicates(
  rows: Pick<ParsedRow, "bankRef" | "date" | "amount" | "type">[],
  exactDuplicateRefs: Set<string>,
  existing: { date: Date; amount: { toString(): string }; type: string }[],
): string[] {
  const available = new Map<string, number>()
  for (const t of existing) {
    // Dates are stored at UTC midnight (date-only convention), so the ISO date part is the wall-clock date.
    const k = `${t.date.toISOString().slice(0, 10)}|${toCents(t.amount.toString())}|${t.type}`
    available.set(k, (available.get(k) ?? 0) + 1)
  }
  const flagged: string[] = []
  for (const r of rows) {
    if (exactDuplicateRefs.has(r.bankRef)) continue
    const k = `${r.date}|${toCents(r.amount)}|${r.type}`
    const n = available.get(k) ?? 0
    if (n > 0) {
      available.set(k, n - 1)
      flagged.push(r.bankRef)
    }
  }
  return flagged
}
```

```ts
// src/lib/bankAccountMap.ts
import { prisma } from "@/lib/prisma"

// AppSetting key holding { "<last 4 digits>": paymentAccountId } so an upload
// can pre-select the ParishCRM bank account. Only the last 4 digits are kept —
// enough to tell a church's handful of accounts apart, not a full account number.
export const BANK_ACCOUNT_MAP_KEY = "bankImport.accountMap"

/** Last 4 digits of a bank account number, or null when it has fewer than 4. */
export function accountSuffix(accountNumber: string): string | null {
  const digits = accountNumber.replace(/\D/g, "")
  return digits.length >= 4 ? digits.slice(-4) : null
}

/** Parse the stored map defensively; corrupt or foreign entries are dropped. */
export function parseAccountMap(raw: string | null | undefined): Record<string, number> {
  if (!raw) return {}
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return {}
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(data)) {
    if (/^\d{4}$/.test(k) && Number.isInteger(v) && (v as number) > 0) out[k] = v as number
  }
  return out
}

/** Suggested PaymentAccount id for a statement's account number; null when unmapped or the account is no longer an active BANK. */
export async function suggestPaymentAccountId(accountNumber: string): Promise<number | null> {
  const suffix = accountSuffix(accountNumber)
  if (!suffix) return null
  const row = await prisma.appSetting.findUnique({ where: { key: BANK_ACCOUNT_MAP_KEY } })
  const id = parseAccountMap(row?.value)[suffix]
  if (!id) return null
  const account = await prisma.paymentAccount.findFirst({ where: { id, kind: "BANK", isActive: true }, select: { id: true } })
  return account?.id ?? null
}
```

```ts
// src/lib/actions/bankImport.ts
"use server"

import { auth } from "@/auth"
import { assertNotDemo } from "@/lib/demoMode"
import { prisma } from "@/lib/prisma"
import { canAccessAccounting } from "@/lib/roleGuard"
import { featureGuard } from "@/lib/featureFlags"
import { BANK_ACCOUNT_MAP_KEY, accountSuffix, parseAccountMap } from "@/lib/bankAccountMap"

/**
 * Remember which ParishCRM bank account a statement's account number belongs
 * to (last 4 digits only), so the next upload pre-selects it. Called by the
 * import wizard after a successful confirm. ADMIN/PASTOR; blocked in demo mode
 * and while bank import is off. Read-modify-write; a concurrent write from a
 * second admin is last-write-wins, which only costs a re-pick next time.
 */
export async function rememberBankImportAccount(
  accountNumber: string,
  paymentAccountId: number,
): Promise<{ error: string } | { success: true }> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const off = await featureGuard("bankImport")
  if (off) return off

  const suffix = typeof accountNumber === "string" ? accountSuffix(accountNumber) : null
  if (!suffix) return { error: "Invalid account number" }
  if (!Number.isInteger(paymentAccountId) || paymentAccountId <= 0) return { error: "Invalid bank account" }
  const account = await prisma.paymentAccount.findFirst({
    where: { id: paymentAccountId, kind: "BANK", isActive: true },
    select: { id: true },
  })
  if (!account) return { error: "Invalid bank account" }

  const row = await prisma.appSetting.findUnique({ where: { key: BANK_ACCOUNT_MAP_KEY } })
  const value = JSON.stringify({ ...parseAccountMap(row?.value), [suffix]: paymentAccountId })
  await prisma.appSetting.upsert({
    where: { key: BANK_ACCOUNT_MAP_KEY },
    create: { key: BANK_ACCOUNT_MAP_KEY, value },
    update: { value },
  })
  return { success: true }
}
```

Check `assertNotDemo()`'s return type in `src/lib/demoMode.ts`: it returns `{ error: string } | null`-shaped (used the same way in `accountingSettings.ts`). If its type differs, adapt the early return to `return { error: demo.error }`.

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPatterns="bankPossibleDuplicate|bankAccountMap|actions/bankImport"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/bankPossibleDuplicate.ts src/lib/bankAccountMap.ts src/lib/actions/bankImport.ts __tests__/lib/bankPossibleDuplicate.test.ts __tests__/lib/bankAccountMap.test.ts __tests__/lib/actions/bankImport.test.ts
git commit -m "feat(bank-import): possible-duplicate check + account auto-match map"
```

---

### Task 6: Upload route — source dispatch + new response fields

**Files:**
- Create: `src/lib/importSources.ts`
- Modify: `src/app/api/import/bank-statement/route.ts`
- Test: `__tests__/api/bank-statement.test.ts` (extend), `__tests__/api/bank-statement-sources.test.ts` (new)

**Interfaces:**
- Consumes: `parseOfx`, `detectOfx` (Task 2); `parseQif`, `detectQif`, `QifDateOrder` (Task 3); `findPossibleDuplicates` (Task 5); `suggestPaymentAccountId` (Task 5).
- Produces: `type ImportSource = "anz" | "ofx" | "qif"`, `IMPORT_SOURCES`, `isImportSource(v: unknown): v is ImportSource`.
- Request (multipart): `file` (required), `source` (optional, default `"anz"` — keeps old clients working), `paymentAccountId` (required for `qif`), `dateOrder` (`"DMY" | "MDY"`, optional, `qif` only).
- Response 200 (superset of today):

```ts
{
  rows: ParsedRow[]
  duplicateBankRefs: string[]
  possibleDuplicateBankRefs: string[]
  period: { from: string; to: string }
  accountNumber: string            // full number as parsed (client sends it back to rememberBankImportAccount)
  suggestedPaymentAccountId: number | null
  dateFormatAmbiguous: boolean
  errors: string[]
}
```

- [ ] **Step 1: Create `src/lib/importSources.ts`** (pure config, shared by route + UI)

```ts
// src/lib/importSources.ts

export type ImportSource = "anz" | "ofx" | "qif"

export type ImportSourceConfig = {
  label: string
  description: string
  // <input accept> value
  accept: string
  // Short "how to export" hint shown on the Upload step.
  exportHelp: string
  // Whether the file is a PDF (binary) or a text export.
  kind: "pdf" | "text"
}

// Order here is the display order on the Source step.
export const IMPORT_SOURCES: Record<ImportSource, ImportSourceConfig> = {
  anz: {
    label: "ANZ statement",
    description: "Statement or Transaction Report PDF",
    accept: "application/pdf,.pdf",
    exportHelp: "ANZ Internet Banking → Statements → download the PDF, or Transaction Search → Export → PDF report.",
    kind: "pdf",
  },
  ofx: {
    label: "OFX / QFX",
    description: "Microsoft Money / Quicken Web Connect",
    accept: ".ofx,.qfx",
    exportHelp: "In your bank's internet banking, export transactions as OFX (\"Microsoft Money\") or QFX (\"Quicken\").",
    kind: "text",
  },
  qif: {
    label: "QIF",
    description: "Quicken Interchange Format",
    accept: ".qif",
    exportHelp: "In your bank's internet banking, export transactions as QIF (\"Quicken\"). QIF files don't include the account, so pick it below first.",
    kind: "text",
  },
}

/** Type guard for an untrusted source value (form field / sessionStorage). */
export function isImportSource(v: unknown): v is ImportSource {
  return v === "anz" || v === "ofx" || v === "qif"
}
```

- [ ] **Step 2: Write the failing route tests** (new file; mirrors the setup in `bank-statement.test.ts`)

```ts
// __tests__/api/bank-statement-sources.test.ts
/** @jest-environment node */

jest.mock("@/lib/featureFlags")
import { POST } from "@/app/api/import/bank-statement/route"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: { findMany: jest.fn() },
    appSetting: { findUnique: jest.fn() },
    paymentAccount: { findFirst: jest.fn() },
  },
}))
jest.mock("unpdf", () => ({ extractText: jest.fn().mockResolvedValue({ text: ["MOCK"] }) }))

const OFX = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>AUD
<BANKACCTFROM><ACCTID>000111224821</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN><DTPOSTED>20260902<TRNAMT>200.00<FITID>F1<NAME>TRANSFER FROM J CITIZEN</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`
const QIF = "!Type:Bank\nD05/09/2026\nT-10.00\nPEXAMPLE SHOP\n^\n"

/** Build a multipart upload request with the given file text and extra fields. */
function upload(text: string, name: string, fields: Record<string, string> = {}) {
  const fd = new FormData()
  fd.append("file", new Blob([text], { type: "application/octet-stream" }), name)
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  return POST(new Request("http://localhost", { method: "POST", body: fd, headers: { "content-length": "1024" } }))
}

describe("POST /api/import/bank-statement — OFX/QIF sources", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    ;(prisma.transaction.findMany as jest.Mock).mockResolvedValue([])
    ;(prisma.appSetting.findUnique as jest.Mock).mockResolvedValue({ value: '{"4821":3}' })
    ;(prisma.paymentAccount.findFirst as jest.Mock).mockResolvedValue({ id: 3 })
  })

  it("parses OFX and suggests the mapped account", async () => {
    const res = await upload(OFX, "s.ofx", { source: "ofx" })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rows).toHaveLength(1)
    expect(body.rows[0].bankRef).toMatch(/^OFX_/)
    expect(body.suggestedPaymentAccountId).toBe(3)
    expect(body.dateFormatAmbiguous).toBe(false)
    expect(body.possibleDuplicateBankRefs).toEqual([])
  })

  it("parses QIF with the chosen account and reports ambiguous dates", async () => {
    const res = await upload(QIF, "s.qif", { source: "qif", paymentAccountId: "3" })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rows[0].bankRef).toMatch(/^QIF_PA3_/)
    expect(body.dateFormatAmbiguous).toBe(true)
    expect(body.suggestedPaymentAccountId).toBeNull()
  })

  it("honours an explicit QIF date order", async () => {
    const body = await (await upload(QIF, "s.qif", { source: "qif", paymentAccountId: "3", dateOrder: "MDY" })).json()
    expect(body.rows[0].date).toBe("2026-05-09")
    expect(body.dateFormatAmbiguous).toBe(false)
  })

  it("requires an account for QIF", async () => {
    const res = await upload(QIF, "s.qif", { source: "qif" })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("Choose the bank account before uploading a QIF file")
  })

  it("explains a source/file mismatch", async () => {
    const res = await upload(QIF, "s.ofx", { source: "ofx" })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("This looks like a QIF file — go back and choose QIF")
  })

  it("rejects a PDF uploaded as a text source", async () => {
    const res = await upload("%PDF-1.4 ...", "s.ofx", { source: "ofx" })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("This is a PDF — go back and choose ANZ statement")
  })

  it("rejects an unknown source", async () => {
    const res = await upload(OFX, "s.ofx", { source: "csv" })
    expect(res.status).toBe(400)
  })

  it("returns the parser's fatal error", async () => {
    const res = await upload(OFX.replace("<CURDEF>AUD", "<CURDEF>USD"), "s.ofx", { source: "ofx" })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("This file is in USD. Only AUD statements can be imported.")
  })

  it("rejects a file with no transactions", async () => {
    const res = await upload("!Type:Bank\n", "s.qif", { source: "qif", paymentAccountId: "3" })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("No transactions found in this file")
  })

  it("flags possible duplicates against existing transactions", async () => {
    ;(prisma.transaction.findMany as jest.Mock).mockImplementation(({ select }) =>
      Promise.resolve(select.amount ? [{ date: new Date("2026-09-02T00:00:00.000Z"), amount: { toString: () => "200" }, type: "INCOME" }] : []),
    )
    const body = await (await upload(OFX, "s.ofx", { source: "ofx" })).json()
    expect(body.possibleDuplicateBankRefs).toEqual([body.rows[0].bankRef])
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -- --testPathPatterns="bank-statement-sources"`
Expected: FAIL (route treats every upload as PDF → "File must be a PDF")

- [ ] **Step 4: Implement the route changes** in `src/app/api/import/bank-statement/route.ts`

4a. Imports — add:

```ts
import { detectOfx, parseOfx } from "@/lib/bankParsers/ofx"
import { detectQif, parseQif, type QifDateOrder } from "@/lib/bankParsers/qif"
import { findPossibleDuplicates } from "@/lib/bankPossibleDuplicate"
import { suggestPaymentAccountId } from "@/lib/bankAccountMap"
import { IMPORT_SOURCES, isImportSource, type ImportSource } from "@/lib/importSources"
```

4b. Replace `readUploadedPdf` with `readUpload`, which returns the buffer **and** the form fields, and moves the `%PDF` check out to the per-source step:

```ts
type UploadFields = { source: ImportSource; paymentAccountId: number | null; dateOrder: QifDateOrder | undefined }

// Validates + reads the uploaded multipart file: body-size caps (checked
// before AND after formData() streams the body), file-field presence, and the
// source/paymentAccountId/dateOrder fields. `source` defaults to "anz" so a
// client that predates the wizard keeps working.
async function readUpload(req: Request): Promise<RouteFailure | { ok: true; buffer: Buffer; fields: UploadFields }> {
  // (existing demo/body-limit/formData/file/size checks — unchanged — up to and including:)
  // const buffer = Buffer.from(await file.arrayBuffer())

  const rawSource = formData.get("source") ?? "anz"
  if (!isImportSource(rawSource)) return { ok: false, error: "Unknown import source", status: 400 }
  const rawAccount = formData.get("paymentAccountId")
  const accountNum = typeof rawAccount === "string" && /^\d{1,9}$/.test(rawAccount) ? Number.parseInt(rawAccount, 10) : null
  const rawOrder = formData.get("dateOrder")
  const dateOrder = rawOrder === "DMY" || rawOrder === "MDY" ? rawOrder : undefined

  return { ok: true, buffer, fields: { source: rawSource, paymentAccountId: accountNum && accountNum > 0 ? accountNum : null, dateOrder } }
}

/** %PDF magic within the first 1KB (the spec allows leading bytes). */
function hasPdfMagic(buffer: Buffer): boolean {
  return buffer.subarray(0, 1024).toString("latin1").includes("%PDF")
}
```

Keep the existing `%PDF` comment block and move it onto `hasPdfMagic`.

4c. Add text decoding + per-source parsing:

```ts
/** Decode a text export: strict UTF-8, falling back to latin1 (older bank exports); BOM stripped. */
function decodeText(buffer: Buffer): string {
  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer)
  } catch {
    text = buffer.toString("latin1")
  }
  return text.replace(/^﻿/, "")
}

/** Name the format a text export actually looks like, for a helpful mismatch error. */
function sniffTextSource(text: string): ImportSource | null {
  if (detectOfx(text)) return "ofx"
  if (detectQif(text)) return "qif"
  return null
}

/** Parse the upload according to its declared source; PDF path is the pre-wizard behaviour verbatim. */
async function parseUpload(buffer: Buffer, fields: UploadFields): Promise<RouteFailure | { ok: true; result: ParseResult }> {
  if (fields.source === "anz") {
    if (!hasPdfMagic(buffer)) return { ok: false, error: "File must be a PDF", status: 400 }
    const textResult = await extractPdfText(buffer)
    if (!textResult.ok) return textResult
    // Auto-detect ANZ shape: the registry tries each adapter's detect() in order
    // (Transaction Report, else statement).
    return { ok: true, result: parseWithRegistry(textResult.text) }
  }

  if (hasPdfMagic(buffer)) return { ok: false, error: "This is a PDF — go back and choose ANZ statement", status: 400 }
  const text = decodeText(buffer)
  const actual = sniffTextSource(text)
  if (actual !== fields.source) {
    const msg = actual
      ? `This looks like a ${IMPORT_SOURCES[actual].label} file — go back and choose ${IMPORT_SOURCES[actual].label}`
      : `This doesn't look like a ${IMPORT_SOURCES[fields.source].label} file`
    return { ok: false, error: msg, status: 400 }
  }
  if (fields.source === "ofx") return { ok: true, result: parseOfx(text) }

  if (fields.paymentAccountId === null) {
    return { ok: false, error: "Choose the bank account before uploading a QIF file", status: 400 }
  }
  return { ok: true, result: parseQif(text, { accountKey: `PA${fields.paymentAccountId}`, dateOrder: fields.dateOrder }) }
}
```

Note: the mismatch label for QIF is `"QIF"`, so the message reads exactly `This looks like a QIF file — go back and choose QIF` (matches the test).

4d. In `validateParsedStatement`, add at the top (before the error-count log):

```ts
  if (result.fatalError) return { ok: false, error: result.fatalError, status: 400 }
```

and after the existing `rows.length === 0 && errors.length > 0` check:

```ts
  if (result.rows.length === 0) {
    return { ok: false, error: "No transactions found in this file", status: 400 }
  }
```

Also generalise the log line from `"ANZ parse errors"` to `"Bank import parse errors"`.

4e. Add the possible-duplicate query next to `findDuplicateBankRefs`:

```ts
// Soft cross-format check over the import's date window: any existing
// transaction (bank-imported or manual) with the same date + amount + direction
// that the exact/content-key pass did not already catch. The UI pre-unticks
// these rows with a "possible duplicate" chip; commit-time dedup is unchanged.
async function findPossibleDuplicateBankRefs(rows: ParsedRow[], exact: string[]): Promise<string[]> {
  const importTimes = rows.map((r) => new Date(r.date).getTime()).filter((n) => !Number.isNaN(n))
  if (importTimes.length === 0) return []
  const existing = await prisma.transaction.findMany({
    where: { date: { gte: new Date(Math.min(...importTimes)), lte: new Date(Math.max(...importTimes)) } },
    select: { date: true, amount: true, type: true },
  })
  return findPossibleDuplicates(rows, new Set(exact), existing)
}
```

4f. Replace the body of `POST` from the file read onward:

```ts
  const upload = await readUpload(req)
  if (!upload.ok) return NextResponse.json({ error: upload.error }, { status: upload.status })

  const parsed = await parseUpload(upload.buffer, upload.fields)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status })
  const result = parsed.result

  const validated = validateParsedStatement(result)
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: validated.status })

  const duplicateBankRefs = await findDuplicateBankRefs(result.rows)
  const [possibleDuplicateBankRefs, suggestedPaymentAccountId] = await Promise.all([
    findPossibleDuplicateBankRefs(result.rows, duplicateBankRefs),
    suggestPaymentAccountId(result.accountNumber),
  ])

  return NextResponse.json({
    rows: result.rows,
    duplicateBankRefs,
    possibleDuplicateBankRefs,
    period: result.period,
    accountNumber: result.accountNumber,
    suggestedPaymentAccountId,
    dateFormatAmbiguous: result.dateFormatAmbiguous === true,
    errors: validated.clientErrors,
  })
```

Update the JSDoc on `POST` to: `/** POST /api/import/bank-statement — parse an ANZ PDF, OFX/QFX or QIF upload for review (no save). ADMIN/PASTOR only. */`

- [ ] **Step 5: Update the existing route test mocks** — in `__tests__/api/bank-statement.test.ts` and `__tests__/api/import-demo.test.ts`, extend the `@/lib/prisma` mock so the new calls resolve:

```ts
jest.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: { findMany: jest.fn() },
    appSetting: { findUnique: jest.fn().mockResolvedValue(null) },
    paymentAccount: { findFirst: jest.fn().mockResolvedValue(null) },
  },
}))
```

If any existing test asserted a 200 for a parse yielding zero rows and zero errors, update it to expect `400` / `"No transactions found in this file"` (intentional spec change). If a test asserts `findMany` was called exactly once, update the count to 2 (exact + possible-duplicate query).

- [ ] **Step 6: Run tests**

Run: `npm test -- --testPathPatterns="bank-statement|import-demo|bankParsers|anzParser"`
Expected: PASS

- [ ] **Step 7: Lint + commit**

```bash
npm run lint
git add src/lib/importSources.ts src/app/api/import/bank-statement/route.ts __tests__/api/bank-statement-sources.test.ts __tests__/api/bank-statement.test.ts __tests__/api/import-demo.test.ts
git commit -m "feat(bank-import): accept OFX/QIF uploads with possible-dup + account suggestion"
```

- [ ] **Step 8: Open PR 1**

Push and open PR titled `feat(bank-import): OFX/QFX + QIF parsers and upload support`. Body: link the spec, list deviations from this plan, note "UI follows in PR 2; route stays backwards-compatible (`source` defaults to `anz`)". Add PR to the board (`gh project item-add`). Merge gate: Normal (≥150 logic lines → reviewer per CLAUDE.md ladder; not auth/crypto/payments/migration).

---

## PR 2 — Wizard UI + docs

Branch `feat/import-wizard-ui` off `main` after PR 1 merges.

### Task 7: Review row flag + filter/stats helpers

**Files:**
- Modify: `src/lib/bankTypes.ts`
- Modify: `src/lib/bankImportDraft.ts` (row validator, ~line 85-100)
- Create: `src/lib/bankReviewFilter.ts`
- Test: `__tests__/lib/bankReviewFilter.test.ts`, `__tests__/lib/bankImportDraft.test.ts` (append)

**Interfaces:**
- Produces: `ReviewRow.isPossibleDuplicate?: boolean`.
- Produces: `type ReviewFilter = "all" | "needsCategory" | "matched" | "duplicates" | "skipped"`, `needsCategory(row: ReviewRow): boolean`, `matchesFilter(row: ReviewRow, filter: ReviewFilter): boolean`, `reviewStats(rows: ReviewRow[]): ReviewStats` where `ReviewStats = { total: number; needsCategory: number; matched: number; duplicates: number; skipped: number; incomeCents: number; expenseCents: number }`.

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/lib/bankReviewFilter.test.ts
import { needsCategory, matchesFilter, reviewStats } from "@/lib/bankReviewFilter"
import type { ReviewRow } from "@/lib/bankTypes"

const base: ReviewRow = {
  date: "2026-09-02", description: "X", details: "", amount: "10.00", type: "INCOME",
  bankRef: "R", dedupKey: "K", accountId: null, skip: false, isDuplicate: false,
  familyId: null, personId: null, fromPettyCash: false,
}
const r = (p: Partial<ReviewRow>): ReviewRow => ({ ...base, ...p })

describe("needsCategory", () => {
  it("is true for an active uncategorised row", () => expect(needsCategory(r({}))).toBe(true))
  it("is false once categorised, skipped, or a petty-cash transfer", () => {
    expect(needsCategory(r({ accountId: 1 }))).toBe(false)
    expect(needsCategory(r({ skip: true }))).toBe(false)
    expect(needsCategory(r({ fromPettyCash: true }))).toBe(false)
  })
  it("is true for an ambiguous type even if categorised", () => {
    expect(needsCategory(r({ accountId: 1, ambiguousType: true }))).toBe(true)
  })
  it("is true for an invalid split, false for a valid one", () => {
    expect(needsCategory(r({ splits: [{ accountId: 1, familyId: null, personId: null, amount: "4.00" }] }))).toBe(true)
    expect(needsCategory(r({ splits: [
      { accountId: 1, familyId: null, personId: null, amount: "4.00" },
      { accountId: 2, familyId: null, personId: null, amount: "6.00" },
    ] }))).toBe(false)
  })
})

describe("matchesFilter", () => {
  it("routes rows to tabs", () => {
    expect(matchesFilter(r({}), "all")).toBe(true)
    expect(matchesFilter(r({ personId: 5 }), "matched")).toBe(true)
    expect(matchesFilter(r({ isPossibleDuplicate: true, skip: true }), "duplicates")).toBe(true)
    expect(matchesFilter(r({ isDuplicate: true, skip: true }), "duplicates")).toBe(true)
    expect(matchesFilter(r({ skip: true }), "skipped")).toBe(true)
    expect(matchesFilter(r({ accountId: 1 }), "needsCategory")).toBe(false)
  })
})

describe("reviewStats", () => {
  it("counts tabs and sums active income/expense in cents", () => {
    const s = reviewStats([
      r({ amount: "200.00", personId: 1 }),
      r({ type: "EXPENSE", amount: "312.40", accountId: 2 }),
      r({ amount: "5.00", skip: true, isDuplicate: true }),
    ])
    expect(s).toEqual({ total: 3, needsCategory: 1, matched: 1, duplicates: 1, skipped: 1, incomeCents: 20000, expenseCents: 31240 })
  })
})
```

Check `isSplit` in `src/lib/bankSplit.ts`: if it requires ≥2 lines, the single-line split case above is "not a split" and falls through to `accountId === null` → still `true`; the expectation holds either way.

Append to `__tests__/lib/bankImportDraft.test.ts` a case that a saved draft whose row has `isPossibleDuplicate: true` round-trips through `saveDraft`/`loadDraft`, and one with `isPossibleDuplicate: "yes"` is rejected (follow the file's existing row fixture + assertion style).

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- --testPathPatterns="bankReviewFilter|bankImportDraft"`
Expected: FAIL — module not found; draft case fails

- [ ] **Step 3: Implement**

`src/lib/bankTypes.ts` — add the field:

```ts
export type ReviewRow = ParsedRow & {
  accountId: number | null
  skip: boolean
  isDuplicate: boolean
  // Same date + amount + direction as an existing transaction but not an exact
  // dedup match (e.g. imported earlier from a PDF, now from OFX). Pre-skipped.
  isPossibleDuplicate?: boolean
  familyId: number | null
  personId: number | null
  fromPettyCash: boolean
  splits?: SplitLine[]
}
```

`src/lib/bankImportDraft.ts` — in the row validator add after the `isDuplicate` line:

```ts
    (row.isPossibleDuplicate === undefined || typeof row.isPossibleDuplicate === "boolean") &&
```

and in `mergeDraftSelections` (line ~225) keep possible duplicates skipped on re-upload too:

```ts
      skip: r.isDuplicate || r.isPossibleDuplicate ? true : prev.skip,
```

(Read the surrounding function first; only change that expression.)

```ts
// src/lib/bankReviewFilter.ts
import type { ReviewRow } from "@/lib/bankTypes"
import { isSplit, splitIsValid } from "@/lib/bankSplit"
import { toCents } from "@/lib/formatting"

export type ReviewFilter = "all" | "needsCategory" | "matched" | "duplicates" | "skipped"

export type ReviewStats = {
  total: number
  needsCategory: number
  matched: number
  duplicates: number
  skipped: number
  incomeCents: number
  expenseCents: number
}

/**
 * An active row that would block import: mirrors BankReviewTable's canImport
 * rule (ambiguous type, or no category / invalid split, unless it's a
 * petty-cash transfer).
 */
export function needsCategory(row: ReviewRow): boolean {
  if (row.skip) return false
  if (row.ambiguousType) return true
  if (row.fromPettyCash) return false
  return isSplit(row) ? !splitIsValid(row) : row.accountId === null
}

/** View-only tab predicate; never changes row state. */
export function matchesFilter(row: ReviewRow, filter: ReviewFilter): boolean {
  switch (filter) {
    case "all": return true
    case "needsCategory": return needsCategory(row)
    case "matched": return row.personId !== null
    case "duplicates": return row.isDuplicate || row.isPossibleDuplicate === true
    case "skipped": return row.skip
  }
}

/** Tab counts plus income/expense totals of the rows that will be imported (integer cents). */
export function reviewStats(rows: ReviewRow[]): ReviewStats {
  const s: ReviewStats = { total: rows.length, needsCategory: 0, matched: 0, duplicates: 0, skipped: 0, incomeCents: 0, expenseCents: 0 }
  for (const row of rows) {
    if (needsCategory(row)) s.needsCategory++
    if (matchesFilter(row, "matched")) s.matched++
    if (matchesFilter(row, "duplicates")) s.duplicates++
    if (row.skip) s.skipped++
    else if (row.type === "INCOME") s.incomeCents += toCents(row.amount)
    else s.expenseCents += toCents(row.amount)
  }
  return s
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPatterns="bankReviewFilter|bankImportDraft|BankImportClient|BankReviewTable"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/bankTypes.ts src/lib/bankImportDraft.ts src/lib/bankReviewFilter.ts __tests__/lib/bankReviewFilter.test.ts __tests__/lib/bankImportDraft.test.ts
git commit -m "feat(bank-import): review filter + stats helpers, possible-dup row flag"
```

---

### Task 8: Stepper + Source step

**Files:**
- Create: `src/components/accounting/import/ImportStepper.tsx`
- Create: `src/components/accounting/import/SourceStep.tsx`
- Test: `__tests__/components/ImportWizardSteps.test.tsx`

**Interfaces:**
- Consumes: `IMPORT_SOURCES`, `ImportSource` (Task 6).
- Produces: `type WizardStep = "source" | "upload" | "review" | "done"`, `WIZARD_STEPS: { id: WizardStep; label: string }[]`, `<ImportStepper current={WizardStep} />`, `<SourceStep value={ImportSource} onChange={(s) => void} onContinue={() => void} />`.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/components/ImportWizardSteps.test.tsx
import { render, screen, fireEvent } from "@testing-library/react"
import { ImportStepper } from "@/components/accounting/import/ImportStepper"
import { SourceStep } from "@/components/accounting/import/SourceStep"

describe("ImportStepper", () => {
  it("marks earlier steps done and the current step active", () => {
    render(<ImportStepper current="review" />)
    expect(screen.getByText(/Step 3 of 4/)).toBeInTheDocument()
    expect(screen.getByRole("listitem", { name: /Review/ })).toHaveAttribute("aria-current", "step")
    expect(screen.getByRole("listitem", { name: /Upload, completed/ })).toBeInTheDocument()
  })
})

describe("SourceStep", () => {
  it("selects a source and continues", () => {
    const onChange = jest.fn()
    const onContinue = jest.fn()
    render(<SourceStep value="anz" onChange={onChange} onContinue={onContinue} />)
    fireEvent.click(screen.getByRole("radio", { name: /OFX \/ QFX/ }))
    expect(onChange).toHaveBeenCalledWith("ofx")
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))
    expect(onContinue).toHaveBeenCalled()
  })

  it("shows AI import disabled as coming soon", () => {
    render(<SourceStep value="anz" onChange={jest.fn()} onContinue={jest.fn()} />)
    const ai = screen.getByRole("radio", { name: /AI import/ })
    expect(ai).toBeDisabled()
    expect(screen.getByText("Coming soon")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- --testPathPatterns="ImportWizardSteps"`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement**

```tsx
// src/components/accounting/import/ImportStepper.tsx
import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

export type WizardStep = "source" | "upload" | "review" | "done"

export const WIZARD_STEPS: { id: WizardStep; label: string }[] = [
  { id: "source", label: "Source" },
  { id: "upload", label: "Upload" },
  { id: "review", label: "Review" },
  { id: "done", label: "Done" },
]

/** Top progress stepper for the bank import wizard; collapses to "Step n of 4" below sm. */
export function ImportStepper({ current }: Readonly<{ current: WizardStep }>) {
  const currentIndex = WIZARD_STEPS.findIndex((s) => s.id === current)
  return (
    <nav aria-label="Import progress">
      <p className="text-sm font-medium text-muted-foreground sm:hidden">
        Step {currentIndex + 1} of {WIZARD_STEPS.length}: {WIZARD_STEPS[currentIndex].label}
      </p>
      <ol className="hidden sm:flex items-center gap-2">
        {WIZARD_STEPS.map((step, i) => {
          const done = i < currentIndex
          const active = i === currentIndex
          return (
            <li
              key={step.id}
              aria-label={done ? `${step.label}, completed` : step.label}
              aria-current={active ? "step" : undefined}
              className="flex flex-1 items-center gap-2 last:flex-none"
            >
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                  done && "border-success bg-success text-success-foreground",
                  active && "border-primary bg-primary text-primary-foreground",
                  !done && !active && "bg-card text-muted-foreground",
                )}
              >
                {done ? <Check className="size-4" aria-hidden /> : i + 1}
              </span>
              <span className={cn("text-sm", active ? "font-semibold text-foreground" : "text-muted-foreground")}>{step.label}</span>
              {i < WIZARD_STEPS.length - 1 && <span aria-hidden className="h-px flex-1 bg-border" />}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
```

jsdom ignores media queries, so the phone `<p>` (`Step 3 of 4: Review`) is always in the DOM — the test matches it with a regex.

```tsx
// src/components/accounting/import/SourceStep.tsx
"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { IMPORT_SOURCES, type ImportSource } from "@/lib/importSources"

const BADGE: Record<ImportSource, string> = { anz: "PDF", ofx: "OFX", qif: "QIF" }

/** Step 1: pick the export format. Radio-group semantics so it's keyboard/screen-reader friendly. */
export function SourceStep({
  value,
  onChange,
  onContinue,
}: Readonly<{ value: ImportSource; onChange: (s: ImportSource) => void; onContinue: () => void }>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Where is your data from?</CardTitle>
        <CardDescription>Pick the file type your bank exported.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div role="radiogroup" aria-label="Import source" className="grid gap-3 sm:grid-cols-2">
          {(Object.keys(IMPORT_SOURCES) as ImportSource[]).map((id) => {
            const s = IMPORT_SOURCES[id]
            const selected = value === id
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange(id)}
                className={cn(
                  "flex min-h-11 items-start gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent",
                  selected && "border-2 border-primary bg-secondary",
                )}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary text-[11px] font-bold text-secondary-foreground">
                  {BADGE[id]}
                </span>
                <span>
                  <span className="block text-sm font-semibold">{s.label}</span>
                  <span className="block text-xs text-muted-foreground">{s.description}</span>
                </span>
              </button>
            )
          })}
          <button
            type="button"
            role="radio"
            aria-checked={false}
            disabled
            className="flex min-h-11 items-start gap-3 rounded-lg border bg-card p-3 text-left opacity-60"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary text-[11px] font-bold">AI</span>
            <span>
              <span className="block text-sm font-semibold">
                AI import <span className="ml-1 rounded-full bg-info/10 px-1.5 py-0.5 text-[10px] text-info">Coming soon</span>
              </span>
              <span className="block text-xs text-muted-foreground">Any statement, read by AI</span>
            </span>
          </button>
        </div>
        <div className="flex justify-end">
          <Button onClick={onContinue}>Continue</Button>
        </div>
      </CardContent>
    </Card>
  )
}
```

Confirm `cn` lives at `@/lib/utils` and `lucide-react`'s `Check` import matches other components (`grep -rn "from \"lucide-react\"" src/components | head -3`). Confirm `text-info`/`bg-info` and `bg-success`/`text-success-foreground` utilities exist in `globals.css` `@theme` mapping (`grep -n "color-info\|color-success" src/app/globals.css`); if a utility isn't mapped, use the nearest existing one (`text-primary`) rather than adding a colour.

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPatterns="ImportWizardSteps"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/accounting/import/ImportStepper.tsx src/components/accounting/import/SourceStep.tsx __tests__/components/ImportWizardSteps.test.tsx
git commit -m "feat(bank-import): wizard stepper and source step"
```

---

### Task 9: Upload step

**Files:**
- Create: `src/components/accounting/import/UploadStep.tsx`
- Delete: `src/components/accounting/BankUploadStep.tsx` (after Task 11 wires the new one; delete in Task 11)
- Test: `__tests__/components/UploadStep.test.tsx`

**Interfaces:**
- Consumes: `IMPORT_SOURCES`, `ImportSource`; `PaymentAccountLite` from `@/lib/paymentAccounts`; route response (Task 6).
- Produces:

```ts
export type UploadResult = {
  rows: ParsedRow[]
  duplicateBankRefs: string[]
  possibleDuplicateBankRefs: string[]
  period: { from: string; to: string } | null
  accountNumber: string
  paymentAccountId: number
  errors: string[]
}
// <UploadStep source paymentAccounts onBack onComplete={(r: UploadResult) => void} />
```

Behaviour:
- Shows `IMPORT_SOURCES[source].exportHelp`, a drop zone (click or drag) with `accept`, "max 50 MB · one file".
- QIF: account select is shown **before** the drop zone and must be chosen first (bankRef depends on it); changing it after a read clears the parsed result.
- OFX/PDF: file is read on pick; afterwards the summary shows `N rows · from – to · acct ••• 1234` and the account select is pre-filled from `suggestedPaymentAccountId` (chip "Auto-matched from file"), else the default BANK account.
- QIF ambiguous dates: shows a DD/MM vs MM/DD toggle (default DD/MM) that re-reads the same file with `dateOrder`.
- Parser warnings (`errors`) shown under the summary.
- "Continue to review" enabled only with a parsed result + account.

- [ ] **Step 1: Write the failing test**

```tsx
/**
 * @jest-environment jsdom
 */
// __tests__/components/UploadStep.test.tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { UploadStep } from "@/components/accounting/import/UploadStep"

// Native <select> stand-in for the shadcn Select — same mock as BankImportClient.draft.test.tsx.
jest.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, disabled, children }: any) => (
    <select value={value ?? ""} disabled={disabled} onChange={(e: any) => onValueChange?.(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: any) => <>{children}</>,
  SelectValue: ({ placeholder }: any) => (placeholder ? <option value="">{placeholder}</option> : null),
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectGroup: ({ children }: any) => <>{children}</>,
  SelectLabel: () => null,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}))

const accounts = [
  { id: 1, name: "Operating", kind: "BANK", isDefault: true, isActive: true },
  { id: 3, name: "Building Fund", kind: "BANK", isDefault: false, isActive: true },
] as never

const okBody = (extra: object = {}) => ({
  rows: [{ date: "2026-09-02", description: "X", details: "", amount: "1.00", type: "INCOME", bankRef: "OFX_a", dedupKey: "a" }],
  duplicateBankRefs: [], possibleDuplicateBankRefs: [], period: { from: "2026-09-01", to: "2026-09-30" },
  accountNumber: "000111224821", suggestedPaymentAccountId: 3, dateFormatAmbiguous: false, errors: [], ...extra,
})

function pick(name = "s.ofx") {
  const input = screen.getByLabelText(/Statement file/i) as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File(["x"], name)] } })
}

describe("UploadStep", () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(okBody()) }) as never
  })

  it("sets accept per source and shows export help", () => {
    render(<UploadStep source="ofx" paymentAccounts={accounts} onBack={jest.fn()} onComplete={jest.fn()} />)
    expect(screen.getByLabelText(/Statement file/i)).toHaveAttribute("accept", ".ofx,.qfx")
    expect(screen.getByText(/export transactions as OFX/)).toBeInTheDocument()
  })

  it("reads the file, shows a summary, auto-matches the account, and continues", async () => {
    const onComplete = jest.fn()
    render(<UploadStep source="ofx" paymentAccounts={accounts} onBack={jest.fn()} onComplete={onComplete} />)
    pick()
    await screen.findByText(/1 row/)
    expect(screen.getByText(/••• 4821/)).toBeInTheDocument()
    expect(screen.getByText("Auto-matched from file")).toBeInTheDocument()
    const body = (global.fetch as jest.Mock).mock.calls[0][1].body as FormData
    expect(body.get("source")).toBe("ofx")
    fireEvent.click(screen.getByRole("button", { name: "Continue to review" }))
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ paymentAccountId: 3, accountNumber: "000111224821" }))
  })

  it("QIF: requires an account first and sends it", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(okBody({ suggestedPaymentAccountId: null, accountNumber: "" })) }) as never
    render(<UploadStep source="qif" paymentAccounts={accounts} onBack={jest.fn()} onComplete={jest.fn()} />)
    pick("s.qif")
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    const body = (global.fetch as jest.Mock).mock.calls[0][1].body as FormData
    expect(body.get("paymentAccountId")).toBe("1") // default BANK pre-selected
  })

  it("QIF ambiguous dates: toggling re-reads with dateOrder", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(okBody({ dateFormatAmbiguous: true })) }) as never
    render(<UploadStep source="qif" paymentAccounts={accounts} onBack={jest.fn()} onComplete={jest.fn()} />)
    pick("s.qif")
    fireEvent.click(await screen.findByRole("radio", { name: "MM/DD" }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2))
    expect(((global.fetch as jest.Mock).mock.calls[1][1].body as FormData).get("dateOrder")).toBe("MDY")
  })

  it("shows the server error", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: "This looks like a QIF file — go back and choose QIF" }) }) as never
    render(<UploadStep source="ofx" paymentAccounts={accounts} onBack={jest.fn()} onComplete={jest.fn()} />)
    pick()
    expect(await screen.findByRole("alert")).toHaveTextContent("go back and choose QIF")
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- --testPathPatterns="UploadStep"`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```tsx
// src/components/accounting/import/UploadStep.tsx
"use client"

import { useRef, useState } from "react"
import { Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import type { ParsedRow } from "@/lib/anzParser"
import type { PaymentAccountLite } from "@/lib/paymentAccounts"
import { IMPORT_SOURCES, type ImportSource } from "@/lib/importSources"

export type UploadResult = {
  rows: ParsedRow[]
  duplicateBankRefs: string[]
  possibleDuplicateBankRefs: string[]
  period: { from: string; to: string } | null
  accountNumber: string
  paymentAccountId: number
  errors: string[]
}

type Parsed = Omit<UploadResult, "paymentAccountId"> & { autoMatched: boolean; dateFormatAmbiguous: boolean }
type DateOrder = "DMY" | "MDY"

/** Step 2: upload one export file, show what was read, and pick/confirm the ParishCRM bank account. */
export function UploadStep({
  source,
  paymentAccounts,
  onBack,
  onComplete,
}: Readonly<{
  source: ImportSource
  paymentAccounts: PaymentAccountLite[]
  onBack: () => void
  onComplete: (r: UploadResult) => void
}>) {
  const cfg = IMPORT_SOURCES[source]
  const defaultBankId = paymentAccounts.find((a) => a.kind === "BANK" && a.isDefault && a.isActive)?.id
  const [paymentAccountId, setPaymentAccountId] = useState<number | "">(defaultBankId ?? "")
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [dateOrder, setDateOrder] = useState<DateOrder>("DMY")
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const isQif = source === "qif"

  /** POST the file to the parse route; QIF also sends the account and (if chosen) date order. */
  async function read(f: File, opts: { account?: number | ""; order?: DateOrder } = {}) {
    const account = opts.account ?? paymentAccountId
    if (isQif && !account) {
      setError("Choose the bank account first.")
      return
    }
    setUploading(true)
    setError(null)
    const fd = new FormData()
    fd.append("file", f)
    fd.append("source", source)
    if (isQif) {
      fd.append("paymentAccountId", String(account))
      if (opts.order) fd.append("dateOrder", opts.order)
    }
    try {
      const res = await fetch("/api/import/bank-statement", { method: "POST", body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setParsed(null)
        setError(data.error ?? "Couldn't read this file.")
        return
      }
      setParsed({
        rows: data.rows,
        duplicateBankRefs: data.duplicateBankRefs ?? [],
        possibleDuplicateBankRefs: data.possibleDuplicateBankRefs ?? [],
        period: data.period ?? null,
        accountNumber: data.accountNumber ?? "",
        errors: data.errors ?? [],
        autoMatched: typeof data.suggestedPaymentAccountId === "number",
        dateFormatAmbiguous: data.dateFormatAmbiguous === true,
      })
      if (typeof data.suggestedPaymentAccountId === "number") setPaymentAccountId(data.suggestedPaymentAccountId)
    } catch {
      setError("Network error — please retry.")
    } finally {
      setUploading(false)
    }
  }

  /** Accept a picked or dropped file and read it straight away. */
  function accept(f: File | undefined) {
    if (!f) return
    setFile(f)
    setDateOrder("DMY")
    void read(f)
  }

  /** QIF bankRefs embed the account, so changing it after a read forces a re-read. */
  function changeAccount(id: number) {
    setPaymentAccountId(id)
    if (isQif && file) void read(file, { account: id, order: dateOrder })
    else if (parsed) setParsed({ ...parsed, autoMatched: false })
  }

  const accountSelect = (
    <div className="space-y-1">
      <label htmlFor="import-bank-account" className="text-sm font-medium">Bank account in ParishCRM</label>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={paymentAccountId === "" ? "" : String(paymentAccountId)} onValueChange={(v: string) => changeAccount(Number(v))}>
          <SelectTrigger id="import-bank-account" className="w-full sm:w-72">
            <SelectValue placeholder="Select account…" />
          </SelectTrigger>
          <SelectContent>
            {paymentAccounts.map((a) => (
              <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {parsed?.autoMatched && (
          <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs text-success">Auto-matched from file</span>
        )}
      </div>
    </div>
  )

  const suffix = parsed?.accountNumber.replace(/\D/g, "").slice(-4)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload your {cfg.label} file</CardTitle>
        <CardDescription>{cfg.exportHelp}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isQif && accountSelect}

        <label
          htmlFor="import-file"
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); accept(e.dataTransfer.files[0]) }}
          className={cn(
            "flex min-h-32 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed bg-background p-6 text-center",
            dragging && "border-primary bg-secondary",
          )}
        >
          <Upload className="size-5 text-muted-foreground" aria-hidden />
          <span className="text-sm"><strong>Drop file here</strong> or <span className="underline">browse</span></span>
          <span className="text-xs text-muted-foreground">{cfg.accept.replace(/application\/pdf,/, "")} · max 50 MB · one file</span>
          <input
            ref={inputRef}
            id="import-file"
            aria-label="Statement file"
            type="file"
            accept={cfg.accept}
            className="sr-only"
            onChange={(e) => accept(e.target.files?.[0])}
          />
        </label>

        {uploading && <p className="text-sm text-muted-foreground">Reading file…</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        {parsed && file && !uploading && (
          <div className="space-y-2 rounded-md border bg-card p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs text-success">Read</span>
              <strong className="break-all">{file.name}</strong>
              <span className="text-muted-foreground">
                {parsed.rows.length} row{parsed.rows.length === 1 ? "" : "s"}
                {parsed.period?.from && ` · ${parsed.period.from} – ${parsed.period.to}`}
                {suffix && ` · acct ••• ${suffix}`}
              </span>
            </div>
            {parsed.errors.length > 0 && <p className="text-warning">{parsed.errors[0]}</p>}
            {parsed.dateFormatAmbiguous && (
              <div role="radiogroup" aria-label="Date format" className="flex items-center gap-2">
                <span className="text-muted-foreground">Dates in this file could be either format:</span>
                {(["DMY", "MDY"] as const).map((o) => (
                  <button
                    key={o}
                    type="button"
                    role="radio"
                    aria-checked={dateOrder === o}
                    onClick={() => { setDateOrder(o); void read(file, { order: o }) }}
                    className={cn("min-h-11 rounded-full border px-3", dateOrder === o && "border-primary bg-primary text-primary-foreground")}
                  >
                    {o === "DMY" ? "DD/MM" : "MM/DD"}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {!isQif && parsed && accountSelect}

        <div className="flex justify-between">
          <Button variant="outline" onClick={onBack}>Back</Button>
          <Button
            disabled={!parsed || !paymentAccountId || uploading}
            onClick={() => parsed && paymentAccountId && onComplete({
              rows: parsed.rows,
              duplicateBankRefs: parsed.duplicateBankRefs,
              possibleDuplicateBankRefs: parsed.possibleDuplicateBankRefs,
              period: parsed.period,
              accountNumber: parsed.accountNumber,
              paymentAccountId,
              errors: parsed.errors,
            })}
          >
            Continue to review
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
```

Note `onClick` for the date-order toggle reads `file` (non-null inside the `parsed && file` block). The "1 row" summary text satisfies `findByText(/1 row/)`.

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPatterns="UploadStep"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/accounting/import/UploadStep.tsx __tests__/components/UploadStep.test.tsx
git commit -m "feat(bank-import): upload step with auto-matched account and QIF date toggle"
```

---

### Task 10: Review summary, filter tabs, possible-dup chip

**Files:**
- Create: `src/components/accounting/import/ReviewSummary.tsx`
- Create: `src/components/accounting/import/ReviewFilterTabs.tsx`
- Modify: `src/components/accounting/BankReviewTable.tsx`
- Test: `__tests__/components/BankReviewTable.test.tsx` (append)

**Interfaces:**
- Consumes: `reviewStats`, `matchesFilter`, `ReviewFilter`, `ReviewStats` (Task 7).
- Produces: `<ReviewSummary stats={ReviewStats} />`, `<ReviewFilterTabs value={ReviewFilter} stats={ReviewStats} onChange={(f) => void} />`. `BankReviewTable` props unchanged (filter state is internal, view-only).

- [ ] **Step 1: Write the failing tests** (append to `__tests__/components/BankReviewTable.test.tsx`, reusing its existing `render` helper / default props — read the top of the file first)

```tsx
describe("BankReviewTable — summary + filters", () => {
  it("shows stat tiles", () => {
    renderTable({ rows: [row({ bankRef: "a" }), row({ bankRef: "b", accountId: 1 })] })
    expect(screen.getByText("Need category").nextSibling).toHaveTextContent("1")
  })

  it("filters rows by tab without changing them", () => {
    renderTable({ rows: [row({ bankRef: "a", description: "NEEDS ONE" }), row({ bankRef: "b", accountId: 1, description: "DONE ONE" })] })
    fireEvent.click(screen.getByRole("button", { name: /Needs category/ }))
    expect(screen.getAllByText("NEEDS ONE").length).toBeGreaterThan(0)
    expect(screen.queryByText("DONE ONE")).not.toBeInTheDocument()
  })

  it("chips possible duplicates", () => {
    renderTable({ rows: [row({ bankRef: "a", isPossibleDuplicate: true, skip: true })] })
    expect(screen.getAllByText("POSSIBLE DUPLICATE").length).toBeGreaterThan(0)
  })

  it("tells the user how many rows still need a category", () => {
    renderTable({ rows: [row({ bankRef: "a" }), row({ bankRef: "b" })] })
    expect(screen.getByText("2 rows still need a category")).toBeInTheDocument()
  })
})
```

`renderTable`/`row` are the file's existing helpers; if they have different names, use those (the file already renders `BankReviewTable` with fixture rows).

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- --testPathPatterns="BankReviewTable"`
Expected: new tests FAIL

- [ ] **Step 3: Implement components**

```tsx
// src/components/accounting/import/ReviewSummary.tsx
import { centsToNumber } from "@/lib/formatting"
import type { ReviewStats } from "@/lib/bankReviewFilter"

const AUD = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" })

/** Stat tiles above the review table: rows, needs category, duplicates, in/out of rows to import. */
export function ReviewSummary({ stats }: Readonly<{ stats: ReviewStats }>) {
  const tiles = [
    { label: "Rows", value: <>{stats.total}</> },
    { label: "Need category", value: <span className={stats.needsCategory > 0 ? "text-warning" : undefined}>{stats.needsCategory}</span> },
    { label: "Duplicates", value: <>{stats.duplicates}</> },
    {
      label: "In / Out",
      value: (
        <>
          <span className="text-income">{AUD.format(centsToNumber(stats.incomeCents))}</span>{" "}
          <span className="text-expense">{AUD.format(centsToNumber(stats.expenseCents))}</span>
        </>
      ),
    },
  ]
  return (
    <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-lg border bg-card px-3 py-2">
          <dt className="text-xs text-muted-foreground">{t.label}</dt>
          <dd className="text-lg font-semibold tabular">{t.value}</dd>
        </div>
      ))}
    </dl>
  )
}
```

```tsx
// src/components/accounting/import/ReviewFilterTabs.tsx
import { cn } from "@/lib/utils"
import type { ReviewFilter, ReviewStats } from "@/lib/bankReviewFilter"

const TABS: { id: ReviewFilter; label: string; count: (s: ReviewStats) => number }[] = [
  { id: "all", label: "All", count: (s) => s.total },
  { id: "needsCategory", label: "Needs category", count: (s) => s.needsCategory },
  { id: "matched", label: "Matched member", count: (s) => s.matched },
  { id: "duplicates", label: "Duplicates", count: (s) => s.duplicates },
  { id: "skipped", label: "Skipped", count: (s) => s.skipped },
]

/** View-only filter pills for the review table; scrolls horizontally on phones. */
export function ReviewFilterTabs({
  value,
  stats,
  onChange,
}: Readonly<{ value: ReviewFilter; stats: ReviewStats; onChange: (f: ReviewFilter) => void }>) {
  return (
    <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" aria-label="Filter rows">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-pressed={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            "min-h-11 shrink-0 rounded-full border bg-card px-3 text-sm text-muted-foreground",
            value === t.id && "border-primary bg-primary text-primary-foreground",
          )}
        >
          {t.label} {t.count(stats)}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Wire into `BankReviewTable.tsx`**

4a. Imports:

```ts
import { useMemo, useState } from "react" // merge with the existing react import (it already imports Fragment)
import { ReviewSummary } from "./import/ReviewSummary"
import { ReviewFilterTabs } from "./import/ReviewFilterTabs"
import { matchesFilter, reviewStats, type ReviewFilter } from "@/lib/bankReviewFilter"
```

4b. At the top of the component body (after `canImport`):

```ts
  const [filter, setFilter] = useState<ReviewFilter>("all")
  const stats = useMemo(() => reviewStats(rows), [rows])
```

Delete the now-unused `duplicateCount` and its `· N duplicates (pre-skipped)` text in the header `<p>` (the tiles replace it); keep `{rows.length} transactions found`.

4c. Directly after the header `<div className="flex items-center justify-between">…</div>` block, insert:

```tsx
      <ReviewSummary stats={stats} />
      <ReviewFilterTabs value={filter} stats={stats} onChange={setFilter} />
```

4d. In **both** row loops (`rows.map((row, i) => {` at ~line 294 desktop and ~line 569 mobile), make the first statement:

```ts
              if (!matchesFilter(row, filter)) return null
```

(keeps the original index `i`, so `onUpdateRow(i, …)` still targets the right row).

4e. Next to both existing `row.isDuplicate` badges (~lines 318 and 595), add:

```tsx
                  {row.isPossibleDuplicate && !row.isDuplicate && (
                    <Badge variant="outline" className="text-xs mt-0.5 border-warning text-warning">
                      POSSIBLE DUPLICATE
                    </Badge>
                  )}
```

4f. After the table/card lists (end of the returned root `<div>`), add a footer that repeats the primary action for long tables:

```tsx
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <p className="text-sm text-muted-foreground">
          {stats.needsCategory > 0
            ? `${stats.needsCategory} row${stats.needsCategory === 1 ? "" : "s"} still need${stats.needsCategory === 1 ? "s" : ""} a category`
            : "All rows ready"}
        </p>
        <Button onClick={onConfirm} disabled={!canImport || importing}>
          {importing ? "Importing…" : `Import ${activeRows.length} transaction${activeRows.length !== 1 ? "s" : ""}`}
        </Button>
      </div>
```

The existing tests may query the import button by role/name; with two now present, update those queries to `getAllByRole(...)[0]` where they fail.

- [ ] **Step 5: Run tests**

Run: `npm test -- --testPathPatterns="BankReviewTable|BankImportClient"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/accounting/import/ReviewSummary.tsx src/components/accounting/import/ReviewFilterTabs.tsx src/components/accounting/BankReviewTable.tsx __tests__/components/BankReviewTable.test.tsx
git commit -m "feat(bank-import): review summary tiles, filter tabs, possible-dup chip"
```

---

### Task 11: Done step + wizard host wiring

**Files:**
- Create: `src/components/accounting/import/DoneStep.tsx`
- Modify: `src/components/accounting/BankImportClient.tsx`
- Modify: `src/app/(dashboard)/accounting/import/page.tsx` (subtitle)
- Delete: `src/components/accounting/BankUploadStep.tsx`
- Test: `__tests__/components/BankImportClient.wizard.test.tsx` (new); update `__tests__/components/BankImportClient.draft.test.tsx` if it references `BankUploadStep` or the old upload labels

**Interfaces:**
- Consumes: `ImportStepper`, `WizardStep` (Task 8), `SourceStep` (Task 8), `UploadStep`, `UploadResult` (Task 9), `rememberBankImportAccount` (Task 5), `ImportSource` (Task 6).
- Produces: `<DoneStep result={{ imported; skipped; duplicates }} onAgain={() => void} />`.

- [ ] **Step 1: Write the failing test**

```tsx
/**
 * @jest-environment jsdom
 */
// __tests__/components/BankImportClient.wizard.test.tsx
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { BankImportClient } from "@/components/accounting/BankImportClient"
import { rememberBankImportAccount } from "@/lib/actions/bankImport"

jest.mock("@/lib/actions/bankImport", () => ({ rememberBankImportAccount: jest.fn().mockResolvedValue({ success: true }) }))

// Native <select> stand-in for the shadcn Select — same mock as BankImportClient.draft.test.tsx.
jest.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, disabled, children }: any) => (
    <select value={value ?? ""} disabled={disabled} onChange={(e: any) => onValueChange?.(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: any) => <>{children}</>,
  SelectValue: ({ placeholder }: any) => (placeholder ? <option value="">{placeholder}</option> : null),
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectGroup: ({ children }: any) => <>{children}</>,
  SelectLabel: () => null,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}))

const paymentAccounts = [{ id: 1, name: "Operating", kind: "BANK", isDefault: true, isActive: true }] as never
const accounts = [{ id: 10, code: "4000", name: "Tithes", type: "INCOME" as const }]

beforeEach(() => {
  sessionStorage.clear()
  global.fetch = jest.fn((url: string) => {
    if (url.endsWith("/confirm")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ imported: 1, skipped: 0, duplicates: 0 }) })
    return Promise.resolve({ ok: true, json: () => Promise.resolve({
      rows: [{ date: "2026-09-02", description: "X", details: "", amount: "1.00", type: "INCOME", bankRef: "OFX_a", dedupKey: "a" }],
      duplicateBankRefs: [], possibleDuplicateBankRefs: [], period: { from: "2026-09-01", to: "2026-09-30" },
      accountNumber: "000111224821", suggestedPaymentAccountId: null, dateFormatAmbiguous: false, errors: [],
    }) })
  }) as never
})

it("walks Source → Upload → Review → Done and remembers the account", async () => {
  render(<BankImportClient accounts={accounts} families={[]} paymentAccounts={paymentAccounts} />)
  expect(screen.getByText(/Step 1 of 4/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole("radio", { name: /OFX \/ QFX/ }))
  fireEvent.click(screen.getByRole("button", { name: "Continue" }))
  fireEvent.change(screen.getByLabelText(/Statement file/i), { target: { files: [new File(["x"], "s.ofx")] } })
  fireEvent.click(await screen.findByRole("button", { name: "Continue to review" }))
  expect(screen.getByText(/Step 3 of 4/)).toBeInTheDocument()
  const tr = within(screen.getByRole("table")).getByText("X").closest("tr")!
  fireEvent.change(tr.querySelector("select")!, { target: { value: "10" } })
  fireEvent.click(screen.getAllByRole("button", { name: "Import 1 transaction" })[0])
  expect(await screen.findByText(/Step 4 of 4/)).toBeInTheDocument()
  expect(screen.getByText("Import complete")).toBeInTheDocument()
  await waitFor(() => expect(rememberBankImportAccount).toHaveBeenCalledWith("000111224821", 1))
})

it("marks possible duplicates skipped on upload", async () => {
  ;(global.fetch as jest.Mock).mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve({
    rows: [{ date: "2026-09-02", description: "X", details: "", amount: "1.00", type: "INCOME", bankRef: "OFX_a", dedupKey: "a" }],
    duplicateBankRefs: [], possibleDuplicateBankRefs: ["OFX_a"], period: null,
    accountNumber: "", suggestedPaymentAccountId: null, dateFormatAmbiguous: false, errors: [],
  }) }))
  render(<BankImportClient accounts={accounts} families={[]} paymentAccounts={paymentAccounts} />)
  fireEvent.click(screen.getByRole("radio", { name: /OFX \/ QFX/ }))
  fireEvent.click(screen.getByRole("button", { name: "Continue" }))
  fireEvent.change(screen.getByLabelText(/Statement file/i), { target: { files: [new File(["x"], "s.ofx")] } })
  fireEvent.click(await screen.findByRole("button", { name: "Continue to review" }))
  expect(screen.getAllByText("POSSIBLE DUPLICATE").length).toBeGreaterThan(0)
  expect(rememberBankImportAccount).not.toHaveBeenCalled()
})
```

Also update `__tests__/components/BankImportClient.draft.test.tsx`: its `jest.mock("@/components/accounting/BankUploadStep", …)` must become

```tsx
jest.mock("@/components/accounting/import/UploadStep", () => ({
  UploadStep: () => <div data-testid="upload-step" />,
}))
```

(the old module is deleted in this task, and `jest.mock` of a missing path fails). Any assertion there on `upload-step` being shown on a fresh mount now needs a click through the Source step first (`Continue`), since the wizard opens on Source.

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- --testPathPatterns="BankImportClient.wizard"`
Expected: FAIL — no stepper/source step

- [ ] **Step 3: Implement `DoneStep`**

```tsx
// src/components/accounting/import/DoneStep.tsx
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

/** Step 4: what was imported, with a way to view it or start another file. */
export function DoneStep({
  result,
  onAgain,
}: Readonly<{ result: { imported: number; skipped: number; duplicates: number } | null; onAgain: () => void }>) {
  const tiles = [
    { label: "Imported", value: result?.imported ?? 0, className: "text-success" },
    { label: "Skipped", value: result?.skipped ?? 0, className: "" },
    { label: "Duplicates", value: result?.duplicates ?? 0, className: "" },
  ]
  return (
    <Card>
      <CardHeader>
        <CardTitle>Import complete</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-3 gap-2">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-lg border bg-card px-3 py-2">
              <dt className="text-xs text-muted-foreground">{t.label}</dt>
              <dd className={`text-lg font-semibold tabular ${t.className}`}>{t.value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/accounting/transactions">View transactions</Link>
          </Button>
          <Button variant="outline" onClick={onAgain}>Import another file</Button>
        </div>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: Rewire `BankImportClient.tsx`**

4a. Imports: replace `BankUploadStep` and `Link`/`Card*` imports with:

```ts
import { ImportStepper, type WizardStep } from "./import/ImportStepper"
import { SourceStep } from "./import/SourceStep"
import { UploadStep, type UploadResult } from "./import/UploadStep"
import { DoneStep } from "./import/DoneStep"
import type { ImportSource } from "@/lib/importSources"
import { rememberBankImportAccount } from "@/lib/actions/bankImport"
```

Remove the `ParsedRow` import if no longer used.

4b. State: replace `const [view, setView] = useState<"upload" | "review" | "done">("upload")` with:

```ts
  const [view, setView] = useState<WizardStep>("source")
  const [source, setSource] = useState<ImportSource>("anz")
  // Full account number from the parsed file (OFX/ANZ); "" for QIF. Sent to
  // rememberBankImportAccount after a successful import — never stored client-side.
  const [accountNumber, setAccountNumber] = useState("")
```

Draft restore still jumps to `"review"` (unchanged).

4c. Replace `handleUploadComplete` with:

```ts
  /** Build review rows from an Upload step result: auto-match members, pre-skip exact and possible duplicates. */
  function handleUploadComplete(upload: UploadResult) {
    if (activeImport.current !== null) return
    const dupSet = new Set<string>(upload.duplicateBankRefs)
    const possibleSet = new Set<string>(upload.possibleDuplicateBankRefs)
    const fresh = upload.rows.map((r) => {
      const matched = matchPerson(`${r.description} ${r.details}`, families)
      const isDuplicate = dupSet.has(r.bankRef)
      const isPossibleDuplicate = !isDuplicate && possibleSet.has(r.bankRef)
      return {
        ...r,
        accountId: null,
        skip: isDuplicate || isPossibleDuplicate,
        isDuplicate,
        isPossibleDuplicate,
        familyId: matched.familyId,
        personId: matched.personId,
        fromPettyCash: false,
      }
    })
    // Re-uploading the same statement keeps selections already made
    setRows(mergeDraftSelections(fresh, rows))
    setPeriod(upload.period)
    setPaymentAccountId(upload.paymentAccountId)
    setAccountNumber(upload.accountNumber)
    setParseErrors(upload.errors)
    setView("review")
  }
```

4d. In `handleImport`, right after `markImported(submitted)`:

```ts
      // Remember account-number → bank-account for next time (best effort; a
      // failure only means the user re-picks the account on the next upload).
      if (accountNumber && typeof paymentAccountId === "number") {
        void rememberBankImportAccount(accountNumber, paymentAccountId).catch(() => {})
      }
```

4e. Replace the three render branches (`upload`, `done`, review) with one wrapper:

```tsx
  /** Reset to a fresh wizard after a completed import. */
  function startOver() {
    setRows([])
    setPeriod(null)
    setResult(null)
    setAccountNumber("")
    setView("source")
  }

  let body: React.ReactNode
  if (view === "source") {
    body = <SourceStep value={source} onChange={setSource} onContinue={() => setView("upload")} />
  } else if (view === "upload") {
    body = (
      <UploadStep source={source} paymentAccounts={paymentAccounts} onBack={() => setView("source")} onComplete={handleUploadComplete} />
    )
  } else if (view === "done") {
    body = <DoneStep result={result} onAgain={startOver} />
  } else {
    body = (
      <BankReviewTable
        rows={rows}
        period={period}
        parseErrors={parseErrors}
        accounts={accounts}
        families={families}
        importError={importError}
        importing={importing}
        onUpdateRow={updateRow}
        onSetAllCategory={setAllCategory}
        onToggleSkipAll={toggleSkipAll}
        onConfirm={handleImport}
        onBack={() => {
          if (activeImport.current === null) setView("upload")
        }}
      />
    )
  }

  return (
    <div className="space-y-6">
      <ImportStepper current={view} />
      {body}
    </div>
  )
```

`React.ReactNode` needs `import type { ReactNode } from "react"` (use `ReactNode` directly) per the file's import style.

4f. Note the draft-restore path sets `view` to `"review"` but `source` stays `"anz"`; Back from a restored review goes to Upload for ANZ. Acceptable (spec: draft remembers review rows; source is cosmetic there). Do **not** persist the account number in the draft (it's only for the remember call).

4g. Delete `src/components/accounting/BankUploadStep.tsx`; `grep -rn "BankUploadStep" src __tests__` must return nothing (update any test still importing it to drive `UploadStep` instead).

4h. Page subtitle in `src/app/(dashboard)/accounting/import/page.tsx`:

```tsx
          Import transactions from an ANZ statement PDF, or an OFX/QFX or QIF export from any bank
```

- [ ] **Step 5: Run tests**

Run: `npm test -- --testPathPatterns="BankImportClient|BankReviewTable|UploadStep|ImportWizardSteps|bankImportDraft"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -u src/components/accounting src/app/\(dashboard\)/accounting/import/page.tsx __tests__/components
git add src/components/accounting/import/DoneStep.tsx __tests__/components/BankImportClient.wizard.test.tsx
git commit -m "feat(bank-import): 4-step import wizard"
```

(Never `git add -A src` — see the worktree symlink trap: `src/lib/generated` may be a symlink in worktrees.)

---

### Task 12: Docs, copy, QA, PR 2

**Files:**
- Modify: `src/lib/features.ts:45`
- Modify: `website/src/content/docs/docs/bank-statement-import.md`
- Modify: `.claude/rules/bank-import.md` (local-only, gitignored — edit, don't commit)
- Modify: `README.md` only if it claims "ANZ PDF only" / "PDFs/CSVs" for bank import (`grep -n -i "bank" README.md`)

- [ ] **Step 1: Feature toggle copy** — `src/lib/features.ts:45`:

```ts
  { key: "bankImport", parent: "accounting", label: "Bank import", description: "Import ANZ statement PDFs and OFX/QFX/QIF bank exports.", defaultOn: true },
```

Run: `npm test -- --testPathPatterns="features|featureGuards"` — update any snapshot/assertion of the old description.

- [ ] **Step 2: Website docs** — read `website/src/content/docs/docs/bank-statement-import.md` in full, then:
  - Retitle the steps to the wizard: **1 Source → 2 Upload → 3 Review → 4 Done**.
  - Add a "Supported formats" table: ANZ statement / Transaction Report PDF; OFX / QFX (any bank); QIF (any bank — pick the account first; DD/MM vs MM/DD prompt when dates are ambiguous).
  - Add "Exporting from your bank" with the three `exportHelp` texts from `src/lib/importSources.ts`.
  - Describe review tiles + filter tabs, the **Possible duplicate** chip (pre-unticked; tick to import anyway), and that the bank account is auto-selected next time for OFX/ANZ files.
  - Keep existing sections on splits, petty-cash transfers, permissions unchanged.

- [ ] **Step 3: Rules file** — append to `.claude/rules/bank-import.md`:

```md
**OFX/QIF (`bankParsers/ofx.ts`, `qif.ts`)**: pure text parsers, dispatched by the upload route's `source` form field (`anz` default → PDF/registry path unchanged; `ofx`/`qif` → decode text, `detect()` must match the chosen source). bankRefs `OFX_<contentKey>_<FITID|S<n>>`, `QIF_<contentKey>_<n>` with QIF account key `PA<paymentAccountId>`; `contentKeyFromBankRef` accepts both. Soft "possible duplicate" = same date+amount+type as any existing txn (`bankPossibleDuplicate.ts`), pre-skipped in review. Account auto-match: `AppSetting` `bankImport.accountMap` (last-4 → paymentAccountId), written by `actions/bankImport.ts::rememberBankImportAccount` after confirm.
```

- [ ] **Step 4: Full verification**

Run: `npm test -- --testPathPatterns="bank|Bank|anz|import|Import|features"` then `npm run lint`
Expected: all PASS, no lint errors.

- [ ] **Step 5: QA in the browser** — `npx prisma dev --detach`, `npm run dev` (with `DISABLE_OTP=true` from `.claude.local.md`), log in as `admin@example.com`, then use `/qa` on `/accounting/import`:
  - Walk all 3 sources with synthetic files (save the test fixtures' OFX/QIF strings to the scratchpad as `.ofx`/`.qif`).
  - Wrong-source upload shows the "looks like" error.
  - QIF ambiguous file shows DD/MM / MM/DD toggle.
  - Re-upload the same OFX after import → all rows DUPLICATE.
  - Second OFX import auto-selects the account.
  - Check at 375px and ≥1920px: stepper collapses to "Step n of 4", tabs scroll, review shows cards on phone.

- [ ] **Step 6: Commit + PR 2**

```bash
git add src/lib/features.ts website/src/content/docs/docs/bank-statement-import.md
git commit -m "docs(bank-import): wizard + OFX/QIF docs and feature copy"
```

Push, open PR `feat(bank-import): 4-step import wizard`, add to board, include before/after screenshots at 375px and 1920px. Merge gate: Normal (UI, ≥150 lines → reviewer per CLAUDE.md ladder).

---

## Self-review notes

- Spec coverage: wizard steps (T8, T9, T11), stepper collapse (T8), source cards incl. disabled AI (T8), export help (T6 config, T9), OFX SGML/XML/QFX/CC/CURDEF/multi-account (T2), QIF Bank/CCard/T-U/date inference/toggle (T3, T9), bankRefs + content key (T2–T4), possible duplicate (T5, T6, T7, T10, T11), accountMap read/write, last-4 only (T5, T6, T9, T11), error table rows (T6, T9), security unchanged (T6 reuses gates; no XML lib), tests (each task), docs (T12), 2 PRs (T6 step 8, T12 step 6).
- Types used across tasks: `UploadResult` (T9 → T11), `ReviewStats`/`ReviewFilter` (T7 → T10), `WizardStep` (T8 → T11), `ImportSource`/`IMPORT_SOURCES` (T6 → T8, T9, T11), `QifDateOrder` (T3 → T6), `findPossibleDuplicates` (T5 → T6), `suggestPaymentAccountId`/`rememberBankImportAccount` (T5 → T6, T11).
