// Shared types for the petty cash CSV import pipeline
import { MONTH_ABBR, toCents, type Money } from "@/lib/formatting"

export type RowType = "receipt" | "expense"

export interface ParsedRow {
  rowNumber: number          // 1-based, excluding header
  date: Date | null          // UTC midnight, null if unparseable
  rawDate: string
  type: RowType | null
  accountName: string
  payeeOrDonor: string
  amount: number | null      // positive, null if invalid
  amountRaw: string          // the exact validated amount string (for the dedupe key)
  notes: string
  errors: string[]           // hard errors; row is invalid when non-empty
}

export interface AccountInfo { id: number; name: string; type: "INCOME" | "EXPENSE"; isActive: boolean }
export interface PersonInfo { id: number; firstName: string; middleName: string | null; lastName: string; bankingName: string | null }

export type DonorMatch =
  | { status: "none" }
  | { status: "matched"; personId: number; label: string }
  | { status: "ambiguous"; candidates: { id: number; label: string }[] }

export interface ResolvedRow extends ParsedRow {
  accountId: number | null   // resolved from accountName, null if unresolved
  donor: DonorMatch          // receipts only; { status: "none" } for expenses
}

// Minimal RFC4180-style parser: comma-separated, double-quote quoting with ""
// escaping, CRLF or LF line endings. Blank lines are skipped.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let field = ""
  let row: string[] = []
  let inQuotes = false
  const src = text.replace(/\r\n?/g, "\n")
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ } else { inQuotes = false }
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ",") { row.push(field); field = "" }
    else if (c === "\n") {
      row.push(field); field = ""
      if (row.some((f) => f.trim() !== "")) rows.push(row)
      row = []
    } else field += c
  }
  // A quote left open at end-of-input swallowed every following line into this
  // field (newlines were absorbed while inQuotes) — the row count and every
  // downstream value are corrupt. Fail loudly instead of importing garbage.
  if (inQuotes) throw new Error("Malformed CSV: unterminated quoted field")
  row.push(field)
  if (row.some((f) => f.trim() !== "")) rows.push(row)
  return rows
}

const EXPECTED_HEADER = ["date", "type", "account", "payee_or_donor", "amount", "notes"]

function parseDate(s: string): Date | null {
  const t = s.trim()
  let y: number, m: number, d: number
  let match = t.match(/^(\d{4})([/-])(\d{2})\2(\d{2})$/)
  if (match) { y = +match[1]; m = +match[3]; d = +match[4] }
  else if ((match = t.match(/^(\d{1,2})([/-])(\d{1,2})\2(\d{4})$/))) { d = +match[1]; m = +match[3]; y = +match[4] }
  else return null
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null
  const date = new Date(Date.UTC(y, m - 1, d))
  // Reject overflow (e.g. 31/02 → Mar 3)
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null
  return date
}

function parseAmount(rawAmount: string, errors: string[]): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(rawAmount)) {
    if (/^\d+\.\d{3,}$/.test(rawAmount)) errors.push("Amount must have at most 2 decimal places")
    else errors.push("Amount must be positive")
    return null
  }
  // The regex above guarantees a non-negative decimal, so NaN is impossible.
  const amount = Number.parseFloat(rawAmount)
  if (amount <= 0) { errors.push("Amount must be positive"); return null }
  return amount
}

