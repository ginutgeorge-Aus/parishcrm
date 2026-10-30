import { notFound, redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { requirePettyCashSessionId } from "@/lib/pettyCashPageGuard"
import { createTransfer } from "@/lib/actions/pettyCashTransfer"
import { TransferForm } from "@/components/petty-cash/TransferForm"
import { calcRunningBalance } from "@/lib/pettyCashLedger"
import { listImportedTransferCandidates } from "@/lib/pettyCashTransferCandidates"

export default async function NewTransferPage(props: Readonly<{ params: Promise<{ id: string }> }>) {
  const params = await props.params;
  const sessionId = await requirePettyCashSessionId(params.id)
  // Independent reads: run the session fetch and the candidate list together.
  const [pcSession, candidates] = await Promise.all([
    prisma.pettyCashSession.findUnique({
    where: { id: sessionId },
    include: {
      receipts: { select: { amount: true } },
      expenses: { select: { amount: true } },
      transfers: { select: { amount: true } },
    },
    }),
    listImportedTransferCandidates(),
  ])
  if (!pcSession) notFound()
  if (pcSession.status === "CLOSED")
    redirect(`/accounting/petty-cash/sessions/${sessionId}`)

  const balance = calcRunningBalance(
    pcSession.openingBalance,
    pcSession.receipts,
    pcSession.expenses,
    pcSession.transfers
  )

  const { options: imported, truncated: importedTruncated } = candidates

  const action = createTransfer.bind(null, sessionId)

  return (
    <div>
      <h2 className="text-2xl font-semibold text-foreground mb-1">Record bank transfer</h2>
      <p className="text-muted-foreground mb-6">{pcSession.title}</p>
      <TransferForm action={action} maxAmount={balance} imported={imported} importedTruncated={importedTruncated} />
    </div>
  )
}