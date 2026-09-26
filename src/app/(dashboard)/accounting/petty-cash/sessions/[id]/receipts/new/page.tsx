import { notFound, redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { requirePettyCashSessionId } from "@/lib/pettyCashPageGuard"
import { PERSON_PICKER_CAP } from "@/lib/constants"
import { createReceipt } from "@/lib/actions/pettyCashReceipt"
import { getActiveFunds } from "@/lib/actions/fund"
import { ReceiptForm } from "@/components/petty-cash/ReceiptForm"

export default async function NewReceiptPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const sessionId = await requirePettyCashSessionId(params.id)
  const pcSession = await prisma.pettyCashSession.findUnique({
    where: { id: sessionId },
    select: { id: true, title: true, status: true },
  })
  if (!pcSession) notFound()
  if (pcSession.status === "CLOSED")
    redirect(`/accounting/petty-cash/sessions/${sessionId}`)

  const [accounts, persons, funds] = await Promise.all([
    prisma.account.findMany({
      where: { type: "INCOME", isActive: true },
      orderBy: [{ group: { sortOrder: "asc" } }, { code: "asc" }],
      select: { id: true, code: true, name: true },
    }),
    prisma.person.findMany({
      where: { archivedAt: null },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      select: { id: true, firstName: true, lastName: true },
      take: PERSON_PICKER_CAP,
    }),
    getActiveFunds(),
  ])

  const action = createReceipt.bind(null, sessionId)

  return (
    <div>
      <h2 className="text-2xl font-semibold text-foreground mb-1">Add receipt</h2>
      <p className="text-muted-foreground mb-6">{pcSession.title}</p>
      <ReceiptForm action={action} accounts={accounts} persons={persons} funds={funds} />
    </div>
  )
}