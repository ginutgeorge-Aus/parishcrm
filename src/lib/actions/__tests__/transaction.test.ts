/** @jest-environment node */

import { createTransaction, updateTransaction } from "../transaction"
import { toggleReconciled, reconcileMany } from "../transactionReconcile"
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => {
    throw new Error("REDIRECT")
  }),
}))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/accountingLock", () => ({ assertUnlocked: jest.fn().mockResolvedValue(null) }))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    account: { findUnique: jest.fn() },
    fund: { findUnique: jest.fn() },
    family: { findUnique: jest.fn() },
    person: { findUnique: jest.fn() },
    paymentAccount: { findUnique: jest.fn() },
    transaction: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
  },
}))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { assertUnlocked } from "@/lib/accountingLock"
import { logAudit } from "@/lib/audit"
const mockAuth = auth as jest.Mock
const mockAssertUnlocked = assertUnlocked as jest.Mock
const mockLogAudit = logAudit as jest.Mock

function fd(o: Record<string, string>) {
  const f = new FormData()
  for (const k in o) f.set(k, o[k])
  return f
}

// A valid INCOME transaction form. Override individual fields per test.
function validForm(over: Record<string, string> = {}) {
  return fd({
    date: "2026-07-05",
    description: "Sunday offering",
    accountId: "2",
    type: "INCOME",
    amount: "100.00",
    paymentAccountId: "1",
    ...over,
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
  ;(prisma.account.findUnique as jest.Mock).mockResolvedValue({ type: "INCOME", isActive: true, name: "Offering" })
  ;(prisma.paymentAccount.findUnique as jest.Mock).mockResolvedValue({ kind: "BANK", isActive: true })
  ;(prisma.family.findUnique as jest.Mock).mockResolvedValue({ id: 7 })
  ;(prisma.transaction.findMany as jest.Mock).mockResolvedValue([])
  ;(prisma.transaction.create as jest.Mock).mockResolvedValue({ id: 1 })
  ;(prisma.transaction.findUnique as jest.Mock).mockResolvedValue({
    id: 1,
    date: new Date("2026-07-01T00:00:00.000Z"),
    reconciled: false,
    pettyCashReceiptId: null,
    pettyCashExpenseId: null,
    pettyCashTransferId: null,
    paymentAccountId: 1,
  })
  ;(prisma.transaction.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
  ;(prisma.transaction.update as jest.Mock).mockResolvedValue({ id: 1 })
})

test("rejects a non-accounting role", async () => {
  mockAuth.mockResolvedValue({ user: { role: "VIEWER", id: "1" } })
  const r = await createTransaction(undefined, validForm())
  expect(r).toEqual({ error: "Unauthorized" })
})

// Bug #1: amount has no magnitude bound, so a value that overflows the
// Decimal(10,2) column (max 99,999,999.99) reaches Prisma and 500s. The 15-char
// length cap does not catch it. Mirrors reconciliation.ts's "Amount too large".
test("rejects an amount that overflows the Decimal(10,2) column", async () => {
  const r = await createTransaction(undefined, validForm({ amount: "100000000.00" }))
  expect(r).toEqual({ error: "Amount too large" })
  expect(prisma.transaction.create).not.toHaveBeenCalled()
})

test("accepts the largest in-range amount", async () => {
  await expect(createTransaction(undefined, validForm({ amount: "99999999.99" }))).rejects.toThrow("REDIRECT")
  expect(prisma.transaction.create).toHaveBeenCalled()
})

test("derives isGiving from familyId, never from input", async () => {
  await expect(createTransaction(undefined, validForm({ familyId: "7" }))).rejects.toThrow("REDIRECT")
  expect((prisma.transaction.create as jest.Mock).mock.calls[0][0].data).toMatchObject({ isGiving: true, familyId: 7 })
})

test("isGiving is false with no family", async () => {
  await expect(createTransaction(undefined, validForm())).rejects.toThrow("REDIRECT")
  expect((prisma.transaction.create as jest.Mock).mock.calls[0][0].data).toMatchObject({ isGiving: false })
})

test("encrypts the description on write", async () => {
  await expect(createTransaction(undefined, validForm({ description: "Tithe" }))).rejects.toThrow("REDIRECT")
  expect((prisma.transaction.create as jest.Mock).mock.calls[0][0].data.description).toBe("enc:Tithe")
})

test("never persists the confirmDuplicate form flag", async () => {
  await expect(createTransaction(undefined, validForm({ confirmDuplicate: "true" }))).rejects.toThrow("REDIRECT")
  const data = (prisma.transaction.create as jest.Mock).mock.calls[0][0].data
  expect(data).not.toHaveProperty("confirmDuplicate")
  // confirmDuplicate bypasses the duplicate scan entirely.
  expect(prisma.transaction.findMany).not.toHaveBeenCalled()
})

test("warns on a likely duplicate instead of posting", async () => {
  ;(prisma.transaction.findMany as jest.Mock).mockResolvedValue([{ description: "enc:Sunday offering" }])
  const r = await createTransaction(undefined, validForm())
  expect(r).toMatchObject({ duplicateWarning: true })
  expect(prisma.transaction.create).not.toHaveBeenCalled()
})

// --- updateTransaction guards ---

test("updateTransaction rejects editing a reconciled row", async () => {
  ;(prisma.transaction.findUnique as jest.Mock).mockResolvedValue({
    id: 1,
    date: new Date("2026-07-01T00:00:00.000Z"),
    reconciled: true,
    pettyCashReceiptId: null,
    pettyCashExpenseId: null,
    pettyCashTransferId: null,
    paymentAccountId: 1,
  })
  const r = await updateTransaction(1, undefined, validForm())
  expect(r).toEqual({
    error: "This transaction is reconciled. Un-reconcile it on the Reconciliation page before editing.",
  })
  expect(prisma.transaction.updateMany).not.toHaveBeenCalled()
  expect(mockLogAudit).not.toHaveBeenCalled()
})

test("updateTransaction rejects editing a petty-cash-linked row", async () => {
  ;(prisma.transaction.findUnique as jest.Mock).mockResolvedValue({
    id: 1,
    date: new Date("2026-07-01T00:00:00.000Z"),
    reconciled: false,
    pettyCashReceiptId: null,
    pettyCashExpenseId: 5,
    pettyCashTransferId: null,
    paymentAccountId: 1,
  })
  const r = await updateTransaction(1, undefined, validForm())
  expect(r).toEqual({
    error: "Petty cash transactions cannot be edited here — edit via the petty cash session",
  })
  expect(prisma.transaction.updateMany).not.toHaveBeenCalled()
  expect(mockLogAudit).not.toHaveBeenCalled()
})

test("updateTransaction rejects when the row's stored date is in a locked period", async () => {
  mockAssertUnlocked.mockResolvedValueOnce(
    "This date is in a locked accounting period (on or before 2026-06-30)."
  )
  const r = await updateTransaction(1, undefined, validForm())
  expect(r).toEqual({ error: "This date is in a locked accounting period (on or before 2026-06-30)." })
  expect(prisma.transaction.updateMany).not.toHaveBeenCalled()
  expect(mockLogAudit).not.toHaveBeenCalled()
  // Only the stored-date check ran before the early return.
  expect(mockAssertUnlocked).toHaveBeenCalledTimes(1)
})

test("updateTransaction rejects when the submitted (re-dated) date is in a locked period", async () => {
  mockAssertUnlocked
    .mockResolvedValueOnce(null) // stored date passes
    .mockResolvedValueOnce("This date is in a locked accounting period (on or before 2026-07-31).")
  const r = await updateTransaction(1, undefined, validForm({ date: "2026-08-01" }))
  expect(r).toEqual({ error: "This date is in a locked accounting period (on or before 2026-07-31)." })
  expect(prisma.transaction.updateMany).not.toHaveBeenCalled()
  expect(mockLogAudit).not.toHaveBeenCalled()
  expect(mockAssertUnlocked).toHaveBeenCalledTimes(2)
})

test("updateTransaction returns a concurrency error when the optimistic update matches 0 rows", async () => {
  ;(prisma.transaction.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
  const r = await updateTransaction(1, undefined, validForm())
  expect(r).toEqual({
    error: "This transaction was changed by someone else since you opened it. Reload the page and reapply your edit.",
  })
  expect(mockLogAudit).not.toHaveBeenCalled()
})

// --- toggleReconciled / reconcileMany IDOR guard ---
// Both live in transaction.ts (not reconciliation.ts, despite the name).

test("toggleReconciled rejects a crafted id whose paymentAccountId doesn't match the expected account", async () => {
  ;(prisma.transaction.findUnique as jest.Mock).mockResolvedValue({
    id: 1,
    date: new Date("2026-07-01T00:00:00.000Z"),
    reconciled: false,
    paymentAccountId: 2,
  })
  const r = await toggleReconciled(1, 1)
  expect(r).toEqual({ error: "Not found" })
  expect(prisma.transaction.update).not.toHaveBeenCalled()
  expect(mockLogAudit).not.toHaveBeenCalled()
})

test("reconcileMany rejects the whole batch when one selected id belongs to a different account, flips zero rows", async () => {
  ;(prisma.transaction.findMany as jest.Mock).mockResolvedValue([
    { id: 1, date: new Date("2026-07-01T00:00:00.000Z"), paymentAccountId: 1, reconciled: false },
    { id: 2, date: new Date("2026-07-02T00:00:00.000Z"), paymentAccountId: 2, reconciled: false },
  ])
  const r = await reconcileMany([1, 2], 1)
  expect(r).toEqual({ error: "Not found" })
  expect(prisma.transaction.updateMany).not.toHaveBeenCalled()
  expect(mockLogAudit).not.toHaveBeenCalled()
})
