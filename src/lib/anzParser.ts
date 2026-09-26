import { toCents } from "@/lib/formatting"

export type ParsedRow = {
  date: string
  description: string
  details: string
  amount: string
  type: "INCOME" | "EXPENSE"
  bankRef: string
  // Cross-format dedup signature: the account/date/amount/description portion that
  // BOTH the statement (ANZ_) and report (ANZTR_) bankRef formats embed. Because it
  // omits the format-specific suffix (running balance vs per-key seq) and prefix,
  // the SAME real transaction yields the SAME dedupKey whether imported as a
  // Statement or a Transaction Report — so a cross-format re-import can be deduped
  // even though the two exact bankRefs differ.
  dedupKey: string
  // Legacy-format rows infer INCOME/EXPENSE from the running-balance direction.
  // When the balance is unchanged we cannot tell a deposit from a withdrawal, so
  // the `type` above is a guess only — the review UI must force a manual choice
  // before import rather than silently posting a wrong sign.
  ambiguousType?: boolean
}

export type ParseResult = {
  rows: ParsedRow[]
  period: { from: string; to: string }
  accountNumber: string
  errors: string[]
}

const MONTH_MAP: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
}

function toIso(day: string, month: string, year: number): string | null {
  const code = MONTH_MAP[month.slice(0, 3).toUpperCase()]
  if (!code) return null
  // Reject impossible calendar dates (31 APR, 29 FEB in a non-leap year). Without
  // this the string "2026-02-31" passes downstream shape checks, then new Date()
  // rolls it into March and posts the transaction under the wrong period.
  const d = Number.parseInt(day, 10)
  const mo = Number.parseInt(code, 10)
  const dt = new Date(Date.UTC(year, mo - 1, d))
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return `${year}-${code}-${day.padStart(2, "0")}`
}

type PeriodParse =
  | { ok: true; period: { from: string; to: string }; fromYear: number; toYear: number }
  | { ok: false; period: { from: string; to: string }; error: string }

// Shared statement-period extraction for both parsers: match the
// "<day> <month> <year> TO/to <day> <month> <year>" header, resolve both ends
// to ISO dates via toIso/MONTH_MAP, and report an unrecognized month by name.
// Callers differ only in the period regex (case + "TO"/"to" spelling).
function parsePeriod(text: string, periodRe: RegExp): PeriodParse {
  const periodMatch = text.match(periodRe)
  if (!periodMatch) {
    return { ok: false, period: { from: "", to: "" }, error: "Could not find statement period" }
  }
  const [, fromDay, fromMonth, fromYearStr, toDay, toMonth, toYearStr] = periodMatch
  const fromYear = Number.parseInt(fromYearStr)
  const toYear = Number.parseInt(toYearStr)
  const fromIso = toIso(fromDay, fromMonth, fromYear)
  const toIsoDate = toIso(toDay, toMonth, toYear)
  if (!fromIso || !toIsoDate) {
    const bad = !fromIso ? `${fromDay} ${fromMonth} ${fromYear}` : `${toDay} ${toMonth} ${toYear}`
    return {
      ok: false,
      period: { from: fromIso ?? "", to: toIsoDate ?? "" },
      error: `Unrecognized month or invalid date "${bad}" in statement period`,
    }
  }
  return { ok: true, period: { from: fromIso, to: toIsoDate }, fromYear, toYear }
}

// Shared statement-date-range guard ( for parseAnzStatement, for
// parseAnzTransactionReport): a year-wrap/year-decrement heuristic in either
// parser's block-grouping can mis-assign a transaction's year on a malformed
// or merged statement. Reject anything outside the statement period instead
// of silently importing a mis-dated transaction — one shared function means a
// future date-bound fix can't land in one parser and miss the other.
function assertWithinPeriod(
  date: string,
  period: { from: string; to: string },
  blockLabel: string,
  errors: string[]
): boolean {
  if (date < period.from || date > period.to) {
    errors.push(`Transaction date ${date} outside statement period ${period.from}–${period.to}: ${blockLabel}`)
    return false
  }
  return true
}

