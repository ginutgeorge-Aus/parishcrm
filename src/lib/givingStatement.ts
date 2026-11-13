import { toCents, centsToNumber, fmtAUD, formatLongDate, formatDMY } from "@/lib/formatting"
import { APP_LOCALE, APP_TIMEZONE } from "@/lib/appConfig"
import { fyDateRange, fyRangeLabel, currentFYYear } from "@/lib/fiscalYear"

/** Fund label used for gifts with no fund set. */
export const UNALLOCATED_FUND = "General (no fund)"

/** One giving transaction as read by the statement loader. Ledger descriptions are deliberately not carried. */
export type StatementGift = {
  date: Date
  amount: { toString(): string } | number
  fundName: string | null
  /** Family the gift is attributed to (the transaction's family). */
  familyId: number
}

type StatementLine = { date: Date; fund: string; cents: number; unallocated: boolean }
type StatementFundTotal = { fund: string; cents: number; unallocated: boolean }

/** A family's giving for one financial year. */
export type FamilyStatement = {
  familyId: number
  lines: StatementLine[]
  byFund: StatementFundTotal[]
  totalCents: number
}

/**
 * Group gifts into one statement per family. All money is summed in integer
 * cents. Lines are date-ascending; fund totals are sorted by name with the
 * unallocated bucket last. Families with no gifts do not appear.
 * @param gifts decrypted giving transactions for a single FY
 */
export function buildStatements(gifts: StatementGift[]): Map<number, FamilyStatement> {
  const out = new Map<number, FamilyStatement>()
  for (const g of gifts) {
    const cents = toCents(g.amount)
    const fund = g.fundName ?? UNALLOCATED_FUND
    let s = out.get(g.familyId)
    if (!s) {
      s = { familyId: g.familyId, lines: [], byFund: [], totalCents: 0 }
      out.set(g.familyId, s)
    }
    s.lines.push({ date: g.date, fund, cents, unallocated: g.fundName === null })
    s.totalCents += cents
  }
  for (const s of out.values()) {
    s.lines.sort((a, b) => a.date.getTime() - b.date.getTime())
    // Keyed apart so a real fund literally named like the unallocated label never merges with it.
    const funds = new Map<string, StatementFundTotal>()
    for (const l of s.lines) {
      const key = `${l.unallocated ? "u" : "f"}:${l.fund}`
      const t = funds.get(key) ?? { fund: l.fund, cents: 0, unallocated: l.unallocated }
      t.cents += l.cents
      funds.set(key, t)
    }
    s.byFund = Array.from(funds.values()).sort((a, b) => {
      if (a.unallocated !== b.unallocated) return a.unallocated ? 1 : -1
      return a.fund.localeCompare(b.fund)
    })
  }
  return out
}

/** Print-ready model for the statement PDF and email. */
export type GivingStatementModel = {
  churchName: string
  churchAbn: string
  churchAddress: string
  churchEmail: string
  familyName: string
  fyLabel: string
  periodLabel: string
  issueDate: string
  totalLabel: string
  byFund: { fund: string; amountLabel: string }[]
  lines: { dateLabel: string; fund: string; amountLabel: string }[]
}

/**
 * Turn a family statement into display strings. Pure. Lines carry date, fund and amount only (no ledger description text). The FY is identified by
 * its START year (same convention as /accounting/reports and the family giving page).
 * @param statement the family's grouped gifts
 * @param familyName display name on the statement
 * @param fyStartYear financial year start year
 * @param church letterhead details
 * @param issued issue date (defaults to now)
 */
export function buildStatementModel(
  statement: FamilyStatement,
  familyName: string,
  fyStartYear: number,
  church: { name: string; abn: string; address: string; email: string },
  issued: Date = new Date()
): GivingStatementModel {
  const { start, end } = fyDateRange(fyStartYear)
  return {
    churchName: church.name,
    churchAbn: church.abn,
    churchAddress: church.address,
    churchEmail: church.email,
    familyName,
    fyLabel: fyRangeLabel(fyStartYear, { short: true }),
    periodLabel: `${formatLongDate(start)} to ${formatLongDate(new Date(end.getTime() - 86_400_000))}`,
    // The issue date is an instant, so read it in the church time zone (period dates are calendar dates, read as UTC).
    issueDate: new Intl.DateTimeFormat(APP_LOCALE, { day: "numeric", month: "long", year: "numeric", timeZone: APP_TIMEZONE }).format(issued),
    totalLabel: fmtAUD(centsToNumber(statement.totalCents)),
    byFund: statement.byFund.map((f) => ({ fund: f.fund, amountLabel: fmtAUD(centsToNumber(f.cents)) })),
    lines: statement.lines.map((l) => ({
      dateLabel: formatDMY(l.date),
      fund: l.fund,
      amountLabel: fmtAUD(centsToNumber(l.cents)),
    })),
  }
}

/**
 * Parse a FY start year from a query/form value: a plain 4-digit integer from
 * 2000 up to the current FY's start year plus one (the range the year picker offers).
 * @returns the year, or null when malformed or out of range
 */
export function parseStatementYear(raw: string | number | null | undefined): number | null {
  const str = String(raw ?? "")
  if (!/^\d{4}$/.test(str)) return null
  const n = Number(str)
  if (n < 2000 || n > currentFYYear() + 1) return null
  return n
}

/** Audit action for a delivered statement (the per-recipient send log). */
export const STATEMENT_SENT = "GIVING_STATEMENT_SENT"
/** Audit action for a failed statement delivery. */
export const STATEMENT_FAILED = "GIVING_STATEMENT_FAILED"
