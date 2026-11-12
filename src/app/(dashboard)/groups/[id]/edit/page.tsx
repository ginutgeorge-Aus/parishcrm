import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { canManageGroups } from "@/lib/roleGuard"
import { parseRouteId } from "@/lib/validation"
import { updateGroup } from "@/lib/actions/group"
import { GroupForm } from "@/components/groups/GroupForm"
import { ArchiveGroupButton } from "@/components/groups/ArchiveGroupButton"

/** Edit a live group (name, category, description) or archive it. canManageGroups only. */
export default async function EditGroupPage(props: Readonly<{ params: Promise<{ id: string }> }>) {
  const session = await auth()
  if (!canManageGroups(session?.user?.role)) redirect("/groups")
  const id = parseRouteId((await props.params).id)
  if (id === null) notFound()

  const group = await prisma.group.findUnique({
    where: { id },
    select: { id: true, name: true, category: true, description: true, archivedAt: true },
  })
  if (!group || group.archivedAt) notFound()

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1 text-sm text-muted-foreground">
          <Link href="/groups" className="hover:underline">Groups</Link>
          {" / "}
          <Link href={`/groups/${group.id}`} className="hover:underline">{group.name}</Link>
          {" / Edit"}
        </p>
        <h2 className="text-2xl font-semibold text-foreground">Edit group</h2>
      </div>
      <GroupForm action={updateGroup.bind(null, group.id)} group={group} />
      <div className="max-w-md border-t pt-4">
        <ArchiveGroupButton groupId={group.id} />
      </div>
    </div>
  )
}
