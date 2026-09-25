/** @jest-environment node */
import { GET } from "../route"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { renderDgrReceiptPdf } from "@/lib/pdf/DgrReceiptPdf"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/pdf/DgrReceiptPdf", () => ({ renderDgrReceiptPdf: jest.fn() }))
jest.mock("@/lib/churchSettings", () => ({
  getChurchSettingsStrict: jest.fn(async () => ({
    name: "Example Church",
    address: "1 Example St",
    abn: "51824753556",
    email: "church@example.com",
  })),
}))
jest.mock("@/lib/prisma", () => ({
  prisma: { dgrReceipt: { findUnique: jest.fn() } },
}))

const mockAuth = auth as jest.Mock
const mockRender = renderDgrReceiptPdf as jest.Mock

const row = {
  id: 5,
  receiptNo: "DGR-2025-003",
  fyEndYear: 2025,
  donorName: "Alex Admin",
  lines: [{ date: "2024-07-24", amount: 100, method: "Bank Transfer" }],
  createdAt: new Date("2025-07-08T00:00:00Z"),
}

function call(id: string) {
  return GET({} as never, { params: Promise.resolve({ id }) })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  mockRender.mockResolvedValue(Buffer.from("%PDF-fake"))
})

describe("GET dgr-receipt pdf", () => {
  it("401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null)
    expect((await call("5")).status).toBe(401)
  })

  it("403 for a role without accounting view access", async () => {
    mockAuth.mockResolvedValue({ user: { id: "1", role: "VIEWER" } })
    expect((await call("5")).status).toBe(403)
  })

  it("400 for an invalid id", async () => {
    expect((await call("abc")).status).toBe(400)
    expect((await call("0")).status).toBe(400)
    expect((await call("9999999999")).status).toBe(400)
  })

  it("404 for a missing receipt", async () => {
    ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue(null)
    expect((await call("5")).status).toBe(404)
  })

  it("200 with a PDF attachment for a valid receipt", async () => {
    ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue(row)
    const res = await call("5")
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("application/pdf")
    expect(res.headers.get("Content-Disposition")).toContain('filename="DGR-2025-003.pdf"')
    expect(mockRender).toHaveBeenCalled()
  })
})
