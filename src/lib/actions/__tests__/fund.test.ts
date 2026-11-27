/** @jest-environment node */

jest.mock("@/lib/featureFlags")
import { createFund, deleteFund, updateFund, validateFund } from "../fund"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(true) }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => {
    throw new Error("REDIRECT")
  }),
}))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: jest.fn(),
    fund: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    transaction: { count: jest.fn() },
    pettyCashReceipt: { count: jest.fn() },
    pettyCashExpense: { count: jest.fn() },
    invoice: { count: jest.fn().mockResolvedValue(0) },
  },
}))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
const mockAuth = auth as jest.Mock
const mockPrismaTransaction = prisma.$transaction as jest.Mock

function fd(o: Record<string, string>) {
  const f = new FormData()
  for (const k in o) f.set(k, o[k])
  return f
}

beforeEach(() => {
  jest.clearAllMocks()
  // Interactive $transaction callback runs against the same mocked prisma client.
  mockPrismaTransaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma))
})

test("createFund rejects non-admin", async () => {
  mockAuth.mockResolvedValue({ user: { role: "PASTOR" } })
  const r = await createFund(undefined, fd({ name: "Building" }))
  expect(r).toEqual({ error: "Unauthorized" })
})

test("createFund rejects duplicate name", async () => {
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  ;(prisma.fund.findUnique as jest.Mock).mockResolvedValue({ id: 1 })
  const r = await createFund(undefined, fd({ name: "General" }))
  expect(r).toEqual({ error: "A fund with this name already exists" })
})

test("deleteFund blocked when referenced", async () => {
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  ;(prisma.fund.findUnique as jest.Mock).mockResolvedValue({ id: 2, name: "Building" })
  ;(prisma.transaction.count as jest.Mock).mockResolvedValue(3)
  ;(prisma.pettyCashReceipt.count as jest.Mock).mockResolvedValue(0)
  ;(prisma.pettyCashExpense.count as jest.Mock).mockResolvedValue(0)
  const r = await deleteFund(2)
  expect(r).toEqual({ error: "Reassign or remove entries in this fund first." })
})

test("deleteFund blocked when only invoices reference it", async () => {
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  ;(prisma.fund.findUnique as jest.Mock).mockResolvedValue({ id: 2, name: "Building" })
  ;(prisma.transaction.count as jest.Mock).mockResolvedValue(0)
  ;(prisma.pettyCashReceipt.count as jest.Mock).mockResolvedValue(0)
  ;(prisma.pettyCashExpense.count as jest.Mock).mockResolvedValue(0)
  ;(prisma.invoice.count as jest.Mock).mockResolvedValueOnce(1)
  const r = await deleteFund(2)
  expect(r).toEqual({ error: "Reassign or remove entries in this fund first." })
})

test("deleteFund blocks the General fund", async () => {
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  ;(prisma.fund.findUnique as jest.Mock).mockResolvedValue({ id: 1, name: "General" })
  const r = await deleteFund(1)
  expect(r).toEqual({ error: "The General fund cannot be deleted." })
})

test("deleteFund runs the count-and-delete inside one Serializable transaction", async () => {
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  ;(prisma.fund.findUnique as jest.Mock).mockResolvedValue({ id: 2, name: "Building" })
  ;(prisma.transaction.count as jest.Mock).mockResolvedValue(0)
  ;(prisma.pettyCashReceipt.count as jest.Mock).mockResolvedValue(0)
  ;(prisma.pettyCashExpense.count as jest.Mock).mockResolvedValue(0)
  const r = await deleteFund(2)
  expect(r).toBeUndefined()
  expect(mockPrismaTransaction).toHaveBeenCalledTimes(1)
  // Second arg must request Serializable — READ COMMITTED leaves the count→delete race open.
  expect(mockPrismaTransaction.mock.calls[0][1]).toEqual({ isolationLevel: "Serializable" })
  expect(prisma.fund.delete).toHaveBeenCalledWith({ where: { id: 2 } })
})

