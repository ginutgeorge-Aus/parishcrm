import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { prisma } from "@/lib/prisma"
import { canEdit } from "@/lib/roleGuard"
import { GROUP_CATEGORY_LABELS } from "@/lib/groups"

/** The live groups this login is linked to (GroupLeaderAccess) and may manage members of. */
export default async function MyGroupsPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const links = await prisma.groupLeaderAccess.findMany({
    where: { userId: actorId(session), group: { archivedAt: null } },
    select: {
      group: {
        select: {
          id: true, name: true, category: true,
          _count: { select: { members: { where: { person: { archivedAt: null } } } } },
        },
      },
    },
    orderBy: { group: { name: "asc" } },
  })
  const groups = links.map((l) => l.group)

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-foreground">My Groups</h1>
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No groups linked to you yet. An administrator will add you to the groups you lead.
        </p>
      ) : (
        <ul className="space-y-3">
          {groups.map((g) => (
            <li key={g.id}>
              <Link
                href={`/my-groups/${g.id}`}
                className="flex items-center justify-between rounded-lg border bg-card p-4 transition-colors duration-200 hover:bg-accent"
              >
                <div>
                  <p className="font-medium text-foreground">{g.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {GROUP_CATEGORY_LABELS[g.category]} · {g._count.members} {g._count.members === 1 ? "member" : "members"}
                  </p>
                </div>
                <span className="text-sm text-muted-foreground">Members →</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {canEdit(session.user.role) && (
        <p className="mt-6 text-xs text-muted-foreground">
          You are viewing this as an editor. Volunteers see only groups linked to them.
        </p>
      )}
    </div>
  )
}
