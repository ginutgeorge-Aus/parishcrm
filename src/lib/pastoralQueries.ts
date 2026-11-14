import "server-only"
import { prisma } from "@/lib/prisma"
import { UserRole } from "@/lib/generated/prisma/enums"

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
