// Who may change the roster for a role (#622, part of #306). Staff
// (canManageRoster) edit every role; a group leader login (EVENT_ORGANISER with
// a GroupLeaderAccess row) edits only roles tied to their group. Shared by the
// staff actions now and the organiser portal (#630) later.

import { isGroupLeaderLogin } from "@/lib/groupAccess"
import { UserRole } from "@/lib/generated/prisma/enums"
import { canManageRoster } from "@/lib/roleGuard"

/**
 * May this user assign and unassign people for a role tied to `groupId`?
 * Staff: any role. EVENT_ORGANISER: only when linked to that group. The role
 * check is load-bearing: access rows survive a role change, so a downgraded
 * login must not keep access through a stale row (same rule as
 * canManageGroupMembers).
 * @param userId the caller's user id
 * @param groupId the group the roster role draws from
 * @param role the caller's role
 */
export async function canEditRosterRole(userId: number, groupId: number, role: UserRole | undefined): Promise<boolean> {
  if (canManageRoster(role)) return true
  if (role !== UserRole.EVENT_ORGANISER) return false
  return isGroupLeaderLogin(userId, groupId)
}
