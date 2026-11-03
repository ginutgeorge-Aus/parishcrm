import { notFound, redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { requirePettyCashSessionId } from "@/lib/pettyCashPageGuard"
import { createTransfer } from "@/lib/actions/pettyCashTransfer"
import { TransferForm } from "@/components/petty-cash/TransferForm"
import { calcRunningBalance } from "@/lib/pettyCashLedger"
import { MONEY_DECIMAL_RE } from "@/lib/validation"
import { listImportedTransferCandidates } from "@/lib/pettyCashTransferCandidates"

export default async function NewTransferPage(
  props: Readonly<{ params: Promise<{ id: string }>; searchParams: Promise<{ date?: string | string[]; amount?: string | string[] }> }>,
) {
  const params = await props.params;
  const sessionId = await requirePettyCashSessionId(params.id)
  const sp = await props.searchParams
  // "Look up older deposit" link: narrow the picker to one amount + day (beyond the newest-first caps).
  // Repeated params arrive as arrays; ignore those. Reject impossible dates (2024-02-31) by round-trip.
  const focusDate = typeof sp.date === "string" ? sp.date : undefined
  const focusAmount = typeof sp.amount === "string" ? sp.amount : undefined
  const focusDay = focusDate && /^\d{4}-\d{2}-\d{2}$/.test(focusDate) ? new Date(`${focusDate}T00:00:00.000Z`) : null
  const focus = focusDay && !Number.isNaN(focusDay.getTime()) && focusDay.toISOString().startsWith(focusDate!)
    && focusAmount && MONEY_DECIMAL_RE.test(focusAmount)
    ? { amount: focusAmount, date: focusDay }
    : undefined
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
    listImportedTransferCandidates(focus),
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
  // Fresh per render (the page is dynamic): one token per form load, so a retried
  // submit of this form is recognised as a replay (#491).
  const submissionToken = crypto.randomUUID()

  return (
    <div>
      <h2 className="text-2xl font-semibold text-foreground mb-1">Record bank transfer</h2>
      <p className="text-muted-foreground mb-6">{pcSession.title}</p>
      <TransferForm action={action} maxAmount={balance} imported={imported} importedTruncated={importedTruncated} importedFiltered={!!focus} submissionToken={submissionToken} />
    </div>
  )
}