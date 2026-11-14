/** @jest-environment node */
import { GET } from "../route"
import { auth } from "@/auth"
import { logAudit } from "@/lib/audit"
import { getSacramentRecord } from "@/lib/actions/sacrament"
import { renderSacramentCertificatePdf } from "@/lib/pdf/SacramentCertificatePdf"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/actions/sacrament", () => ({ getSacramentRecord: jest.fn() }))
jest.mock("@/lib/pdf/SacramentCertificatePdf", () => ({ renderSacramentCertificatePdf: jest.fn() }))
jest.mock("@/lib/churchSettings", () => ({
  getChurchSettings: jest.fn(async () => ({ name: "Example Church", address: "1 Example St" })),
}))

const RECORD = {
  id: 5,
  type: "BAPTISM",
  registerNo: "BAP-2026-003",
  person: { id: 8, firstName: "Alex", lastName: "Sample" },
}

/** Call the route handler with a string id. */
function call(id: string) {
  return GET({} as never, { params: Promise.resolve({ id }) })
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "PASTOR" } })
  ;(getSacramentRecord as jest.Mock).mockResolvedValue(RECORD)
  ;(renderSacramentCertificatePdf as jest.Mock).mockResolvedValue(Buffer.from("%PDF-fake"))
})

describe("GET sacrament certificate", () => {
  it("401 when signed out", async () => {
    ;(auth as jest.Mock).mockResolvedValue(null)
    expect((await call("5")).status).toBe(401)
  })

  it.each(["VIEWER", "AUDITOR", "EVENT_ORGANISER", "HEADMASTER", "TEACHER"])("403 for %s", async (role) => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role } })
    expect((await call("5")).status).toBe(403)
    expect(getSacramentRecord).not.toHaveBeenCalled()
  })

  it("400 for an invalid id", async () => {
    expect((await call("abc")).status).toBe(400)
    expect((await call("0")).status).toBe(400)
  })

  it("404 when the entry does not exist", async () => {
    ;(getSacramentRecord as jest.Mock).mockResolvedValue(null)
    expect((await call("5")).status).toBe(404)
  })

  it.each(["ADMIN", "PASTOR", "OFFICE_ADMIN"])("%s gets the PDF and an audit row without PII", async (role) => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role } })
    const res = await call("5")
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("application/pdf")
    expect(res.headers.get("Content-Disposition")).toContain("BAP-2026-003.pdf")
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 4).toString()).toBe("%PDF")
    expect(logAudit).toHaveBeenCalledWith(1, "SACRAMENT_CERTIFICATE_PRINTED", "SacramentRecord", 5, {
      registerNo: "BAP-2026-003",
      type: "BAPTISM",
      personId: 8,
    })
  })
})
