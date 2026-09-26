import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { PERSON_PICKER_CAP } from "@/lib/constants"
import { canAccessAccounting } from "@/lib/roleGuard"
import { updateReceipt } from "@/lib/actions/pettyCashReceipt"
import { getActiveFunds } from "@/lib/actions/fund"
import { ReceiptForm } from "@/components/petty-cash/ReceiptForm"
import { safeDecrypt } from "@/lib/crypto"

export default async function EditReceiptPage(props: {
  params: Promise<{ id: string; receiptId: string }>
}) {
  const params = await props.params
  const session = await auth()
  // canAccessAccounting matches createReceipt + updateReceipt action (/AUDIT-033).
  if (!canAccessAccounting(session?.user?.role)) redirect("/accounting/petty-cash")

  const sessionId = Number(params.id)
  if (Number.isNaN(sessionId) || sessionId <= 0 || sessionId > 2147483647) notFound()
  const receiptId = Number(params.receiptId)
  if (Number.isNaN(receiptId) || receiptId <= 0 || receiptId > 2147483647) notFound()
  const receipt = await prisma.pettyCashReceipt.findUnique({
    where: { id: receiptId },
    include: { session: { select: { id: true, title: true, status: true } } },
  })
  // IDOR guard: receipt must belong to the session in the URL
  if (!receipt || receipt.sessionId !== sessionId) notFound()
  if (receipt.session.status === "CLOSED")
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

  const action = updateReceipt.bind(null, receiptId)

  return (
    <div>
      <h2 className="text-2xl font-semibold text-foreground mb-1">Edit receipt</h2>
      <p className="text-muted-foreground mb-6">{receipt.session.title}</p>
      <ReceiptForm
        action={action}
        accounts={accounts}
        persons={persons}
        funds={funds}
        receipt={{
          amount: String(Number(receipt.amount)),
          accountId: String(receipt.accountId),
          personId: receipt.personId ? String(receipt.personId) : "",
          serviceTypeId: receipt.serviceTypeId ? String(receipt.serviceTypeId) : "",
          notes: receipt.notes ? safeDecrypt(receipt.notes) : "",
          fundId: String(receipt.fundId ?? ""),
        }}
      />
    </div>
  )
}