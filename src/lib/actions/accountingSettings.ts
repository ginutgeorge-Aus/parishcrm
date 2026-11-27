"use server"

import { auth } from "@/auth"
import { assertNotDemo } from "@/lib/demoMode"
import { actorId } from "@/lib/actor"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { isAdmin } from "@/lib/roleGuard"
import { logAuditGuardedTx, auditTxErrorResult } from "@/lib/auditGuard"
import { ACCOUNTING_LOCK_DATE_KEY, getAccountingLockDate, holdAccountingLock } from "@/lib/accountingLock"
import { SIGNED_MONEY_DECIMAL_RE, isOversizeMoney, isRealCalendarDate } from "@/lib/validation"

import type { ActionResultWithSuccess } from "./types"
import { featureGuard } from "@/lib/featureFlags"
import { sydneyTodayYMD } from "@/lib/dates"

const OpeningBalanceSchema = z.object({
  paymentAccountId: z.coerce.number().int().positive(),
  amount: z
    .string()
    .min(1, "Amount is required")
    .max(15)
    // Keep the validated string and pass it straight to the Decimal column —
    // parseFloat would round-trip through binary float. The opening balance
    // anchors every reconciliation/balance-sheet calc, so precision loss here
    // cascades through all downstream reports. A leading "-" is allowed (overdrawn account).
    .regex(SIGNED_MONEY_DECIMAL_RE, "Amount must be a dollar amount with up to 2 decimals")
    // More than 8 integer digits overflows the Decimal(10,2) column.
    .refine((v) => !isOversizeMoney(v), "Amount too large (max 99,999,999.99)"),
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

/** Set a payment account's opening balance. ADMIN; blocked in demo mode and while Accounting is off. */
export async function upsertOpeningBalance(
  _prev: ActionResultWithSuccess,
  formData: FormData
): Promise<ActionResultWithSuccess> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }
  const off = await featureGuard("accounting")
  if (off) return off

  const parsed = OpeningBalanceSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { paymentAccountId, amount, asOfDate } = parsed.data

  // Client-supplied FK (#security checklist): confirm the account exists
  // before doing anything else with it.
  const account = await prisma.paymentAccount.findUnique({ where: { id: paymentAccountId } })
  if (!account) return { error: "Account not found" }

  // Changing an opening balance dated inside a locked period shifts every closed-period balance.
  const lockDate = await getAccountingLockDate()
  if (lockDate) {
    const existing = await prisma.accountOpeningBalance.findUnique({ where: { paymentAccountId }, select: { asOfDate: true } })
    if (asOfDate <= lockDate || (existing && existing.asOfDate <= lockDate)) {
      return { error: "Opening balance date is in a locked period. Clear or move the lock date first." }
    }
  }

  const uid = actorId(session)
  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.accountOpeningBalance.findUnique({ where: { paymentAccountId }, select: { amount: true, asOfDate: true } })
      await tx.accountOpeningBalance.upsert({
        where: { paymentAccountId },
        create: { paymentAccountId, amount, asOfDate },
        update: { amount, asOfDate },
      })
      await logAuditGuardedTx(tx, uid, "SETTING_UPDATED", "AccountOpeningBalance", undefined, {
        paymentAccountId,
        before: before ? { amount: before.amount.toString(), asOfDate: before.asOfDate.toISOString().slice(0, 10) } : null,
        after: { amount, asOfDate: asOfDate.toISOString().slice(0, 10) },
      })
    })
  } catch (e) {
    return auditTxErrorResult(e, "upsertOpeningBalance", "Failed to save. Try again.") ?? { error: "Failed to save" }
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

/** Set or clear the accounting lock date. ADMIN; blocked in demo mode and while Accounting is off. */
export async function setAccountingLockDate(
  _prev: ActionResultWithSuccess,
  formData: FormData
): Promise<ActionResultWithSuccess> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }
  const off = await featureGuard("accounting")
  if (off) return off

  const parsed = LockDateSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const value = parsed.data.date
  // A future lock date would freeze every transaction up to then; compare as
  // YYYY-MM-DD strings against today in Sydney (the app's calendar).
  if (value !== "" && value > sydneyTodayYMD()) return { error: "Lock date cannot be in the future" }
  const uid = actorId(session)
  try {
    await prisma.$transaction(async (tx) => {
      // Wait for in-flight statement saves; they hold this shared until commit, so
      // none can reconcile rows this lock is about to cover.
      await holdAccountingLock(tx, "exclusive")
      await tx.appSetting.upsert({
        where: { key: ACCOUNTING_LOCK_DATE_KEY },
        create: { key: ACCOUNTING_LOCK_DATE_KEY, value },
        update: { value },
      })
      await logAuditGuardedTx(tx, uid, "ACCOUNTING_LOCK_DATE_SET", "AppSetting", undefined, { lockDate: value || null })
    })
  } catch (e) {
    return auditTxErrorResult(e, "setAccountingLockDate", "Failed to save. Try again.") ?? { error: "Failed to save" }
  }

  revalidatePath("/accounting/settings")
  revalidatePath("/accounting/transactions")
  return { success: "Saved" }
}
