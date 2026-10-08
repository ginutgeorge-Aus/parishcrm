/** @jest-environment node */
import { renderToStaticMarkup } from "react-dom/server"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: { sundaySchoolClass: { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn() } },
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
jest.mock("@/lib/actions/sundaySchool", () => ({ createClass: jest.fn(), updateClass: jest.fn() }))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import SundaySchoolPage from "@/app/(dashboard)/sunday-school/page"
import NewClassPage from "@/app/(dashboard)/sunday-school/new/page"
import EditClassPage from "@/app/(dashboard)/sunday-school/[id]/edit/page"
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
    expect(prisma.sundaySchoolClass.count).toHaveBeenCalledWith({ where: { year: 2027, archivedAt: null } })
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
