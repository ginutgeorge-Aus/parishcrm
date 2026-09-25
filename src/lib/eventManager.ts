import { prisma } from "@/lib/prisma"
import { canEdit } from "@/lib/roleGuard"
import { UserRole } from "@/lib/generated/prisma/enums"

// True when this user is explicitly assigned to manage this event.
export async function isEventManager(userId: number, eventId: number): Promise<boolean> {
  const row = await prisma.eventManager.findUnique({
    where: { eventId_userId: { eventId, userId } },
    select: { id: true },
  })
  return row !== null
}

// Editors (ADMIN/PASTOR/OFFICE_ADMIN) keep full access; an assigned
// EVENT_ORGANISER is widened in for exactly the events she manages. The
// role check is load-bearing: EventManager rows only cascade-delete on user
// delete, not on a role change, so a downgraded organiser (now VIEWER/AUDITOR)
// can retain a stale link row — the current role must still be EVENT_ORGANISER
// for that row to grant access, else the stale row would leak registrant PII.
export async function canManageEvent(
  userId: number,
  eventId: number,
  role: UserRole | undefined
): Promise<boolean> {
  if (canEdit(role)) return true
  if (role !== UserRole.EVENT_ORGANISER) return false
  return isEventManager(userId, eventId)
}