test("deleteFund translates a P2034 serialization conflict into the reassign message", async () => {
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  ;(prisma.fund.findUnique as jest.Mock).mockResolvedValue({ id: 2, name: "Building" })
  // A concurrent referencing insert aborts the Serializable transaction.
  mockPrismaTransaction.mockRejectedValueOnce(Object.assign(new Error("serialization failure"), { code: "P2034" }))
  const r = await deleteFund(2)
  expect(r).toEqual({ error: "Reassign or remove entries in this fund first." })
})

test("deleteFund does not delete when a reference is found inside the transaction", async () => {
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  ;(prisma.fund.findUnique as jest.Mock).mockResolvedValue({ id: 2, name: "Building" })
  ;(prisma.transaction.count as jest.Mock).mockResolvedValue(1)
  ;(prisma.pettyCashReceipt.count as jest.Mock).mockResolvedValue(0)
  ;(prisma.pettyCashExpense.count as jest.Mock).mockResolvedValue(0)
  const r = await deleteFund(2)
  expect(r).toEqual({ error: "Reassign or remove entries in this fund first." })
  expect(prisma.fund.delete).not.toHaveBeenCalled()
})

test("deleteFund rethrows a non-P2034 transaction error instead of swallowing it", async () => {
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  ;(prisma.fund.findUnique as jest.Mock).mockResolvedValue({ id: 2, name: "Building" })
  // Anything other than a P2034 serialization conflict (e.g. a dropped
  // connection) must propagate — not be mistaken for "reassign first" and not
  // silently resolve as a success.
  mockPrismaTransaction.mockRejectedValueOnce(new Error("connection reset"))
  await expect(deleteFund(2)).rejects.toThrow("connection reset")
  expect(prisma.fund.delete).not.toHaveBeenCalled()
})

test("updateFund blocks renaming the General fund", async () => {
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  ;(prisma.fund.findUnique as jest.Mock).mockResolvedValue({ id: 1, name: "General" })
  const r = await updateFund(1, undefined, fd({ name: "Building" }))
  expect(r).toEqual({ error: "The General fund cannot be renamed." })
})

test("validateFund true for existing active fund", async () => {
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  ;(prisma.fund.findUnique as jest.Mock).mockResolvedValue({ id: 5, isActive: true })
  expect(await validateFund(5)).toBe(true)
})

test("validateFund false for missing fund", async () => {
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  ;(prisma.fund.findUnique as jest.Mock).mockResolvedValue(null)
  expect(await validateFund(999)).toBe(false)
})

test("validateFund rejects an inactive fund by default (create path)", async () => {
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  ;(prisma.fund.findUnique as jest.Mock).mockResolvedValue({ id: 6, isActive: false })
  expect(await validateFund(6)).toBe(false)
})

test("validateFund allows an inactive fund with allowInactive (update path)", async () => {
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  ;(prisma.fund.findUnique as jest.Mock).mockResolvedValue({ id: 6, isActive: false })
  expect(await validateFund(6, { allowInactive: true })).toBe(true)
})

test("deleteFund writes an audit row (AUD-3-10)", async () => {
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  ;(prisma.fund.findUnique as jest.Mock).mockResolvedValue({ id: 2, name: "Building" })
  ;(prisma.transaction.count as jest.Mock).mockResolvedValue(0)
  ;(prisma.pettyCashReceipt.count as jest.Mock).mockResolvedValue(0)
  ;(prisma.pettyCashExpense.count as jest.Mock).mockResolvedValue(0)
  await deleteFund(2)
  expect(logAudit).toHaveBeenCalledWith(1, "FUND_DELETED", "Fund", 2, { name: "Building" })
})

test("updateFund returns 'Fund not found' when the fund vanishes before the in-transaction re-read", async () => {
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  ;(prisma.fund.findUnique as jest.Mock).mockResolvedValueOnce({ id: 2, name: "Earlier", isActive: true, sortOrder: 0 }).mockResolvedValueOnce(null).mockResolvedValueOnce(null)
  const r = await updateFund(2, undefined, fd({ name: "Hall", isActive: "on", sortOrder: "3" }))
  expect(r).toEqual({ error: "Fund not found" })
  expect(prisma.fund.update).not.toHaveBeenCalled()
  expect(logAudit).not.toHaveBeenCalled()
})

