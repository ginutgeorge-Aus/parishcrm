import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { UserRole } from "@/lib/generated/prisma/enums"

/**
 * Page guard for the organiser roster portal: redirects anonymous users to
 * /login and any non-EVENT_ORGANISER to /, then returns the login's user id.
 * The role check is load-bearing (link rows survive a role change; same rule
 * as canEditRosterRole).
 */
export async function requireOrganiserUserId(): Promise<number> {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (session.user.role !== UserRole.EVENT_ORGANISER) redirect("/")
  return actorId(session)
}

/**
 * Prisma filter for roster roles in a live group the given login leads
 * (GroupLeaderAccess).
 */
export function ledRoleWhere(userId: number) {
  return { archivedAt: null, group: { archivedAt: null, leaderAccess: { some: { userId } } } }
}
