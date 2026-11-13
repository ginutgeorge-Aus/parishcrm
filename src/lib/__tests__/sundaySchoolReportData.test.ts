/** @jest-environment node */
jest.mock("@/lib/prisma", () => ({
  prisma: {
    sundaySchoolClass: { findMany: jest.fn() },
    sundaySchoolEnrolment: { findMany: jest.fn() },
    sundaySchoolAttendance: { findMany: jest.fn() },
    sundaySchoolExam: { findMany: jest.fn() },
    sundaySchoolExamResult: { findMany: jest.fn() },
  },
}))

import { prisma } from "@/lib/prisma"
import { loadReportInput } from "@/lib/sundaySchoolReportData"

const p = prisma as unknown as Record<string, { findMany: jest.Mock }>

beforeEach(() => {
  jest.clearAllMocks()
  p.sundaySchoolClass.findMany.mockResolvedValue([{ id: 1, name: "Kindy", level: 0, location: "" }])
  p.sundaySchoolEnrolment.findMany.mockResolvedValue([
    { classId: 1, person: { id: 10, firstName: "Ann", lastName: "Zed", family: { name: "Zed" } } },
    { classId: 1, person: { id: 11, firstName: "Bob", lastName: "Abe", family: { name: "Abe" } } },
  ])
  p.sundaySchoolAttendance.findMany.mockResolvedValue([{ personId: 10, status: "PRESENT", session: { classId: 1 } }])
  p.sundaySchoolExam.findMany.mockResolvedValue([
    { id: 100, classId: 1, name: "T1", date: new Date("2026-03-01T00:00:00Z"), totalMarks: { toString: () => "20.00" } },
  ])
  p.sundaySchoolExamResult.findMany.mockResolvedValue([{ examId: 100, personId: 10, score: { toString: () => "15.50" } }])
})

it("loads one year's active classes, enrolled children, marks and exam results", async () => {
  const r = await loadReportInput(2026, null)
  expect(r).toEqual({
    year: 2026,
    classes: [{ id: 1, name: "Kindy", level: 0, location: "" }],
    children: [
      { personId: 10, firstName: "Ann", lastName: "Zed", familyName: "Zed", classId: 1 },
      { personId: 11, firstName: "Bob", lastName: "Abe", familyName: "Abe", classId: 1 },
    ],
    marks: [{ personId: 10, classId: 1, status: "PRESENT" }],
    exams: [{ id: 100, classId: 1, name: "T1", date: new Date("2026-03-01T00:00:00Z"), totalMarks: "20.00" }],
    results: [{ examId: 100, personId: 10, score: "15.50" }],
  })
  expect(p.sundaySchoolClass.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { year: 2026, archivedAt: null } }))
  // Child queries are scoped to the loaded class ids; archived people and exams are left out.
  expect(p.sundaySchoolEnrolment.findMany.mock.calls[0][0].where).toEqual({ classId: { in: [1] }, year: 2026, person: { archivedAt: null } })
  expect(p.sundaySchoolExam.findMany.mock.calls[0][0].where).toEqual({ classId: { in: [1] }, year: 2026, archivedAt: null })
})

it("scopes to one class, and skips the child queries when no class matches", async () => {
  await loadReportInput(2026, 1)
  expect(p.sundaySchoolClass.findMany.mock.calls[0][0].where).toEqual({ year: 2026, archivedAt: null, id: 1 })
  p.sundaySchoolClass.findMany.mockResolvedValueOnce([])
  const r = await loadReportInput(2026, 9)
  expect(r.classes).toEqual([])
  expect(p.sundaySchoolEnrolment.findMany).toHaveBeenCalledTimes(1)
})
