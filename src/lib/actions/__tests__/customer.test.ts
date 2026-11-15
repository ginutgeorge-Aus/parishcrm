jest.mock("@/lib/featureFlags")
import { createCustomer, updateCustomer, setCustomerActive, createCustomerInline, listCustomers } from "@/lib/actions/customer"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { logAuditTx } from "@/lib/audit"
import { AUDIT_FAILED_ERROR } from "@/lib/auditGuard"
import { redirect } from "next/navigation"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn(), logAuditTx: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("next/navigation", () => ({ redirect: jest.fn() }))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("@/lib/prisma", () => {
  // Interactive transactions run their callback against the same mocks (the tx client mirrors prisma).
  const prisma: Record<string, unknown> = { customer: { create: jest.fn(), update: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() } }
  prisma.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(prisma))
  return { prisma }
})

const mockAuth = auth as jest.Mock
const as = (role: string) => mockAuth.mockResolvedValue({ user: { id: "1", role } })
function fd(o: Record<string, string> = {}) {
  const f = new FormData()
  for (const [k, v] of Object.entries({ name: "Example Scouts", abn: "", email: "scouts@example.com", phone: "", address: "1 Example St", notes: "", ...o })) f.set(k, v)
  return f
}
beforeEach(() => { jest.clearAllMocks(); as("ADMIN"); (prisma.customer.create as jest.Mock).mockResolvedValue({ id: 9, name: "Example Scouts" }) })

describe("createCustomer", () => {
  it.each(["OFFICE_ADMIN", "AUDITOR", "VIEWER"])("rejects %s", async (r) => {
    as(r); expect(await createCustomer(undefined, fd())).toEqual({ error: "Unauthorized" })
  })
  it("encrypts contact fields, audits without PII, redirects", async () => {
    await createCustomer(undefined, fd())
    expect(prisma.customer.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      name: "Example Scouts", email: "enc:scouts@example.com", address: "enc:1 Example St", phone: null, notes: null, abn: null,
    }) })
    expect(logAuditTx).toHaveBeenCalledWith(prisma, 1, "CUSTOMER_CREATED", "Customer", 9, {})
    expect(redirect).toHaveBeenCalledWith("/accounting/customers")
  })
  it("rolls back and returns AUDIT_FAILED_ERROR when the audit write fails", async () => {
    ;(logAuditTx as jest.Mock).mockRejectedValueOnce(new Error("audit down"))
    expect(await createCustomer(undefined, fd())).toEqual({ error: AUDIT_FAILED_ERROR })
    expect(redirect).not.toHaveBeenCalled()
  })
  it("requires a name", async () => expect(await createCustomer(undefined, fd({ name: " " }))).toEqual({ error: "Name is required" }))
  it("validates email", async () => expect(await createCustomer(undefined, fd({ email: "x" }))).toEqual({ error: "Enter a valid email" }))
  it("validates ABN as 11 digits", async () => expect(await createCustomer(undefined, fd({ abn: "123" }))).toEqual({ error: "ABN must be 11 digits" }))
})

describe("updateCustomer / setCustomerActive", () => {
  it("updates and audits", async () => {
    ;(prisma.customer.update as jest.Mock).mockResolvedValue({ id: 9 })
    await updateCustomer(9, undefined, fd({ name: "Renamed" }))
    expect(prisma.customer.update).toHaveBeenCalledWith({ where: { id: 9 }, data: expect.objectContaining({ name: "Renamed" }) })
    expect(logAuditTx).toHaveBeenCalledWith(prisma, 1, "CUSTOMER_UPDATED", "Customer", 9, {})
  })
  it("update: audit failure maps to AUDIT_FAILED_ERROR, not 'not found'", async () => {
    ;(prisma.customer.update as jest.Mock).mockResolvedValue({ id: 9 })
    ;(logAuditTx as jest.Mock).mockRejectedValueOnce(new Error("audit down"))
    expect(await updateCustomer(9, undefined, fd())).toEqual({ error: AUDIT_FAILED_ERROR })
    expect(redirect).not.toHaveBeenCalled()
  })
  it("setCustomerActive: audit failure maps to AUDIT_FAILED_ERROR", async () => {
    ;(prisma.customer.update as jest.Mock).mockResolvedValue({ id: 9 })
    ;(logAuditTx as jest.Mock).mockRejectedValueOnce(new Error("audit down"))
    expect(await setCustomerActive(9, false)).toEqual({ error: AUDIT_FAILED_ERROR })
  })
  it("deactivates", async () => {
    ;(prisma.customer.update as jest.Mock).mockResolvedValue({ id: 9 })
    expect(await setCustomerActive(9, false)).toEqual({ success: "Customer deactivated" })
    expect(logAuditTx).toHaveBeenCalledWith(prisma, 1, "CUSTOMER_ACTIVE_SET", "Customer", 9, { isActive: false })
  })
})

describe("createCustomerInline", () => {
  it("audits in the transaction and rolls back on audit failure", async () => {
    await createCustomerInline({ name: "Example Scouts", email: "", address: "" })
    expect(logAuditTx).toHaveBeenCalledWith(prisma, 1, "CUSTOMER_CREATED", "Customer", 9, { inline: true })
    ;(logAuditTx as jest.Mock).mockRejectedValueOnce(new Error("audit down"))
    expect(await createCustomerInline({ name: "Example Scouts", email: "", address: "" })).toEqual({ error: AUDIT_FAILED_ERROR })
  })
  it("returns id and name", async () => {
    expect(await createCustomerInline({ name: "Example Scouts", email: "", address: "" })).toEqual({ id: 9, name: "Example Scouts" })
  })
  it("rejects AUDITOR", async () => { as("AUDITOR"); expect(await createCustomerInline({ name: "x", email: "", address: "" })).toEqual({ error: "Unauthorized" }) })
})

describe("listCustomers", () => {
  const row = { id: 9, name: "Example Scouts", abn: null, email: "enc:scouts@example.com", phone: null, address: "enc:1 Example St", notes: null, isActive: true }
  beforeEach(() => (prisma.customer.findMany as jest.Mock).mockResolvedValue([row]))
  it("decrypts for OFFICE_ADMIN", async () => {
    as("OFFICE_ADMIN"); expect(await listCustomers()).toEqual([expect.objectContaining({ email: "scouts@example.com", address: "1 Example St" })])
  })
  it("masks contact for AUDITOR", async () => {
    as("AUDITOR"); expect(await listCustomers()).toEqual([expect.objectContaining({ name: "Example Scouts", email: null, address: null, notes: null })])
  })
  it("rejects VIEWER", async () => { as("VIEWER"); expect(await listCustomers()).toEqual({ error: "Unauthorized" }) })
})