// Shared block-grouping: both parsers window their transaction table
// text down to trimmed, non-blank lines, then group them into per-transaction
// blocks starting at each DD MMM date line. They differ in what else a line
// might do — parseAnzStatement captures an opening balance and skips fixed
// header/footer strings; parseAnzTransactionReport tracks a "MMM YYYY"
// year-separator and skips its own header/footer patterns — so `beforeGroup`
// runs first per line and returning true drops that line from grouping
// entirely (its side effect, if any, has already been applied by the caller).
const MAX_BLOCK_LINES = 200

function groupIntoBlocks<T>(
  lines: string[],
  makeBlock: (dateLine: string) => T,
  pushLine: (block: T, line: string) => void,
  beforeGroup: (line: string) => boolean
): T[] {
  const blocks: T[] = []
  let current: T | null = null
  // Cap lines appended to a single block: a malformed/adversarial PDF with a long
  // run of non-date text between two date lines would otherwise grow one row's
  // `details` unbounded (up to the whole document). 200 lines/transaction is far
  // beyond any legitimate multi-line description; extra lines are dropped.
  let blockLineCount = 0
  for (const line of lines) {
    if (beforeGroup(line)) continue
    if (DATE_LINE_RE.test(line)) {
      if (current) blocks.push(current)
      current = makeBlock(line)
      blockLineCount = 0
    } else if (current && blockLineCount < MAX_BLOCK_LINES) {
      pushLine(current, line)
      blockLineCount++
    }
  }
  if (current) blocks.push(current)
  return blocks
}

// Parse a money token to exact integer cents. Handles thousands separators, an
// optional leading minus, and an optional trailing DR/CR overdrawn marker — ANZ
// prints an overdrawn running balance as "1,234.56 DR" and occasionally a
// reversal/negative amount with a leading minus, both of which previously matched
// no pattern and dropped the whole transaction. Parsing straight to cents
// (rather than parseFloat → Math.round(*100)) keeps the bankRef dedup key stable:
// Math.round of a binary float can flip the cents on edge values, producing a
// different key on re-import and a double-post.
function parseMoneyCents(str: string): number {
  const trimmed = str.trim()
  const drcr = /(DR|CR)$/i.exec(trimmed)
  const cleaned = trimmed.replace(/\s?(?:DR|CR)$/i, "").replace(/,/g, "").trim()
  const cents = toCents(cleaned) // toCents already honours a leading '-'
  return drcr && drcr[1].toUpperCase() === "DR" ? -Math.abs(cents) : cents
}

// Balance is signed (overdrawn = negative). Kept as a named alias for the many
// call sites that read a running balance.
function parseBalance(str: string): number {
  return parseMoneyCents(str)
}

// Render integer cents back to a positive magnitude decimal string ("60.00").
function centsToDecimalString(cents: number): string {
  const abs = Math.abs(cents)
  return `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`
}

// Normalize a transaction amount token to a positive magnitude decimal string.
// Direction is carried by `type` (deposit/withdrawal column or balance change),
// so a leading minus or DR/CR marker on the amount is stripped to a magnitude
//. "-60.00" / "60.00 DR" / "6,000.00" → "60.00" / "60.00" / "6000.00".
function amountMagnitude(raw: string): string {
  return centsToDecimalString(parseMoneyCents(raw))
}

// The cross-format dedup signature shared by both bankRef builders.
// Non-alphanumeric characters (including underscores) are stripped so the key
// contains only the field separators added here — making it unambiguously
// recoverable from a stored bankRef via contentKeyFromBankRef.
export function bankRefContentKey(accountNumber: string, date: string, amount: string, description: string): string {
  const desc = description.replace(/[^A-Za-z0-9]/g, "").slice(0, 20).toUpperCase()
  return `${accountNumber}_${date.replace(/-/g, "")}_${amount}_${desc}`
}

