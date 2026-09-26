import { notFound, redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { requirePettyCashSessionId } from "@/lib/pettyCashPageGuard"
import { closeSession } from "@/lib/actions/pettyCashSession"
import { CloseSessionForm } from "@/components/petty-cash/CloseSessionForm"
import { calcRunningBalance } from "@/lib/pettyCashLedger"

export default async function CloseSessionPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const sessionId = await requirePettyCashSessionId(params.id)
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

  const action = closeSession.bind(null, sessionId)

  return (
    <div>
      <h2 className="text-2xl font-semibold text-foreground mb-1">Close session</h2>
      <p className="text-muted-foreground mb-6">{pcSession.title}</p>
      <CloseSessionForm action={action} balance={balance} />
    </div>
  )
}