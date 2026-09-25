import { prisma } from "@/lib/prisma"
import { getAccountingLockDate } from "@/lib/accountingLock"
import { calcRunningBalance } from "@/lib/pettyCashLedger"
import { sumCents, centsToNumber } from "@/lib/formatting"
import { PERSON_PICKER_CAP } from "@/lib/constants"

/** Query shape shared by every session-detail table (receipts/expenses/transfers). */
function fetchSession(sessionId: number) {
  return prisma.pettyCashSession.findUnique({
    where: { id: sessionId },
    include: {
      custodian: { select: { firstName: true, lastName: true } },
      receipts: {
        include: {
          account: { select: { code: true, name: true } },
          serviceType: { select: { name: true } },
          person: { select: { firstName: true, lastName: true } },
        },
        orderBy: { date: "desc" },
      },
      expenses: {
        include: { account: { select: { code: true, name: true } } },
        orderBy: { date: "desc" },
      },
      transfers: { orderBy: { date: "desc" } },
    },
  })
}

type PettyCashSessionDetail = NonNullable<Awaited<ReturnType<typeof fetchSession>>>
export type SessionReceipt = PettyCashSessionDetail["receipts"][number]
export type SessionExpense = PettyCashSessionDetail["expenses"][number]
export type SessionTransfer = PettyCashSessionDetail["transfers"][number]

export interface SessionDetailData {
  pcSession: PettyCashSessionDetail
  /** Person picker options for the custodian editor — empty when the viewer can't edit. */
  people: { id: number; firstName: string; lastName: string }[]
  balance: number
  totalReceipts: number
  totalExpenses: number
  totalTransfers: number
  lockDate: Date | null
}

/**
 * Fetches a petty cash session plus everything the detail page needs to
 * render: running balance, per-section totals, the accounting lock date, and
 * (editors only) the person picker for the custodian editor. Returns null
 * when the session doesn't exist — caller should `notFound()`.
 */
export async function getSessionDetailData(
  sessionId: number,
  userCanEdit: boolean
): Promise<SessionDetailData | null> {
  const pcSession = await fetchSession(sessionId)
  if (!pcSession) return null

  const balance = calcRunningBalance(
    pcSession.openingBalance,
    pcSession.receipts,
    pcSession.expenses,
    pcSession.transfers
  )
  const totalReceipts = centsToNumber(sumCents(pcSession.receipts.map((r) => r.amount)))
  const totalExpenses = centsToNumber(sumCents(pcSession.expenses.map((e) => e.amount)))
  const totalTransfers = centsToNumber(sumCents(pcSession.transfers.map((t) => t.amount)))

  const people = userCanEdit
    ? await prisma.person.findMany({
        where: { archivedAt: null },
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
        select: { id: true, firstName: true, lastName: true },
        take: PERSON_PICKER_CAP,
      })
    : []

  const lockDate = await getAccountingLockDate()

  return { pcSession, people, balance, totalReceipts, totalExpenses, totalTransfers, lockDate }
}
