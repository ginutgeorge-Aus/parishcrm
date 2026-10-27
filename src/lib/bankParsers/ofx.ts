// src/lib/bankParsers/ofx.ts
import { bankRefContentKey, type ParsedRow, type ParseResult } from "@/lib/anzParser"
import { isRealCalendarDate } from "@/lib/validation"
import { normaliseSignedAmount } from "./amount"

type Tag = { close: boolean; name: string; value: string }

// One regex scan covers both OFX 1.x SGML (unclosed leaf tags) and 2.x XML:
// each tag's value is the text up to the next "<". Hand-rolled on purpose — no
// XML parser means no entity expansion / XXE surface.
const TAG_RE = /<(\/?)([A-Za-z0-9.]+)>([^<]*)/g

const ENTITY_RE = /&(?:(amp|lt|gt|quot|apos)|#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6}));/g
const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }
// Mirrors RowSchema in bankImportConfirm.ts (description 500, details 1000).
const MAX_DESCRIPTION = 500
const MAX_DETAILS = 1000

/**
 * Decode the five XML named entities plus numeric references in one pass
 * (so "&amp;lt;" becomes "&lt;", never "<"). Unknown names and invalid code
 * points are left literal. No entity definitions are ever expanded.
 */
function decodeEntities(value: string): string {
  return value.replace(ENTITY_RE, (whole, named?: string, dec?: string, hex?: string) => {
    if (named) return NAMED_ENTITIES[named]
    const cp = dec ? Number.parseInt(dec, 10) : Number.parseInt(hex ?? "", 16)
    const valid = cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff)
    return valid ? String.fromCodePoint(cp) : whole
  })
}

/** Tokenise OFX into a flat list of open/close tags with their entity-decoded, trimmed text value. */
function tokenise(text: string): Tag[] {
  const tags: Tag[] = []
  for (const m of text.matchAll(TAG_RE)) {
    tags.push({ close: m[1] === "/", name: m[2].toUpperCase(), value: decodeEntities(m[3].trim()) })
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

  // Only statement-level ACCTIDs count; one inside a STMTTRN is a transfer's
  // counter-account (BANKACCTTO), not another statement account.
  const accountIds: string[] = []
  let inTrn = false
  for (const t of tags) {
    if (t.name === "STMTTRN") inTrn = !t.close
    else if (t.close && t.name === "BANKTRANLIST") inTrn = false
    else if (!inTrn && !t.close && t.name === "ACCTID") accountIds.push(t.value)
  }
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
    const description = (name || memo).slice(0, MAX_DESCRIPTION)
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
      details: name && memo && memo !== name ? memo.slice(0, MAX_DETAILS) : "",
      amount: signed.amount,
      type: signed.type,
      bankRef: `OFX_${dedupKey}_${suffix}`,
      dedupKey,
    })
  })

  const dates = rows.map((r) => r.date).sort((a, b) => a.localeCompare(b))
  const from = ofxDate(tags.find((t) => !t.close && t.name === "DTSTART")?.value) ?? dates[0] ?? ""
  const to = ofxDate(tags.find((t) => !t.close && t.name === "DTEND")?.value) ?? dates.at(-1) ?? ""
  return { rows, period: { from, to }, accountNumber, errors }
}
