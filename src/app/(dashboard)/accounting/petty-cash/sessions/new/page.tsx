import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { PERSON_PICKER_CAP } from "@/lib/constants"
import { canAccessAccounting } from "@/lib/roleGuard"
import { createSession } from "@/lib/actions/pettyCashSession"
import { SessionForm } from "@/components/petty-cash/SessionForm"

export default async function NewSessionPage() {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) redirect("/accounting/petty-cash")

  const people = await prisma.person.findMany({
    where: { archivedAt: null },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    select: { id: true, firstName: true, lastName: true },
    take: PERSON_PICKER_CAP,
  })

  return (
    <div>
      <h2 className="text-2xl font-semibold text-foreground mb-6">Open new session</h2>
      <SessionForm action={createSession} people={people} />
    </div>
  )
}
