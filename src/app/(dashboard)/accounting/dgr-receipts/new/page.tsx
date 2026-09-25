import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { PERSON_PICKER_CAP } from "@/lib/constants"
import { canAccessAccounting } from "@/lib/roleGuard"
import DgrReceiptForm from "@/components/accounting/DgrReceiptForm"
import { currentFyEndYear } from "@/lib/dgr"

export default async function NewDgrReceiptPage() {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) redirect("/")

  // Names only — the donor's email is fetched+decrypted on demand when they're
  // picked (getDonorEmail), so the whole congregation's emails never ship here.
  const people = await prisma.person.findMany({
    where: { archivedAt: null },
    select: { id: true, firstName: true, lastName: true },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: PERSON_PICKER_CAP,
  })

  const persons = people.map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}` }))

  const fyEndNow = currentFyEndYear()

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/accounting/dgr-receipts" className="text-sm text-primary hover:underline">
          ← DGR Receipts
        </Link>
      </div>
      <h2 className="text-2xl font-semibold text-foreground">New DGR Receipt</h2>
      <DgrReceiptForm persons={persons} currentFyEndYear={fyEndNow} />
    </div>
  )
}