// Recover the cross-format content key from a stored bankRef of either format
//. Returns null for a non-ANZ / manually-keyed ref or a petty-cash paired
// leg (XFER_OUT_*), which have no bank-line content key. Split-sibling suffixes
// ("#2", "#3" …) are stripped first.
export function contentKeyFromBankRef(bankRef: string): string | null {
  if (bankRef.startsWith("XFER_OUT_")) return null
  const prefix = /^ANZ(?:TR)?_/.exec(bankRef)
  if (!prefix) return null
  const body = bankRef.slice(prefix[0].length).replace(/#\d+$/, "")
  const parts = body.split("_")
  // acct_date_amount_desc_suffix — at least 5 segments (desc may be empty).
  if (parts.length < 5) return null
  return parts.slice(0, -1).join("_")
}

function makeBankRef(accountNumber: string, date: string, amount: string, description: string, balanceCents: number): string {
  return `ANZ_${bankRefContentKey(accountNumber, date, amount, description)}_${balanceCents}`
}

const DATE_LINE_RE = /^(\d{2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(.*)/
// A money token: thousands separators, 2 decimals, optional leading minus and
// optional trailing DR/CR overdrawn marker.
const AMT = String.raw`-?[\d,]+\.\d{2}(?:\s?(?:DR|CR))?`
// Legacy format — two bare amounts on a line: "60.00 51,768.94"
const TWO_AMOUNTS_ONLY_RE = new RegExp(`^(${AMT})\\s+(${AMT})$`)
// Legacy format — amounts inline with description: "PAYMENT FROM JACK 60.00 51,768.94"
const ENDS_WITH_TWO_AMOUNTS_RE = new RegExp(`^(.*?)\\s+(${AMT})\\s+(${AMT})$`)
// "blank" column format (ANZ Business Extra) — deposit: "blank 60.00 51,768.94"
const DEPOSIT_ONLY_RE = new RegExp(`^blank\\s+(${AMT})\\s+(${AMT})$`)
// "blank" column format — withdrawal: "6,000.00 blank 46,793.04"
const WITHDRAWAL_ONLY_RE = new RegExp(`^(${AMT})\\s+blank\\s+(${AMT})$`)
// "blank" column format — deposit inline: "DESCRIPTION blank 60.00 51,768.94"
const INLINE_DEPOSIT_RE = new RegExp(`^(.*?)\\s+blank\\s+(${AMT})\\s+(${AMT})$`)
// "blank" column format — withdrawal inline: "DESCRIPTION 6,000.00 blank 46,793.04"
const INLINE_WITHDRAWAL_RE = new RegExp(`^(.*?)\\s+(${AMT})\\s+blank\\s+(${AMT})$`)

const SKIP_PATTERNS = [
  "OPENING BALANCE",
  "TOTALS AT END OF PAGE",
  "TOTALS AT END OF PERIOD",
  "Date Transaction Details",
  "Withdrawals ($)",
  "Deposits ($)",
]

type AnzAmountMatch = {
  desc: string | null
  amountStr: string
  balance: number
  explicitType: "INCOME" | "EXPENSE" | null
}

// Tries each Business Extra Statement amount-line shape in turn — "blank"
// column deposit/withdrawal (own-line and inline-with-description) then the
// legacy two-bare-amounts formats. Returns null when the line matches none of
// them (a plain description/detail line).
function tryParseAnzAmountLine(line: string): AnzAmountMatch | null {
  // "blank" format — deposit only: "blank 60.00 51,768.94"
  const depOnly = line.match(DEPOSIT_ONLY_RE)
  if (depOnly) return { desc: null, amountStr: amountMagnitude(depOnly[1]), balance: parseBalance(depOnly[2]), explicitType: "INCOME" }
  // "blank" format — withdrawal only: "6,000.00 blank 46,793.04"
  const wdOnly = line.match(WITHDRAWAL_ONLY_RE)
  if (wdOnly) return { desc: null, amountStr: amountMagnitude(wdOnly[1]), balance: parseBalance(wdOnly[2]), explicitType: "EXPENSE" }
  // "blank" format — deposit inline: "DESCRIPTION blank 60.00 51,768.94"
  const inlineDep = line.match(INLINE_DEPOSIT_RE)
  if (inlineDep && inlineDep[1].trim())
    return { desc: inlineDep[1].trim(), amountStr: amountMagnitude(inlineDep[2]), balance: parseBalance(inlineDep[3]), explicitType: "INCOME" }
  // "blank" format — withdrawal inline: "DESCRIPTION 6,000.00 blank 46,793.04"
  const inlineWd = line.match(INLINE_WITHDRAWAL_RE)
  if (inlineWd && inlineWd[1].trim())
    return { desc: inlineWd[1].trim(), amountStr: amountMagnitude(inlineWd[2]), balance: parseBalance(inlineWd[3]), explicitType: "EXPENSE" }
  // Legacy format — exactly two amounts: "60.00 51,768.94"
  const exact = line.match(TWO_AMOUNTS_ONLY_RE)
  if (exact) return { desc: null, amountStr: amountMagnitude(exact[1]), balance: parseBalance(exact[2]), explicitType: null }
  // Legacy format — inline: "PAYMENT FROM JACK 60.00 51,768.94"
  const inline = line.match(ENDS_WITH_TWO_AMOUNTS_RE)
  if (inline && inline[1].trim()) return { desc: inline[1].trim(), amountStr: amountMagnitude(inline[2]), balance: parseBalance(inline[3]), explicitType: null }
  return null
}

const STATEMENT_PERIOD_RE = /(\d{1,2})\s+([A-Z]+)\s+(\d{4})\s+TO\s+(\d{1,2})\s+([A-Z]+)\s+(\d{4})/

export function parseAnzStatement(text: string): ParseResult {
  const errors: string[] = []

  const periodParse = parsePeriod(text, STATEMENT_PERIOD_RE)
  if (!periodParse.ok) {
    return { rows: [], period: periodParse.period, accountNumber: "", errors: [periodParse.error] }
  }
  const { period, fromYear } = periodParse

  const acctMatch = text.match(/Account Number\s+([\d-]+)/)
  const accountNumber = acctMatch ? acctMatch[1].replace(/-/g, "") : ""

  const tableStart = text.indexOf("Date Transaction Details")
  const tableEnd = text.indexOf("TOTALS AT END OF PERIOD")
  const tableText = text.slice(
    tableStart !== -1 ? tableStart : 0,
    tableEnd !== -1 ? tableEnd : undefined
  )

  // Guard against silent data truncation on multi-page statements
  if (tableEnd !== -1 && text.lastIndexOf("TOTALS AT END OF PERIOD") !== tableEnd) {
    errors.push("Multiple 'TOTALS AT END OF PERIOD' markers found — only first section imported. Re-import remaining pages separately.")
  }

  const lines = tableText.split("\n").map((l) => l.trim()).filter(Boolean)

  // Capture the opening balance so the first legacy (bare-amount) transaction can
  // be classified by comparing against it, instead of defaulting to INCOME. The
  // amount may be inline ("OPENING BALANCE 10,000.00") or on the following line.
  let openingBalance: number | null = null
  let captureOpeningNext = false

  // Group lines into blocks — each block starts with a DD MMM line
  const blocks = groupIntoBlocks<string[]>(
    lines,
    (line) => [line],
    (block, line) => block.push(line),
    (line) => {
      if (captureOpeningNext) {
        captureOpeningNext = false
        const m = line.match(/^([\d,]+\.\d{2})$/)
        if (m) { openingBalance = parseBalance(m[1]); return true }
      }
      if (SKIP_PATTERNS.some((p) => line.includes(p))) {
        if (line.includes("OPENING BALANCE")) {
          const m = line.match(/([\d,]+\.\d{2})\s*$/)
          if (m) openingBalance = parseBalance(m[1])
          else captureOpeningNext = true
        }
        return true
      }
      if (/^\d{4}$/.test(line)) return true
      return false
    }
  )

  const rows: ParsedRow[] = []
  let prevBalance: number | null = openingBalance
  let currentYear = fromYear
  let prevMonthNum: number | null = null

  for (const block of blocks) {
    const dateMatch = block[0].match(DATE_LINE_RE)
    if (!dateMatch) continue
    const [, day, month, firstLineRest] = dateMatch

    const monthNum = Number.parseInt(MONTH_MAP[month])
    if (prevMonthNum !== null && monthNum < prevMonthNum) currentYear++
    prevMonthNum = monthNum

    const date = toIso(day, month, currentYear)
    if (date === null) {
      errors.push(`Invalid date in transaction: ${block[0]}`)
      continue
    }
    // The monotonic year-wrap heuristic above assumes chronologically ordered
    // months. Malformed/merged statements can violate that and yield a date in
    // the wrong year — reject anything outside the statement period rather than
    // silently importing a mis-dated transaction.
    if (!assertWithinPeriod(date, period, block[0], errors)) continue
    const descLines: string[] = []
    let amountStr: string | null = null
    let balance: number | null = null
    let explicitType: "INCOME" | "EXPENSE" | null = null

    const consumeLine = (line: string) => {
      // Parse the amount/balance once. Later lines fall through to the
      // description-continuation branch below — an early `return` here dropped
      // every detail line that appears AFTER the amount line in a block.
      if (amountStr === null) {
        const parsed = tryParseAnzAmountLine(line)
        if (parsed) {
          if (parsed.desc) descLines.push(parsed.desc)
          amountStr = parsed.amountStr
          balance = parsed.balance
          explicitType = parsed.explicitType
          return
        }
      }
      // Description/detail line — captured whether it precedes OR follows the
      // amount line. Skip EFFECTIVE DATE lines (settlement-date noise).
      if (/^EFFECTIVE DATE/.test(line)) return
      if (line) descLines.push(line)
    }

    if (firstLineRest.trim()) consumeLine(firstLineRest.trim())
    for (let i = 1; i < block.length; i++) consumeLine(block[i])

    if (amountStr === null || balance === null) {
      errors.push(`Could not parse amounts for: ${block[0]}`)
      continue
    }

    // A legacy row (no explicit deposit/withdrawal column) whose sign can't be
    // derived from the running balance is undecidable — flag it for manual review
    // instead of silently posting a guessed type:
    //   - equal balance: a deposit that left the balance unchanged would flip to
    //     EXPENSE;
    //   - null prevBalance (opening balance missed/unparsed): the first row would
    //     silently default to INCOME even when it's a withdrawal.
    const ambiguousType = explicitType == null && (prevBalance === null || balance === prevBalance)
    const type: "INCOME" | "EXPENSE" =
      explicitType ?? (prevBalance === null || balance > prevBalance ? "INCOME" : "EXPENSE")
    prevBalance = balance

    const description = descLines[0] ?? ""
    const details = descLines.join(" | ")
    const dedupKey = bankRefContentKey(accountNumber, date, amountStr, description)
    const bankRef = makeBankRef(accountNumber, date, amountStr, description, balance)

    rows.push({ date, description, details, amount: amountStr, type, bankRef, dedupKey, ...(ambiguousType && { ambiguousType: true }) })
  }

  return { rows, period, accountNumber, errors }
}

// ANZ "Transaction Report" — a different export from the Business Extra Statement.
// Key differences: mixed-case period with lowercase "to" and full month names,
// "$"-prefixed amounts, NO per-row running balance, descending (newest-first) dates,
// a standalone "blank" token marking the empty Withdrawals/Deposits column (its
// position relative to the amount gives the type), repeated page headers/footers
// inside the data, and a trailing disclaimer block.
const REPORT_PERIOD_RE = /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s+to\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/i
const MONTH_YEAR_SEPARATOR_RE = /^([A-Z]{3})\s+(\d{4})$/
// Require the leading `$`: real ANZ Transaction Report amount lines are
// always `$`-prefixed. An optional `$` let any description/reference line ending
// in a bare `NN.NN` be locked in as the amount (wrong value + wrong sign), while
// the true `$`-line was swallowed into the details text — no parse error raised.
const REPORT_AMOUNT_RE = new RegExp(String.raw`^(.*?)\s*\$(${AMT})\s*$`)

const REPORT_SKIP_RE = [
  /^Transaction Report/,
  /^CHEQUE ACCOUNT$/,
  /^Date Transaction Details/,
  /^Australia and New Zealand/,
  /^Account Name/,
  /^Branch Number/,
  /Account Number:/,
  /^RECENT/,
  /^\d{6}\s+\d+\s+\$/, // BSB / account number / balance value line
]

function makeReportBankRef(accountNumber: string, date: string, amount: string, description: string, seq: number): string {
  return `ANZTR_${bankRefContentKey(accountNumber, date, amount, description)}_${seq}`
}

export function parseAnzTransactionReport(text: string): ParseResult {
  const errors: string[] = []

  const periodParse = parsePeriod(text, REPORT_PERIOD_RE)
  if (!periodParse.ok) {
    return { rows: [], period: periodParse.period, accountNumber: "", errors: [periodParse.error] }
  }
  const { period, toYear } = periodParse

  // Account number appears either as a per-page "Account Number: 987654321" header
  // (pages 2+) or only in the page-1 "BSB account balance" value line.
  let accountNumber = ""
  const colonMatch = text.match(/Account Number:\s*([\d-]+)/)
  if (colonMatch) {
    accountNumber = colonMatch[1].replace(/-/g, "")
  } else {
    const valueLine = text.match(/^\d{6}\s+(\d+)\s+\$/m)
    if (valueLine) accountNumber = valueLine[1]
  }

  // Window to the transaction table: from the first column header to the totals/
  // disclaimer block. Drops the requestor/balance preamble and trailing legalese.
  const tableStart = text.indexOf("Date Transaction Details")
  const totalIdx = text.indexOf("\nTotal $")
  const disclaimerIdx = text.indexOf("Please check your Transaction Report")
  const ends = [totalIdx, disclaimerIdx].filter((i) => i !== -1)
  const tableEnd = ends.length ? Math.min(...ends) : -1
  const tableText = text.slice(
    tableStart !== -1 ? tableStart : 0,
    tableEnd !== -1 ? tableEnd : undefined
  )

  const lines = tableText.split("\n").map((l) => l.trim()).filter(Boolean)

  // Group lines into blocks, each starting with a DD MMM date line. "blank" tokens
  // and continuation lines belong to the current block. Month-year separator lines
  // ("DEC 2025") set the working year — reports are newest-first, so the year can
  // decrease as we read down.
  type Block = { year: number; segs: string[] }
  let currentYear = toYear

  const blocks = groupIntoBlocks<Block>(
    lines,
    (line) => ({ year: currentYear, segs: [line] }),
    (block, line) => block.segs.push(line),
    (line) => {
      const sep = line.match(MONTH_YEAR_SEPARATOR_RE)
      if (sep && MONTH_MAP[sep[1]]) {
        currentYear = Number.parseInt(sep[2])
        return true
      }
      if (REPORT_SKIP_RE.some((re) => re.test(line))) return true
      return false
    }
  )

  const rows: ParsedRow[] = []
  const seqByKey = new Map<string, number>()

  for (const block of blocks) {
    const dateMatch = block.segs[0].match(DATE_LINE_RE)
    if (!dateMatch) continue
    const [, day, month, firstLineRest] = dateMatch
    const date = toIso(day, month, block.year)
    if (date === null) {
      errors.push(`Invalid date in transaction: ${block.segs[0]}`)
      continue
    }
    // The year-decrement heuristic can mis-assign years from malformed/merged
    // report pages — reject anything outside the statement period rather than
    // silently importing a mis-dated transaction into the wrong FY (
    // matching parseAnzStatement's guard).
    if (!assertWithinPeriod(date, period, block.segs[0], errors)) continue

    const descLines: string[] = []
    let amountStr: string | null = null
    let type: "INCOME" | "EXPENSE" | null = null
    let sawBlank = false

    const segs = [firstLineRest.trim(), ...block.segs.slice(1)]
    for (const seg of segs) {
      if (!seg) continue
      if (seg === "blank") {
        sawBlank = true
        continue
      }
      if (amountStr === null) {
        const m = seg.match(REPORT_AMOUNT_RE)
        if (m) {
          // Amount before the "blank" marker = Withdrawals column = EXPENSE;
          // amount after "blank" = Deposits column = INCOME.
          amountStr = amountMagnitude(m[2])
          type = sawBlank ? "INCOME" : "EXPENSE"
          if (m[1].trim()) descLines.push(m[1].trim())
          continue
        }
      }
      descLines.push(seg)
    }

    if (amountStr === null || type === null) {
      errors.push(`Could not parse amount for: ${block.segs[0]}`)
      continue
    }

    const description = descLines[0] ?? ""
    const details = descLines.join(" | ")
    const dedupKey = bankRefContentKey(accountNumber, date, amountStr, description)
    const seq = seqByKey.get(dedupKey) ?? 0
    seqByKey.set(dedupKey, seq + 1)
    const bankRef = makeReportBankRef(accountNumber, date, amountStr, description, seq)

    rows.push({ date, description, details, amount: amountStr, type, bankRef, dedupKey })
  }

  return { rows, period, accountNumber, errors }
}
