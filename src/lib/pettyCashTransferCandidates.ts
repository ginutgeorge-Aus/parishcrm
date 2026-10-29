import { prisma } from "@/lib/prisma"
import { safeDecrypt } from "@/lib/crypto"
import { getAccountingLockDate } from "@/lib/accountingLock"
import { adoptionMismatch, ymd } from "@/lib/pettyCashAdoption"
import { getCashAccount } from "@/lib/paymentAccounts"
import { findXferAccountId, XFER_OUT_PREFIX } from "@/lib/xferAccount"

/** Max unlinked cash-out legs considered (newest first); deposits are fetched by their refs, so none are dropped separately. */
const LEG_LIMIT = 500

export type ImportedTransferOption = {
  id: number
  date: string
  amount: string
  description: string
}

/**
 * Bank-import deposits flagged "from petty cash" whose cash-out leg
 * (`XFER_OUT_<bankRef>`) is not yet linked to a session transfer. Newest first.
 * Selecting one in the Record transfer form adopts that leg as the transfer's
 * ledger mirror instead of booking a second cash-out.
 */
export async function listImportedTransferCandidates(): Promise<ImportedTransferOption[]> {
  // Independent lookups; read-only XFER lookup so a GET render never creates the account.
  const [xferAccountId, cashAccount, lockDate] = await Promise.all([
    findXferAccountId(prisma),
    // Same cash-account lookup createTransfer validates the leg against.
    getCashAccount(),
    // Same lock createTransfer enforces on the transfer (= leg) date.
    getAccountingLockDate(),
  ])
  if (xferAccountId === null) return []
  const legs = await prisma.transaction.findMany({
    where: {
      accountId: xferAccountId,
      type: "EXPENSE",
      bankRef: { startsWith: XFER_OUT_PREFIX },
      pettyCashTransferId: null,
      // Only legs createTransfer would accept: unreconciled and on the cash account.
      reconciled: false,
      paymentAccountId: cashAccount?.id ?? null,
      // Locked periods are read-only, so createTransfer would reject them: filter in
      // the query so they don't consume the take limit either.
      ...(lockDate ? { date: { gt: lockDate } } : {}),
    },
    select: { bankRef: true, date: true, amount: true, reconciled: true, paymentAccountId: true },
    orderBy: { date: "desc" },
    take: LEG_LIMIT,
  })
  const legByDepositRef = new Map<string, (typeof legs)[number]>()
  for (const l of legs) if (l.bankRef) legByDepositRef.set(l.bankRef.slice(XFER_OUT_PREFIX.length), l)
  if (!legByDepositRef.size) return []
  const deposits = await prisma.transaction.findMany({
    where: { accountId: xferAccountId, type: "INCOME", bankRef: { in: [...legByDepositRef.keys()] } },
    select: { id: true, bankRef: true, date: true, amount: true, description: true },
    // No take: bankRef is unique, so at most one deposit per leg (<= LEG_LIMIT rows).
    orderBy: { date: "desc" },
  })
  return deposits
    .filter((d) => {
      // Mirror createTransfer: the leg must agree with its deposit on amount + day.
      const leg = d.bankRef ? legByDepositRef.get(d.bankRef) : undefined
      return !!leg && adoptionMismatch(leg, { amount: d.amount.toFixed(2), date: d.date }, cashAccount?.id ?? null) === null
    })
    .map((d) => ({
      id: d.id,
      date: ymd(d.date),
      amount: d.amount.toFixed(2),
      description: safeDecrypt(d.description),
    }))
}
