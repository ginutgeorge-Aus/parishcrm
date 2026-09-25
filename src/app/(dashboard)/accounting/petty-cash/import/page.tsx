import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { PERSON_PICKER_CAP } from "@/lib/constants"
import { isAdmin } from "@/lib/roleGuard"
import { ImportClient } from "@/components/petty-cash/ImportClient"

export default async function PettyCashImportPage() {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) redirect("/accounting/petty-cash")
  const people = await prisma.person.findMany({
    where: { archivedAt: null },
    select: { id: true, firstName: true, lastName: true },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    take: PERSON_PICKER_CAP,
  })
  const custodians = people.map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}` }))
  return (
    <div>
      <h1 className="text-xl font-semibold text-foreground mb-4">Import petty cash (CSV)</h1>
      <ImportClient custodians={custodians} />
    </div>
  )
}
