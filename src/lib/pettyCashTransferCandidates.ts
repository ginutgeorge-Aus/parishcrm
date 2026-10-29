import { prisma } from "@/lib/prisma"
import { safeDecrypt } from "@/lib/crypto"
import { getAccountingLockDate } from "@/lib/accountingLock"
import { adoptionProblem, depositRefOfLeg, ymd } from "@/lib/pettyCashAdoption"
import { getCashAccount } from "@/lib/paymentAccounts"
import { findXferAccountId, XFER_OUT_PREFIX } from "@/lib/xferAccount"

/** Max options returned to the picker (newest first); beyond this `truncated` is set. */
const OPTION_LIMIT = 200
/** Max unlinked cash-out legs read per render (newest first); legs that never pair can't grow the read without bound. */
const LEG_LIMIT = 1000

export type ImportedTransferOption = {
  id: number
  date: string
  amount: string
  description: string
}

export type ImportedTransferCandidates = { options: ImportedTransferOption[]; truncated: boolean }

/**
 * Bank-import deposits flagged "from petty cash" whose cash-out leg
 * (`XFER_OUT_<bankRef>`) is not yet linked to a session transfer. Newest first.
 * Selecting one in the Record transfer form adopts that leg as the transfer's
 * ledger mirror instead of booking a second cash-out. Pairs are matched in
 * memory with the same `adoptionProblem` check createTransfer uses; only the
 * final list is capped (`truncated` is set when valid pairs or legs were dropped).
 */
export async function listImportedTransferCandidates(): Promise<ImportedTransferCandidates> {
  // Independent lookups; read-only XFER lookup so a GET render never creates the account.
  const [xferAccountId, cashAccount, lockDate] = await Promise.all([
    findXferAccountId(prisma),
    // Same cash-account lookup createTransfer validates the leg against.
    getCashAccount(),
    // Same lock createTransfer enforces on the transfer (= leg) date.
    getAccountingLockDate(),
  ])
  const empty: ImportedTransferCandidates = { options: [], truncated: false }
  if (xferAccountId === null) return empty
  const cashAccountId = cashAccount?.id ?? null
  // Only unreconciled, unlinked cash-side XFER_OUT legs, newest first and capped at LEG_LIMIT: legs whose
  // deposit never arrives (or never pairs) would otherwise accumulate. Hitting the cap sets `truncated`.
  const legs = await prisma.transaction.findMany({
    where: {
      accountId: xferAccountId,
      type: "EXPENSE",
      bankRef: { startsWith: XFER_OUT_PREFIX },
      pettyCashTransferId: null,
      reconciled: false,
      paymentAccountId: cashAccountId,
      // Locked periods are read-only (lock day inclusive, by UTC calendar day): start
      // the day after the lock, matching isDateLocked. This is the only lock check (it also keeps
      // locked legs from using up the LEG_LIMIT cap).
      ...(lockDate ? { date: { gte: new Date(Date.UTC(lockDate.getUTCFullYear(), lockDate.getUTCMonth(), lockDate.getUTCDate() + 1)) } } : {}),
    },
    select: {
      type: true, accountId: true, bankRef: true, date: true, amount: true, reconciled: true,
      paymentAccountId: true, pettyCashTransferId: true,
    },
    orderBy: { date: "desc" },
    take: LEG_LIMIT,
  })
  const legsTruncated = legs.length >= LEG_LIMIT
  const legByDepositRef = new Map<string, (typeof legs)[number]>()
  for (const l of legs) if (l.bankRef) legByDepositRef.set(depositRefOfLeg(l.bankRef), l)
  if (!legByDepositRef.size) return { options: [], truncated: legsTruncated }
  const deposits = await prisma.transaction.findMany({
    where: { accountId: xferAccountId, type: "INCOME", bankRef: { in: [...legByDepositRef.keys()] } },
    select: { id: true, bankRef: true, accountId: true, type: true, date: true, amount: true, description: true },
    orderBy: { date: "desc" },
  })
  const valid = deposits.filter((d) => {
    // Mirror createTransfer: the pair must agree with the deposit's own amount + day.
    const leg = d.bankRef ? legByDepositRef.get(d.bankRef) : undefined
    return !!leg && adoptionProblem(d, leg, { amount: d.amount.toFixed(2), date: d.date }, { xferAccountId, cashAccountId }) === null
  })
  return {
    truncated: legsTruncated || valid.length > OPTION_LIMIT,
    options: valid.slice(0, OPTION_LIMIT).map((d) => ({
      id: d.id,
      date: ymd(d.date),
      amount: d.amount.toFixed(2),
      description: safeDecrypt(d.description),
    })),
  }
}
