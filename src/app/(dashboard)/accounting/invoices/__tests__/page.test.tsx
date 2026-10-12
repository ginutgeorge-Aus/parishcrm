/** @jest-environment node */
import InvoicesPage from "../page"
import { auth } from "@/auth"
import { getInvoiceSummary, listInvoices } from "@/lib/actions/invoice"
import { getInvoiceSettings } from "@/lib/invoiceSettings"
import { renderToStaticMarkup } from "react-dom/server"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/actions/invoice", () => ({ listInvoices: jest.fn(), getInvoiceSummary: jest.fn() }))
jest.mock("@/lib/invoiceSettings", () => ({ getInvoiceSettings: jest.fn() }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => {
    throw new Error("REDIRECT")
  }),
}))

const mockAuth = auth as jest.Mock
const mockList = listInvoices as jest.Mock
const as = (role: string) => mockAuth.mockResolvedValue({ user: { id: "1", role } })
const row = {
  id: 11, invoiceNo: "INV-0007", status: "SENT", recipientName: "Example Scouts",
  issueDate: "2026-10-11", dueDate: "2026-10-25", total: "330.00", gstTotal: "30.00", paidAt: null,
}
const call = (sp: Record<string, string> = {}) => InvoicesPage({ searchParams: Promise.resolve(sp) })

describe("InvoicesPage", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockList.mockResolvedValue([row])
    ;(getInvoiceSummary as jest.Mock).mockResolvedValue({ outstandingCents: 16000, outstandingCount: 2, paidCents: 33000, paidCount: 1, gstCollectedCents: 3000 })
    ;(getInvoiceSettings as jest.Mock).mockResolvedValue({ gstRegistered: true, paymentDetails: "" })
  })

  it("redirects a role without accounting view access", async () => {
    as("VIEWER")
    await expect(call()).rejects.toThrow("REDIRECT")
  })

  it("lists invoices for an AUDITOR without the New invoice button", async () => {
    as("AUDITOR")
    const html = renderToStaticMarkup(await call())
    expect(html).toContain("INV-0007")
    expect(html).toContain("Example Scouts")
    expect(html).toContain("$330.00")
    expect(html).not.toContain("/accounting/invoices/new")
  })

  it("shows New invoice to an ADMIN", async () => {
    as("ADMIN")
    expect(renderToStaticMarkup(await call())).toContain("/accounting/invoices/new")
  })

  it("says when the list hits its row cap", async () => {
    as("ADMIN")
    mockList.mockResolvedValue(Array.from({ length: 500 }, (_, i) => ({ ...row, id: i + 1 })))
    expect(renderToStaticMarkup(await call())).toContain("Showing the newest 500 invoices")
  })

  it("passes only valid filters through", async () => {
    as("ADMIN")
    await call({ status: "PAID", from: "2026-02-30", to: "2026-10-31" })
    expect(mockList).toHaveBeenCalledWith({ status: "PAID", from: undefined, to: "2026-10-31" })
  })

  it("shows outstanding, paid and GST collected tiles for this month by default", async () => {
    as("AUDITOR")
    jest.useFakeTimers({ now: new Date("2026-02-10T03:00:00Z"), doNotFake: ["nextTick", "setImmediate"] })
    try {
      const html = renderToStaticMarkup(await call())
      expect(getInvoiceSummary).toHaveBeenCalledWith({ from: "2026-02-01", to: "2026-02-28" })
      expect(html).toContain("$160.00")
      expect(html).toContain("2 sent, unpaid")
      expect(html).toContain("GST collected")
      expect(html).toContain("$30.00")
    } finally {
      jest.useRealTimers()
    }
  })

  it("uses the date filters as the payment period and hides GST when not registered", async () => {
    as("ADMIN")
    ;(getInvoiceSettings as jest.Mock).mockResolvedValue({ gstRegistered: false, paymentDetails: "" })
    const html = renderToStaticMarkup(await call({ from: "2026-07-01", to: "2026-09-30" }))
    expect(getInvoiceSummary).toHaveBeenCalledWith({ from: "2026-07-01", to: "2026-09-30" })
    expect(html).toContain("1 paid 2026-07-01 to 2026-09-30")
    expect(html).not.toContain("GST collected")
  })

  it("redirects if the summary is unauthorized", async () => {
    as("ADMIN")
    ;(getInvoiceSummary as jest.Mock).mockResolvedValue({ error: "Unauthorized" })
    await expect(call()).rejects.toThrow("REDIRECT")
  })
})
