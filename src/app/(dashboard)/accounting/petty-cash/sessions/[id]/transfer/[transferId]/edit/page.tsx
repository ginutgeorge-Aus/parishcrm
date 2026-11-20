import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { canAccessAccounting, isAdmin } from "@/lib/roleGuard"
import { updateTransfer } from "@/lib/actions/pettyCashTransfer"
import { TransferForm } from "@/components/petty-cash/TransferForm"
import { calcRunningBalance } from "@/lib/pettyCashLedger"
import { centsToNumber, toCents } from "@/lib/formatting"
import { safeDecrypt } from "@/lib/crypto"
import { utcYmd } from "@/lib/dates"
import { parseRouteId } from "@/lib/validation"
import { XFER_OUT_PREFIX } from "@/lib/xferRefs"

/** Correct a mis-keyed transfer's amount, date or notes (AUD-3-04). */
export default async function EditTransferPage(props: Readonly<{
  params: Promise<{ id: string; transferId: string }>
}>) {
  const params = await props.params
  const session = await auth()
  // canAccessAccounting matches the updateTransfer action.
  if (!canAccessAccounting(session?.user?.role)) redirect("/accounting/petty-cash")

  const sessionId = parseRouteId(params.id)
  if (sessionId === null) notFound()
  const transferId = parseRouteId(params.transferId)
  if (transferId === null) notFound()
  const transfer = await prisma.pettyCashTransfer.findUnique({
    where: { id: transferId },
    include: {
      transaction: { select: { bankRef: true } },
      session: {
        select: {
          id: true, title: true, status: true, openingBalance: true,
          receipts: { select: { amount: true } },
          expenses: { select: { amount: true } },
          transfers: { select: { amount: true } },
        },
      },
    },
  })
  // IDOR guard: the transfer must belong to the session in the URL.
  if (transfer?.sessionId !== sessionId) notFound()
  const pcSession = transfer.session
  if (pcSession.status === "CLOSED") redirect(`/accounting/petty-cash/sessions/${sessionId}`)

  const adopted = transfer.transaction?.bankRef?.startsWith(XFER_OUT_PREFIX) ?? false
  // Cash available to this transfer: the running balance with its own amount added back.
  const available = centsToNumber(
    toCents(calcRunningBalance(pcSession.openingBalance, pcSession.receipts, pcSession.expenses, pcSession.transfers)) +
      toCents(transfer.amount),
  )
  const action = updateTransfer.bind(null, transferId)

  return (
    <div>
      <h2 className="text-2xl font-semibold text-foreground mb-1">Edit bank transfer</h2>
      <p className="text-muted-foreground mb-6">{pcSession.title}</p>
      {adopted ? (
        <div className="max-w-lg space-y-3">
          <p className="text-sm">
            This transfer is linked to an imported bank deposit, so its amount and date must match that deposit and
            cannot be edited here. Correct the imported deposit instead.
          </p>
          <Link className="text-sm underline" href={`/accounting/petty-cash/sessions/${sessionId}`}>
            Back to session
          </Link>
        </div>
      ) : (
        <TransferForm
          action={action}
          maxAmount={available}
          isAdmin={isAdmin(session?.user?.role)}
          transfer={{
            date: utcYmd(transfer.date),
            amount: (toCents(transfer.amount) / 100).toFixed(2),
            notes: transfer.notes ? safeDecrypt(transfer.notes) : "",
          }}
        />
      )}
    </div>
  )
}
