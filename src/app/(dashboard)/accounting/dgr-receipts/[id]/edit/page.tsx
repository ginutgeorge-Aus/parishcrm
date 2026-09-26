import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { PERSON_PICKER_CAP } from "@/lib/constants"
import { safeDecrypt } from "@/lib/crypto"
import { canAccessAccounting } from "@/lib/roleGuard"
import { currentFyEndYear, type DgrLine } from "@/lib/dgr"
import DgrReceiptForm from "@/components/accounting/DgrReceiptForm"
import { parseRouteId } from "@/lib/validation"

type Props = { params: Promise<{ id: string }> }

export default async function EditDgrReceiptPage(props: Props) {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) redirect("/")

  const { id: idParam } = await props.params
  const id = parseRouteId(idParam)
  if (id === null) redirect("/accounting/dgr-receipts")

  const receipt = await prisma.dgrReceipt.findUnique({ where: { id } })
  if (!receipt) redirect("/accounting/dgr-receipts")
  // A SENT receipt is a delivered legal document — frozen. DRAFT/FAILED, plus a
  // SENDING row stuck by a mid-send crash, are editable (mirrors
  // updateDgrReceipt's guard).
  if (receipt.status !== "DRAFT" && receipt.status !== "FAILED" && receipt.status !== "SENDING") {
    redirect("/accounting/dgr-receipts")
  }

  const people = await prisma.person.findMany({
    where: { archivedAt: null },
    select: { id: true, firstName: true, lastName: true },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: PERSON_PICKER_CAP,
  })
  const persons = people.map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}` }))

  const lines = (receipt.lines as DgrLine[]).map((l) => ({
    date: l.date,
    amount: String(l.amount),
    method: l.method,
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/accounting/dgr-receipts" className="text-sm text-primary hover:underline">
          ← DGR Receipts
        </Link>
      </div>
      <h2 className="text-2xl font-semibold text-foreground">Edit DGR Receipt {receipt.receiptNo}</h2>
      <DgrReceiptForm
        persons={persons}
        currentFyEndYear={currentFyEndYear()}
        edit={{
          id: receipt.id,
          personId: receipt.personId ? String(receipt.personId) : "",
          email: safeDecrypt(receipt.donorEmail),
          fyEndYear: receipt.fyEndYear,
          lines,
        }}
      />
    </div>
  )
}
