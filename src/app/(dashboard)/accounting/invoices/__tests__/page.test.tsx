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
    mockList.mockResolvedValue({ rows: [row], nextCursor: null, prevCursor: null })
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

  it("shows no pager when everything fits on one page", async () => {
    as("ADMIN")
    expect(renderToStaticMarkup(await call())).not.toContain("Invoice pages")
  })

  it("links Next/Previous with the filters preserved", async () => {
    as("ADMIN")
    mockList.mockResolvedValue({ rows: [row], nextCursor: "2026-10-01_5", prevCursor: "2026-10-11_11" })
    const html = renderToStaticMarkup(await call({ status: "SENT", from: "2026-10-01", to: "2026-10-31", after: "2026-10-12_20" }))
    expect(html).toContain('href="/accounting/invoices?status=SENT&amp;from=2026-10-01&amp;to=2026-10-31&amp;after=2026-10-01_5"')
    expect(html).toContain('href="/accounting/invoices?status=SENT&amp;from=2026-10-01&amp;to=2026-10-31&amp;before=2026-10-11_11"')
  })

  it("disables Previous on the first page and Next on the last", async () => {
    as("ADMIN")
    mockList.mockResolvedValue({ rows: [row], nextCursor: "2026-10-11_11", prevCursor: null })
    let html = renderToStaticMarkup(await call())
    expect(html).toContain("after=2026-10-11_11")
    expect(html).not.toContain("before=")
    mockList.mockResolvedValue({ rows: [row], nextCursor: null, prevCursor: "2026-10-11_11" })
    html = renderToStaticMarkup(await call({ after: "2026-10-12_20" }))
    expect(html).toContain("before=2026-10-11_11")
    expect(html).not.toContain("after=")
  })

  it("passes a valid cursor through and drops a malformed one", async () => {
    as("ADMIN")
    await call({ after: "2026-10-11_11" })
    expect(mockList).toHaveBeenLastCalledWith({ status: undefined, from: undefined, to: undefined, after: "2026-10-11_11", before: undefined })
    await call({ before: "2026-10-11_11" })
    expect(mockList).toHaveBeenLastCalledWith(expect.objectContaining({ after: undefined, before: "2026-10-11_11" }))
    await call({ after: "x'; DROP TABLE--", before: "2026-13-01_1" })
    expect(mockList).toHaveBeenLastCalledWith(expect.objectContaining({ after: undefined, before: undefined }))
  })

  it("passes only valid filters through", async () => {
    as("ADMIN")
    await call({ status: "PAID", from: "2026-02-30", to: "2026-10-31" })
    expect(mockList).toHaveBeenCalledWith({ status: "PAID", from: undefined, to: "2026-10-31", after: undefined, before: undefined })
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

  it("falls back to this month when only one date filter is set", async () => {
    as("ADMIN")
    jest.useFakeTimers({ now: new Date("2026-10-10T03:00:00Z"), doNotFake: ["nextTick", "setImmediate"] })
    try {
      await call({ from: "2026-11-01" })
      expect(getInvoiceSummary).toHaveBeenCalledWith({ from: "2026-10-01", to: "2026-10-31" })
    } finally {
      jest.useRealTimers()
    }
  })

  it("redirects if the summary is unauthorized", async () => {
    as("ADMIN")
    ;(getInvoiceSummary as jest.Mock).mockResolvedValue({ error: "Unauthorized" })
    await expect(call()).rejects.toThrow("REDIRECT")
  })
})
