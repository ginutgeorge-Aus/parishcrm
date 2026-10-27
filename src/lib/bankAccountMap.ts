// src/lib/bankAccountMap.ts
import { prisma } from "@/lib/prisma"

// AppSetting key holding { "<last 4 digits>": paymentAccountId } so an upload
// can pre-select the ParishCRM bank account. Only the last 4 digits are kept —
// enough to tell a church's handful of accounts apart, not a full account number.
export const BANK_ACCOUNT_MAP_KEY = "bankImport.accountMap"

/** Last 4 digits of a bank account number, or null when it has fewer than 4. */
export function accountSuffix(accountNumber: string): string | null {
  const digits = accountNumber.replace(/\D/g, "")
  return digits.length >= 4 ? digits.slice(-4) : null
}

/** Parse the stored map defensively; corrupt or foreign entries are dropped. */
export function parseAccountMap(raw: string | null | undefined): Record<string, number> {
  if (!raw) return {}
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return {}
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(data)) {
    if (/^\d{4}$/.test(k) && Number.isInteger(v) && (v as number) > 0) out[k] = v as number
  }
  return out
}

/** Suggested PaymentAccount id for a statement's account number; null when unmapped or the account is no longer an active BANK. */
export async function suggestPaymentAccountId(accountNumber: string): Promise<number | null> {
  const suffix = accountSuffix(accountNumber)
  if (!suffix) return null
  const row = await prisma.appSetting.findUnique({ where: { key: BANK_ACCOUNT_MAP_KEY } })
  const id = parseAccountMap(row?.value)[suffix]
  if (!id) return null
  const account = await prisma.paymentAccount.findFirst({ where: { id, kind: "BANK", isActive: true }, select: { id: true } })
  return account?.id ?? null
}
