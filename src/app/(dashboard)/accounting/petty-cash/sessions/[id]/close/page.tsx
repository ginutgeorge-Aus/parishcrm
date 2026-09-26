import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { canAccessAccounting } from "@/lib/roleGuard"
import { closeSession } from "@/lib/actions/pettyCashSession"
import { CloseSessionForm } from "@/components/petty-cash/CloseSessionForm"
import { calcRunningBalance } from "@/lib/pettyCashLedger"
import { parseRouteId } from "@/lib/validation"

export default async function CloseSessionPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) redirect("/accounting/petty-cash")

  const sessionId = parseRouteId(params.id)
  if (sessionId === null) notFound()
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