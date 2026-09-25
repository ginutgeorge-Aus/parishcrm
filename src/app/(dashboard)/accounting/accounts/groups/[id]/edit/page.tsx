import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { isAdmin } from "@/lib/roleGuard"
import { updateAccountGroup } from "@/lib/actions/accountGroup"
import { AccountGroupForm } from "@/components/accounting/AccountGroupForm"

export default async function EditAccountGroupPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const session = await auth()
  if (!isAdmin(session?.user?.role)) redirect("/accounting/accounts/groups")

  const id = parseInt(params.id, 10)
  if (isNaN(id) || id <= 0 || id > 2147483647) notFound()

  const group = await prisma.accountGroup.findUnique({ where: { id } })
  if (!group) notFound()

  const action = updateAccountGroup.bind(null, group.id)

  return (
    <div>
      <h2 className="text-2xl font-semibold text-foreground mb-6">Edit group</h2>
      <AccountGroupForm action={action} group={group} />
    </div>
  )
}
