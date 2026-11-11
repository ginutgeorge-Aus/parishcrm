import "server-only"
import { prisma } from "@/lib/prisma"
import { safeDecrypt } from "@/lib/crypto"
import { MAX_GROUP_MEMBERS, sortMembers, type GroupMemberExportRow, type MemberRow } from "@/lib/groups"

/**
 * A group's live members for the members panel (names, family, role, title;
 * no contact details). Leaders first, then by name. Archived people are hidden.
 * @param groupId group id (caller has already checked access)
 */
export async function loadMemberRows(groupId: number): Promise<MemberRow[]> {
  const rows = await prisma.groupMember.findMany({
    where: { groupId, person: { archivedAt: null } },
    select: {
      role: true, title: true,
      person: { select: { id: true, firstName: true, lastName: true, family: { select: { name: true } } } },
    },
    // Deterministic order before the cap: leaders survive truncation, then by name.
    orderBy: [{ role: "asc" }, { person: { lastName: "asc" } }, { person: { firstName: "asc" } }, { personId: "asc" }],
    take: MAX_GROUP_MEMBERS,
  })
  return sortMembers(rows.map((r) => ({
    role: r.role, title: r.title, firstName: r.person.firstName, lastName: r.person.lastName,
    personId: r.person.id, name: `${r.person.firstName} ${r.person.lastName}`, familyName: r.person.family.name,
  }))).map(({ personId, name, familyName, role, title }) => ({ personId, name, familyName, role, title }))
}

/**
 * A group's live members with decrypted email/mobile, for print and CSV export
 * (staff only). Leaders first, then by name.
 * @param groupId group id (caller has already checked access)
 */
export async function loadMemberExportRows(groupId: number): Promise<GroupMemberExportRow[]> {
  const rows = await prisma.groupMember.findMany({
    where: { groupId, person: { archivedAt: null } },
    select: {
      role: true, title: true, joinedAt: true,
      person: { select: { firstName: true, lastName: true, email: true, mobile: true, family: { select: { name: true } } } },
    },
    // Deterministic order before the cap: leaders survive truncation, then by name.
    orderBy: [{ role: "asc" }, { person: { lastName: "asc" } }, { person: { firstName: "asc" } }, { personId: "asc" }],
    take: MAX_GROUP_MEMBERS,
  })
  return sortMembers(rows.map((r) => ({
    firstName: r.person.firstName,
    lastName: r.person.lastName,
    familyName: r.person.family.name,
    role: r.role,
    title: r.title,
    joinedAt: r.joinedAt,
    email: r.person.email ? safeDecrypt(r.person.email) : "",
    mobile: r.person.mobile ? safeDecrypt(r.person.mobile) : "",
  })))
}
