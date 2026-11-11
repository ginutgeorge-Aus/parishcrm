import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { canManageGroups, canViewGroups, isAdmin } from "@/lib/roleGuard"
import { parseRouteId } from "@/lib/validation"
import { GROUP_CATEGORY_LABELS } from "@/lib/groups"
import { loadMemberRows } from "@/lib/groupMembers"
import { listAssignableOrganisers } from "@/lib/actions/eventAccess"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MembersPanel } from "@/components/groups/MembersPanel"
import { LeaderAccessPanel } from "@/components/groups/LeaderAccessPanel"
import { RestoreGroupButton } from "@/components/groups/ArchiveGroupButton"

/**
 * Group detail: members (add via person search, role/title, remove), print and
 * CSV export (ADMIN only), and leader logins. canViewGroups to view (VIEWER read-only);
 * canManageGroups to change anything. Archived groups are read-only.
 */
export default async function GroupPage(props: Readonly<{ params: Promise<{ id: string }> }>) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (!canViewGroups(session.user.role)) redirect("/")
  const id = parseRouteId((await props.params).id)
  if (id === null) notFound()

  const group = await prisma.group.findUnique({
    where: { id },
    select: { id: true, name: true, category: true, description: true, archivedAt: true },
  })
  if (!group) notFound()

  const manager = canManageGroups(session.user.role)
  const editor = manager && !group.archivedAt
  const [members, linked, assignable] = await Promise.all([
    loadMemberRows(id),
    manager
      ? prisma.groupLeaderAccess.findMany({
        where: { groupId: id, user: { archivedAt: null } },
        select: { user: { select: { id: true, name: true, email: true, role: true } } },
        orderBy: { user: { name: "asc" } },
      })
      : [],
    editor ? listAssignableOrganisers() : [],
  ])

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1 text-sm text-muted-foreground">
          <Link href="/groups" className="hover:underline">Groups</Link>
          {` / ${group.name}`}
        </p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex flex-wrap items-center gap-2 text-2xl font-semibold text-foreground">
            {group.name}
            <Badge variant="secondary">{GROUP_CATEGORY_LABELS[group.category]}</Badge>
            {group.archivedAt && <Badge variant="secondary">Archived</Badge>}
          </h2>
          <div className="flex flex-wrap gap-2">
            {/* Print/CSV carry decrypted email/mobile: ADMIN only, as the people export. */}
            {isAdmin(session.user.role) && (
              <>
                <Button variant="outline" asChild>
                  <Link href={`/groups/${group.id}/print`} target="_blank">Print</Link>
                </Button>
                <Button variant="outline" asChild>
                  {/* Plain <a>: a file download, not a client navigation. */}
                  <a href={`/api/groups/${group.id}/export-csv`}>Export CSV</a>
                </Button>
              </>
            )}
            {editor && (
              <Button variant="outline" asChild>
                <Link href={`/groups/${group.id}/edit`}>Edit</Link>
              </Button>
            )}
          </div>
        </div>
        {group.description && <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{group.description}</p>}
      </div>

      {manager && group.archivedAt && <RestoreGroupButton groupId={group.id} />}

      <Card>
        <CardHeader><CardTitle>Members ({members.length})</CardTitle></CardHeader>
        <CardContent>
          <MembersPanel groupId={group.id} members={members} readOnly={!editor} linkPeople />
        </CardContent>
      </Card>

      {manager && (
        <Card>
          <CardHeader><CardTitle>Leader logins</CardTitle></CardHeader>
          <CardContent>
            <LeaderAccessPanel
              groupId={group.id}
              linked={linked.map(({ user: { role, ...u } }) => ({ ...u, active: role === "EVENT_ORGANISER" }))}
              assignable={assignable}
              readOnly={!editor}
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
