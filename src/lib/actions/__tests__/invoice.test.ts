import { createInvoice, updateInvoice, deleteDraftInvoice, getInvoice, getRecipientContact } from "@/lib/actions/invoice"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { logAudit } from "@/lib/audit"
import { redirect } from "next/navigation"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("next/navigation", () => ({ redirect: jest.fn() }))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("@/lib/invoiceSettings", () => ({ getInvoiceSettings: jest.fn(async () => ({ gstRegistered: true, paymentDetails: "" })) }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    invoice: { create: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
    account: { findUnique: jest.fn() },
    fund: { findUnique: jest.fn() },
    person: { findUnique: jest.fn() },
    customer: { findUnique: jest.fn() },
  },
}))

const mockAuth = auth as jest.Mock
const as = (role: string) => mockAuth.mockResolvedValue({ user: { id: "1", role } })
function fd(o: Record<string, string> = {}) {
  const f = new FormData()
  const base: Record<string, string> = {
    recipientKind: "customer", recipientId: "3", recipientName: "Example Scouts", recipientEmail: "scouts@example.com",
    recipientAddress: "1 Example St", issueDate: "2026-10-11", dueDate: "2026-10-25", accountId: "4", fundId: "", notes: "",
    lines: JSON.stringify([{ description: "Hall hire", qty: "2", unitPrice: "150.00", gst: true }]), ...o,
  }
  for (const [k, v] of Object.entries(base)) f.set(k, v)
  return f
}
beforeEach(() => {
  jest.clearAllMocks(); as("ADMIN")
  ;(prisma.account.findUnique as jest.Mock).mockResolvedValue({ id: 4, type: "INCOME", isActive: true })
  ;(prisma.customer.findUnique as jest.Mock).mockResolvedValue({ id: 3, isActive: true })
  ;(prisma.invoice.create as jest.Mock).mockResolvedValue({ id: 11 })
  ;(prisma.invoice.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
})

describe("createInvoice", () => {
  it.each(["OFFICE_ADMIN", "AUDITOR", "VIEWER", "EVENT_ORGANISER"])("rejects %s", async (r) => {
    as(r); expect(await createInvoice(undefined, fd())).toEqual({ error: "Unauthorized" })
  })
  it("computes totals server-side, encrypts contact, audits, redirects", async () => {
    await createInvoice(undefined, fd())
    expect(prisma.invoice.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      status: "DRAFT", customerId: 3, personId: null, recipientName: "Example Scouts",
      recipientEmail: "enc:scouts@example.com", recipientAddress: "enc:1 Example St",
      subtotal: "300.00", gstTotal: "30.00", total: "330.00", accountId: 4, fundId: null, createdById: 1,
      lines: [{ description: "Hall hire", qty: 2, unitPriceCents: 15000, gst: true }],
    }) })
    expect(logAudit).toHaveBeenCalledWith(1, "INVOICE_CREATED", "Invoice", 11, { total: "330.00" })
    expect(redirect).toHaveBeenCalledWith("/accounting/invoices/11")
  })
  it("ignores GST when not registered", async () => {
    const { getInvoiceSettings } = jest.requireMock("@/lib/invoiceSettings")
    getInvoiceSettings.mockResolvedValueOnce({ gstRegistered: false, paymentDetails: "" })
    await createInvoice(undefined, fd())
    expect(prisma.invoice.create).toHaveBeenCalledWith({ data: expect.objectContaining({ gstTotal: "0.00", total: "300.00" }) })
  })
  it("rejects a non-income or inactive account", async () => {
    ;(prisma.account.findUnique as jest.Mock).mockResolvedValue({ id: 4, type: "EXPENSE", isActive: true })
    expect(await createInvoice(undefined, fd())).toEqual({ error: "Choose an active income account" })
  })
  it("rejects an unknown customer", async () => {
    ;(prisma.customer.findUnique as jest.Mock).mockResolvedValue(null)
    expect(await createInvoice(undefined, fd())).toEqual({ error: "Recipient not found" })
  })
  it("rejects a missing person", async () => {
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue(null)
    expect(await createInvoice(undefined, fd({ recipientKind: "person", recipientId: "5" }))).toEqual({ error: "Recipient not found" })
  })
  it("rejects an inactive fund", async () => {
    ;(prisma.fund.findUnique as jest.Mock).mockResolvedValue({ id: 2, isActive: false })
    expect(await createInvoice(undefined, fd({ fundId: "2" }))).toEqual({ error: "Choose an active fund" })
  })
})

