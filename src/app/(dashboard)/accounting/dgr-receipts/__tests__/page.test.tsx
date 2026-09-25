/** @jest-environment node */
import DgrReceiptsPage from "../page"
import { auth } from "@/auth"
import { listDgrReceipts } from "@/lib/actions/dgrReceipt"
import { renderToStaticMarkup } from "react-dom/server"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/actions/dgrReceipt", () => ({
  listDgrReceipts: jest.fn(),
  sendDgrReceipt: jest.fn(),
  deleteDgrReceipt: jest.fn(),
}))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => {
    throw new Error("REDIRECT")
  }),
}))
jest.mock("@/components/accounting/DgrReceiptRowActions", () => ({
  DgrReceiptRowActions: () => null,
}))

const mockAuth = auth as jest.Mock
const mockList = listDgrReceipts as jest.Mock

function render(el: React.ReactElement) {
  return renderToStaticMarkup(el)
}

describe("DgrReceiptsPage", () => {
  beforeEach(() => jest.clearAllMocks())

  it("redirects a role without accounting view access", async () => {
    mockAuth.mockResolvedValue({ user: { id: "1", role: "VIEWER" } })
    await expect(
      DgrReceiptsPage({ searchParams: Promise.resolve({}) })
    ).rejects.toThrow("REDIRECT")
  })

  it("renders receipt rows for an accounting viewer", async () => {
    mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    mockList.mockResolvedValue([
      {
        id: 5,
        receiptNo: "DGR-2025-003",
        fyLabel: "2024–25",
        donorName: "Alex Admin",
        total: 450,
        status: "SENT",
        sentAt: new Date("2025-07-08T00:00:00Z"),
      },
    ])

    const html = render(await DgrReceiptsPage({ searchParams: Promise.resolve({}) }))

    expect(html).toContain("DGR-2025-003")
    expect(html).toContain("Alex Admin")
    expect(html).toContain("$450.00")
    expect(html).toContain("SENT")
    expect(html).toContain("/accounting/dgr-receipts/new")
  })

  it("shows the sent date in the church timezone, not the server's", async () => {
    mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
    // 22:00 UTC on 7 Jul = 8:00 AM 8 Jul in Sydney.
    mockList.mockResolvedValue([
      { id: 5, receiptNo: "DGR-2025-003", fyLabel: "2024–25", donorName: "G", total: 1, status: "SENT", sentAt: new Date("2025-07-07T22:00:00Z") },
    ])

    const html = render(await DgrReceiptsPage({ searchParams: Promise.resolve({}) }))

    expect(html).toContain("08/07/2025")
    expect(html).not.toContain("07/07/2025")
  })
})
