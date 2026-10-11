/** @jest-environment node */
import InvoicesPage from "../page"
import { auth } from "@/auth"
import { listInvoices } from "@/lib/actions/invoice"
import { renderToStaticMarkup } from "react-dom/server"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/actions/invoice", () => ({ listInvoices: jest.fn() }))
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

  it("passes only valid filters through", async () => {
    as("ADMIN")
    await call({ status: "PAID", from: "2026-02-30", to: "2026-10-31" })
    expect(mockList).toHaveBeenCalledWith({ status: "PAID", from: undefined, to: "2026-10-31" })
  })
})
