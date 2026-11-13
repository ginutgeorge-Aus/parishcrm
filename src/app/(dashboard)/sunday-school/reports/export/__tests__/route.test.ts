/** @jest-environment node */
import { NextRequest } from "next/server"
import { GET } from "@/app/(dashboard)/sunday-school/reports/export/route"
import { auth } from "@/auth"
import { featureNotFound } from "@/lib/featureFlags"
import { loadReportInput } from "@/lib/sundaySchoolReportData"
import { logAudit } from "@/lib/audit"
import { renderSundaySchoolReportPdf } from "@/lib/pdf/SundaySchoolReportPdf"
import { __resetRateLimit } from "@/lib/rateLimit"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/featureFlags")
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/sundaySchoolReportData", () => ({ loadReportInput: jest.fn() }))
jest.mock("@/lib/churchSettings", () => ({ getChurchSettings: jest.fn(async () => ({ name: "Example Church" })) }))
jest.mock("@/lib/pdf/SundaySchoolReportPdf", () => ({
  renderSundaySchoolReportPdf: jest.fn(async () => Buffer.from("%PDF-1")),
}))

const mockAuth = auth as jest.Mock
const mockLoad = loadReportInput as jest.Mock

const call = (q: string) => GET(new NextRequest(`http://localhost/sunday-school/reports/export?${q}`))

const input = {
  year: 2026,
  classes: [{ id: 1, name: "Kindy", level: 0, location: "" }],
  children: [{ personId: 10, firstName: "Ann", lastName: "Zed", familyName: "Zed", classId: 1 }],
  marks: [],
  exams: [],
  results: [],
}

beforeEach(() => {
  jest.clearAllMocks()
  __resetRateLimit()
  mockAuth.mockResolvedValue({ user: { id: "5", role: "HEADMASTER" } })
  ;(featureNotFound as jest.Mock).mockResolvedValue(null)
  mockLoad.mockResolvedValue(input)
})

describe("GET /sunday-school/reports/export", () => {
  it("401 without a session, 403 for roles that can't browse Sunday School", async () => {
    mockAuth.mockResolvedValueOnce(null)
    expect((await call("format=xlsx")).status).toBe(401)
    for (const role of ["TEACHER", "AUDITOR", "EVENT_ORGANISER"]) {
      mockAuth.mockResolvedValueOnce({ user: { id: "5", role } })
      expect((await call("format=xlsx")).status).toBe(403)
    }
    expect(mockLoad).not.toHaveBeenCalled()
  })

  it("returns the feature-off response when Sunday School is disabled", async () => {
    const off = new Response(null, { status: 404 })
    ;(featureNotFound as jest.Mock).mockResolvedValueOnce(off)
    expect(await call("format=xlsx")).toBe(off)
  })

  it("400 on an unknown format", async () => {
    expect((await call("format=docx")).status).toBe(400)
  })

  it("400 on a malformed year or class instead of a fallback report", async () => {
    expect((await call("format=pdf&year=20x6")).status).toBe(400)
    expect((await call("format=pdf&year=1900")).status).toBe(400)
    expect((await call("format=pdf&year=2026&class=abc")).status).toBe(400)
    expect(mockLoad).not.toHaveBeenCalled()
  })

  it("404 when the picked class is not in that year", async () => {
    mockLoad.mockResolvedValueOnce({ ...input, classes: [] })
    expect((await call("format=xlsx&year=2026&class=9")).status).toBe(404)
  })

  it("serves a no-store xlsx download and audits it without names", async () => {
    const res = await call("format=xlsx&year=2026&class=1&applied=1&col=family")
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="sunday-school-kindy-2026.xlsx"')
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    const body = Buffer.from(await res.arrayBuffer())
    expect(body.subarray(0, 2).toString()).toBe("PK")
    expect(mockLoad).toHaveBeenCalledWith(2026, 1)
    expect(logAudit).toHaveBeenCalledWith(5, "SUNDAY_SCHOOL_REPORT_EXPORTED", "SundaySchoolClass", 1, {
      year: 2026, format: "xlsx", columns: ["family"], rowCount: 1,
    }, undefined)
  })

  it("serves a PDF for all classes", async () => {
    const res = await call("format=pdf&year=2026")
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("application/pdf")
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="sunday-school-all-classes-2026.pdf"')
    expect(mockLoad).toHaveBeenCalledWith(2026, null)
    expect(renderSundaySchoolReportPdf).toHaveBeenCalledWith(expect.objectContaining({ headers: expect.any(Array) }), "Example Church")
  })

  it("429 after too many exports", async () => {
    for (let i = 0; i < 20; i++) await call("format=xlsx")
    expect((await call("format=xlsx")).status).toBe(429)
  })
})
