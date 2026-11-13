/** @jest-environment node */
import { renderToStaticMarkup } from "react-dom/server"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({ prisma: { sundaySchoolClass: { findMany: jest.fn() } } }))
jest.mock("@/lib/sundaySchoolReportData", () => ({ loadReportInput: jest.fn() }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn((to: string) => { throw new Error(`REDIRECT ${to}`) }),
}))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { loadReportInput } from "@/lib/sundaySchoolReportData"
import ReportsPage from "@/app/(dashboard)/sunday-school/reports/page"

const as = (role: string | null) =>
  (auth as jest.Mock).mockResolvedValue(role ? { user: { id: "1", role } } : null)
const render = async (sp: Record<string, string | string[]> = {}) =>
  renderToStaticMarkup(await ReportsPage({ searchParams: Promise.resolve(sp) }))

beforeEach(() => {
  jest.clearAllMocks()
  ;(prisma.sundaySchoolClass.findMany as jest.Mock).mockResolvedValue([
    { id: 1, name: "Kindy", location: "" },
    { id: 2, name: "Year 1", location: "North" },
  ])
  ;(loadReportInput as jest.Mock).mockResolvedValue({
    year: 2025,
    classes: [{ id: 1, name: "Kindy", level: 0, location: "" }],
    children: [{ personId: 10, firstName: "Ann", lastName: "Zed", familyName: "Zed", classId: 1 }],
    marks: [{ personId: 10, classId: 1, status: "PRESENT" }],
    exams: [],
    results: [],
  })
})

describe("Sunday School reports page", () => {
  it("redirects anonymous users to login and non-browsers home", async () => {
    as(null)
    await expect(render()).rejects.toThrow("REDIRECT /login")
    as("TEACHER")
    await expect(render()).rejects.toThrow("REDIRECT /")
  })

  it("renders the picker, a preview and export links carrying the same options", async () => {
    as("VIEWER")
    const out = await render({ year: "2025", class: "1", applied: "1", col: ["attendance", "family"] })
    expect(loadReportInput).toHaveBeenCalledWith(2025, 1)
    expect(out).toContain('<option value="1" selected="">Kindy</option>')
    expect(out).toContain("Year 1 (North)")
    expect(out).toContain('name="col" checked="" value="attendance"')
    expect(out).toContain('name="col" value="marks"')
    expect(out).toContain("Zed, Ann")
    expect(out).toContain("100%")
    expect(out).toContain('href="/sunday-school/reports/export?year=2025&amp;class=1&amp;applied=1&amp;col=family&amp;col=attendance&amp;format=xlsx"')
    expect(out).toContain("format=pdf")
  })

  it("falls back to all classes when the class is not in the year", async () => {
    as("HEADMASTER")
    await render({ year: "2025", class: "99" })
    expect(loadReportInput).toHaveBeenCalledWith(2025, null)
  })

  it("shows an empty state with no export links when there are no children", async () => {
    as("ADMIN")
    ;(loadReportInput as jest.Mock).mockResolvedValueOnce({ year: 2025, classes: [], children: [], marks: [], exams: [], results: [] })
    const out = await render({ year: "2025" })
    expect(out).toContain("No enrolled children")
    expect(out).not.toContain("format=xlsx")
  })
})
