/** @jest-environment node */
jest.mock("@/lib/featureFlags")
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@/lib/rateLimit", () => ({ rateLimit: jest.fn(() => true) }))
jest.mock("@/lib/prisma", () => ({ prisma: {} }))
jest.mock("@/lib/churchSettings", () => ({ getChurchSettings: jest.fn().mockResolvedValue({ name: "Example Church" }) }))
jest.mock("@/lib/sundaySchoolReportsLoad", () => ({ classYear: jest.fn(), loadReportInput: jest.fn() }))

import { NextRequest } from "next/server"
import { auth } from "@/auth"
import { logAudit } from "@/lib/audit"
import { rateLimit } from "@/lib/rateLimit"
import { classYear, loadReportInput } from "@/lib/sundaySchoolReportsLoad"
import { GET } from "../route"

const mockAuth = auth as jest.Mock
const ctx = (id = "4") => ({ params: Promise.resolve({ id }) })
const req = (q = "") => new NextRequest(`http://localhost/api/sunday-school/4/export${q}`)
const input = {
  className: "Year 1 / Blue",
  students: [{ personId: 1, name: "=cmd", enrolledAt: new Date("2026-01-01T00:00:00Z") }],
  sessions: [{ date: new Date("2026-02-01T00:00:00Z"), marks: [{ personId: 1, status: "PRESENT" }] }],
  exams: [],
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(rateLimit as jest.Mock).mockReturnValue(true)
  mockAuth.mockResolvedValue({ user: { role: "VIEWER", id: "7" } })
  ;(classYear as jest.Mock).mockResolvedValue(2026)
  ;(loadReportInput as jest.Mock).mockResolvedValue(input)
})

describe("GET /api/sunday-school/[id]/export", () => {
  it("401 when signed out", async () => {
    mockAuth.mockResolvedValue(null)
    expect((await GET(req(), ctx())).status).toBe(401)
  })
  it.each(["TEACHER", "EVENT_ORGANISER", "AUDITOR"])("403 for %s", async (role) => {
    mockAuth.mockResolvedValue({ user: { role, id: "7" } })
    expect((await GET(req(), ctx())).status).toBe(403)
    expect(loadReportInput).not.toHaveBeenCalled()
  })
  it.each([
    "?from=2026-06-01&to=2026-01-01",
    "?from=2020-01-01&to=2026-01-01",
    "?from=2020-01-01",
    "?from=nope&to=2026-01-01",
    "?report=bogus",
    "?format=xls",
  ])("400 for %s", async (q) => {
    expect((await GET(req(q), ctx())).status).toBe(400)
    expect(loadReportInput).not.toHaveBeenCalled()
  })
  it("404 for a missing class", async () => {
    ;(classYear as jest.Mock).mockResolvedValue(null)
    expect((await GET(req(), ctx())).status).toBe(404)
  })
  it("429 when rate limited", async () => {
    ;(rateLimit as jest.Mock).mockReturnValue(false)
    expect((await GET(req(), ctx())).status).toBe(429)
  })
  it("serves a no-store CSV with a safe filename, defaults to the school year, guards formulas, audits", async () => {
    const res = await GET(req(), ctx())
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("text/csv")
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="sunday-school-year-1-blue-summary-2026-01-01-to-2026-12-31.csv"')
    expect(await res.text()).toContain("'=cmd,1,0,0,0,100%")
    expect(loadReportInput).toHaveBeenCalledWith(4, new Date("2026-01-01T00:00:00Z"), new Date("2026-12-31T00:00:00Z"))
    expect(logAudit).toHaveBeenCalledWith(7, "SUNDAY_SCHOOL_REPORT_EXPORTED", "SundaySchoolClass", 4, expect.objectContaining({ report: "summary", format: "csv" }), undefined)
  })
  it("serves a PDF", async () => {
    const res = await GET(req("?report=history&format=pdf&from=2026-01-01&to=2026-06-30"), ctx())
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("application/pdf")
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 4).toString()).toBe("%PDF")
  })
})
