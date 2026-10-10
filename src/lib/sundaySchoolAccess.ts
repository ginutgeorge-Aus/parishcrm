import { prisma } from "@/lib/prisma"
import { canEdit } from "@/lib/roleGuard"
import { UserRole } from "@/lib/generated/prisma/enums"

/** True when this login is assigned to take this class's roll. */
export async function isRollMarker(userId: number, classId: number): Promise<boolean> {
  const row = await prisma.sundaySchoolRollMarker.findUnique({
    where: { classId_userId: { classId, userId } },
    select: { id: true },
  })
  return row !== null
}

/**
 * May this user mark this class's roll? Editors: any class. EVENT_ORGANISER:
 * only classes they are assigned to. The role check is load-bearing — marker
 * rows only cascade on user delete, not on a role change, so a downgraded
 * account must not keep access through a stale row (same rule as canManageEvent).
 */
export async function canMarkRoll(userId: number, classId: number, role: UserRole | undefined): Promise<boolean> {
  if (canEdit(role)) return true
  if (role !== UserRole.EVENT_ORGANISER) return false
  return isRollMarker(userId, classId)
}
