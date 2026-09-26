"use server"

import { auth } from "@/auth"
import { logger } from "@/lib/logger"
import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { isAdmin, canAccessAccounting } from "@/lib/roleGuard"
import { SIGNED_MONEY_DECIMAL_RE, MIN_YEAR, MAX_YEAR, isValidPgId } from "@/lib/validation"

import type { ActionResultWithSuccess } from "./types"

export async function upsertBudgets(
  _prev: ActionResultWithSuccess,
  formData: FormData
): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }

  const yearStr = formData.get("year") as string
  const year = Number.parseInt(yearStr, 10)
  if (Number.isNaN(year) || year < MIN_YEAR || year > MAX_YEAR) return { error: "Invalid year" }

  const MAX_AMOUNT = 99999999.99
  const MAX_BUDGET_ENTRIES = 500
  const amountKeys = Array.from(formData.keys()).filter((k) => k.startsWith("amount_"))
  if (amountKeys.length > MAX_BUDGET_ENTRIES) return { error: "Too many budget entries" }

  const entries: Array<{ accountId: number; amount: string }> = []
  for (const [key, value] of Array.from(formData.entries())) {
    if (!key.startsWith("amount_")) continue
    const valueStr = (value as string).trim()
    if (!valueStr) continue
    const accountId = Number.parseInt(key.slice("amount_".length), 10)
    // isNaN alone isn't enough — an out-of-int4-range value parses fine but
    // overflows the Prisma/PG column later, surfacing as an unhandled 500
    // instead of a clean validation error (security.md).
    if (Number.isNaN(accountId) || !isValidPgId(accountId)) continue
    // Validate format before parse, then pass the string straight to the
    // Decimal(10,2) column — parseFloat would round-trip through binary float
    // and drift budget-vs-actual variances (matches).
    if (!SIGNED_MONEY_DECIMAL_RE.test(valueStr))
      return { error: "Budget amounts must have at most 2 decimal places" }
    const amount = Number.parseFloat(valueStr)
    if (amount < 0 || amount > MAX_AMOUNT)
      return { error: "Budget amounts must be between 0 and 99,999,999.99" }
    entries.push({ accountId, amount: valueStr })
  }

  if (entries.length === 0) return { success: "Budget saved" }

  const ids = Array.from(new Set(entries.map((e) => e.accountId)))
  // Only active accounts may carry a budget — the budget form and the
  // budget-vs-actual report both list `isActive: true` accounts only, so a
  // budget on a deactivated account would show a figure with no matching
  // transactions and pollute the report. Both INCOME and EXPENSE accounts are
  // legitimate budget targets, so no type filter. Inactive or missing
  // ids both fail the count check below.
  const existing = await prisma.account.findMany({
    where: { id: { in: ids }, isActive: true },
    select: { id: true },
  })
  if (existing.length !== ids.length)
    return { error: "One or more accounts are inactive or no longer exist" }

  try {
    await prisma.$transaction(
      entries.map(({ accountId, amount }) =>
        prisma.budget.upsert({
          where: { year_accountId: { year, accountId } },
          update: { amount },
          create: { year, accountId, amount },
        })
      )
    )
  } catch (e) {
    // Include the error detail so a real failure (e.g. DB down) is diagnosable
    // in logs — the user still gets the generic message.
    logger.error("Budget upsert error", { error: e instanceof Error ? e.message : String(e) })
    return { error: "Failed to save budget" }
  }

  revalidatePath("/accounting/budget")
  revalidatePath("/accounting/reports/budget-vs-actual") // report queries budget data
  return { success: "Budget saved" }
}

// Persisted per-line variance explanation note. Attached to an existing
// Budget row (year + account) — the note only surfaces on flagged budget-vs-actual
// lines, which by definition already have a budget. Editable by accounting staff
// (ADMIN | PASTOR); read access is gated on the report page (canViewAccounting).
const MAX_NOTE_LEN = 1000

export async function saveBudgetVarianceNote(
  year: number,
  accountId: number,
  note: string,
): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }

  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) return { error: "Invalid year" }
  // accountId maps to a PG int4 column — a value past its max would reach
  // updateMany and throw an ungraceful "out of range" 500 (security.md).
  if (!isValidPgId(accountId)) return { error: "Invalid account" }
  const trimmed = note.trim()
  if (trimmed.length > MAX_NOTE_LEN) return { error: `Note must be ${MAX_NOTE_LEN} characters or fewer` }

  // Empty clears the note. updateMany (not update) so a missing budget row is a
  // no-op count-0 rather than a thrown P2025 — the UI only offers this on lines
  // that have a budget, but guard against a stale/forged request.
  const { count } = await prisma.budget.updateMany({
    where: { year, accountId },
    data: { note: trimmed || null },
  })
  if (count === 0) return { error: "No budget set for this line" }

  revalidatePath("/accounting/reports/budget-vs-actual")
  return { success: "Note saved" }
}

export async function getPrevYearBudgets(
  year: number
): Promise<{ accountId: number; amount: string }[]> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return []
  if (year < MIN_YEAR || year > MAX_YEAR) return []

  const rows = await prisma.budget.findMany({
    where: { year: year - 1 },
    select: { accountId: true, amount: true },
  })
  return rows.map((r) => ({ accountId: r.accountId, amount: r.amount.toString() }))
}