describe("updateInvoice", () => {
  it("only updates drafts", async () => {
    ;(prisma.invoice.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
    expect(await updateInvoice(11, undefined, fd())).toEqual({ error: "This invoice has changed. Reload and try again." })
    expect(prisma.invoice.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 11, status: "DRAFT" } }))
  })
  it("audits on success", async () => {
    await updateInvoice(11, undefined, fd())
    expect(logAudit).toHaveBeenCalledWith(1, "INVOICE_UPDATED", "Invoice", 11, { total: "330.00" })
  })
})

describe("deleteDraftInvoice", () => {
  it("deletes only drafts", async () => {
    ;(prisma.invoice.deleteMany as jest.Mock).mockResolvedValue({ count: 0 })
    expect(await deleteDraftInvoice(11)).toEqual({ error: "Only unnumbered draft invoices can be deleted" })
    expect(prisma.invoice.deleteMany).toHaveBeenCalledWith({ where: { id: 11, status: "DRAFT", invoiceNo: null } })
  })
})

describe("getInvoice", () => {
  const row = {
    id: 11, invoiceNo: null, status: "DRAFT", personId: null, customerId: 3, recipientName: "Example Scouts",
    recipientEmail: "enc:scouts@example.com", recipientAddress: "enc:1 Example St",
    issueDate: new Date("2026-10-11"), dueDate: new Date("2026-10-25"),
    lines: [{ description: "Hall hire", qty: 2, unitPriceCents: 15000, gst: true }],
    subtotal: { toString: () => "300.00" }, gstTotal: { toString: () => "30.00" }, total: { toString: () => "330.00" },
    taxInvoice: false, accountId: 4, account: { name: "Hall hire" }, fundId: null, fund: null, notes: "enc:n",
    sentAt: null, paidAt: null, voidedAt: null, voidReason: null, payment: null,
  }
  beforeEach(() => (prisma.invoice.findUnique as jest.Mock).mockResolvedValue(row))
  it("decrypts for OFFICE_ADMIN", async () => {
    as("OFFICE_ADMIN")
    expect(await getInvoice(11)).toEqual(expect.objectContaining({ recipientEmail: "scouts@example.com", notes: "n", issueDate: "2026-10-11", total: "330.00" }))
  })
  it("masks for AUDITOR", async () => {
    as("AUDITOR")
    expect(await getInvoice(11)).toEqual(expect.objectContaining({ recipientName: "Example Scouts", recipientEmail: null, recipientAddress: null, notes: null }))
  })
  it("rejects VIEWER", async () => { as("VIEWER"); expect(await getInvoice(11)).toEqual({ error: "Unauthorized" }) })
})

describe("getRecipientContact", () => {
  it("builds a person's address from their family", async () => {
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({
      email: "enc:p@example.com", family: { address: "enc:2 Example Rd", suburb: "enc:Exampleton", state: "enc:NSW", postcode: "enc:2000" },
    })
    expect(await getRecipientContact("person", 5)).toEqual({ email: "p@example.com", address: "2 Example Rd\nExampleton NSW 2000" })
  })
  it("rejects AUDITOR", async () => { as("AUDITOR"); expect(await getRecipientContact("person", 5)).toEqual({ error: "Unauthorized" }) })
})
