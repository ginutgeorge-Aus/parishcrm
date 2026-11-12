/** @jest-environment node */
import { renderToStaticMarkup } from "react-dom/server"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    sundaySchoolClass: { findUnique: jest.fn() },
    sundaySchoolExam: { findFirst: jest.fn() },
    sundaySchoolEnrolment: { findMany: jest.fn() },
  },
}))
jest.mock("@/lib/sundaySchoolAccess", () => ({ canMarkExam: jest.fn() }))
jest.mock("@/lib/sundaySchoolYearLock", () => ({ lockedYears: jest.fn() }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn((to: string) => { throw new Error(`REDIRECT ${to}`) }),
  notFound: jest.fn(() => { throw new Error("NOT_FOUND") }),
}))
jest.mock("@/components/sunday-school/ExamPanel", () => ({
  ExamPanel: (p: { readOnly: boolean; hrefBase: string; enrolledCount: number; year: number; exams: { id: number; date: string; totalMarks: string; marked: number }[] }) =>
    <div data-testid="panel" data-readonly={String(p.readOnly)} data-base={p.hrefBase} data-enrolled={p.enrolledCount} data-year={p.year} data-exams={JSON.stringify(p.exams)} />,
}))
jest.mock("@/components/sunday-school/ExamMarksForm", () => ({
  ExamMarksForm: (p: { readOnly: boolean; examId: number; totalMarks: string; rows: unknown[] }) =>
    <div data-testid="marks" data-readonly={String(p.readOnly)} data-exam={p.examId} data-total={p.totalMarks} data-rows={JSON.stringify(p.rows)} />,
}))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { canMarkExam } from "@/lib/sundaySchoolAccess"
import { lockedYears } from "@/lib/sundaySchoolYearLock"
import StaffList from "@/app/(dashboard)/sunday-school/[id]/exams/page"
import StaffMarks from "@/app/(dashboard)/sunday-school/[id]/exams/[examId]/page"
import OrgList from "@/app/(organiser)/my-classes/[id]/exams/page"
import OrgMarks from "@/app/(organiser)/my-classes/[id]/exams/[examId]/page"

const as = (role: string | null) =>
  (auth as jest.Mock).mockResolvedValue(role ? { user: { id: "1", role } } : null)
const listProps = (id = "4") => ({ params: Promise.resolve({ id }) })
const marksProps = (id = "4", examId = "9") => ({ params: Promise.resolve({ id, examId }) })
const html = async (p: Promise<React.ReactElement>) => renderToStaticMarkup(await p)

const cls = (over: Record<string, unknown> = {}) => ({
  name: "Kindy", year: 2026, archivedAt: null,
  enrolments: [{ personId: 1 }, { personId: 2 }],
  exams: [{ id: 9, name: "Term 2 Bible", date: new Date("2026-06-14T00:00:00Z"), totalMarks: { toString: () => "50.00" }, _count: { results: 1 } }],
  ...over,
})
const exam = (over: Record<string, unknown> = {}) => ({
  name: "Term 2 Bible", date: new Date("2026-06-14T00:00:00Z"), totalMarks: { toString: () => "50.00" }, year: 2026,
  class: { name: "Kindy", archivedAt: null },
  results: [{ personId: 1, score: { toString: () => "7.5" } }],
  ...over,
})

beforeEach(() => {
  jest.clearAllMocks()
  ;(canMarkExam as jest.Mock).mockResolvedValue(true)
  ;(lockedYears as jest.Mock).mockResolvedValue(new Set())
  ;(prisma.sundaySchoolClass.findUnique as jest.Mock).mockResolvedValue(cls())
  ;(prisma.sundaySchoolExam.findFirst as jest.Mock).mockResolvedValue(exam())
  ;(prisma.sundaySchoolEnrolment.findMany as jest.Mock).mockResolvedValue([
    { person: { id: 1, firstName: "Ann", lastName: "Adams" } },
    { person: { id: 2, firstName: "Ben", lastName: "Brown" } },
  ])
})

