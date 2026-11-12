import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { prisma } from "@/lib/prisma"
import { parseRouteId } from "@/lib/validation"
import { canManageGroupMembers } from "@/lib/groupAccess"
import { GroupComposeView } from "@/components/groups/GroupMessageViews"

/**
 * Email group for one group. Page-level guard: `canManageGroupMembers` (group managers on any group, an organiser only
 * on a group linked to their login, role re-checked); the send action re-checks it. An unlinked organiser or an
 * archived group gets a 404, so group ids can't be probed.
 */
export default async function GroupMessagePage(props: Readonly<{ params: Promise<{ id: string }> }>) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  const id = parseRouteId((await props.params).id)
  if (id === null) notFound()
  if (!(await canManageGroupMembers(actorId(session), id, session.user.role))) redirect("/")

  const group = await prisma.group.findFirst({ where: { id, archivedAt: null }, select: { id: true, name: true } })
  if (!group) notFound()

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1 text-sm text-muted-foreground">
          <Link href="/groups" className="hover:underline">Groups</Link>
          {" / "}
          <Link href={`/groups/${group.id}`} className="hover:underline">{group.name}</Link>
        </p>
        <h1 className="text-2xl font-bold text-foreground">Email group</h1>
      </div>
      <GroupComposeView groupId={group.id} historyHref={`/groups/${group.id}/messages`} />
    </div>
  )
}
