/** @jest-environment node */
jest.mock("server-only", () => ({}))
jest.mock("@/lib/featureFlags")
jest.mock("@/lib/demoMode", () => ({ assertNotDemo: jest.fn(() => null), isDemoMode: jest.fn(() => false), DEMO_ERROR: "demo" }))
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn(async () => {}), logAuditTx: jest.fn(async () => {}) }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn(), unstable_cache: (fn: unknown) => fn }))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))

import { recordPayment, deletePayment } from "@/lib/actions/fundraiser"
import { auth } from "@/auth"
import { logAudit, logAuditTx } from "@/lib/audit"
import { revalidatePath } from "next/cache"

type Row = { entryId: number; stripePaymentRef: string | null; amount: string }

const prismaMock = {
  fundraiserEntry: { findUnique: jest.fn() },
  fundraiserPayment: { findUnique: jest.fn(), create: jest.fn(), deleteMany: jest.fn(async () => ({ count: 1 })) },
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
}
jest.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, { get: (_t, k) => (prismaMock as Record<string | symbol, unknown>)[k] }),
}))

// A tiny in-memory payments table so idempotency is checked on effect, not call counts.
let rows: Row[] = []

const input = { amount: "20.00", method: "CASH" as const, paidAt: "2026-11-01", submissionKey: "k-1" }

beforeEach(() => {
  jest.clearAllMocks()
  rows = []
  ;(auth as jest.Mock).mockResolvedValue({ user: { id: "5", role: "ADMIN" } })
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prismaMock))
  prismaMock.$queryRaw.mockResolvedValue([{ id: 11 }])
  // Entry owes 3 x 10.00 = 30.00; payments come from the in-memory table.
  prismaMock.fundraiserEntry.findUnique.mockImplementation(async () => ({
    id: 11, quantity: 3, unitPrice: "10.00", fundraiser: { eventId: 7 },
    payments: rows.map((r) => ({ amount: r.amount })),
  }))
  prismaMock.fundraiserPayment.findUnique.mockImplementation(async (a: { where: { stripePaymentRef: string } }) =>
    rows.find((r) => r.stripePaymentRef === a.where.stripePaymentRef) ?? null,
  )
  prismaMock.fundraiserPayment.create.mockImplementation(async (a: { data: Row }) => {
    if (rows.some((r) => r.stripePaymentRef === a.data.stripePaymentRef)) {
      throw Object.assign(new Error("unique"), { code: "P2002" })
    }
    rows.push({ entryId: a.data.entryId, stripePaymentRef: a.data.stripePaymentRef, amount: String(a.data.amount) })
    return { id: rows.length }
  })
})

describe("recordPayment", () => {
  it("records a payment with the manual submission key, locks the entry row, audits", async () => {
    expect(await recordPayment(11, input)).toBeUndefined()
    expect(prismaMock.$queryRaw).toHaveBeenCalled()
    expect(prismaMock.$transaction.mock.calls[0][1]).toMatchObject({ isolationLevel: "Serializable" })
    const data = prismaMock.fundraiserPayment.create.mock.calls[0][0].data
    expect(data).toMatchObject({ entryId: 11, amount: "20.00", method: "CASH", stripePaymentRef: "manual:k-1", recordedById: 5 })
    expect(data.paidAt).toEqual(new Date("2026-11-01T00:00:00.000Z"))
    expect(logAuditTx).toHaveBeenCalledWith(prismaMock, 5, "FUNDRAISER_PAYMENT_ADD", "FundraiserPayment", 1, expect.objectContaining({ amount: "20.00", method: "CASH" }))
    expect(revalidatePath).toHaveBeenCalledWith("/events/7/fundraiser")
  })

  it("rejects an amount over the remaining balance", async () => {
    expect(await recordPayment(11, { ...input, amount: "30.01" })).toEqual({ error: "Exceeds remaining balance" })
    expect(rows).toHaveLength(0)
  })

  it("accepts exactly the remaining balance", async () => {
    expect(await recordPayment(11, { ...input, amount: "30" })).toBeUndefined()
    expect(rows).toHaveLength(1)
  })

  it("same submissionKey twice: one row, second returns ok (not 'Exceeds remaining')", async () => {
    // First consumes the full balance, so a non-idempotent repeat would fail the remaining check.
    expect(await recordPayment(11, { ...input, amount: "30.00" })).toBeUndefined()
    expect(await recordPayment(11, { ...input, amount: "30.00" })).toBeUndefined()
    expect(rows).toHaveLength(1)
    expect(logAuditTx).toHaveBeenCalledTimes(1)
  })

  it("concurrent repeat losing on the unique constraint (P2002) is idempotent success", async () => {
    // Pre-check misses (the other request had not committed yet), create then collides.
    rows.push({ entryId: 11, stripePaymentRef: "manual:k-1", amount: "5.00" })
    prismaMock.fundraiserPayment.findUnique.mockResolvedValueOnce(null)
    expect(await recordPayment(11, input)).toBeUndefined()
    expect(rows).toHaveLength(1)
  })

  it("rejects a submissionKey already used on another entry", async () => {
    rows.push({ entryId: 99, stripePaymentRef: "manual:k-1", amount: "5.00" })
    expect((await recordPayment(11, input))?.error).toBeTruthy()
  })

  it.each(["abc", "0", "0.00", "-5", "1.234", "", "1e3"])("rejects amount %p", async (amount) => {
    expect((await recordPayment(11, { ...input, amount }))?.error).toBeTruthy()
    expect(prismaMock.fundraiserPayment.create).not.toHaveBeenCalled()
  })

  it.each(["2026-02-30", "01/11/2026", ""])("rejects paidAt %p", async (paidAt) => {
    expect((await recordPayment(11, { ...input, paidAt }))?.error).toBeTruthy()
  })

  it("rejects ONLINE (webhook-only) and blank submission key", async () => {
    expect((await recordPayment(11, { ...input, method: "ONLINE" as never }))?.error).toBeTruthy()
    expect((await recordPayment(11, { ...input, submissionKey: "" }))?.error).toBeTruthy()
    expect(prismaMock.fundraiserPayment.create).not.toHaveBeenCalled()
  })

  it("missing entry", async () => {
    prismaMock.$queryRaw.mockResolvedValue([])
    expect(await recordPayment(11, input)).toEqual({ error: "Entry not found" })
  })

  it("OFFICE_ADMIN allowed", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "5", role: "OFFICE_ADMIN" } })
    expect(await recordPayment(11, input)).toBeUndefined()
  })

  it.each(["AUDITOR", "VIEWER"])("blocks %s", async (role) => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "5", role } })
    expect(await recordPayment(11, input)).toEqual({ error: "Unauthorized" })
    expect(prismaMock.fundraiserPayment.create).not.toHaveBeenCalled()
  })
})

