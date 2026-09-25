/**
 * Family subscription dues — pure calculation helpers.
 *
 * The church charges each member family a recurring monthly subscription
 * (`Family.monthlyDues`, a custom amount). This file derives, for a financial
 * year, how much a family is *expected* to have paid and how much is still
 * owed ("due"), netting it against what was actually received. No DB access —
 * the page supplies the paid total.
 *
 * FY runs Jul–Jun (see `@/lib/fiscalYear`). A month only counts as owed once it
 * has fully ended, so the current in-progress month is never billed yet
 * ("due only at end of month"). The "now" instant is read against the Sydney
 * wall clock; stored join dates are read as UTC-midnight calendar dates.
 */

import { sydneyParts } from "@/lib/dates"
import { FY_START_MONTH } from "@/lib/appConfig"

/** Absolute month ordinal so months across years compare and subtract cleanly. */
function toAbsMonth(year: number, month1to12: number): number {
  return year * 12 + (month1to12 - 1)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Whole months within FY `fyYear` that have fully elapsed as of `asOf`, counted
 * from the later of the FY start and the family's join month (inclusive) up to
 * the last month that is already over (the current month is excluded).
 *
 * `joinedDate` null → the family is treated as a member for the whole FY.
 */
export function completedMonthsInFY(
  fyYear: number,
  joinedDate: Date | null,
  asOf: Date = new Date(),
): number {
  const fyStartAbs = toAbsMonth(fyYear, FY_START_MONTH)
  const fyEndAbs = fyStartAbs + 11 // June next year

  const now = sydneyParts(asOf)
  const asOfAbs = toAbsMonth(now.year, now.month)

  const joinAbs = joinedDate
    ? toAbsMonth(joinedDate.getUTCFullYear(), joinedDate.getUTCMonth() + 1)
    : fyStartAbs

  const firstOwed = Math.max(fyStartAbs, joinAbs)
  const lastCompleted = Math.min(fyEndAbs, asOfAbs - 1) // current month excluded
  return Math.max(0, lastCompleted - firstOwed + 1)
}

// All money fields below are in DOLLARS, not integer cents. monthlyDues is a
// dollar amount coerced from the Family.monthlyDues Decimal, and paidTotal must
// be the dollar sum of the family's FY payments. Passing cents for either makes
// expected/due off by 100x — convert with centsToNumber at the call site.
export type FamilyDuesInput = {
  /** Expected monthly subscription in DOLLARS; null = no obligation. */
  monthlyDues: number | null
  /** null = joined before this FY; treated as member for the full year */
  joinedDate: Date | null
  /** Sum of subscription payments received from the family within the FY, in DOLLARS. */
  paidTotal: number
}

export type FamilyDues = {
  months: number
  expected: number
  paid: number
  due: number
}

export function computeFamilyDues(
  input: FamilyDuesInput,
  fyYear: number,
  asOf: Date = new Date(),
): FamilyDues {
  const months = completedMonthsInFY(fyYear, input.joinedDate, asOf)
  const rate = input.monthlyDues ?? 0
  const expected = round2(months * rate)
  const paid = input.paidTotal
  const due = Math.max(0, round2(expected - paid))
  return { months, expected, paid, due }
}
