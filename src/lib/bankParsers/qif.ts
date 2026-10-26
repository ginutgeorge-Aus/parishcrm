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
