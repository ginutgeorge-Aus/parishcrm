import { prisma } from "@/lib/prisma"
import { canManageSundaySchool, canViewPeople } from "@/lib/roleGuard"
import { UserRole } from "@/lib/generated/prisma/enums"
import type { Prisma } from "@/lib/generated/prisma/client"

/** True when this login is assigned to take this class's roll. */
export async function isRollMarker(userId: number, classId: number): Promise<boolean> {
  const row = await prisma.sundaySchoolRollMarker.findUnique({
    where: { classId_userId: { classId, userId } },
    select: { id: true },
  })
  return row !== null
}

/**
 * May this user mark this class's roll? Editors and HEADMASTER: any class.
 * TEACHER and EVENT_ORGANISER (pre-TEACHER marker logins): only classes they
 * are assigned to. The role check is load-bearing — marker rows only cascade on
 * user delete, not on a role change, so a downgraded account must not keep
 * access through a stale row (same rule as canManageEvent).
 * @param userId the caller's user id
 * @param classId the class being marked
 * @param role the caller's role
 */
export async function canMarkRoll(userId: number, classId: number, role: UserRole | undefined): Promise<boolean> {
  if (canManageSundaySchool(role)) return true
  if (role !== UserRole.TEACHER && role !== UserRole.EVENT_ORGANISER) return false
  return isRollMarker(userId, classId)
}

/**
 * May this user enter exam marks for this class? Same rule as canMarkRoll:
 * managers any class, TEACHER/EVENT_ORGANISER only assigned classes.
 * @param userId the caller's user id
 * @param classId the exam's class
 * @param role the caller's role
 */
export async function canMarkExam(userId: number, classId: number, role: UserRole | undefined): Promise<boolean> {
  return canMarkRoll(userId, classId, role)
}

/**
 * Extra `Person` filter for who this role may enrol into a class (AUD-5-01).
 * Roles without people access (HEADMASTER) may only enrol children, matching
 * the picker, which never sends them adults. Other editors: no extra filter.
 * Shared by the action so the rule lives in one place, not just in the picker.
 * Fails closed: keyed on `canViewPeople`, so any future role without people
 * access is limited too.
 * @param role the caller's role
 * @param _year the target class's school year (unused; kept for call-site stability)
 */
export function enrolCandidateWhere(role: UserRole | undefined, _year?: number): Prisma.PersonWhereInput {
  if (canViewPeople(role)) return {}
  return { role: "CHILD" }
}
