/** @jest-environment node */
import { renderToStaticMarkup } from "react-dom/server"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    sundaySchoolEnrolment: { findFirst: jest.fn() },
    sundaySchoolSession: { findMany: jest.fn() },
    sundaySchoolExam: { findMany: jest.fn() },
  },
}))
jest.mock("@/lib/sundaySchoolStatsLoad", () => ({ loadClassStats: jest.fn() }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn((to: string) => { throw new Error(`REDIRECT ${to}`) }),
  notFound: jest.fn(() => { throw new Error("NOT_FOUND") }),
}))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { loadClassStats } from "@/lib/sundaySchoolStatsLoad"
import { classStats } from "@/lib/sundaySchoolStats"
import Overview from "@/app/(dashboard)/sunday-school/progress/page"
import ClassProgress from "@/app/(dashboard)/sunday-school/[id]/progress/page"
import StudentProgress from "@/app/(dashboard)/sunday-school/[id]/progress/[personId]/page"

const as = (role: string | null) =>
  (auth as jest.Mock).mockResolvedValue(role ? { user: { id: "1", role } } : null)
const html = async (p: Promise<React.ReactElement>) => renderToStaticMarkup(await p)
const dec = (s: string) => ({ toString: () => s })

const kindy = classStats({
  id: 4, name: "Kindy", level: 0, location: "",
  students: [{ personId: 1, name: "Ann Adams" }, { personId: 2, name: "Ben Brown" }],
  attendance: [{ personId: 1, status: "PRESENT" }, { personId: 1, status: "ABSENT" }, { personId: 2, status: "LATE" }],
  exams: [{ totalMarks: "10", results: [{ personId: 1, score: "8" }] }],
})
const year3 = classStats({ id: 5, name: "Year 3", level: 3, location: "North", students: [], attendance: [], exams: [] })

beforeEach(() => {
  jest.clearAllMocks()
  ;(loadClassStats as jest.Mock).mockResolvedValue([
    { year: 2026, archived: false, stats: kindy },
    { year: 2026, archived: false, stats: year3 },
  ])
  ;(prisma.sundaySchoolEnrolment.findFirst as jest.Mock).mockResolvedValue({
    person: { firstName: "Ann", lastName: "Adams" },
    class: { name: "Kindy", year: 2026 },
  })
  ;(prisma.sundaySchoolSession.findMany as jest.Mock).mockResolvedValue([
    { date: new Date("2026-03-08T00:00:00Z"), attendance: [{ status: "PRESENT" }] },
    { date: new Date("2026-03-01T00:00:00Z"), attendance: [] },
  ])
  ;(prisma.sundaySchoolExam.findMany as jest.Mock).mockResolvedValue([
    { id: 9, name: "Term 1 Bible", date: new Date("2026-03-15T00:00:00Z"), totalMarks: dec("10"), results: [{ score: dec("8") }] },
    { id: 10, name: "Term 2 Bible", date: new Date("2026-06-15T00:00:00Z"), totalMarks: dec("20"), results: [] },
  ])
})

describe("/sunday-school/progress", () => {
  const props = (year?: string) => ({ searchParams: Promise.resolve({ year }) })
  it("redirects anonymous to login", async () => {
    as(null)
    await expect(html(Overview(props()))).rejects.toThrow("REDIRECT /login")
  })
  it("redirects a role that cannot browse Sunday School", async () => {
    as("TEACHER")
    await expect(html(Overview(props()))).rejects.toThrow("REDIRECT /")
  })
  it("loads the year's live classes and shows grade + class rows", async () => {
    as("HEADMASTER")
    const out = await html(Overview(props("2026")))
    expect(loadClassStats).toHaveBeenCalledWith({ year: 2026, archivedAt: null })
    expect(out).toContain("Level 0")
    expect(out).toContain("Level 3")
    expect(out).toContain('href="/sunday-school/4/progress"')
    // Kindy: 2 of 3 attended, exam 80%
    expect(out).toContain("67%")
    expect(out).toContain("80%")
    expect(out).toContain("—")
  })
  it("shows an empty state", async () => {
    as("VIEWER")
    ;(loadClassStats as jest.Mock).mockResolvedValue([])
    expect(await html(Overview(props("2026")))).toContain("No classes for 2026")
  })
})

describe("/sunday-school/[id]/progress", () => {
  const props = (id = "4") => ({ params: Promise.resolve({ id }) })
  it("redirects a role that cannot browse", async () => {
    as("TEACHER")
    await expect(html(ClassProgress(props()))).rejects.toThrow("REDIRECT /")
  })
  it("404s a bad id or missing class", async () => {
    as("ADMIN")
    await expect(html(ClassProgress(props("abc")))).rejects.toThrow("NOT_FOUND")
    ;(loadClassStats as jest.Mock).mockResolvedValue([])
    await expect(html(ClassProgress(props()))).rejects.toThrow("NOT_FOUND")
  })
  it("lists each child with a link to their progress", async () => {
    as("ADMIN")
    ;(loadClassStats as jest.Mock).mockResolvedValue([{ year: 2026, archived: false, stats: kindy }])
    const out = await html(ClassProgress(props()))
    expect(loadClassStats).toHaveBeenCalledWith({ id: 4 })
    expect(out).toContain('href="/sunday-school/4/progress/1"')
    expect(out).toContain("Ann Adams")
    expect(out).toContain("50%")
    expect(out).toContain("100%")
  })
})

describe("/sunday-school/[id]/progress/[personId]", () => {
  const props = (id = "4", personId = "1") => ({ params: Promise.resolve({ id, personId }) })
  it("redirects a role that cannot browse", async () => {
    as("TEACHER")
    await expect(html(StudentProgress(props()))).rejects.toThrow("REDIRECT /")
  })
  it("404s bad ids and a child not enrolled in the class", async () => {
    as("ADMIN")
    await expect(html(StudentProgress(props("4", "x")))).rejects.toThrow("NOT_FOUND")
    ;(prisma.sundaySchoolEnrolment.findFirst as jest.Mock).mockResolvedValue(null)
    await expect(html(StudentProgress(props()))).rejects.toThrow("NOT_FOUND")
  })
  it("scopes queries to the class + child and shows rolls and marks", async () => {
    as("HEADMASTER")
    const out = await html(StudentProgress(props()))
    expect((prisma.sundaySchoolEnrolment.findFirst as jest.Mock).mock.calls[0][0].where)
      .toEqual({ classId: 4, personId: 1, person: { archivedAt: null } })
    expect((prisma.sundaySchoolSession.findMany as jest.Mock).mock.calls[0][0].select.attendance.where).toEqual({ personId: 1 })
    expect((prisma.sundaySchoolExam.findMany as jest.Mock).mock.calls[0][0].where).toEqual({ classId: 4, archivedAt: null })
    expect(out).toContain("Ann Adams")
    expect(out).toContain("Present")
    expect(out).toContain("Not marked")
    expect(out).toContain("8 / 10")
    expect(out).toContain("80%")
    // headmaster: no /people link
    expect(out).not.toContain('href="/people/')
  })
})
