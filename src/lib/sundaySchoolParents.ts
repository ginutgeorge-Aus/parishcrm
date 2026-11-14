import "server-only"
import { prisma } from "@/lib/prisma"
import { decrypt } from "@/lib/crypto"
import { FamilyRole } from "@/lib/generated/prisma/enums"

/** Family roles that count as a child's parent for Sunday School email (OSS-14). */
export const PARENT_ROLES: readonly FamilyRole[] = [FamilyRole.HEAD, FamilyRole.SPOUSE]

/** Why a child's parents will not get the email. */
export type ChildSkipReason = "NO_PARENT" | "NO_REACHABLE_PARENT"

/** Human wording for each {@link ChildSkipReason}. */
export const CHILD_SKIP_LABELS: Record<ChildSkipReason, string> = {
  NO_PARENT: "No parent in the family record",
  NO_REACHABLE_PARENT: "No parent with a usable email who accepts email",
}

/** One enrolled child and the ids of their reachable parents (ids only, never an address). */
export type StudentParents = { personId: number; name: string; parentIds: number[]; reason: ChildSkipReason | null }

/** A parent who will receive the email. Names only: addresses are decrypted at send time. */
export type ParentRecipient = { personId: number; name: string }

/** A child whose parents cannot be emailed, with the reason. */
export type SkippedChild = { personId: number; name: string; reason: ChildSkipReason }

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * True when the stored value decrypts to something address-shaped.
 * @param stored the encrypted `Person.email` value
 */
export function isUsableParentEmail(stored: string | null): boolean {
  if (!stored) return false
  try {
    return EMAIL_SHAPE.test(decrypt(stored).trim())
  } catch {
    return false
  }
}

/**
 * Live children enrolled in the class (optionally only `studentIds`), each with
 * the ids of their reachable parents: live HEAD/SPOUSE members of the child's
 * family (never the child itself) with `emailConsent` and a usable email.
 * Never returns or logs an address.
 * @param classId the class (caller has already checked access)
 * @param studentIds restrict to these children; omitted = whole class
 * @returns children sorted by surname then given name
 */
export async function loadStudentParents(classId: number, studentIds?: number[]): Promise<StudentParents[]> {
  const rows = await prisma.sundaySchoolEnrolment.findMany({
    where: { classId, person: { archivedAt: null }, ...(studentIds ? { personId: { in: studentIds } } : {}) },
    orderBy: [{ person: { lastName: "asc" } }, { person: { firstName: "asc" } }, { personId: "asc" }],
    select: {
      person: {
        select: {
          id: true, firstName: true, lastName: true,
          family: {
            select: {
              people: {
                where: { archivedAt: null, role: { in: [...PARENT_ROLES] } },
                select: { id: true, email: true, emailConsent: true },
                orderBy: { id: "asc" },
              },
            },
          },
        },
      },
    },
  })
  return rows.map(({ person: c }) => {
    const parents = c.family.people.filter((p) => p.id !== c.id)
    const parentIds = parents.filter((p) => p.emailConsent && isUsableParentEmail(p.email)).map((p) => p.id)
    const reason: ChildSkipReason | null = parents.length === 0 ? "NO_PARENT" : parentIds.length === 0 ? "NO_REACHABLE_PARENT" : null
    return { personId: c.id, name: `${c.firstName} ${c.lastName}`, parentIds, reason }
  })
}

/**
 * Split the selected children into deduped parent recipients and skipped
 * children. Two siblings in the class share their parents, so each parent
 * appears once.
 * @param classId the class (caller has already checked access)
 * @param studentIds the selected children (only live enrolments in this class count)
 * @returns recipients (parent ids + names) and skipped children with a reason
 */
export async function selectParentRecipients(
  classId: number,
  studentIds: number[],
): Promise<{ students: number; recipients: ParentRecipient[]; skipped: SkippedChild[] }> {
  const children = await loadStudentParents(classId, studentIds)
  const ids = new Set<number>()
  const skipped: SkippedChild[] = []
  for (const c of children) {
    if (c.reason) skipped.push({ personId: c.personId, name: c.name, reason: c.reason })
    for (const id of c.parentIds) ids.add(id)
  }
  if (ids.size === 0) return { students: children.length, recipients: [], skipped }
  const people = await prisma.person.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, firstName: true, lastName: true },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
  })
  return {
    students: children.length,
    recipients: people.map((p) => ({ personId: p.id, name: `${p.firstName} ${p.lastName}` })),
    skipped,
  }
}
