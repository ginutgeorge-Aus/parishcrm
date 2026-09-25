/** @jest-environment node */

import { createFund, deleteFund, updateFund, validateFund } from "../fund"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
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
  },
}))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
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
  mockAuth.mockResolvedValue({ user: { role: "ADMIN" } })
  ;(prisma.fund.findUnique as jest.Mock).mockResolvedValue({ id: 1 })
  const r = await createFund(undefined, fd({ name: "General" }))
  expect(r).toEqual({ error: "A fund with this name already exists" })
})

test("deleteFund blocked when referenced", async () => {
  mockAuth.mockResolvedValue({ user: { role: "ADMIN" } })
  ;(prisma.fund.findUnique as jest.Mock).mockResolvedValue({ id: 2, name: "Building" })
  ;(prisma.transaction.count as jest.Mock).mockResolvedValue(3)
  ;(prisma.pettyCashReceipt.count as jest.Mock).mockResolvedValue(0)
  ;(prisma.pettyCashExpense.count as jest.Mock).mockResolvedValue(0)
  const r = await deleteFund(2)
  expect(r).toEqual({ error: "Reassign or remove entries in this fund first." })
})

test("deleteFund blocks the General fund", async () => {
  mockAuth.mockResolvedValue({ user: { role: "ADMIN" } })
  ;(prisma.fund.findUnique as jest.Mock).mockResolvedValue({ id: 1, name: "General" })
  const r = await deleteFund(1)
  expect(r).toEqual({ error: "The General fund cannot be deleted." })
})

test("deleteFund runs the count-and-delete inside one Serializable transaction", async () => {
  mockAuth.mockResolvedValue({ user: { role: "ADMIN" } })
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
  mockAuth.mockResolvedValue({ user: { role: "ADMIN" } })
  ;(prisma.fund.findUnique as jest.Mock).mockResolvedValue({ id: 2, name: "Building" })
  // A concurrent referencing insert aborts the Serializable transaction.
  mockPrismaTransaction.mockRejectedValueOnce(Object.assign(new Error("serialization failure"), { code: "P2034" }))
  const r = await deleteFund(2)
  expect(r).toEqual({ error: "Reassign or remove entries in this fund first." })
})

test("deleteFund does not delete when a reference is found inside the transaction", async () => {
  mockAuth.mockResolvedValue({ user: { role: "ADMIN" } })
  ;(prisma.fund.findUnique as jest.Mock).mockResolvedValue({ id: 2, name: "Building" })
  ;(prisma.transaction.count as jest.Mock).mockResolvedValue(1)
  ;(prisma.pettyCashReceipt.count as jest.Mock).mockResolvedValue(0)
  ;(prisma.pettyCashExpense.count as jest.Mock).mockResolvedValue(0)
  const r = await deleteFund(2)
  expect(r).toEqual({ error: "Reassign or remove entries in this fund first." })
  expect(prisma.fund.delete).not.toHaveBeenCalled()
})

test("deleteFund rethrows a non-P2034 transaction error instead of swallowing it", async () => {
  mockAuth.mockResolvedValue({ user: { role: "ADMIN" } })
  ;(prisma.fund.findUnique as jest.Mock).mockResolvedValue({ id: 2, name: "Building" })
  // Anything other than a P2034 serialization conflict (e.g. a dropped
  // connection) must propagate — not be mistaken for "reassign first" and not
  // silently resolve as a success.
  mockPrismaTransaction.mockRejectedValueOnce(new Error("connection reset"))
  await expect(deleteFund(2)).rejects.toThrow("connection reset")
  expect(prisma.fund.delete).not.toHaveBeenCalled()
})

test("updateFund blocks renaming the General fund", async () => {
  mockAuth.mockResolvedValue({ user: { role: "ADMIN" } })
  ;(prisma.fund.findUnique as jest.Mock).mockResolvedValue({ id: 1, name: "General" })
  const r = await updateFund(1, undefined, fd({ name: "Building" }))
  expect(r).toEqual({ error: "The General fund cannot be renamed." })
})

test("validateFund true for existing active fund", async () => {
  mockAuth.mockResolvedValue({ user: { role: "ADMIN" } })
  ;(prisma.fund.findUnique as jest.Mock).mockResolvedValue({ id: 5, isActive: true })
  expect(await validateFund(5)).toBe(true)
})

test("validateFund false for missing fund", async () => {
  mockAuth.mockResolvedValue({ user: { role: "ADMIN" } })
  ;(prisma.fund.findUnique as jest.Mock).mockResolvedValue(null)
  expect(await validateFund(999)).toBe(false)
})

test("validateFund rejects an inactive fund by default (create path)", async () => {
  mockAuth.mockResolvedValue({ user: { role: "ADMIN" } })
  ;(prisma.fund.findUnique as jest.Mock).mockResolvedValue({ id: 6, isActive: false })
  expect(await validateFund(6)).toBe(false)
})

test("validateFund allows an inactive fund with allowInactive (update path)", async () => {
  mockAuth.mockResolvedValue({ user: { role: "ADMIN" } })
  ;(prisma.fund.findUnique as jest.Mock).mockResolvedValue({ id: 6, isActive: false })
  expect(await validateFund(6, { allowInactive: true })).toBe(true)
})
