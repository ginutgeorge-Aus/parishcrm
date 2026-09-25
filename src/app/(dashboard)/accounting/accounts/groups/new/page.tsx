import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { isAdmin } from "@/lib/roleGuard"
import { createAccountGroup } from "@/lib/actions/accountGroup"
import { AccountGroupForm } from "@/components/accounting/AccountGroupForm"

export default async function NewAccountGroupPage() {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) redirect("/accounting/accounts/groups")

  return (
    <div>
      <h2 className="text-2xl font-semibold text-foreground mb-6">New group</h2>
      <AccountGroupForm action={createAccountGroup} />
    </div>
  )
}
