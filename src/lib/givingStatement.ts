import { toCents, centsToNumber, fmtAUD, formatLongDate, formatDMY } from "@/lib/formatting"
import { fyDateRange, fyRangeLabel } from "@/lib/fiscalYear"
import { currentFyEndYear } from "@/lib/dgr"

/** Fund label used for gifts with no fund set. */
export const UNALLOCATED_FUND = "General (no fund)"

/** One giving transaction, already decrypted, as read by the statement loader. */
export type StatementGift = {
  date: Date
  description: string
  amount: { toString(): string } | number
  fundName: string | null
  /** Family the gift is attributed to (direct, or via the giving person). */
  familyId: number
}

export type StatementLine = { date: Date; description: string; fund: string; cents: number }
export type StatementFundTotal = { fund: string; cents: number }

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
    s.lines.push({ date: g.date, description: g.description, fund, cents })
    s.totalCents += cents
  }
  for (const s of out.values()) {
    s.lines.sort((a, b) => a.date.getTime() - b.date.getTime())
    const funds = new Map<string, number>()
    for (const l of s.lines) funds.set(l.fund, (funds.get(l.fund) ?? 0) + l.cents)
    s.byFund = Array.from(funds, ([fund, cents]) => ({ fund, cents })).sort((a, b) => {
      if (a.fund === UNALLOCATED_FUND) return 1
      if (b.fund === UNALLOCATED_FUND) return -1
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
  lines: { dateLabel: string; description: string; fund: string; amountLabel: string }[]
}

/**
 * Turn a family statement into display strings. Pure. The FY is identified by
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
    issueDate: formatLongDate(issued),
    totalLabel: fmtAUD(centsToNumber(statement.totalCents)),
    byFund: statement.byFund.map((f) => ({ fund: f.fund, amountLabel: fmtAUD(centsToNumber(f.cents)) })),
    lines: statement.lines.map((l) => ({
      dateLabel: formatDMY(l.date),
      description: l.description,
      fund: l.fund,
      amountLabel: fmtAUD(centsToNumber(l.cents)),
    })),
  }
}

/**
 * Parse a FY start year from a query/form value. Accepts 2000 up to the year
 * after the current FY's start.
 * @returns the year, or null when malformed or out of range
 */
export function parseStatementYear(raw: string | number | null | undefined): number | null {
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10)
  if (!Number.isInteger(n) || n < 2000 || n > currentFyEndYear() + 1) return null
  return n
}

/** Audit action for a delivered statement (the per-recipient send log). */
export const STATEMENT_SENT = "GIVING_STATEMENT_SENT"
/** Audit action for a failed statement delivery. */
export const STATEMENT_FAILED = "GIVING_STATEMENT_FAILED"
