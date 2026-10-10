/** @jest-environment node */
import { canMarkRoll, isRollMarker } from "@/lib/sundaySchoolAccess"
import { prisma } from "@/lib/prisma"

jest.mock("@/lib/prisma", () => ({ prisma: { sundaySchoolRollMarker: { findUnique: jest.fn() } } }))

const findUnique = prisma.sundaySchoolRollMarker.findUnique as jest.Mock
const expectedQuery = { where: { classId_userId: { classId: 4, userId: 9 } }, select: { id: true } }

beforeEach(() => findUnique.mockReset())

describe("canMarkRoll", () => {
  it.each([
    ["ADMIN", null, true, false],
    ["PASTOR", null, true, false],
    ["OFFICE_ADMIN", null, true, false],
    ["EVENT_ORGANISER", { id: 1 }, true, true],
    ["EVENT_ORGANISER", null, false, true],
    ["VIEWER", { id: 1 }, false, false],
    ["AUDITOR", { id: 1 }, false, false],
    [undefined, null, false, false],
  ] as const)("%s with marker %j → %s (queried: %s)", async (role, row, expected, queried) => {
    findUnique.mockResolvedValue(row)
    await expect(canMarkRoll(9, 4, role)).resolves.toBe(expected)
    if (queried) expect(findUnique).toHaveBeenCalledWith(expectedQuery)
    else expect(findUnique).not.toHaveBeenCalled()
  })
})

describe("isRollMarker", () => {
  it("is true only when a marker row exists", async () => {
    findUnique.mockResolvedValueOnce({ id: 1 }).mockResolvedValueOnce(null)
    await expect(isRollMarker(9, 4)).resolves.toBe(true)
    await expect(isRollMarker(9, 4)).resolves.toBe(false)
    expect(findUnique).toHaveBeenCalledWith(expectedQuery)
  })
})
