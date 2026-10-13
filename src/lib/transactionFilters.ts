// Pure helpers for the transaction list filters — shared by the list page, the
// edit page/action ("back to my filtered list") and the client filter bar.
import { APP_LOCALE } from "@/lib/appConfig"

const LIST_PATH = "/accounting/transactions"

// Allow-list of list filter params. Anything else is dropped so a crafted
// `back` value can't smuggle extra params through the post-save redirect.
const FILTER_KEYS = ["q", "from", "to", "account", "type", "family", "paymentAccount", "reconciled", "fund", "page"] as const

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/

type FilterKey = (typeof FILTER_KEYS)[number]

/**
 * Apply the filter allow-list to a raw query string or searchParams object.
 * Only `FILTER_KEYS` with non-empty string values survive. `omit` drops keys;
 * `overrides` replaces a key's raw value (an `undefined` override drops it) -
 * used to forward validated values instead of the raw strings.
 */
function allowListedParams(
  input: string | Record<string, unknown> | undefined | null,
  omit: readonly FilterKey[] = [],
  overrides: Partial<Record<FilterKey, string | undefined>> = {}
): URLSearchParams {
  const out = new URLSearchParams()
  if (input == null) return out
  const src = typeof input === "string" ? Object.fromEntries(new URLSearchParams(input)) : input
  for (const key of FILTER_KEYS) {
    if (omit.includes(key)) continue
    const v = key in overrides ? overrides[key] : src[key]
    if (typeof v === "string" && v !== "") out.set(key, v)
  }
  return out
}

/** Sanitised list query string (no leading "?") from a raw query string or a searchParams object. */
export function transactionListQuery(input: string | Record<string, unknown> | undefined | null): string {
  return allowListedParams(input).toString()
}

/**
 * Query string (no leading "?") for the CSV export link: the same allow-list
 * as the list, minus `page` (the export is unpaginated). `validated` carries
 * the already-validated account/type/paymentAccount values, which replace the
 * raw strings so an invalid one can't reach the export route.
 */
export function transactionExportQuery(
  input: Record<string, unknown>,
  validated: { account: string | undefined; type: string | undefined; paymentAccount: string | undefined }
): string {
  return allowListedParams(input, ["page"], validated).toString()
}

/** Transactions list URL carrying the (sanitised) filters — always a same-origin path. */
export function transactionListHref(query: string | undefined | null): string {
  const qs = transactionListQuery(query)
  return qs ? `${LIST_PATH}?${qs}` : LIST_PATH
}

/** Edit-page URL that remembers the list filters it was opened from. */
export function transactionEditHref(id: number, listQuery: string): string {
  const base = `${LIST_PATH}/${id}/edit`
  return listQuery ? `${base}?back=${encodeURIComponent(listQuery)}` : base
}

export type MonthOption = { value: string; label: string }

/** Index (year*12 + zero-based month) of a UTC-midnight calendar date. */
function monthIndexOf(d: Date): number {
  return d.getUTCFullYear() * 12 + d.getUTCMonth()
}

/**
 * Every month from the earliest to the latest transaction (always including the
 * current Sydney month), newest first, as `YYYY-MM` options for the Month filter.
 */
export function monthOptions(
  earliest: Date | null,
  latest: Date | null,
  now: { year: number; month: number }
): MonthOption[] {
  const nowIdx = now.year * 12 + (now.month - 1)
  const start = earliest ? Math.min(monthIndexOf(earliest), nowIdx) : nowIdx
  const end = latest ? Math.max(monthIndexOf(latest), nowIdx) : nowIdx
  const fmt = new Intl.DateTimeFormat(APP_LOCALE, { month: "long", year: "numeric", timeZone: "UTC" })
  const out: MonthOption[] = []
  for (let i = end; i >= start; i--) {
    const y = Math.floor(i / 12)
    const m = (i % 12) + 1
    out.push({
      value: `${y}-${String(m).padStart(2, "0")}`,
      label: fmt.format(new Date(Date.UTC(y, m - 1, 1))),
    })
  }
  return out
}

/** First and last calendar day (`YYYY-MM-DD`) of a `YYYY-MM` month, or null if malformed. */
export function monthRange(month: string): { from: string; to: string } | null {
  const m = MONTH_RE.exec(month)
  if (!m) return null
  const lastDay = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, "0")}` }
}

/** The `YYYY-MM` month whose full range exactly matches from/to, else "". */
export function monthFromRange(from: string, to: string): string {
  const month = from.slice(0, 7)
  const r = monthRange(month)
  return r && r.from === from && r.to === to ? month : ""
}
