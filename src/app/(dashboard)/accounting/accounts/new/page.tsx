import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { isAdmin } from "@/lib/roleGuard"
import { createAccount } from "@/lib/actions/account"
import { AccountForm } from "@/components/accounting/AccountForm"

export default async function NewAccountPage() {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) redirect("/accounting/accounts")

  const groups = await prisma.accountGroup.findMany({
    orderBy: [{ type: "asc" }, { sortOrder: "asc" }],
    select: { id: true, name: true, type: true },
  })

  return (
    <div>
      <h2 className="text-2xl font-semibold text-foreground mb-6">New category</h2>
      <AccountForm action={createAccount} groups={groups} />
    </div>
  )
}
