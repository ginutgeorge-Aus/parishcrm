/** @jest-environment node */
jest.mock("@/lib/prisma", () => ({ prisma: { sundaySchoolClass: { findMany: jest.fn() } } }))

import { prisma } from "@/lib/prisma"
import { loadClassStats } from "@/lib/sundaySchoolStatsLoad"

const dec = (s: string) => ({ toString: () => s })
const findMany = prisma.sundaySchoolClass.findMany as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe("loadClassStats", () => {
  it("maps class rows into ClassStats, carrying year and archived", async () => {
    findMany.mockResolvedValue([{
      id: 4, name: "Kindy", level: 0, location: "", year: 2026, archivedAt: null,
      enrolments: [{ person: { id: 1, firstName: "Ann", lastName: "Adams" } }],
      sessions: [{ attendance: [{ personId: 1, status: "PRESENT" }, { personId: 1, status: "ABSENT" }] }],
      exams: [{ totalMarks: dec("50.00"), results: [{ personId: 1, score: dec("25") }] }],
    }])
    const [row] = await loadClassStats({ year: 2026, archivedAt: null })
    expect(row.year).toBe(2026)
    expect(row.archived).toBe(false)
    expect(row.stats).toMatchObject({ id: 4, enrolled: 1, attendance: { rate: 50 }, exams: { averagePercent: 50 } })
    expect(row.stats.students[0]).toMatchObject({ personId: 1, name: "Ann Adams" })
  })

  it("passes the filter through and only counts live children and exams", async () => {
    findMany.mockResolvedValue([])
    await loadClassStats({ id: 7 })
    const arg = findMany.mock.calls[0][0]
    expect(arg.where).toEqual({ id: 7 })
    expect(arg.select.enrolments.where).toEqual({ person: { archivedAt: null } })
    expect(arg.select.exams.where).toEqual({ archivedAt: null })
  })
})
