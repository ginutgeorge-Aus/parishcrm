/** @jest-environment node */
jest.mock("@/lib/prisma", () => ({
  prisma: { sundaySchoolClass: { findMany: jest.fn() }, sundaySchoolAttendance: { groupBy: jest.fn() } },
}))

import { prisma } from "@/lib/prisma"
import { loadClassStats } from "@/lib/sundaySchoolStatsLoad"

const dec = (s: string) => ({ toString: () => s })
const findMany = prisma.sundaySchoolClass.findMany as jest.Mock
const groupBy = prisma.sundaySchoolAttendance.groupBy as jest.Mock

const kindyRow = {
  id: 4, name: "Kindy", level: 0, location: "", year: 2026, archivedAt: null,
  enrolments: [{ person: { id: 1, firstName: "Ann", lastName: "Adams" } }, { person: { id: 2, firstName: "Ben", lastName: "Brown" } }],
  exams: [{ totalMarks: dec("50.00"), results: [{ personId: 1, score: dec("25") }] }],
}

beforeEach(() => jest.clearAllMocks())

describe("loadClassStats", () => {
  it("maps class rows and grouped attendance counts into ClassStats, carrying year and archived", async () => {
    findMany.mockResolvedValue([kindyRow])
    groupBy.mockResolvedValue([
      { personId: 1, status: "PRESENT", _count: { _all: 3 } },
      { personId: 1, status: "ABSENT", _count: { _all: 1 } },
    ])
    const [row] = await loadClassStats({ year: 2026 })
    expect(row.year).toBe(2026)
    expect(row.archived).toBe(false)
    expect(row.stats).toMatchObject({ id: 4, enrolled: 2, attendance: { marked: 4, attended: 3, rate: 75 }, exams: { averagePercent: 50 } })
    expect(row.stats.students[0]).toMatchObject({ personId: 1, name: "Ann Adams", attendance: { marked: 4 } })
  })

  it("counts attendance in one grouped DB query, each class paired with its own enrolled children", async () => {
    const y1 = { ...kindyRow, id: 5, name: "Year 1", level: 1, enrolments: [{ person: { id: 3, firstName: "Cat", lastName: "Cole" } }], exams: [] }
    findMany.mockResolvedValue([kindyRow, y1])
    groupBy.mockResolvedValue([
      { personId: 3, status: "ABSENT", _count: { _all: 2 } },
      { personId: 1, status: "PRESENT", _count: { _all: 1 } },
    ])
    const rows = await loadClassStats({ year: 2026 })
    const arg = findMany.mock.calls[0][0]
    expect(arg.where).toEqual({ year: 2026 })
    expect(arg.select.sessions).toBeUndefined()
    expect(arg.select.enrolments.where).toEqual({ person: { archivedAt: null } })
    expect(arg.select.exams.where).toEqual({ archivedAt: null })
    expect(groupBy).toHaveBeenCalledTimes(1)
    expect(groupBy).toHaveBeenCalledWith({
      by: ["personId", "status"],
      where: { OR: [
        { session: { classId: 4 }, personId: { in: [1, 2] } },
        { session: { classId: 5 }, personId: { in: [3] } },
      ] },
      _count: { _all: true },
    })
    expect(rows[0].stats.attendance).toMatchObject({ present: 1, absent: 0 })
    expect(rows[1].stats.attendance).toMatchObject({ present: 0, absent: 2 })
  })

  it("skips the attendance query for a class with nobody enrolled", async () => {
    findMany.mockResolvedValue([{ ...kindyRow, enrolments: [] }])
    const [row] = await loadClassStats({ id: 4 })
    expect(groupBy).not.toHaveBeenCalled()
    expect(row.stats.enrolled).toBe(0)
  })

  it("students: false keeps class totals but drops the per-child rows", async () => {
    findMany.mockResolvedValue([kindyRow])
    groupBy.mockResolvedValue([{ personId: 2, status: "LATE", _count: { _all: 2 } }])
    const [row] = await loadClassStats({ year: 2026 }, { students: false })
    expect(row.stats.students).toEqual([])
    expect(row.stats).toMatchObject({ enrolled: 2, attendance: { attended: 2, rate: 100 } })
  })
})
