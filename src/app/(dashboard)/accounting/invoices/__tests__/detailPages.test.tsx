/** @jest-environment node */
import InvoicePage from "../[id]/page"
import NewInvoicePage from "../new/page"
import EditInvoicePage from "../[id]/edit/page"
import { auth } from "@/auth"
import { getInvoice } from "@/lib/actions/invoice"
import { getInvoiceSettings } from "@/lib/invoiceSettings"
import { prisma } from "@/lib/prisma"
import { renderToStaticMarkup } from "react-dom/server"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/actions/invoice", () => ({ getInvoice: jest.fn() }))
jest.mock("@/lib/invoiceSettings", () => ({ getInvoiceSettings: jest.fn() }))
jest.mock("@/lib/invoiceFormData", () => ({
  loadInvoiceFormData: jest.fn(async () => ({ recipients: [], accounts: [], funds: [], gstEnabled: false })),
}))
jest.mock("@/components/accounting/InvoiceForm", () => ({ __esModule: true, default: (p: { edit?: { id: number } }) => `FORM:${p.edit?.id ?? "new"}` }))
jest.mock("@/components/accounting/InvoiceRowActions", () => ({ DeleteDraftButton: () => "DELETE" }))
jest.mock("@/components/accounting/InvoiceSendActions", () => ({ InvoiceSendActions: (p: { status: string }) => `SEND:${p.status}` }))
jest.mock("@/components/accounting/MarkPaidDialog", () => ({
  MarkPaidDialog: (p: { bankAccounts: { name: string }[] }) => `MARKPAID:${p.bankAccounts.map((a) => a.name).join(",")}`,
  UnmarkPaidButton: () => "UNMARK",
}))
jest.mock("@/components/accounting/VoidInvoiceDialog", () => ({ VoidInvoiceDialog: () => "VOID" }))
jest.mock("@/lib/prisma", () => ({ prisma: { paymentAccount: { findMany: jest.fn(async () => [{ id: 2, name: "Main" }]) } } }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn((to: string) => { throw new Error(`REDIRECT:${to}`) }),
  notFound: jest.fn(() => { throw new Error("NOT_FOUND") }),
}))

const mockAuth = auth as jest.Mock
const as = (role: string) => mockAuth.mockResolvedValue({ user: { id: "1", role } })
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const inv = {
  id: 11, invoiceNo: "INV-0007", status: "SENT", personId: null, customerId: 3, recipientName: "Example Scouts",
  recipientEmail: "scouts@example.com", recipientAddress: "1 Example St", issueDate: "2026-10-11", dueDate: "2026-10-25",
  lines: [{ description: "Hall hire", qty: 2, unitPriceCents: 15000, gst: true }],
  subtotal: "300.00", gstTotal: "30.00", total: "330.00", taxInvoice: true, accountId: 4, accountName: "Hall hire",
  fundId: 2, fundName: "General", notes: "Thanks", sentAt: new Date("2026-10-11T21:00:00Z"), paidAt: null,
  voidedAt: null, voidReason: null, paymentTransactionId: null,
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(getInvoiceSettings as jest.Mock).mockResolvedValue({ gstRegistered: false, paymentDetails: "" })
  ;(getInvoice as jest.Mock).mockResolvedValue(inv)
})