test("updateFund maps a concurrent-rename P2002 to the duplicate-name error", async () => {
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  ;(prisma.fund.findUnique as jest.Mock).mockResolvedValueOnce({ id: 2, name: "Earlier", isActive: true, sortOrder: 0 }).mockResolvedValueOnce(null)
  mockPrismaTransaction.mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }))
  const r = await updateFund(2, undefined, fd({ name: "Hall", isActive: "on", sortOrder: "3" }))
  expect(r).toEqual({ error: "A fund with this name already exists" })
})

test("updateFund maps a P2034 serialization conflict to a retry message", async () => {
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  ;(prisma.fund.findUnique as jest.Mock).mockResolvedValueOnce({ id: 2, name: "Earlier", isActive: true, sortOrder: 0 }).mockResolvedValueOnce(null)
  mockPrismaTransaction.mockRejectedValueOnce(Object.assign(new Error("conflict"), { code: "P2034" }))
  const r = await updateFund(2, undefined, fd({ name: "Hall", isActive: "on", sortOrder: "3" }))
  expect(r).toEqual({ error: "This fund was changed at the same time by someone else — try again." })
})

test("updateFund rethrows an unexpected transaction error", async () => {
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  ;(prisma.fund.findUnique as jest.Mock).mockResolvedValueOnce({ id: 2, name: "Earlier", isActive: true, sortOrder: 0 }).mockResolvedValueOnce(null)
  mockPrismaTransaction.mockRejectedValueOnce(new Error("connection dropped"))
  await expect(updateFund(2, undefined, fd({ name: "Hall", isActive: "on", sortOrder: "3" }))).rejects.toThrow("connection dropped")
})

test("updateFund records before and after (AUD-3-10)", async () => {
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  ;(prisma.fund.findUnique as jest.Mock).mockResolvedValueOnce({ id: 2, name: "Earlier", isActive: true, sortOrder: 0 }).mockResolvedValueOnce(null).mockResolvedValueOnce({ name: "Building", isActive: true, sortOrder: 0 })
  await expect(updateFund(2, undefined, fd({ name: "Hall", isActive: "on", sortOrder: "3" }))).rejects.toThrow("REDIRECT")
  expect(logAudit).toHaveBeenCalledWith(1, "FUND_UPDATED", "Fund", 2, {
    before: { name: "Building", isActive: true, sortOrder: 0 },
    after: { name: "Hall", isActive: true, sortOrder: 3 },
  })
})

// guardedAction migration (audit idea 83): client-controlled argument shapes never reach Prisma.
describe("argument shapes (guardedAction)", () => {
  beforeEach(() => mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } }))

  test("deleteFund rejects an object id before any lookup", async () => {
    expect(await deleteFund({ gt: 0 } as unknown as number)).toEqual({ error: "Invalid ID" })
    expect(prisma.fund.findUnique).not.toHaveBeenCalled()
    expect(mockPrismaTransaction).not.toHaveBeenCalled()
  })

  test("updateFund rejects a non-FormData body", async () => {
    const r = await updateFund(2, undefined, { name: "Hall" } as unknown as FormData)
    expect(r).toEqual({ error: "Invalid form data" })
    expect(prisma.fund.update).not.toHaveBeenCalled()
  })

  test("createFund still refuses a non-admin before reading the form", async () => {
    mockAuth.mockResolvedValue({ user: { id: "2", role: "OFFICE_ADMIN" } })
    expect(await createFund(undefined, "junk" as unknown as FormData)).toEqual({ error: "Unauthorized" })
  })

  test("validateFund is false for an object id or unknown option keys, with no query", async () => {
    expect(await validateFund({ not: 0 } as unknown as number)).toBe(false)
    expect(await validateFund(5, { allowInactive: true, where: {} } as unknown as { allowInactive: boolean })).toBe(false)
    expect(prisma.fund.findUnique).not.toHaveBeenCalled()
  })

  test("validateFund refuses a non-accounting role with false", async () => {
    mockAuth.mockResolvedValue({ user: { id: "3", role: "VIEWER" } })
    expect(await validateFund(5)).toBe(false)
    expect(prisma.fund.findUnique).not.toHaveBeenCalled()
  })
})
