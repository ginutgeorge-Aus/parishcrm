import { createInvoice, updateInvoice, deleteDraftInvoice, getInvoice, getRecipientContact, listInvoices, getInvoiceSummary } from "@/lib/actions/invoice"
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
    invoice: { create: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), aggregate: jest.fn() },
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
  beforeEach(() => (prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ customerId: 3 }))
  it("rejects an invalid id", async () => {
    expect(await updateInvoice(2 ** 31, undefined, fd())).toEqual({ error: "Invoice not found" })
    expect(prisma.invoice.updateMany).not.toHaveBeenCalled()
  })
  it("lets a draft keep a customer deactivated after it was addressed", async () => {
    ;(prisma.customer.findUnique as jest.Mock).mockResolvedValue({ id: 3, isActive: false })
    await updateInvoice(11, undefined, fd())
    expect(prisma.invoice.updateMany).toHaveBeenCalled()
  })
  it("still rejects switching to a different inactive customer", async () => {
    ;(prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ customerId: 8 })
    ;(prisma.customer.findUnique as jest.Mock).mockResolvedValue({ id: 3, isActive: false })
    expect(await updateInvoice(11, undefined, fd())).toEqual({ error: "Recipient not found" })
  })
  it("only updates drafts", async () => {
    ;(prisma.invoice.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
    expect(await updateInvoice(11, undefined, fd())).toEqual({ error: "This invoice has changed. Reload and try again." })
    expect(prisma.invoice.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 11, status: "DRAFT" } }))
  })
  it("bumps updatedAt explicitly (the send path's version check)", async () => {
    await updateInvoice(11, undefined, fd())
    expect(prisma.invoice.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ updatedAt: expect.any(Date) }) }))
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

describe("listInvoices", () => {
  const base = { id: 11, invoiceNo: null, recipientName: "Example Scouts", issueDate: new Date("2026-10-11"), dueDate: new Date("2026-10-25"), paidAt: null,
    lines: [{ description: "Hall hire", qty: 2, unitPriceCents: 15000, gst: true }] }
  it("recomputes draft totals with the current GST setting but keeps sent totals", async () => {
    ;(prisma.invoice.findMany as jest.Mock).mockResolvedValue([
      { ...base, status: "DRAFT", total: { toString: () => "300.00" }, gstTotal: { toString: () => "0.00" } },
      { ...base, id: 12, invoiceNo: "INV-0001", status: "SENT", total: { toString: () => "300.00" }, gstTotal: { toString: () => "0.00" } },
    ])
    const { rows } = (await listInvoices()) as { rows: unknown[] }
    expect(rows).toEqual([
      expect.objectContaining({ id: 11, total: "330.00", gstTotal: "30.00", issueDate: "2026-10-11" }),
      expect.objectContaining({ id: 12, total: "300.00", gstTotal: "0.00" }),
    ])
    expect(rows).not.toEqual(expect.arrayContaining([expect.objectContaining({ lines: expect.anything() })]))
  })
  it("applies status and date filters", async () => {
    ;(prisma.invoice.findMany as jest.Mock).mockResolvedValue([])
    await listInvoices({ status: "SENT" as never, from: "2026-10-01", to: "2026-10-31" })
    expect(prisma.invoice.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: "SENT", issueDate: { gte: new Date("2026-10-01"), lte: new Date("2026-10-31") } },
    }))
  })
  it("ignores a malformed or impossible date filter instead of passing Invalid Date to Prisma", async () => {
    ;(prisma.invoice.findMany as jest.Mock).mockResolvedValue([])
    await listInvoices({ from: "garbage", to: "2026-02-30" })
    expect((prisma.invoice.findMany as jest.Mock).mock.calls.at(-1)[0].where).toEqual({})
  })
  const mk = (n: number, day = "2026-10-11") => Array.from({ length: n }, (_, i) => ({ ...base, id: 100 - i, issueDate: new Date(day), status: "SENT", total: { toString: () => "1.00" }, gstTotal: { toString: () => "0.00" } }))
  const lastWhere = () => (prisma.invoice.findMany as jest.Mock).mock.calls.at(-1)[0]
  it("first page: fetches page size + 1, no where cursor, next but no prev when more exist", async () => {
    ;(prisma.invoice.findMany as jest.Mock).mockResolvedValue(mk(51))
    const r = (await listInvoices()) as { rows: unknown[]; nextCursor: string | null; prevCursor: string | null }
    expect(lastWhere().take).toBe(51)
    expect(lastWhere().where).toEqual({})
    expect(lastWhere().orderBy).toEqual([{ issueDate: "desc" }, { id: "desc" }])
    expect(r.rows).toHaveLength(50)
    expect(r.nextCursor).toBe("2026-10-11_51")
    expect(r.prevCursor).toBeNull()
  })
  it("exactly a page of rows has no next", async () => {
    ;(prisma.invoice.findMany as jest.Mock).mockResolvedValue(mk(50))
    expect(await listInvoices()).toEqual(expect.objectContaining({ nextCursor: null, prevCursor: null }))
  })
  it("after: keyset where AND-ed with filters, prev cursor points at first row", async () => {
    ;(prisma.invoice.findMany as jest.Mock).mockResolvedValue(mk(3))
    const r = await listInvoices({ status: "SENT" as never, from: "2026-10-01", after: "2026-10-11_90" })
    const day = new Date("2026-10-11")
    expect(lastWhere().where).toEqual({
      status: "SENT", issueDate: { gte: new Date("2026-10-01") },
      AND: [{ OR: [{ issueDate: { lt: day } }, { issueDate: day, id: { lt: 90 } }] }],
    })
    expect(r).toEqual(expect.objectContaining({ prevCursor: "2026-10-11_100", nextCursor: null }))
  })
  it("keeps the full timestamp in the cursor so same-day rows past a page boundary aren't skipped", async () => {
    const rows = mk(51).map((r) => ({ ...r, issueDate: new Date("2026-10-11T09:30:00Z") }))
    ;(prisma.invoice.findMany as jest.Mock).mockResolvedValue(rows)
    const r = (await listInvoices()) as { nextCursor: string | null }
    expect(r.nextCursor).toBe("2026-10-11T09:30:00.000Z_51")
    await listInvoices({ after: r.nextCursor! })
    const stamp = new Date("2026-10-11T09:30:00Z")
    expect(lastWhere().where).toEqual({ AND: [{ OR: [{ issueDate: { lt: stamp } }, { issueDate: stamp, id: { lt: 51 } }] }] })
  })
  it("before: walks ascending, returns rows newest first, next always present", async () => {
    const asc = mk(3).reverse() // ids 98, 99, 100 as fetched ascending
    ;(prisma.invoice.findMany as jest.Mock).mockResolvedValue(asc)
    const r = (await listInvoices({ before: "2026-10-11_97" })) as { rows: { id: number }[]; nextCursor: string | null; prevCursor: string | null }
    const day = new Date("2026-10-11")
    expect(lastWhere().orderBy).toEqual([{ issueDate: "asc" }, { id: "asc" }])
    expect(lastWhere().where).toEqual({ AND: [{ OR: [{ issueDate: { gt: day } }, { issueDate: day, id: { gt: 97 } }] }] })
    expect(r.rows.map((x) => x.id)).toEqual([100, 99, 98])
    expect(r.nextCursor).toBe("2026-10-11_98")
    expect(r.prevCursor).toBeNull()
  })
  it("before with more rows behind sets prev from the newest visible row", async () => {
    ;(prisma.invoice.findMany as jest.Mock).mockResolvedValue(mk(51).reverse())
    const r = (await listInvoices({ before: "2026-10-11_1" })) as { rows: unknown[]; prevCursor: string | null }
    expect(r.rows).toHaveLength(50)
    expect(r.prevCursor).toBe("2026-10-11_99")
  })
  it("ignores a malformed cursor (first page) and prefers after over before", async () => {
    ;(prisma.invoice.findMany as jest.Mock).mockResolvedValue([])
    await listInvoices({ after: "garbage", before: "2026-10-11_0" })
    expect(lastWhere().where).toEqual({})
    // A present-but-malformed `after` still wins: first page, not a `before` walk.
    await listInvoices({ after: "garbage", before: "2026-10-11_9" })
    expect(lastWhere().where).toEqual({})
    expect(lastWhere().orderBy).toEqual([{ issueDate: "desc" }, { id: "desc" }])
    await listInvoices({ after: "2026-10-11_5", before: "2026-10-11_9" })
    expect(lastWhere().orderBy).toEqual([{ issueDate: "desc" }, { id: "desc" }])
  })
  it("rejects VIEWER", async () => { as("VIEWER"); expect(await listInvoices()).toEqual({ error: "Unauthorized" }) })
})

