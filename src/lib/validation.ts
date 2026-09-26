// Decimal-string pattern for money amounts stored in Decimal(10,2) columns.
// Validated as a string and passed straight to Prisma — never parseFloat,
// which round-trips through binary float and can corrupt precision.
export const MONEY_DECIMAL_RE = /^\d+(\.\d{1,2})?$/

// Same, but allows a leading "-" for fields where a negative amount is valid
// (e.g. an overdrawn account balance).
export const SIGNED_MONEY_DECIMAL_RE = /^-?\d+(\.\d{1,2})?$/

// Same 2-decimal-place restriction as MONEY_DECIMAL_RE, for money fields that
// arrive already parsed to a JS number rather than a form-data string (e.g.
// DGR receipt lines, JSON-parsed from the "lines" field). Without this,
// a sub-cent line amount could make the PDF/email total (rendered via
// toFixed(2)) diverge from the persisted receipt total.
export function isTwoDecimalMoney(n: number): boolean {
  return Number.isFinite(n) && Number(n.toFixed(2)) === n
}

// True if `ymd` (a YYYY-MM-DD string) is a real calendar date — it must
// round-trip through a UTC Date without the day or month rolling over. A regex
// alone accepts impossible dates like 2025-02-30 or 2025-04-31, which JS then
// silently normalises into the next month. Anchored at UTC midnight to
// match the app's date-only storage convention.
export function isRealCalendarDate(ymd: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

// Optimistic-concurrency guard: parses the hidden "updatedAt" form field a page
// round-trips back on every edit form. A missing/malformed value (stale form,
// tampered request) falls back to an unconditional update rather than throwing,
// matching each caller's existing `where: seenAt ? { id, updatedAt: seenAt } : { id }`.
export function parseOptimisticUpdatedAt(formData: FormData): Date | null {
  const seenRaw = formData.get("updatedAt")
  return typeof seenRaw === "string" && seenRaw && !Number.isNaN(Date.parse(seenRaw)) ? new Date(seenRaw) : null
}

// Shared "possible duplicate" check for manually-keyed ledger entries
// (transaction.ts::createTransaction, pettyCashExpense.ts::createExpense):
// candidates are pre-filtered by the caller's own DB query (date/amount/account
// or session), then every listed encrypted field must match the submitted
// plaintext for at least one candidate row.
//
// `decrypt` MUST be `safeDecrypt` (@/lib/crypto), not the throwing `decrypt` —
// one corrupt/unrotated-key candidate row would otherwise make the whole check
// throw instead of just failing to match that row.
export function hasEncryptedFieldMatch<T>(
  candidates: T[],
  checks: [keyof T, string][],
  decrypt: (value: string) => string
): boolean {
  return candidates.some((c) =>
    checks.every(([field, expected]) => {
      const v = c[field]
      // Only decrypt an actual string — a null/undefined candidate field must
      // simply not match, never reach decrypt (this is a generic helper; a
      // caller's field may be nullable).
      return typeof v === "string" && decrypt(v) === expected
    }),
  )
}

// Bounds for financial-year / statement year inputs across budget, reconciliation, and DGR receipts.
export const MIN_YEAR = 2000
export const MAX_YEAR = 2100

// Stricter than /^[^\s@]+@[^\s@]+\.[^\s@]+$/, which accepted leading/trailing/
// consecutive dots (".a@x.com", "a..b@x.com", "a@x..com", "a@x.com.") that mail
// servers reject. Requires a dotted domain.
export const EMAIL_REGEX =
  /^[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_REGEX.test(email)
}

// Postgres int4 upper bound — an id above this overflows the column and
// surfaces as a raw P2003/P2025 500 instead of a clean validation error.
// Reject zero/negative/out-of-range ids before they reach Postgres
// (security.md route-param checklist).
export function isValidPgId(id: number): boolean {
  return Number.isInteger(id) && id > 0 && id <= 2147483647
}

// Parse a route/query id param. Digits only — "12abc" or "1.5" is rejected
// rather than coerced to 12 / passed through as a float. Null when invalid.
export function parseRouteId(raw: string | null | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null
  const id = Number(raw)
  return isValidPgId(id) ? id : null
}

// Reject a P2002 (unique constraint) error from a Prisma write — used to retry
// once on a concurrent-conflict race (dgrReceipt.ts, membership.ts) rather than
// surfacing an unhandled 500.
export function isP2002(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002"
}

// Reject a P2034 (Serializable transaction conflict) error — surfaced by the
// last-admin recount transactions when a concurrent write aborts the
// isolation level's read.
export function isP2034(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2034"
}
