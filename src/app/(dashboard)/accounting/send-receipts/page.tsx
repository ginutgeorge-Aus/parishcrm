import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { canAccessAccounting } from "@/lib/roleGuard"
import { SendReceiptsClient } from "@/components/accounting/SendReceiptsClient"

export default async function SendReceiptsPage() {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) redirect("/")

  const accounts = await prisma.account.findMany({
    where: { isActive: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true },
  })

  return (
    <div>
      <h2 className="text-2xl font-semibold text-foreground mb-6">Send Receipts</h2>
      <SendReceiptsClient accounts={accounts} />
    </div>
  )
}
