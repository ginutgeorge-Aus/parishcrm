import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { prisma } from "@/lib/prisma"
import { parseRouteId } from "@/lib/validation"
import { canManageGroupMembers } from "@/lib/groupAccess"
import { GroupComposeView, GroupHistoryView } from "@/components/groups/GroupMessageViews"

/** Route specifics that differ between the dashboard and the organiser portal. */
const SCOPES = {
  dashboard: { base: "/groups", rootLabel: "Groups", deniedRedirectsHome: true },
  organiser: { base: "/my-groups", rootLabel: "My Groups", deniedRedirectsHome: false },
} as const

/**
 * Shared body of the group email compose and history pages. Page-level guard: `canManageGroupMembers` (group managers
 * on any group, an organiser only on a group linked to their login, role re-checked); the send action re-checks it.
 * An unlinked organiser or an archived group gets a 404, so group ids can't be probed. Dashboard users without access
 * go home; organisers get a 404.
 * @param params route params promise holding the group id
 * @param view "compose" for the email form, "history" for sent messages
 * @param scope "dashboard" or "organiser" route family
 */
export async function renderGroupMessagePage(
  params: Promise<{ id: string }>,
  view: "compose" | "history",
  scope: keyof typeof SCOPES,
) {
  const session = await auth()
  if (!session?.user) redirect("/login")
  const id = parseRouteId((await params).id)
  if (id === null) notFound()
  const { base, rootLabel, deniedRedirectsHome } = SCOPES[scope]
  if (!(await canManageGroupMembers(actorId(session), id, session.user.role))) {
    if (deniedRedirectsHome) redirect("/")
    notFound()
  }

  const group = await prisma.group.findFirst({ where: { id, archivedAt: null }, select: { id: true, name: true } })
  if (!group) notFound()

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1 text-sm text-muted-foreground">
          <Link href={base} className="hover:underline">{rootLabel}</Link>
          {" / "}
          <Link href={`${base}/${group.id}`} className="hover:underline">{group.name}</Link>
        </p>
        <h1 className="text-2xl font-bold text-foreground">{view === "compose" ? "Email group" : "Sent messages"}</h1>
      </div>
      {view === "compose" ? (
        <GroupComposeView groupId={group.id} historyHref={`${base}/${group.id}/messages`} />
      ) : (
        <GroupHistoryView groupId={group.id} composeHref={`${base}/${group.id}/message`} />
      )}
    </div>
  )
}
