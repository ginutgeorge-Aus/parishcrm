import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { isAdmin } from "@/lib/roleGuard"
import { updateAccount } from "@/lib/actions/account"
import { AccountForm } from "@/components/accounting/AccountForm"
import { parseRouteId } from "@/lib/validation"

export default async function EditAccountPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const session = await auth()
  if (!isAdmin(session?.user?.role)) redirect("/accounting/accounts")

  const id = parseRouteId(params.id)
  if (id === null) notFound()

  const [account, groups] = await Promise.all([
    prisma.account.findUnique({ where: { id } }),
    prisma.accountGroup.findMany({
      orderBy: [{ type: "asc" }, { sortOrder: "asc" }],
      select: { id: true, name: true, type: true },
    }),
  ])

  if (!account) notFound()

  const action = updateAccount.bind(null, account.id)

  return (
    <div>
      <h2 className="text-2xl font-semibold text-foreground mb-6">Edit category</h2>
      <AccountForm action={action} account={account} groups={groups} />
    </div>
  )
}
