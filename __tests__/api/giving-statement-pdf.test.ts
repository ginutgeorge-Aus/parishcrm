/** @jest-environment node */
import { NextRequest } from "next/server"
import { GET } from "@/app/(dashboard)/accounting/giving-statements/[familyId]/pdf/route"
import { auth } from "@/auth"
import { loadStatements, loadStatementFamilies } from "@/lib/givingStatementData"
import { getChurchSettingsForReceipt } from "@/lib/churchSettings"
import { featureNotFound } from "@/lib/featureFlags"
import { buildStatements } from "@/lib/givingStatement"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/featureFlags")
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/givingStatementData", () => ({ loadStatements: jest.fn(), loadStatementFamilies: jest.fn() }))
jest.mock("@/lib/churchSettings", () => ({ getChurchSettingsForReceipt: jest.fn() }))
jest.mock("@/lib/pdf/GivingStatementPdf", () => ({ renderGivingStatementPdf: jest.fn(async () => Buffer.from("%PDF-1")) }))

const mockAuth = auth as jest.Mock
const mockLoad = loadStatements as jest.Mock
const mockFamilies = loadStatementFamilies as jest.Mock
const mockChurch = getChurchSettingsForReceipt as jest.Mock

const call = (id = "1", year = "2025") =>
  GET(new NextRequest(`http://localhost/accounting/giving-statements/${id}/pdf?year=${year}`), {
    params: Promise.resolve({ familyId: id }),
  })

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  ;(featureNotFound as jest.Mock).mockResolvedValue(null)
  mockLoad.mockResolvedValue(
    buildStatements([{ date: new Date("2025-08-01T00:00:00Z"), description: "x", amount: 10, fundName: null, familyId: 1 }])
  )
  mockFamilies.mockResolvedValue(new Map([[1, { id: 1, name: "Smith", canEmail: true, emails: [] }]]))
  mockChurch.mockResolvedValue({ church: { name: "C", abn: "1", address: "a", email: "c@x.com", website: "" } })
})

describe("GET giving statement pdf", () => {
  it("401 without a session, 403 without accounting view", async () => {
    mockAuth.mockResolvedValueOnce(null)
    expect((await call()).status).toBe(401)
    mockAuth.mockResolvedValueOnce({ user: { id: "1", role: "VIEWER" } })
    expect((await call()).status).toBe(403)
  })

  it("returns the feature-off response when receipts are disabled", async () => {
    const off = new Response(null, { status: 404 })
    ;(featureNotFound as jest.Mock).mockResolvedValueOnce(off)
    expect(await call()).toBe(off)
  })

  it("400 on a bad id or year", async () => {
    expect((await call("abc")).status).toBe(400)
    expect((await call("1", "1900")).status).toBe(400)
  })

  it("serves a no-store PDF and never decrypts addresses", async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("application/pdf")
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    expect(mockFamilies).toHaveBeenCalledWith([1], false)
  })

  it("422 with the scan-cap message, but a generic message for other errors", async () => {
    mockLoad.mockRejectedValueOnce(new Error("Too many gifts in this financial year"))
    const cap = await call()
    expect(cap.status).toBe(422)
    expect((await cap.json()).error).toMatch(/Too many gifts/)
    mockLoad.mockRejectedValueOnce(new Error("decrypt failed: secret detail"))
    const other = await call()
    expect(other.status).toBe(422)
    expect(JSON.stringify(await other.json())).not.toContain("secret detail")
  })

  it("404 when the family has no statement", async () => {
    mockFamilies.mockResolvedValueOnce(new Map())
    expect((await call()).status).toBe(404)
  })

  it("409 when church settings are incomplete", async () => {
    mockChurch.mockResolvedValueOnce({ error: "Set the church name first" })
    expect((await call()).status).toBe(409)
  })
})
