// Visibility rules for pastoral follow-up tasks (#305, PO decision #611): a
// task is visible to ADMIN + PASTOR (the pastoral-notes circle) and to its
// assignee. Pure and DB-free so actions, pages and tests share one rule. Reads
// and the assignee's status change (setFollowUpStatus) merge followUpVisibilityWhere
// into their Prisma `where`, so a by-id call for someone else's task matches no
// row (IDOR guard). Create/edit/delete are manager-only (canManageFollowUps).

import type { Session } from "next-auth"
import { actorId } from "@/lib/actor"
import type { Prisma } from "@/lib/generated/prisma/client"
import type { UserRole } from "@/lib/generated/prisma/enums"
import { canBeFollowUpAssignee, canManageFollowUps } from "@/lib/roleGuard"

/** The signed-in user a pastoral query runs for. */
export type PastoralViewer = { id: number; role: UserRole | undefined }

/** Follow-up task list page; revalidated after task mutations. */
export const FOLLOW_UPS_PATH = "/follow-ups"

/**
 * Hard cap on one follow-up list read (DoS bound). The /follow-ups page shows
 * a "first N" hint when a list hits it.
 */
export const FOLLOW_UP_LIST_MAX = 500

/** Prayer request list page; revalidated after prayer request mutations. */
export const PRAYER_REQUESTS_PATH = "/prayer-requests"

/**
 * Prisma `where` fragment limiting follow-up tasks to those `viewer` may see:
 * `{}` for managers (all tasks), `{ assigneeId }` for an eligible assignee,
 * or null when the viewer may see none.
 * @param viewer the signed-in user
 */
export function followUpVisibilityWhere(viewer: PastoralViewer): { assigneeId?: number } | null {
  if (canManageFollowUps(viewer.role)) return {}
  if (canBeFollowUpAssignee(viewer.role)) return { assigneeId: viewer.id }
  return null
}

/**
 * The follow-up viewer and visibility scope for a resolved session, or null
 * when signed out or the role may see no tasks. The one place a session becomes
 * a follow-up scope, shared by the actions and the dashboard badge count.
 * @param session the caller's session
 */
export function followUpViewerFromSession(
  session: Session | null,
): { viewer: PastoralViewer; scope: { assigneeId?: number } } | null {
  const role = session?.user?.role
  // Role check first (DB-free, no id needed), so a wrong-role session never
  // reaches actorId.
  if (!session?.user || followUpVisibilityWhere({ id: 0, role }) === null) return null
  const viewer: PastoralViewer = { id: actorId(session), role }
  const scope = followUpVisibilityWhere(viewer)
  return scope ? { viewer, scope } : null
}

/**
 * Prisma `where` fragment that hides tasks whose person or family is archived
 * (soft-archive convention: listings never show archived people/families).
 */
export function liveFollowUpTarget(): Prisma.FollowUpTaskWhereInput {
  return { OR: [{ person: { is: { archivedAt: null } } }, { family: { is: { archivedAt: null } } }] }
}
