/** @jest-environment node */
jest.mock("@/lib/featureFlags")
import { GET } from "../route"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getChurchSettingsStrict } from "@/lib/churchSettings"
import { renderDgrReceiptPdf } from "@/lib/pdf/DgrReceiptPdf"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/pdf/DgrReceiptPdf", () => ({ renderDgrReceiptPdf: jest.fn() }))
jest.mock("@/lib/crypto", () => ({
  decryptBytes: jest.fn((b: Uint8Array) => Buffer.from(Buffer.from(b).toString("utf8").replace(/^enc:/, ""))),
}))
jest.mock("@/lib/receiptSettings", () => ({
  getReceiptSettings: jest.fn(async () => ({
    documentTitle: "LIVE TITLE",
    totalLabel: "LIVE TOTAL",
    coveredPeriodTemplate: "{from} to {to}",
    legalText: "Live legal text",
  })),
}))
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

  it("serves the frozen PDF for a SENT receipt after settings change", async () => {
    ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue({
      ...row,
      status: "SENT",
      frozenPdf: Buffer.from("enc:%PDF-as-emailed"),
      issuer: { churchName: "Old Church" },
    })
    const res = await call("5")
    expect(res.status).toBe(200)
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("%PDF-as-emailed")
    expect(mockRender).not.toHaveBeenCalled()
  })

  it("renders a SENT receipt from its issuer snapshot (no PDF blob) with the frozen issue date", async () => {
    ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue({
      ...row,
      status: "SENT",
      frozenPdf: null,
      issuer: {
        churchName: "Old Church",
        churchAbn: "11111111111",
        churchAddress: "Old addr",
        churchEmail: "old@example.com",
        documentTitle: "OLD TITLE",
        totalDonationsLabel: "OLD TOTAL",
        legalLines: ["Old legal"],
        coveredPeriod: "old period",
        issueDate: "1 July 2026",
      },
    })
    await call("5")
    expect(mockRender).toHaveBeenCalledWith(
      expect.objectContaining({ churchName: "Old Church", documentTitle: "OLD TITLE", issueDate: "1 July 2026", legalLines: ["Old legal"] })
    )
  })

  it("renders a SENT receipt from its snapshot even when live church settings are unavailable", async () => {
    ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue({
      ...row,
      status: "SENT",
      frozenPdf: null,
      issuer: {
        churchName: "Old Church",
        churchAbn: "11111111111",
        churchAddress: "Old addr",
        churchEmail: "old@example.com",
        documentTitle: "OLD TITLE",
        totalDonationsLabel: "OLD TOTAL",
        legalLines: ["Old legal"],
        coveredPeriod: "old period",
        issueDate: "1 July 2026",
      },
    })
    const res = await call("5")
    expect(res.status).toBe(200)
    expect(mockRender).toHaveBeenCalledWith(expect.objectContaining({ churchName: "Old Church", issueDate: "1 July 2026" }))
    expect(getChurchSettingsStrict).not.toHaveBeenCalled()
  })

  it("a legacy SENT row (no snapshot) still renders live", async () => {
    ;(prisma.dgrReceipt.findUnique as jest.Mock).mockResolvedValue({ ...row, status: "SENT", frozenPdf: null, issuer: null })
    const res = await call("5")
    expect(res.status).toBe(200)
    expect(mockRender).toHaveBeenCalledWith(expect.objectContaining({ churchName: "Example Church", documentTitle: "LIVE TITLE" }))
  })
})