describe("InvoicePage", () => {
  it("redirects roles without accounting view", async () => {
    as("VIEWER")
    await expect(InvoicePage(params("11"))).rejects.toThrow("REDIRECT:/")
  })
  it("404s on a bad id or missing invoice", async () => {
    as("ADMIN")
    await expect(InvoicePage(params("abc"))).rejects.toThrow("NOT_FOUND")
    ;(getInvoice as jest.Mock).mockResolvedValue(null)
    await expect(InvoicePage(params("11"))).rejects.toThrow("NOT_FOUND")
  })
  it("shows a sent tax invoice with frozen totals, Sydney sent date and send actions", async () => {
    as("ADMIN")
    const html = renderToStaticMarkup(await InvoicePage(params("11")))
    expect(html).toContain("Tax invoice")
    expect(html).toContain("INV-0007")
    expect(html).toContain("$330.00")
    expect(html).toContain("Sent 2026-10-12")
    expect(html).toContain("SEND:SENT")
    expect(html).toContain("/accounting/invoices/11/pdf")
    expect(html).not.toContain("DELETE")
  })
  it("recomputes a draft's totals and offers edit + delete", async () => {
    as("PASTOR")
    ;(getInvoiceSettings as jest.Mock).mockResolvedValue({ gstRegistered: false, paymentDetails: "" })
    ;(getInvoice as jest.Mock).mockResolvedValue({ ...inv, status: "DRAFT", invoiceNo: null, sentAt: null, taxInvoice: false })
    const html = renderToStaticMarkup(await InvoicePage(params("11")))
    expect(html).toContain("$300.00")
    expect(html).not.toContain("$330.00")
    expect(html).toContain("/accounting/invoices/11/edit")
    expect(html).toContain("DELETE")
  })
  it("AUDITOR sees no PDF link, contact details or actions", async () => {
    as("AUDITOR")
    ;(getInvoice as jest.Mock).mockResolvedValue({ ...inv, recipientEmail: null, recipientAddress: null, notes: null })
    const html = renderToStaticMarkup(await InvoicePage(params("11")))
    expect(html).toContain("Example Scouts")
    expect(html).not.toContain("/pdf")
    expect(html).not.toContain("SEND:")
  })
  it("offers mark paid (with active bank accounts) and void on a SENT invoice", async () => {
    as("PASTOR")
    const html = renderToStaticMarkup(await InvoicePage(params("11")))
    expect(html).toContain("MARKPAID:Main")
    expect(html).toContain("VOID")
    expect(html).not.toContain("UNMARK")
    expect(prisma.paymentAccount.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { kind: "BANK", isActive: true } }))
  })
  it("offers unmark and links the payment on a PAID invoice", async () => {
    as("ADMIN")
    ;(getInvoice as jest.Mock).mockResolvedValue({ ...inv, status: "PAID", paidAt: new Date("2026-10-20T00:00:00Z"), paymentTransactionId: 50 })
    const html = renderToStaticMarkup(await InvoicePage(params("11")))
    expect(html).toContain("UNMARK")
    expect(html).toContain("/accounting/transactions/50")
    expect(html).not.toContain("MARKPAID")
    expect(prisma.paymentAccount.findMany).not.toHaveBeenCalled()
  })
  it("read-only roles get no payment or void actions", async () => {
    as("OFFICE_ADMIN")
    const html = renderToStaticMarkup(await InvoicePage(params("11")))
    expect(html).not.toContain("MARKPAID")
    expect(html).not.toContain("VOID")
  })
  it("shows void details", async () => {
    as("ADMIN")
    ;(getInvoice as jest.Mock).mockResolvedValue({ ...inv, status: "VOID", voidedAt: new Date("2026-10-13T00:00:00Z"), voidReason: "Duplicate" })
    expect(renderToStaticMarkup(await InvoicePage(params("11")))).toContain("Duplicate")
  })
})

describe("NewInvoicePage / EditInvoicePage", () => {
  it("new: redirects non-managers, renders the form for ADMIN", async () => {
    as("OFFICE_ADMIN")
    await expect(NewInvoicePage()).rejects.toThrow("REDIRECT:/accounting/invoices")
    as("ADMIN")
    expect(renderToStaticMarkup(await NewInvoicePage())).toContain("FORM:new")
  })
  it("edit: renders drafts, redirects sent invoices, 404s missing", async () => {
    as("ADMIN")
    ;(getInvoice as jest.Mock).mockResolvedValue({ ...inv, status: "DRAFT" })
    expect(renderToStaticMarkup(await EditInvoicePage(params("11")))).toContain("FORM:11")
    ;(getInvoice as jest.Mock).mockResolvedValue(inv)
    await expect(EditInvoicePage(params("11"))).rejects.toThrow("REDIRECT:/accounting/invoices/11")
    ;(getInvoice as jest.Mock).mockResolvedValue(null)
    await expect(EditInvoicePage(params("11"))).rejects.toThrow("NOT_FOUND")
    await expect(EditInvoicePage(params("x"))).rejects.toThrow("NOT_FOUND")
    as("AUDITOR")
    await expect(EditInvoicePage(params("11"))).rejects.toThrow("REDIRECT:/accounting/invoices")
  })
})
