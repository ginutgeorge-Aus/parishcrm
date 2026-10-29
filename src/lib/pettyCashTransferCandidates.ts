import { prisma } from "@/lib/prisma"
import { safeDecrypt } from "@/lib/crypto"
import { toCents } from "@/lib/formatting"
import { getCashAccount } from "@/lib/paymentAccounts"
import { findXferAccountId, XFER_OUT_PREFIX } from "@/lib/xferAccount"

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
  const [xferAccountId, cashAccount] = await Promise.all([
    findXferAccountId(prisma),
    // Same cash-account lookup createTransfer validates the leg against.
    getCashAccount(),
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
    },
    select: { bankRef: true, date: true, amount: true },
    orderBy: { date: "desc" },
    take: 100,
  })
  const legByDepositRef = new Map<string, (typeof legs)[number]>()
  for (const l of legs) if (l.bankRef) legByDepositRef.set(l.bankRef.slice(XFER_OUT_PREFIX.length), l)
  if (!legByDepositRef.size) return []
  const deposits = await prisma.transaction.findMany({
    where: { accountId: xferAccountId, type: "INCOME", bankRef: { in: [...legByDepositRef.keys()] } },
    select: { id: true, bankRef: true, date: true, amount: true, description: true },
    orderBy: { date: "desc" },
    take: 100,
  })
  const day = (d: Date) => d.toISOString().slice(0, 10)
  return deposits
    .filter((d) => {
      // Mirror createTransfer: the leg must agree with its deposit on amount + day.
      const leg = d.bankRef ? legByDepositRef.get(d.bankRef) : undefined
      return !!leg && toCents(leg.amount.toFixed(2)) === toCents(d.amount.toFixed(2)) && day(leg.date) === day(d.date)
    })
    .map((d) => ({
      id: d.id,
      date: day(d.date),
      amount: d.amount.toFixed(2),
      description: safeDecrypt(d.description),
    }))
}
