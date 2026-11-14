/** @jest-environment node */
import { UserRole } from "@/lib/generated/prisma/enums"

jest.mock("@/lib/prisma", () => ({ prisma: { groupLeaderAccess: { findUnique: jest.fn() } } }))

import { prisma } from "@/lib/prisma"
import { canEditRosterRole } from "@/lib/rosterAccess"
import { canManageRoster } from "@/lib/roleGuard"

const findUnique = (prisma as unknown as { groupLeaderAccess: { findUnique: jest.Mock } }).groupLeaderAccess.findUnique

beforeEach(() => findUnique.mockReset().mockResolvedValue(null))

describe("canManageRoster", () => {
  it("is staff only", () => {
    expect([UserRole.ADMIN, UserRole.PASTOR, UserRole.OFFICE_ADMIN].every(canManageRoster)).toBe(true)
    expect([UserRole.VIEWER, UserRole.AUDITOR, UserRole.EVENT_ORGANISER, UserRole.HEADMASTER, UserRole.TEACHER, undefined].some(canManageRoster)).toBe(false)
  })
})

describe("canEditRosterRole", () => {
  it("lets staff edit any role without a DB lookup", async () => {
    await expect(canEditRosterRole(9, 4, UserRole.OFFICE_ADMIN)).resolves.toBe(true)
    expect(findUnique).not.toHaveBeenCalled()
  })
  it("lets an organiser edit only roles of a group they lead", async () => {
    await expect(canEditRosterRole(9, 4, UserRole.EVENT_ORGANISER)).resolves.toBe(false)
    findUnique.mockResolvedValue({ id: 1 })
    await expect(canEditRosterRole(9, 4, UserRole.EVENT_ORGANISER)).resolves.toBe(true)
    expect(findUnique).toHaveBeenCalledWith({ where: { groupId_userId: { groupId: 4, userId: 9 } }, select: { id: true } })
  })
  it("ignores a stale leader row on any other role", async () => {
    findUnique.mockResolvedValue({ id: 1 })
    for (const role of [UserRole.VIEWER, UserRole.AUDITOR, UserRole.TEACHER, undefined]) {
      await expect(canEditRosterRole(9, 4, role)).resolves.toBe(false)
    }
  })
})
