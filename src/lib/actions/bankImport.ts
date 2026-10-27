// src/lib/actions/bankImport.ts
"use server"

import { auth } from "@/auth"
import { assertNotDemo } from "@/lib/demoMode"
import { prisma } from "@/lib/prisma"
import { canAccessAccounting } from "@/lib/roleGuard"
import { featureGuard } from "@/lib/featureFlags"
import { BANK_ACCOUNT_MAP_KEY, accountSuffix, parseAccountMap } from "@/lib/bankAccountMap"

/**
 * Remember which ParishCRM bank account a statement's account number belongs
 * to (last 4 digits only), so the next upload pre-selects it. Called by the
 * import wizard after a successful confirm. ADMIN/PASTOR; blocked in demo mode
 * and while bank import is off. Read-modify-write; a concurrent write from a
 * second admin is last-write-wins, which only costs a re-pick next time.
 */
export async function rememberBankImportAccount(
  accountNumber: string,
  paymentAccountId: number,
): Promise<{ error: string } | { success: true }> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const off = await featureGuard("bankImport")
  if (off) return off

  const suffix = typeof accountNumber === "string" ? accountSuffix(accountNumber) : null
  if (!suffix) return { error: "Invalid account number" }
  if (!Number.isInteger(paymentAccountId) || paymentAccountId <= 0) return { error: "Invalid bank account" }
  const account = await prisma.paymentAccount.findFirst({
    where: { id: paymentAccountId, kind: "BANK", isActive: true },
    select: { id: true },
  })
  if (!account) return { error: "Invalid bank account" }

  const row = await prisma.appSetting.findUnique({ where: { key: BANK_ACCOUNT_MAP_KEY } })
  // Map, not a computed object key: no dynamic property write on user input.
  const map = new Map(Object.entries(parseAccountMap(row?.value)))
  map.set(suffix, paymentAccountId)
  const value = JSON.stringify(Object.fromEntries(map))
  await prisma.appSetting.upsert({
    where: { key: BANK_ACCOUNT_MAP_KEY },
    create: { key: BANK_ACCOUNT_MAP_KEY, value },
    update: { value },
  })
  return { success: true }
}