export function parseRows(text: string): ParsedRow[] {
  const grid = parseCsv(text)
  if (grid.length === 0) throw new Error("Empty file")
  const header = grid[0].map((h) => h.trim().toLowerCase())
  if (header.length < EXPECTED_HEADER.length || EXPECTED_HEADER.some((h, i) => header[i] !== h))
    throw new Error(`Invalid header — expected: ${EXPECTED_HEADER.join(", ")}`)

  return grid.slice(1).map((cols, idx) => {
    const [rawDate = "", rawType = "", account = "", payeeOrDonor = "", rawAmount = "", notes = ""] = cols.map((c) => c.trim())
    const errors: string[] = []

    const date = parseDate(rawDate)
    if (!date) errors.push("Invalid date")

    const typeLc = rawType.toLowerCase()
    const type: RowType | null = typeLc === "receipt" || typeLc === "expense" ? typeLc : null
    if (!type) errors.push("Type must be receipt or expense")

    const amount = parseAmount(rawAmount, errors)

    if (!account) errors.push("Account is required")

    if (type === "expense") {
      if (!payeeOrDonor) errors.push("Expense requires a payee")
      if (!notes) errors.push("Expense requires a description (notes column)")
    }

    return { rowNumber: idx + 1, date, rawDate, type, accountName: account, payeeOrDonor, amount, amountRaw: rawAmount, notes, errors }
  })
}

export function resolveAccount(
  type: RowType,
  accountName: string,
  accounts: AccountInfo[]
): { accountId: number } | { error: string } {
  const want = type === "receipt" ? "INCOME" : "EXPENSE"
  const match = accounts.find((a) => a.name.toLowerCase() === accountName.trim().toLowerCase())
  if (!match) return { error: `Unknown account "${accountName}"` }
  if (match.type !== want) return { error: `"${match.name}" is not an ${want.toLowerCase()} account` }
  if (!match.isActive) return { error: `"${match.name}" is inactive` }
  return { accountId: match.id }
}

export function sessionTitle(date: Date): string {
  return `${String(date.getUTCDate()).padStart(2, "0")}-${MONTH_ABBR[date.getUTCMonth()]}-${date.getUTCFullYear()}`
}

// Identity for idempotent re-import: a row equals an existing entry when date,
// type, account, amount and the free-text (notes for receipts / payee for
// expenses) all match.
export function dedupeKey(e: { date: Date; type: RowType; accountId: number; amount: Money; text: string }): string {
  // Key on exact integer cents: a CSV row carries its raw amount string
  // and an existing DB entry its Decimal — both normalise to the same cents, so
  // a re-import is recognised as a duplicate regardless of float representation.
  return [e.date.toISOString().slice(0, 10), e.type, e.accountId, toCents(e.amount), e.text.trim().toLowerCase()].join("|")
}

function fullName(p: PersonInfo): string {
  return [p.firstName, p.middleName, p.lastName].filter(Boolean).join(" ")
}

// Resolve every parsed row's account + donor against the supplied lookups.
// Pure (no DB) so both previewImport and commitImport can share a single
// accounts/people fetch instead of each running its own.
export function resolveRows(
  parsed: ParsedRow[],
  accounts: AccountInfo[],
  people: PersonInfo[]
): ResolvedRow[] {
  return parsed.map((r) => {
    const out: ResolvedRow = { ...r, accountId: null, donor: { status: "none" } }
    if (r.type && r.accountName) {
      const resolved = resolveAccount(r.type, r.accountName, accounts)
      if ("error" in resolved) out.errors = [...out.errors, resolved.error]
      else out.accountId = resolved.accountId
    }
    if (r.type === "receipt" && r.payeeOrDonor) out.donor = matchDonor(r.payeeOrDonor, people)
    return out
  })
}

export function matchDonor(name: string, people: PersonInfo[]): DonorMatch {
  const q = name.trim().toLowerCase()
  if (!q) return { status: "none" }
  // A person matches if the query equals their full name, "first last", or banking name.
  const hits = people.filter((p) => {
    const candidates = [fullName(p), `${p.firstName} ${p.lastName}`, p.bankingName ?? ""]
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
    return candidates.includes(q)
  })
  if (hits.length === 0) return { status: "none" }
  if (hits.length === 1) return { status: "matched", personId: hits[0].id, label: fullName(hits[0]) }
  return { status: "ambiguous", candidates: hits.map((p) => ({ id: p.id, label: fullName(p) })) }
}
