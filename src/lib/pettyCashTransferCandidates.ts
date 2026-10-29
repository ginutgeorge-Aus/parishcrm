import { prisma } from "@/lib/prisma"
import { safeDecrypt } from "@/lib/crypto"
import { getCashAccount } from "@/lib/paymentAccounts"
import { getXferAccountId, XFER_OUT_PREFIX } from "@/lib/xferAccount"

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
  const xferAccountId = await getXferAccountId(prisma)
  // Same cash-account lookup createTransfer validates the leg against.
  const cashAccount = await getCashAccount()
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
    select: { bankRef: true },
    orderBy: { date: "desc" },
    take: 100,
  })
  const depositRefs = legs.flatMap((l) => (l.bankRef ? [l.bankRef.slice(XFER_OUT_PREFIX.length)] : []))
  if (!depositRefs.length) return []
  const deposits = await prisma.transaction.findMany({
    where: { accountId: xferAccountId, type: "INCOME", bankRef: { in: depositRefs } },
    select: { id: true, date: true, amount: true, description: true },
    orderBy: { date: "desc" },
    take: 100,
  })
  return deposits.map((d) => ({
    id: d.id,
    date: d.date.toISOString().slice(0, 10),
    amount: d.amount.toFixed(2),
    description: safeDecrypt(d.description),
  }))
}
