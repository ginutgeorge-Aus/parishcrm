"use server"

import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { isAdmin } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import { ACCOUNTING_LOCK_DATE_KEY } from "@/lib/accountingLock"
import { MONEY_DECIMAL_RE, isRealCalendarDate } from "@/lib/validation"

import type { ActionResultWithSuccess } from "./types"

const OpeningBalanceSchema = z.object({
  paymentAccountId: z.coerce.number().int().positive(),
  amount: z
    .string()
    .min(1, "Amount is required")
    .max(15)
    // Keep the validated string and pass it straight to the Decimal column —
    // parseFloat would round-trip through binary float. The opening balance
    // anchors every reconciliation/balance-sheet calc, so precision loss here
    // cascades through all downstream reports. Negative rejected by the regex.
    .regex(MONEY_DECIMAL_RE, "Amount must be 0 or greater"),
  asOfDate: z
    .string()
    .min(1, "As-of date is required")
    // Date-only ISO → `new Date` anchors at UTC midnight (the app's storage
    // convention). Round-trip the components so an impossible date like
    // 2024-02-31 is rejected, not silently normalised to 2024-03-02 before it
    // anchors every reconciliation/balance-sheet calc.
    .refine(isRealCalendarDate, "As-of date must be a valid YYYY-MM-DD date")
    .transform((v) => new Date(v)),
})

export async function upsertOpeningBalance(
  _prev: ActionResultWithSuccess,
  formData: FormData
): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }

  const parsed = OpeningBalanceSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { paymentAccountId, amount, asOfDate } = parsed.data

  // Client-supplied FK (#security checklist): confirm the account exists
  // before doing anything else with it.
  const account = await prisma.paymentAccount.findUnique({ where: { id: paymentAccountId } })
  if (!account) return { error: "Account not found" }

  try {
    await prisma.accountOpeningBalance.upsert({
      where: { paymentAccountId },
      create: { paymentAccountId, amount, asOfDate },
      update: { amount, asOfDate },
    })
    void logAudit(actorId(session), "SETTING_UPDATED", "AccountOpeningBalance", undefined, { paymentAccountId })
  } catch {
    return { error: "Failed to save" }
  }

  // Opening balances feed the dashboard balance cards and these report pages.
  // revalidatePath(path) defaults to page-scope (not a root-wide cascade), so
  // each affected page must be listed — the report paths were previously missed
  // and went stale after a save.
  revalidatePath("/")
  revalidatePath("/accounting/settings")
  revalidatePath("/accounting/reports/balance-sheet")
  revalidatePath("/accounting/reconciliation")
  return { success: "Saved" }
}

const LockDateSchema = z.object({
  // "" clears the lock; otherwise a real date-only calendar value. Round-trip
  // (not just shape) so 2024-02-31 can't lock the ledger at a normalised
  // 2024-03-02.
  date: z.string().refine((v) => v === "" || isRealCalendarDate(v), "Date must be a valid YYYY-MM-DD date"),
})

export async function setAccountingLockDate(
  _prev: ActionResultWithSuccess,
  formData: FormData
): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }

  const parsed = LockDateSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const value = parsed.data.date
  try {
    await prisma.appSetting.upsert({
      where: { key: ACCOUNTING_LOCK_DATE_KEY },
      create: { key: ACCOUNTING_LOCK_DATE_KEY, value },
      update: { value },
    })
    void logAudit(actorId(session), "ACCOUNTING_LOCK_DATE_SET", "AppSetting", undefined, { lockDate: value || null })
  } catch {
    return { error: "Failed to save" }
  }

  revalidatePath("/accounting/settings")
  revalidatePath("/accounting/transactions")
  return { success: "Saved" }
}