describe("/sunday-school/[id]/exams", () => {
  it("redirects anonymous to login", async () => {
    as(null)
    await expect(html(StaffList(listProps()))).rejects.toThrow("REDIRECT /login")
  })
  it("redirects a role that cannot browse Sunday School home", async () => {
    as("TEACHER")
    await expect(html(StaffList(listProps()))).rejects.toThrow("REDIRECT /")
  })
  it("404s a non-numeric id", async () => {
    as("ADMIN")
    await expect(html(StaffList(listProps("abc")))).rejects.toThrow("NOT_FOUND")
  })
  it("404s a missing class", async () => {
    as("ADMIN")
    ;(prisma.sundaySchoolClass.findUnique as jest.Mock).mockResolvedValue(null)
    await expect(html(StaffList(listProps()))).rejects.toThrow("NOT_FOUND")
  })
  it("renders the list editable for a marker, passing exam data through", async () => {
    as("ADMIN")
    const out = await html(StaffList(listProps()))
    expect(canMarkExam).toHaveBeenCalledWith(1, 4, "ADMIN")
    expect(out).toContain("Exams · Kindy")
    expect(out).toContain('href="/sunday-school/4"')
    expect(out).toContain('data-readonly="false"')
    expect(out).toContain('data-base="/sunday-school/4/exams"')
    expect(out).toContain('data-enrolled="2"')
    expect(out).toContain("&quot;date&quot;:&quot;2026-06-14&quot;")
    expect(out).toContain("&quot;totalMarks&quot;:&quot;50.00&quot;")
    expect(out).toContain("&quot;marked&quot;:1")
  })
  it("is read-only when the viewer cannot mark", async () => {
    as("VIEWER")
    ;(canMarkExam as jest.Mock).mockResolvedValue(false)
    expect(await html(StaffList(listProps()))).toContain('data-readonly="true"')
  })
  it("is read-only with a Locked badge when the year is locked", async () => {
    as("ADMIN")
    ;(lockedYears as jest.Mock).mockResolvedValue(new Set([2026]))
    const out = await html(StaffList(listProps()))
    expect(out).toContain("Locked")
    expect(out).toContain('data-readonly="true"')
  })
  it("is read-only with an Archived badge for an archived class", async () => {
    as("ADMIN")
    ;(prisma.sundaySchoolClass.findUnique as jest.Mock).mockResolvedValue(cls({ archivedAt: new Date() }))
    const out = await html(StaffList(listProps()))
    expect(out).toContain("Archived")
    expect(out).toContain('data-readonly="true"')
  })
})

describe("/sunday-school/[id]/exams/[examId]", () => {
  it("redirects anonymous to login", async () => {
    as(null)
    await expect(html(StaffMarks(marksProps()))).rejects.toThrow("REDIRECT /login")
  })
  it("redirects a role that cannot browse home", async () => {
    as("TEACHER")
    await expect(html(StaffMarks(marksProps()))).rejects.toThrow("REDIRECT /")
  })
  it("404s a non-numeric class or exam id", async () => {
    as("ADMIN")
    await expect(html(StaffMarks(marksProps("x", "9")))).rejects.toThrow("NOT_FOUND")
    await expect(html(StaffMarks(marksProps("4", "y")))).rejects.toThrow("NOT_FOUND")
  })
  it("404s an exam not in this class / archived", async () => {
    as("ADMIN")
    ;(prisma.sundaySchoolExam.findFirst as jest.Mock).mockResolvedValue(null)
    await expect(html(StaffMarks(marksProps()))).rejects.toThrow("NOT_FOUND")
    expect((prisma.sundaySchoolExam.findFirst as jest.Mock).mock.calls[0][0].where).toEqual({ id: 9, classId: 4, archivedAt: null })
  })
  it("renders rows in enrolment order with existing scores", async () => {
    as("ADMIN")
    const out = await html(StaffMarks(marksProps()))
    expect(out).toContain("Term 2 Bible")
    expect(out).toContain("Kindy · out of 50.00")
    expect(out).toContain('href="/sunday-school/4/exams"')
    expect(out).toContain('data-readonly="false"')
    expect(out).toContain('data-exam="9"')
    expect(out).toContain("&quot;name&quot;:&quot;Ann Adams&quot;,&quot;score&quot;:&quot;7.5&quot;")
    expect(out).toContain("&quot;name&quot;:&quot;Ben Brown&quot;,&quot;score&quot;:null")
  })
  it("is read-only for a viewer, locked year and archived class", async () => {
    as("VIEWER")
    ;(canMarkExam as jest.Mock).mockResolvedValue(false)
    expect(await html(StaffMarks(marksProps()))).toContain('data-readonly="true"')

    as("ADMIN")
    ;(canMarkExam as jest.Mock).mockResolvedValue(true)
    ;(lockedYears as jest.Mock).mockResolvedValue(new Set([2026]))
    const locked = await html(StaffMarks(marksProps()))
    expect(locked).toContain("Locked")
    expect(locked).toContain('data-readonly="true"')

    ;(lockedYears as jest.Mock).mockResolvedValue(new Set())
    ;(prisma.sundaySchoolExam.findFirst as jest.Mock).mockResolvedValue(exam({ class: { name: "Kindy", archivedAt: new Date() } }))
    expect(await html(StaffMarks(marksProps()))).toContain('data-readonly="true"')
  })
})

