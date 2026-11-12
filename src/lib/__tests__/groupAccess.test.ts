/** @jest-environment node */
import { canManageGroupMembers, isGroupLeaderLogin } from "@/lib/groupAccess"
import { canManageGroups, canViewGroups } from "@/lib/roleGuard"
import { prisma } from "@/lib/prisma"
import { UserRole } from "@/lib/generated/prisma/enums"

jest.mock("@/lib/prisma", () => ({ prisma: { groupLeaderAccess: { findUnique: jest.fn() } } }))

const findUnique = prisma.groupLeaderAccess.findUnique as jest.Mock
const expectedQuery = { where: { groupId_userId: { groupId: 4, userId: 9 } }, select: { id: true } }

beforeEach(() => findUnique.mockReset())

describe("group role helpers", () => {
  it.each([
    [UserRole.ADMIN, true, true],
    [UserRole.PASTOR, true, true],
    [UserRole.OFFICE_ADMIN, true, true],
    [UserRole.VIEWER, true, false],
    [UserRole.AUDITOR, false, false],
    [UserRole.EVENT_ORGANISER, false, false],
    [undefined, false, false],
  ] as const)("%s → view %s, manage %s", (role, view, manage) => {
    expect(canViewGroups(role)).toBe(view)
    expect(canManageGroups(role)).toBe(manage)
  })
})

describe("canManageGroupMembers", () => {
  it.each([
    ["ADMIN", null, true, false],
    ["PASTOR", null, true, false],
    ["OFFICE_ADMIN", null, true, false],
    ["EVENT_ORGANISER", { id: 1 }, true, true],
    // An organiser hitting a group they are not linked to is denied.
    ["EVENT_ORGANISER", null, false, true],
    // A stale link on a non-organiser account grants nothing (no DB read).
    ["VIEWER", { id: 1 }, false, false],
    ["AUDITOR", { id: 1 }, false, false],
    [undefined, null, false, false],
  ] as const)("%s with link %j → %s (queried: %s)", async (role, row, expected, queried) => {
    findUnique.mockResolvedValue(row)
    await expect(canManageGroupMembers(9, 4, role)).resolves.toBe(expected)
    if (queried) expect(findUnique).toHaveBeenCalledWith(expectedQuery)
    else expect(findUnique).not.toHaveBeenCalled()
  })
})

describe("isGroupLeaderLogin", () => {
  it("is true only when a link row exists", async () => {
    findUnique.mockResolvedValueOnce({ id: 1 }).mockResolvedValueOnce(null)
    await expect(isGroupLeaderLogin(9, 4)).resolves.toBe(true)
    await expect(isGroupLeaderLogin(9, 4)).resolves.toBe(false)
  })
})
