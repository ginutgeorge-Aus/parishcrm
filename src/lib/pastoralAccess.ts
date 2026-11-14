// Visibility rules for pastoral follow-up tasks (#305, PO decision #611): a
// task is visible to ADMIN + PASTOR (the pastoral-notes circle) and to its
// assignee. Pure and DB-free so actions, pages and tests share one rule. Every
// read AND write in src/lib/actions/followUp.ts merges followUpVisibilityWhere
// into its Prisma `where`, so a by-id call for someone else's task matches no
// row (IDOR guard) instead of relying on a separate check.

import type { Prisma } from "@/lib/generated/prisma/client"
import type { UserRole } from "@/lib/generated/prisma/enums"
import { canBeFollowUpAssignee, canManageFollowUps } from "@/lib/roleGuard"

/** The signed-in user a pastoral query runs for. */
export type PastoralViewer = { id: number; role: UserRole | undefined }

/** Revalidated after pastoral mutations; the pages land in #614/#616. */
export const PASTORAL_PATH = "/pastoral"

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
 * Prisma `where` fragment that hides tasks whose person or family is archived
 * (soft-archive convention: listings never show archived people/families).
 */
export function liveFollowUpTarget(): Prisma.FollowUpTaskWhereInput {
  return { OR: [{ person: { is: { archivedAt: null } } }, { family: { is: { archivedAt: null } } }] }
}