describe("/my-classes/[id]/exams", () => {
  it("redirects anonymous to login", async () => {
    as(null)
    await expect(html(OrgList(listProps()))).rejects.toThrow("REDIRECT /login")
  })
  it("404s a non-numeric id", async () => {
    as("TEACHER")
    await expect(html(OrgList(listProps("abc")))).rejects.toThrow("NOT_FOUND")
  })
  it("404s a class the teacher is not assigned to, before any class lookup", async () => {
    as("TEACHER")
    ;(canMarkExam as jest.Mock).mockResolvedValue(false)
    await expect(html(OrgList(listProps()))).rejects.toThrow("NOT_FOUND")
    expect(canMarkExam).toHaveBeenCalledWith(1, 4, "TEACHER")
    expect(prisma.sundaySchoolClass.findUnique).not.toHaveBeenCalled()
  })
  it("renders editable list with organiser links", async () => {
    as("TEACHER")
    const out = await html(OrgList(listProps()))
    expect(out).toContain('href="/my-classes"')
    expect(out).toContain("My classes")
    expect(out).toContain('data-base="/my-classes/4/exams"')
    expect(out).toContain('data-readonly="false"')
  })
})

describe("/my-classes/[id]/exams/[examId]", () => {
  it("redirects anonymous to login", async () => {
    as(null)
    await expect(html(OrgMarks(marksProps()))).rejects.toThrow("REDIRECT /login")
  })
  it("404s non-numeric ids", async () => {
    as("TEACHER")
    await expect(html(OrgMarks(marksProps("x", "9")))).rejects.toThrow("NOT_FOUND")
    await expect(html(OrgMarks(marksProps("4", "y")))).rejects.toThrow("NOT_FOUND")
  })
  it("404s an unassigned class without loading the exam", async () => {
    as("TEACHER")
    ;(canMarkExam as jest.Mock).mockResolvedValue(false)
    await expect(html(OrgMarks(marksProps()))).rejects.toThrow("NOT_FOUND")
    expect(prisma.sundaySchoolExam.findFirst).not.toHaveBeenCalled()
  })
  it("404s an exam from another class", async () => {
    as("TEACHER")
    ;(prisma.sundaySchoolExam.findFirst as jest.Mock).mockResolvedValue(null)
    await expect(html(OrgMarks(marksProps()))).rejects.toThrow("NOT_FOUND")
  })
  it("renders the marks form editable with organiser back link", async () => {
    as("TEACHER")
    const out = await html(OrgMarks(marksProps()))
    expect(out).toContain('href="/my-classes/4/exams"')
    expect(out).toContain('data-readonly="false"')
  })
  it("is still read-only when the year is locked", async () => {
    as("TEACHER")
    ;(lockedYears as jest.Mock).mockResolvedValue(new Set([2026]))
    expect(await html(OrgMarks(marksProps()))).toContain('data-readonly="true"')
  })
})
