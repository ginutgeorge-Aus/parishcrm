import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { prisma } from "@/lib/prisma"
import { parseRouteId } from "@/lib/validation"
import { canManageGroupMembers } from "@/lib/groupAccess"
import { GROUP_CATEGORY_LABELS } from "@/lib/groups"
import { loadMemberRows } from "@/lib/groupMembers"
import { Button } from "@/components/ui/button"
import { MembersPanel } from "@/components/groups/MembersPanel"

/**
 * Manage one linked group's members from the organiser portal. An organiser
 * not linked to this group (or a downgraded login) gets a 404, the same as a
 * missing group, so group ids can't be probed. Names/roles/titles only.
 */
export default async function MyGroupPage(props: Readonly<{ params: Promise<{ id: string }> }>) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  const id = parseRouteId((await props.params).id)
  if (id === null) notFound()
  if (!(await canManageGroupMembers(actorId(session), id, session.user.role))) notFound()

  const group = await prisma.group.findFirst({
    where: { id, archivedAt: null },
    select: { id: true, name: true, category: true },
  })
  if (!group) notFound()
  const members = await loadMemberRows(id)

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1 text-sm text-muted-foreground">
          <Link href="/my-groups" className="hover:underline">My Groups</Link>
          {` / ${group.name}`}
        </p>
        <h1 className="text-2xl font-bold text-foreground">{group.name}</h1>
        <p className="text-sm text-muted-foreground">{GROUP_CATEGORY_LABELS[group.category]} · {members.length} {members.length === 1 ? "member" : "members"}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="outline" asChild><Link href={`/my-groups/${group.id}/message`}>Email group</Link></Button>
          <Button variant="outline" asChild><Link href={`/my-groups/${group.id}/messages`}>Sent messages</Link></Button>
        </div>
      </div>
      <div className="rounded-lg border bg-card p-4">
        <MembersPanel groupId={group.id} members={members} />
      </div>
    </div>
  )
}
