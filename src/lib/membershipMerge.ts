import type { FamilyRole } from "@/lib/generated/prisma/enums"

/**
 * Role a seeded household member gets when merged into an EXISTING family.
 * A family has one Head and one Spouse: if the family already has an active
 * person in that role, the incoming HEAD or SPOUSE is added as OTHER so the
 * family never ends up with two Heads (AUD-9-02). With no active HEAD/SPOUSE the
 * seeded role is kept. CHILD and OTHER never change. Archived people must be
 * excluded by the caller. Not used by the "create new family" path.
 */
export function resolveMergedRole(seedRole: FamilyRole, activeRoles: readonly FamilyRole[]): FamilyRole {
  if ((seedRole === "HEAD" || seedRole === "SPOUSE") && activeRoles.includes(seedRole)) return "OTHER"
  return seedRole
}
