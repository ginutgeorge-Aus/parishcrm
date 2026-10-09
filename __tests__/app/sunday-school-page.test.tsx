/** @jest-environment node */
import { renderToStaticMarkup } from "react-dom/server"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    sundaySchoolClass: { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn() },
    person: { findMany: jest.fn() },
  },
}))
jest.mock("next/navigation", () => ({
  redirect: jest.fn((to: string) => { throw new Error(`REDIRECT ${to}`) }),
  notFound: jest.fn(() => { throw new Error("NOT_FOUND") }),
}))
jest.mock("@/components/sunday-school/RolloverButton", () => ({
  RolloverButton: ({ fromYear }: { fromYear: number }) => <button type="button">Roll over to {fromYear + 1}</button>,
}))
jest.mock("@/components/sunday-school/ClassForm", () => ({ ClassForm: () => null }))
jest.mock("@/components/sunday-school/ArchiveClassButton", () => ({ ArchiveClassButton: () => null }))
jest.mock("@/components/sunday-school/TeachersPanel", () => ({
  TeachersPanel: (p: { readOnly: boolean; teachers: { name: string; wwcc: string }[] }) =>
    <div data-testid="teachers" data-readonly={String(p.readOnly)}>{p.teachers.map((t) => `${t.name}:${t.wwcc}`).join(",")}</div>,
}))
jest.mock("@/components/sunday-school/EnrolPanel", () => ({
  EnrolPanel: (p: { readOnly: boolean; candidates: { name: string; isChild: boolean; currentClass: string | null }[] }) =>
    <div data-testid="enrol" data-readonly={String(p.readOnly)}>{p.candidates.map((c) => `${c.name}:${c.isChild}:${c.currentClass}`).join(",")}</div>,
}))
jest.mock("@/lib/actions/sundaySchool", () => ({ createClass: jest.fn(), updateClass: jest.fn() }))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import SundaySchoolPage from "@/app/(dashboard)/sunday-school/page"
import NewClassPage from "@/app/(dashboard)/sunday-school/new/page"
import EditClassPage from "@/app/(dashboard)/sunday-school/[id]/edit/page"
import ClassPage from "@/app/(dashboard)/sunday-school/[id]/page"
import { currentSchoolYear } from "@/lib/sundaySchool"

const as = (role: string) => (auth as jest.Mock).mockResolvedValue({ user: { id: "1", role } })
const rows = [
  { id: 1, name: "Kindy", level: 0, location: "", teachers: [{ person: { firstName: "Jane", lastName: "Sample" } }], _count: { enrolments: 1 } },
  { id: 2, name: "Years 1–2", level: 1, location: "", teachers: [], _count: { enrolments: 3 } },
]
const render = async (year?: string) =>
  renderToStaticMarkup(await SundaySchoolPage({ searchParams: Promise.resolve(year ? { year } : {}) }))

beforeEach(() => {
  jest.clearAllMocks()
  ;(prisma.sundaySchoolClass.findMany as jest.Mock).mockResolvedValue(rows)
  ;(prisma.sundaySchoolClass.count as jest.Mock).mockResolvedValue(0)
})

describe("/sunday-school", () => {
  it("redirects an AUDITOR home", async () => {
    as("AUDITOR")
    await expect(render()).rejects.toThrow("REDIRECT /")
  })

  it("shows classes to a VIEWER without edit controls", async () => {
    as("VIEWER")
    const html = await render("2026")
    expect(html).toContain("Kindy")
    expect(html).toContain("Teachers: Jane Sample")
    expect(html).toContain("3 children")
    expect(html).not.toContain("New class")
    expect(html).not.toContain("Roll over")
    expect(prisma.sundaySchoolClass.count).not.toHaveBeenCalled()
  })

  it("shows New class and Roll over to an ADMIN while next year is empty", async () => {
    as("ADMIN")
    const html = await render("2026")
    expect(html).toContain("New class")
    expect(html).toContain("Roll over to 2027")
    expect(prisma.sundaySchoolClass.count).toHaveBeenCalledWith({ where: { year: 2027 } })
  })

  it("hides Roll over once next year has classes", async () => {
    as("ADMIN")
    ;(prisma.sundaySchoolClass.count as jest.Mock).mockResolvedValue(4)
    expect(await render("2026")).not.toContain("Roll over")
  })

  it("falls back to the current school year for a bad ?year=", async () => {
    as("VIEWER")
    await render("abc")
    expect((prisma.sundaySchoolClass.findMany as jest.Mock).mock.calls[0][0].where).toEqual({ year: currentSchoolYear(), archivedAt: null })
  })

  it("shows an empty state", async () => {
    as("OFFICE_ADMIN")
    ;(prisma.sundaySchoolClass.findMany as jest.Mock).mockResolvedValue([])
    const html = await render("2026")
    expect(html).toContain("No classes for 2026 yet.")
    expect(html).toContain("Create the first class")
  })
})

