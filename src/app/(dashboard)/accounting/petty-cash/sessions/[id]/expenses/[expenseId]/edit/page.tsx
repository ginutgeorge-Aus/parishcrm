import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { canAccessAccounting } from "@/lib/roleGuard"
import { updateExpense } from "@/lib/actions/pettyCashExpense"
import { getActiveFunds } from "@/lib/actions/fund"
import { ExpenseForm } from "@/components/petty-cash/ExpenseForm"
import { safeDecrypt } from "@/lib/crypto"
import { parseRouteId } from "@/lib/validation"

export default async function EditExpensePage(props: {
  params: Promise<{ id: string; expenseId: string }>
}) {
  const params = await props.params
  const session = await auth()
  // canAccessAccounting matches createExpense + updateExpense action (/AUDIT-033).
  if (!canAccessAccounting(session?.user?.role)) redirect("/accounting/petty-cash")

  const sessionId = parseRouteId(params.id)
  if (sessionId === null) notFound()
  const expenseId = parseRouteId(params.expenseId)
  if (expenseId === null) notFound()
  const expense = await prisma.pettyCashExpense.findUnique({
    where: { id: expenseId },
    include: { session: { select: { id: true, title: true, status: true } } },
  })
  // IDOR guard: expense must belong to the session in the URL
  if (!expense || expense.sessionId !== sessionId) notFound()
  if (expense.session.status === "CLOSED")
    redirect(`/accounting/petty-cash/sessions/${sessionId}`)

  const [accounts, funds] = await Promise.all([
    prisma.account.findMany({
      where: { type: "EXPENSE", isActive: true },
      orderBy: [{ group: { sortOrder: "asc" } }, { code: "asc" }],
      select: { id: true, code: true, name: true },
    }),
    getActiveFunds(),
  ])

  const action = updateExpense.bind(null, expenseId)

  return (
    <div>
      <h2 className="text-2xl font-semibold text-foreground mb-1">Edit expense</h2>
      <p className="text-muted-foreground mb-6">{expense.session.title}</p>
      <ExpenseForm
        action={action}
        accounts={accounts}
        funds={funds}
        expense={{
          amount: String(Number(expense.amount)),
          payee: safeDecrypt(expense.payee),
          accountId: String(expense.accountId),
          description: safeDecrypt(expense.description),
          receiptRef: expense.receiptRef ?? "",
          fundId: String(expense.fundId ?? ""),
        }}
      />
    </div>
  )
}