describe("deletePayment", () => {
  beforeEach(() => {
    prismaMock.fundraiserPayment.findUnique.mockResolvedValue({
      // Decimal-like: toString() drops trailing zeros, as Prisma's Decimal does.
      id: 4, entryId: 11, amount: { toString: () => "20", toFixed: (n: number) => (20).toFixed(n) }, method: "BANK",
      entry: { fundraiser: { eventId: 7 } },
    })
  })

  it("deletes and audits amount + method in one transaction", async () => {
    expect(await deletePayment(4)).toBeUndefined()
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(prismaMock.fundraiserPayment.deleteMany).toHaveBeenCalledWith({ where: { id: 4 } })
    expect(logAuditTx).toHaveBeenCalledWith(prismaMock, 5, "FUNDRAISER_PAYMENT_DELETE", "FundraiserPayment", 4, expect.objectContaining({ amount: "20.00", method: "BANK", entryId: 11 }))
    expect(logAudit).not.toHaveBeenCalled()
    expect(revalidatePath).toHaveBeenCalledWith("/events/7/fundraiser")
  })

  it("an audit write failure fails the delete (rolled back with it), not swallowed", async () => {
    ;(logAuditTx as jest.Mock).mockRejectedValueOnce(new Error("audit down"))
    await expect(deletePayment(4)).rejects.toThrow("audit down")
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("concurrent double-delete: second gets not found, no audit row", async () => {
    prismaMock.fundraiserPayment.deleteMany.mockResolvedValueOnce({ count: 0 })
    expect(await deletePayment(4)).toEqual({ error: "Payment not found" })
    expect(logAuditTx).not.toHaveBeenCalled()
  })

  it("blocks deleting an ONLINE (Stripe) payment, even for OFFICE_ADMIN", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "5", role: "OFFICE_ADMIN" } })
    prismaMock.fundraiserPayment.findUnique.mockResolvedValue({
      id: 4, entryId: 11, amount: { toString: () => "20", toFixed: (n: number) => (20).toFixed(n) }, method: "ONLINE",
      entry: { fundraiser: { eventId: 7 } },
    })
    expect(await deletePayment(4)).toEqual({ error: "Online payments must be refunded in Stripe" })
    expect(prismaMock.fundraiserPayment.deleteMany).not.toHaveBeenCalled()
    expect(logAudit).not.toHaveBeenCalled()
  })

  it("not found", async () => {
    prismaMock.fundraiserPayment.findUnique.mockResolvedValue(null)
    expect(await deletePayment(4)).toEqual({ error: "Payment not found" })
  })

  it("blocks AUDITOR", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "5", role: "AUDITOR" } })
    expect(await deletePayment(4)).toEqual({ error: "Unauthorized" })
    expect(prismaMock.fundraiserPayment.deleteMany).not.toHaveBeenCalled()
  })
})