describe("/sunday-school/new and /[id]/edit", () => {
  it("send a VIEWER back to the list", async () => {
    as("VIEWER")
    await expect(NewClassPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT /sunday-school")
    await expect(EditClassPage({ params: Promise.resolve({ id: "1" }) })).rejects.toThrow("REDIRECT /sunday-school")
  })

  it("404s on a bad id or an archived class", async () => {
    as("ADMIN")
    await expect(EditClassPage({ params: Promise.resolve({ id: "x" }) })).rejects.toThrow("NOT_FOUND")
    ;(prisma.sundaySchoolClass.findUnique as jest.Mock).mockResolvedValue({ id: 1, year: 2026, name: "K", level: 0, location: "", archivedAt: new Date() })
    await expect(EditClassPage({ params: Promise.resolve({ id: "1" }) })).rejects.toThrow("NOT_FOUND")
  })
})

describe("/sunday-school/[id]", () => {
  const cls = (archivedAt: Date | null = null) => ({
    id: 1, year: 2026, name: "Kindy", level: 0, location: "Hall", archivedAt,
    teachers: [{ person: { id: 2, firstName: "Jane", lastName: "Sample", clearances: [] } }],
    enrolments: [{ person: { id: 3, firstName: "Test", lastName: "Child", family: { name: "Sample" } } }],
  })
  const renderClass = async () => renderToStaticMarkup(await ClassPage({ params: Promise.resolve({ id: "1" }) }))

  it("redirects an AUDITOR home", async () => {
    as("AUDITOR")
    await expect(renderClass()).rejects.toThrow("REDIRECT /")
  })

  it("is read-only for a VIEWER and skips the candidate queries", async () => {
    as("VIEWER")
    ;(prisma.sundaySchoolClass.findUnique as jest.Mock).mockResolvedValue(cls())
    const html = await renderClass()
    expect(html).toContain("Level 0 · Hall · 2026")
    expect(html).toContain("Jane Sample:MISSING")
    expect(html).toContain('data-readonly="true"')
    expect(html).not.toContain(">Edit<")
    expect(prisma.person.findMany).not.toHaveBeenCalled()
  })

  it("loads candidates for an editor, flagging children and current class", async () => {
    as("OFFICE_ADMIN")
    ;(prisma.sundaySchoolClass.findUnique as jest.Mock).mockResolvedValue(cls())
    ;(prisma.person.findMany as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 4, firstName: "Amy", lastName: "Brown", role: "CHILD", family: { name: "Brown" }, sundaySchoolEnrolments: [{ class: { name: "Years 3–4" } }] }])
    const html = await renderClass()
    expect(html).toContain("Amy Brown:true:Years 3–4")
    expect(html).toContain(">Edit<")
    expect((prisma.person.findMany as jest.Mock).mock.calls[0][0].where).toEqual({
      archivedAt: null, ministryRoles: { has: "SUNDAY_SCHOOL_TEACHER" }, sundaySchoolTeaching: { none: { classId: 1 } },
    })
  })

  it("renders an archived class read-only even for an editor", async () => {
    as("ADMIN")
    ;(prisma.sundaySchoolClass.findUnique as jest.Mock).mockResolvedValue(cls(new Date()))
    const html = await renderClass()
    expect(html).toContain("Archived")
    expect(html).toContain('data-readonly="true"')
    expect(prisma.person.findMany).not.toHaveBeenCalled()
  })
})
