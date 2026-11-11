import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { canManageGroups } from "@/lib/roleGuard"
import { createGroup } from "@/lib/actions/group"
import { GroupForm } from "@/components/groups/GroupForm"

/** New group form. canManageGroups only. */
export default async function NewGroupPage() {
  const session = await auth()
  if (!canManageGroups(session?.user?.role)) redirect("/groups")

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1 text-sm text-muted-foreground">
          <Link href="/groups" className="hover:underline">Groups</Link>
          {" / New group"}
        </p>
        <h2 className="text-2xl font-semibold text-foreground">New group</h2>
      </div>
      <GroupForm action={createGroup} />
    </div>
  )
}
