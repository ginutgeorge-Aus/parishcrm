import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { canAccessAccounting } from "@/lib/roleGuard"
import { createTransfer } from "@/lib/actions/pettyCashTransfer"
import { TransferForm } from "@/components/petty-cash/TransferForm"
import { calcRunningBalance } from "@/lib/pettyCashLedger"

export default async function NewTransferPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) redirect("/accounting/petty-cash")

  const sessionId = Number(params.id)
  if (Number.isNaN(sessionId) || sessionId <= 0 || sessionId > 2147483647) notFound()
  const pcSession = await prisma.pettyCashSession.findUnique({
    where: { id: sessionId },
    include: {
      receipts: { select: { amount: true } },
      expenses: { select: { amount: true } },
      transfers: { select: { amount: true } },
    },
  })
  if (!pcSession) notFound()
  if (pcSession.status === "CLOSED")
    redirect(`/accounting/petty-cash/sessions/${sessionId}`)

  const balance = calcRunningBalance(
    pcSession.openingBalance,
    pcSession.receipts,
    pcSession.expenses,
    pcSession.transfers
  )

  const action = createTransfer.bind(null, sessionId)

  return (
    <div>
      <h2 className="text-2xl font-semibold text-foreground mb-1">Record bank transfer</h2>
      <p className="text-muted-foreground mb-6">{pcSession.title}</p>
      <TransferForm action={action} maxAmount={balance} />
    </div>
  )
}