describe("getInvoiceSummary", () => {
  const period = { from: "2026-10-01", to: "2026-10-31" }
  it("rejects VIEWER", async () => {
    as("VIEWER")
    expect(await getInvoiceSummary(period)).toEqual({ error: "Unauthorized" })
    expect(prisma.invoice.aggregate).not.toHaveBeenCalled()
  })
  it("sums outstanding SENT and PAID-in-period totals in cents (AUDITOR may read)", async () => {
    as("AUDITOR")
    ;(prisma.invoice.aggregate as jest.Mock)
      .mockResolvedValueOnce({ _sum: { total: { toString: () => "160.00" } }, _count: { _all: 2 } })
      .mockResolvedValueOnce({ _sum: { total: { toString: () => "330.00" }, gstTotal: { toString: () => "30.00" } }, _count: { _all: 1 } })
    expect(await getInvoiceSummary(period)).toEqual({ outstandingCents: 16000, outstandingCount: 2, paidCents: 33000, paidCount: 1, gstCollectedCents: 3000 })
    expect(prisma.invoice.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "SENT" } }))
    expect(prisma.invoice.aggregate).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: "PAID", paidAt: { gte: new Date("2026-10-01"), lte: new Date("2026-10-31T23:59:59.999Z") } },
    }))
  })
  it.each([[{ from: "not-a-date", to: "2026-10-31" }], [{ from: "2026-10-01", to: "2026-02-30" }], [{ from: "2026-10-31", to: "2026-10-01" }]])("rejects an invalid period %j", async (bad) => {
    expect(await getInvoiceSummary(bad)).toEqual({ error: "Invalid period" })
    expect(prisma.invoice.aggregate).not.toHaveBeenCalled()
  })
  it("treats empty sums as zero", async () => {
    ;(prisma.invoice.aggregate as jest.Mock).mockResolvedValue({ _sum: { total: null, gstTotal: null }, _count: { _all: 0 } })
    expect(await getInvoiceSummary(period)).toEqual({ outstandingCents: 0, outstandingCount: 0, paidCents: 0, paidCount: 0, gstCollectedCents: 0 })
  })
})
