/** @jest-environment node */
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@/lib/rateLimit", () => ({ rateLimit: jest.fn(() => true) }))
jest.mock("@/lib/prisma", () => ({ prisma: {} }))
jest.mock("@/lib/crypto", () => ({ safeDecrypt: jest.fn() }))
jest.mock("@/lib/clearanceCompliance", () => ({
  ...jest.requireActual("@/lib/clearanceCompliance"),
  loadComplianceRows: jest.fn(),
}))

import { NextRequest } from "next/server"
import { auth } from "@/auth"
import { logAudit } from "@/lib/audit"
import { rateLimit } from "@/lib/rateLimit"
import { MINISTRY_ROLE_LABELS } from "@/lib/ministryRoles"
import { loadComplianceRows, toComplianceRow, COMPLIANCE_CAP } from "@/lib/clearanceCompliance"
import { GET } from "../route"

const mockAuth = auth as jest.Mock
const req = (q = "") => new NextRequest(`http://localhost/api/clearances/export${q}`)
const today = new Date()
const row = (lastName: string, clearances: object[] = []) =>
  toComplianceRow({
    id: 1, firstName: "Alex", lastName, ministryRoles: ["STAFF", "YOUTH_LEADER"],
    family: { name: "F" }, clearances: clearances as never,
  }, today)

describe("GET /api/clearances/export", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(rateLimit as jest.Mock).mockReturnValue(true)
    mockAuth.mockResolvedValue({ user: { role: "OFFICE_ADMIN", id: "7" } })
    ;(loadComplianceRows as jest.Mock).mockResolvedValue({ rows: [row("Testperson")] })
  })

  it("401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null)
    expect((await GET(req())).status).toBe(401)
  })
  it.each(["VIEWER", "AUDITOR", "EVENT_ORGANISER"])("403 for %s", async (role) => {
    mockAuth.mockResolvedValue({ user: { role, id: "7" } })
    expect((await GET(req())).status).toBe(403)
    expect(loadComplianceRows).not.toHaveBeenCalled()
  })
  it("429 when rate limited", async () => {
    ;(rateLimit as jest.Mock).mockReturnValue(false)
    expect((await GET(req())).status).toBe(429)
  })
  it("returns a no-store CSV attachment with headers, roles and statuses, and no sensitive columns", async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("text/csv")
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment; filename="clearance-compliance-\d{4}-\d{2}-\d{2}\.csv"$/)
    const [header, line] = (await res.text()).split("\n")
    expect(header).toBe("Family name,Given name,Ministry roles,WWCC status,WWCC expires,WWCC verified,Safe Ministry status,Safe Ministry expires,Safe Ministry verified")
    expect(line).toBe(`Testperson,Alex,${MINISTRY_ROLE_LABELS.STAFF}; ${MINISTRY_ROLE_LABELS.YOUTH_LEADER},Missing,,,Missing,,`)
    expect(header).not.toMatch(/number|birth|dob/i)
  })
  it("neutralises spreadsheet formulas in names (escapeCsv)", async () => {
    ;(loadComplianceRows as jest.Mock).mockResolvedValue({ rows: [row("=cmd")] })
    const text = await (await GET(req())).text()
    expect(text.split("\n")[1].startsWith("'=cmd,")).toBe(true)
  })
  it("flags truncation when the filtered export exceeds the cap", async () => {
    ;(loadComplianceRows as jest.Mock).mockResolvedValue({ rows: Array.from({ length: COMPLIANCE_CAP + 1 }, (_, i) => row("P" + i)) })
    const res = await GET(req())
    expect((await res.text()).split("\n")).toHaveLength(COMPLIANCE_CAP + 1)
    expect(res.headers.get("X-Export-Truncated")).toBe("true")
  })
  it("honours ?status=, audits CLEARANCE_EXPORTED, flags truncation", async () => {
    ;(loadComplianceRows as jest.Mock).mockResolvedValue({
      rows: [row("Testperson"), row("Other", [{ id: "c9", type: "WWCC", number: "x", expiresAt: new Date("2020-01-01T00:00:00Z"), verifiedAt: new Date() }])],
    })
    const res = await GET(req("?status=expired"))
    expect((await res.text()).split("\n")).toHaveLength(2) // header + the one expired person
    expect(res.headers.get("X-Export-Truncated")).toBeNull()
    expect(logAudit).toHaveBeenCalledWith(7, "CLEARANCE_EXPORTED", "Person", undefined, { rowCount: 1, filter: "expired" }, expect.any(String))
  })
})
