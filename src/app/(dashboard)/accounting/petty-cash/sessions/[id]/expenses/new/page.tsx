import { notFound, redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { requirePettyCashSessionId } from "@/lib/pettyCashPageGuard"
import { createExpense } from "@/lib/actions/pettyCashExpense"
import { getActiveFunds } from "@/lib/actions/fund"
import { ExpenseForm } from "@/components/petty-cash/ExpenseForm"

export default async function NewExpensePage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const sessionId = await requirePettyCashSessionId(params.id)
  const pcSession = await prisma.pettyCashSession.findUnique({
    where: { id: sessionId },
    select: { id: true, title: true, status: true },
  })
  if (!pcSession) notFound()
  if (pcSession.status === "CLOSED")
    redirect(`/accounting/petty-cash/sessions/${sessionId}`)

  const [accounts, funds] = await Promise.all([
    prisma.account.findMany({
      where: { type: "EXPENSE", isActive: true },
      orderBy: [{ group: { sortOrder: "asc" } }, { code: "asc" }],
      select: { id: true, code: true, name: true },
    }),
    getActiveFunds(),
  ])

  const action = createExpense.bind(null, sessionId)

  return (
    <div>
      <h2 className="text-2xl font-semibold text-foreground mb-1">Add expense</h2>
      <p className="text-muted-foreground mb-6">{pcSession.title}</p>
      <ExpenseForm action={action} accounts={accounts} funds={funds} />
    </div>
  )
}