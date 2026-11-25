import { prisma } from "@/lib/prisma"
import { canManageGroups } from "@/lib/roleGuard"
import { UserRole } from "@/lib/generated/prisma/enums"

/** True when this login holds a GroupLeaderAccess row for this group. */
export async function isGroupLeaderLogin(userId: number, groupId: number): Promise<boolean> {
  const row = await prisma.groupLeaderAccess.findUnique({
    where: { groupId_userId: { groupId, userId } },
    select: { id: true },
  })
  return row !== null
}

/**
 * True when this login leads at least one live (unarchived) group that
 * `personId` belongs to. Callers must still check the caller's role.
 * @param userId the caller's user id
 * @param personId the person whose group membership is checked
 */
export async function leadsGroupWithMember(userId: number, personId: number): Promise<boolean> {
  const row = await prisma.groupLeaderAccess.findFirst({
    where: { userId, group: { archivedAt: null, members: { some: { personId } } } },
    select: { id: true },
  })
  return row !== null
}

/**
 * May this user change this group's membership? Group managers: any group.
 * EVENT_ORGANISER: only groups they are linked to via GroupLeaderAccess. The
 * role check is load-bearing: access rows only cascade on user delete, not on
 * a role change, so a downgraded account must not keep access through a stale
 * row (same rule as canMarkRoll / canManageEvent).
 * @param userId the caller's user id
 * @param groupId the group being changed
 * @param role the caller's role
 */
export async function canManageGroupMembers(userId: number, groupId: number, role: UserRole | undefined): Promise<boolean> {
  if (canManageGroups(role)) return true
  if (role !== UserRole.EVENT_ORGANISER) return false
  return isGroupLeaderLogin(userId, groupId)
}
