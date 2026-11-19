import "server-only"
import type { Session } from "next-auth"
import { sydneyToday } from "@/lib/dates"
import { prisma } from "@/lib/prisma"
import { FollowUpStatus, UserRole } from "@/lib/generated/prisma/enums"
import { dueByTodayWhere, followUpViewerFromSession, liveFollowUpTarget } from "@/lib/pastoralAccess"

/**
 * In-app notification count for an already-resolved session: the user's own
 * open/in-progress follow-ups due today or earlier (Sydney). 0 when signed out
 * or for roles that can't hold tasks. Takes the session so the dashboard layout
 * reuses the one it already read. Server-only on purpose: as a Server Action a
 * client could pass a forged session.
 * @param session the caller's session (from `getSession()` / `auth()`)
 */
export async function countDueFollowUpsFor(session: Session | null): Promise<number> {
  const ctx = followUpViewerFromSession(session)
  if (!ctx) return 0
  return prisma.followUpTask.count({
    where: {
      ...liveFollowUpTarget(),
      assigneeId: ctx.viewer.id,
      status: { in: [FollowUpStatus.OPEN, FollowUpStatus.IN_PROGRESS] },
      ...dueByTodayWhere(sydneyToday()),
    },
  })
}

/** A login that can hold a follow-up task. */
export type AssignableUser = { id: number; name: string }

/**
 * Live logins allowed to be a follow-up assignee (editors: ADMIN | PASTOR |
 * OFFICE_ADMIN, see canBeFollowUpAssignee), by name. Callers gate on role
 * first: this lists staff names.
 */
export async function listAssignableUsers(): Promise<AssignableUser[]> {
  return prisma.user.findMany({
    where: { archivedAt: null, role: { in: [UserRole.ADMIN, UserRole.PASTOR, UserRole.OFFICE_ADMIN] } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })
}
