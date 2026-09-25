/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    account: {
      findUnique: jest.fn(),
    },
    paymentAccount: {
      findUnique: jest.fn(),
    },
    family: {
      findUnique: jest.fn(),
    },
    person: {
      findUnique: jest.fn(),
    },
  },
}))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("next/navigation", () => ({ redirect: jest.fn() }))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  decrypt: jest.fn((v: string) => {
    if (v.includes("CORRUPT")) throw new Error("Decryption failed: unknown key id")
    return v.replace(/^enc:/, "")
  }),
  // Mirrors the real safeDecrypt contract (crypto-core.ts): never throws,
  // returns a sentinel placeholder on failure instead.
  safeDecrypt: jest.fn((v: string) => {
    if (v.includes("CORRUPT")) return "[decryption error]"
    return v.replace(/^enc:/, "")
  }),
}))

jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))
jest.mock("@/lib/accountingLock", () => ({ assertUnlocked: jest.fn().mockResolvedValue(null) }))

import { auth } from "@/auth"
import { logAudit } from "@/lib/audit"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { createTransaction, updateTransaction, deleteTransaction } from "@/lib/actions/transaction"
import { toggleReconciled, reconcileMany } from "@/lib/actions/transactionReconcile"
import { encrypt } from "@/lib/crypto"
import { assertUnlocked } from "@/lib/accountingLock"

const mockSession = auth as jest.Mock
const mockCreate = prisma.transaction.create as jest.Mock
const mockUpdate = prisma.transaction.update as jest.Mock
const mockDelete = prisma.transaction.delete as jest.Mock
const mockFindUnique = prisma.transaction.findUnique as jest.Mock
const mockFindMany = prisma.transaction.findMany as jest.Mock
const mockUpdateMany = prisma.transaction.updateMany as jest.Mock
const mockAccountFindUnique = prisma.account.findUnique as jest.Mock
const mockPaymentAccountFindUnique = prisma.paymentAccount.findUnique as jest.Mock
const mockFamilyFindUnique = prisma.family.findUnique as jest.Mock
const mockPersonFindUnique = prisma.person.findUnique as jest.Mock
const mockRevalidate = revalidatePath as jest.Mock
const mockRedirect = redirect as unknown as jest.Mock
const mockLogAudit = logAudit as jest.Mock
const mockAssertUnlocked = assertUnlocked as jest.Mock

function fd(fields: Record<string, string>) {
  const f = new FormData()
  Object.entries(fields).forEach(([k, v]) => f.set(k, v))
  return f
}

const validTx = {
  date: "2026-05-17",
  description: "Sunday offering",
  accountId: "4001",
  type: "INCOME",
  amount: "500",
  paymentAccountId: "1",
}

beforeEach(() => {
  jest.clearAllMocks()
  // createTransaction reads the created row's id for audit logging
  mockCreate.mockResolvedValue({ id: 1 })
  // No likely-duplicate candidates by default — individual tests
  // override this to simulate a matching prior transaction.
  mockFindMany.mockResolvedValue([])
  // Default payment account: an active BANK-kind account, matching validTx's
  // paymentAccountId. Individual tests override to test the CASH-kind guard.
  mockPaymentAccountFindUnique.mockResolvedValue({ kind: "BANK", isActive: true })
})

// --- createTransaction ---
describe("createTransaction", () => {
  it("blocks unauthenticated", async () => {
    mockSession.mockResolvedValue(null)
    const result = await createTransaction(undefined, fd(validTx))
    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("blocks VIEWER role", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "VIEWER" } })
    const result = await createTransaction(undefined, fd(validTx))
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("blocks AUDITOR role", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "AUDITOR" } })
    const result = await createTransaction(undefined, fd(validTx))
    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("allows PASTOR role", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    mockAccountFindUnique.mockResolvedValue({ type: "INCOME", isActive: true })
    await createTransaction(undefined, fd(validTx))
    expect(mockCreate).toHaveBeenCalled()
  })

  it("returns validation error for missing description", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const result = await createTransaction(undefined, fd({ ...validTx, description: "" }))
    expect(result).toEqual({ error: "Description is required" })
  })

  it("rejects a CASH-kind payment account — mirrored rows come only from petty-cash actions", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockAccountFindUnique.mockResolvedValue({ type: "INCOME", isActive: true })
    mockPaymentAccountFindUnique.mockResolvedValue({ kind: "CASH", isActive: true })
    const result = await createTransaction(undefined, fd({ ...validTx, paymentAccountId: "3" }))
    expect(result).toEqual({ error: "Invalid payment account" })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("returns validation error for zero amount", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const result = await createTransaction(undefined, fd({ ...validTx, amount: "0" }))
    expect(result).toEqual({ error: "Amount must be positive" })
  })

  it("rejects a malformed date instead of forwarding Invalid Date to Prisma", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockAccountFindUnique.mockResolvedValue({ type: "INCOME", isActive: true })
    const result = await createTransaction(undefined, fd({ ...validTx, date: "not-a-date" }))
    expect(result).toEqual({ error: "Invalid date" })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("rejects an out-of-range date string", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockAccountFindUnique.mockResolvedValue({ type: "INCOME", isActive: true })
    const result = await createTransaction(undefined, fd({ ...validTx, date: "2026-99-01" }))
    expect(result).toEqual({ error: "Invalid date" })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("rejects an amount with more than 2 decimal places", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockAccountFindUnique.mockResolvedValue({ type: "INCOME", isActive: true })
    const result = await createTransaction(undefined, fd({ ...validTx, amount: "10.999" }))
    expect(result).toEqual({ error: "Amount must be positive" })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("rejects a negative amount", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockAccountFindUnique.mockResolvedValue({ type: "INCOME", isActive: true })
    const result = await createTransaction(undefined, fd({ ...validTx, amount: "-10.00" }))
    expect(result).toEqual({ error: "Amount must be positive" })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("passes the amount to the Decimal column as a string, not a float", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockAccountFindUnique.mockResolvedValue({ type: "INCOME", isActive: true })
    await createTransaction(undefined, fd({ ...validTx, amount: "10.99" }))
    const arg = mockCreate.mock.calls[0][0]
    expect(arg.data.amount).toBe("10.99")
    expect(typeof arg.data.amount).toBe("string")
  })

  it("sets isGiving=true when familyId provided", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockAccountFindUnique.mockResolvedValue({ type: "INCOME", isActive: true })
    mockFamilyFindUnique.mockResolvedValue({ id: 3 })
    await createTransaction(undefined, fd({ ...validTx, familyId: "3" }))
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ isGiving: true, familyId: 3 }),
    })
  })

  it("rejects a non-existent familyId", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockAccountFindUnique.mockResolvedValue({ type: "INCOME", isActive: true })
    mockFamilyFindUnique.mockResolvedValue(null)
    const result = await createTransaction(undefined, fd({ ...validTx, familyId: "999" }))
    expect(result).toEqual({ error: "Invalid family" })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("rejects a non-existent personId", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockAccountFindUnique.mockResolvedValue({ type: "INCOME", isActive: true })
    mockFamilyFindUnique.mockResolvedValue({ id: 3 })
    mockPersonFindUnique.mockResolvedValue(null)
    const result = await createTransaction(undefined, fd({ ...validTx, familyId: "3", personId: "999" }))
    expect(result).toEqual({ error: "Invalid person" })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("rejects a person belonging to a different family", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockAccountFindUnique.mockResolvedValue({ type: "INCOME", isActive: true })
    mockFamilyFindUnique.mockResolvedValue({ id: 3 })
    mockPersonFindUnique.mockResolvedValue({ id: 5, familyId: 7 })
    const result = await createTransaction(undefined, fd({ ...validTx, familyId: "3", personId: "5" }))
    expect(result).toEqual({ error: "Person does not belong to the selected family" })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("accepts a person belonging to the selected family", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockAccountFindUnique.mockResolvedValue({ type: "INCOME", isActive: true })
    mockFamilyFindUnique.mockResolvedValue({ id: 3 })
    mockPersonFindUnique.mockResolvedValue({ id: 5, familyId: 3 })
    await createTransaction(undefined, fd({ ...validTx, familyId: "3", personId: "5" }))
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ familyId: 3, personId: 5, isGiving: true }),
    })
  })

  it("sets isGiving=false and familyId=null when no familyId", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockAccountFindUnique.mockResolvedValue({ type: "INCOME", isActive: true })
    await createTransaction(undefined, fd(validTx))
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ isGiving: false, familyId: null, personId: null }),
    })
  })

  it("encrypts description before storing", async () => {
    const mockEncrypt = encrypt as jest.Mock
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockAccountFindUnique.mockResolvedValue({ type: "INCOME", isActive: true })
    await createTransaction(undefined, fd(validTx))
    expect(mockEncrypt).toHaveBeenCalledWith("Sunday offering")
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ description: "enc:Sunday offering" }),
    })
  })

  it("redirects to /accounting/transactions on success", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockAccountFindUnique.mockResolvedValue({ type: "INCOME", isActive: true })
    await createTransaction(undefined, fd(validTx))
    expect(mockRedirect).toHaveBeenCalledWith("/accounting/transactions")
  })

  it("revalidates both accounting paths", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockAccountFindUnique.mockResolvedValue({ type: "INCOME", isActive: true })
    await createTransaction(undefined, fd(validTx))
    expect(mockRevalidate).toHaveBeenCalledWith("/accounting")
    expect(mockRevalidate).toHaveBeenCalledWith("/accounting/transactions")
  })

  it("rejects a non-existent accountId", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockAccountFindUnique.mockResolvedValue(null)
    const result = await createTransaction(undefined, fd(validTx))
    expect(result).toEqual({ error: "Invalid category" })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("rejects an account whose type does not match the transaction type", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockAccountFindUnique.mockResolvedValue({ type: "EXPENSE", isActive: true })
    const result = await createTransaction(undefined, fd(validTx)) // validTx.type === "INCOME"
    expect(result).toEqual({ error: "Invalid category" })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("rejects an inactive account", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockAccountFindUnique.mockResolvedValue({ type: "INCOME", isActive: false })
    const result = await createTransaction(undefined, fd(validTx))
    expect(result).toEqual({ error: "Invalid category" })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  // reconciling must only ever happen via toggleReconciled/reconcileMany,
  // never via a plain create/update write — a "reconciled" form field must
  // never reach the Prisma call.
  it("never spreads a submitted reconciled=on into the Prisma create", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockAccountFindUnique.mockResolvedValue({ type: "INCOME", isActive: true })
    await createTransaction(undefined, fd({ ...validTx, reconciled: "on" }))
    const arg = mockCreate.mock.calls[0][0]
    expect(arg.data.reconciled).toBeUndefined()
  })

  it("audit-logs TRANSACTION_CREATED", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    mockAccountFindUnique.mockResolvedValue({ type: "INCOME", isActive: true })
    mockCreate.mockResolvedValue({ id: 11 })
    await createTransaction(undefined, fd(validTx))
    expect(mockLogAudit).toHaveBeenCalledWith(7, "TRANSACTION_CREATED", "Transaction", 11, {
      amount: 500,
      type: "INCOME",
      accountId: 4001,
    })
  })
})

// --- createTransaction duplicate detection ---
describe("createTransaction duplicate detection", () => {
  beforeEach(() => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockAccountFindUnique.mockResolvedValue({ type: "INCOME", isActive: true })
  })

  it("blocks an exact duplicate (same date+amount+account+description) without confirmation", async () => {
    mockFindMany.mockResolvedValue([{ description: "enc:Sunday offering" }])
    const result = await createTransaction(undefined, fd(validTx))
    expect(result).toEqual({
      error: expect.stringMatching(/duplicate/i),
      duplicateWarning: true,
    })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("queries candidates scoped to date+amount+accountId+paymentAccount+familyId, capped", async () => {
    await createTransaction(undefined, fd(validTx))
    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        date: new Date(validTx.date),
        amount: validTx.amount,
        accountId: Number(validTx.accountId),
        paymentAccountId: Number(validTx.paymentAccountId),
        familyId: null,
      },
      select: { description: true },
      take: 20,
    })
  })

  it("scopes the candidate query to the submitted familyId", async () => {
    mockFamilyFindUnique.mockResolvedValue({ id: 3 })
    await createTransaction(undefined, fd({ ...validTx, familyId: "3" }))
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ familyId: 3 }) })
    )
  })

  it("posts when a candidate exists but confirmDuplicate is set", async () => {
    mockFindMany.mockResolvedValue([{ description: "enc:Sunday offering" }])
    await createTransaction(undefined, fd({ ...validTx, confirmDuplicate: "true" }))
    expect(mockCreate).toHaveBeenCalled()
    const arg = mockCreate.mock.calls[0][0]
    // confirmDuplicate is a form-only flag — it must never leak into the
    // Transaction row (the model has no such column).
    expect(arg.data.confirmDuplicate).toBeUndefined()
  })

  it("does not flag a same date+amount+account row with a different description", async () => {
    mockFindMany.mockResolvedValue([{ description: "enc:Unrelated donation" }])
    await createTransaction(undefined, fd(validTx))
    expect(mockCreate).toHaveBeenCalled()
  })

  it("posts normally when no candidate rows exist", async () => {
    mockFindMany.mockResolvedValue([])
    await createTransaction(undefined, fd(validTx))
    expect(mockCreate).toHaveBeenCalled()
  })

  // a corrupt/unrotated-key candidate row must not make the duplicate
  // check throw for the whole request — it should be skipped (treated as "not
  // a match") like any other non-matching row.
  it("does not throw when a candidate row's description is undecryptable, and posts normally", async () => {
    mockFindMany.mockResolvedValue([{ description: "enc:CORRUPT-ROW" }])
    await createTransaction(undefined, fd(validTx))
    expect(mockCreate).toHaveBeenCalled()
  })
})

// --- updateTransaction ---
describe("updateTransaction", () => {
  it("blocks VIEWER", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "VIEWER" } })
    const result = await updateTransaction(1, undefined, fd(validTx))
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("blocks AUDITOR", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "AUDITOR" } })
    const result = await updateTransaction(1, undefined, fd(validTx))
    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("rejects a CASH-kind payment account", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ id: 1, pettyCashReceiptId: null, pettyCashExpenseId: null })
    mockAccountFindUnique.mockResolvedValue({ type: "INCOME", isActive: true })
    mockPaymentAccountFindUnique.mockResolvedValue({ kind: "CASH", isActive: true })
    const result = await updateTransaction(1, undefined, fd({ ...validTx, paymentAccountId: "3" }))
    expect(result).toEqual({ error: "Invalid payment account" })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("rejects editing a petty-cash transfer mirror", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ id: 1, pettyCashReceiptId: null, pettyCashExpenseId: null, pettyCashTransferId: 42 })
    const result = await updateTransaction(1, undefined, fd(validTx))
    expect(result).toHaveProperty("error")
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("rejects editing a reconciled transaction", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ id: 1, reconciled: true })
    const result = await updateTransaction(1, undefined, fd(validTx))
    expect(result).toHaveProperty("error")
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("clears familyId to null when empty string provided", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ id: 1 })
    mockAccountFindUnique.mockResolvedValue({ type: "INCOME", isActive: true })
    mockUpdateMany.mockResolvedValue({ count: 1 })
    await updateTransaction(1, undefined, fd({ ...validTx, familyId: "" }))
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ familyId: null, isGiving: false }),
    })
  })

  it("sets familyId when provided", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ id: 1 })
    mockAccountFindUnique.mockResolvedValue({ type: "INCOME", isActive: true })
    mockFamilyFindUnique.mockResolvedValue({ id: 5 })
    mockUpdateMany.mockResolvedValue({ count: 1 })
    await updateTransaction(1, undefined, fd({ ...validTx, familyId: "5" }))
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ familyId: 5, isGiving: true }),
    })
  })

  it("does not spread the form-only confirmDuplicate flag into the Prisma update", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ id: 1 })
    mockAccountFindUnique.mockResolvedValue({ type: "INCOME", isActive: true })
    mockUpdateMany.mockResolvedValue({ count: 1 })
    await updateTransaction(1, undefined, fd({ ...validTx, confirmDuplicate: "true" }))
    const arg = mockUpdateMany.mock.calls[0][0]
    expect(arg.data.confirmDuplicate).toBeUndefined()
  })

  it("never spreads a submitted reconciled=on into the Prisma update", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ id: 1, reconciled: false })
    mockAccountFindUnique.mockResolvedValue({ type: "INCOME", isActive: true })
    mockUpdateMany.mockResolvedValue({ count: 1 })
    await updateTransaction(1, undefined, fd({ ...validTx, reconciled: "on" }))
    const arg = mockUpdateMany.mock.calls[0][0]
    expect(arg.data.reconciled).toBeUndefined()
  })

  it("allows editing a historical row on a now-inactive account", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ id: 1 })
    mockAccountFindUnique.mockResolvedValue({ type: "INCOME", isActive: false, name: "Retired account" })
    mockUpdateMany.mockResolvedValue({ count: 1 })
    const result = await updateTransaction(1, undefined, fd(validTx))
    expect(result?.error).toBeUndefined()
    expect(mockUpdateMany).toHaveBeenCalled()
  })

  it("audit-logs TRANSACTION_UPDATED", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    mockFindUnique.mockResolvedValue({ id: 1 })
    mockAccountFindUnique.mockResolvedValue({ type: "INCOME", isActive: true })
    mockUpdateMany.mockResolvedValue({ count: 1 })
    await updateTransaction(1, undefined, fd(validTx))
    expect(mockLogAudit).toHaveBeenCalledWith(7, "TRANSACTION_UPDATED", "Transaction", 1, {
      amount: 500,
      type: "INCOME",
      accountId: 4001,
    })
  })

  // --- optimistic concurrency ---

  it("guards the update on the submitted last-seen updatedAt", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ id: 1 })
    mockAccountFindUnique.mockResolvedValue({ type: "INCOME", isActive: true })
    mockUpdateMany.mockResolvedValue({ count: 1 })
    const seen = "2026-07-02T10:00:00.000Z"
    await updateTransaction(1, undefined, fd({ ...validTx, updatedAt: seen }))
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 1, updatedAt: new Date(seen) },
      data: expect.any(Object),
    })
  })

  it("returns a reload error when the row changed under it (count 0)", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ id: 1 })
    mockAccountFindUnique.mockResolvedValue({ type: "INCOME", isActive: true })
    mockUpdateMany.mockResolvedValue({ count: 0 })
    const result = await updateTransaction(1, undefined, fd({ ...validTx, updatedAt: "2026-07-02T10:00:00.000Z" }))
    expect(result).toEqual({ error: expect.stringMatching(/changed by someone else/i) })
    expect(mockLogAudit).not.toHaveBeenCalled()
  })

  it("falls back to an id-only update when no updatedAt token is submitted", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ id: 1 })
    mockAccountFindUnique.mockResolvedValue({ type: "INCOME", isActive: true })
    mockUpdateMany.mockResolvedValue({ count: 1 })
    await updateTransaction(1, undefined, fd(validTx))
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.any(Object),
    })
  })
})

// --- deleteTransaction ---
describe("deleteTransaction", () => {
  it("blocks PASTOR (isAdmin gate)", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    const result = await deleteTransaction(1)
    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it("blocks AUDITOR (read-only accounting)", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "AUDITOR" } })
    const result = await deleteTransaction(1)
    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it("deletes and revalidates for ADMIN", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ id: 1 })
    await deleteTransaction(1)
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: 1 } })
    expect(mockRevalidate).toHaveBeenCalledWith("/accounting")
    expect(mockRevalidate).toHaveBeenCalledWith("/accounting/transactions")
  })

  it("rejects deleting a reconciled transaction", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ id: 1, reconciled: true })
    const result = await deleteTransaction(1)
    expect(result).toHaveProperty("error")
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it("rejects deleting a petty-cash transfer mirror", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ id: 1, pettyCashReceiptId: null, pettyCashExpenseId: null, pettyCashTransferId: 42 })
    const result = await deleteTransaction(1)
    expect(result).toHaveProperty("error")
    expect(mockDelete).not.toHaveBeenCalled()
  })

  // --- ATO 7-year retention floor ---

  it("blocks deleting a transaction dated within the 7-year retention window", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const recentDate = new Date()
    recentDate.setFullYear(recentDate.getFullYear() - 1) // 1 year ago
    mockFindUnique.mockResolvedValue({ id: 1, date: recentDate, reconciled: false, pettyCashReceiptId: null, pettyCashExpenseId: null, pettyCashTransferId: null })
    const result = await deleteTransaction(1)
    expect(result).toEqual({ error: expect.stringMatching(/retention/i) })
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it("allows deleting a transaction dated older than 7 years (still subject to other guards)", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const oldDate = new Date()
    oldDate.setFullYear(oldDate.getFullYear() - 8) // 8 years ago, past the floor
    mockFindUnique.mockResolvedValue({ id: 1, date: oldDate, reconciled: false, pettyCashReceiptId: null, pettyCashExpenseId: null, pettyCashTransferId: null })
    await deleteTransaction(1)
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: 1 } })
  })

  it("audit-logs TRANSACTION_DELETED with details of the deleted row", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    mockFindUnique.mockResolvedValue({
      id: 1,
      pettyCashReceiptId: null,
      pettyCashExpenseId: null,
      amount: { toString: () => "250" }, // Prisma Decimal mock
      type: "EXPENSE",
      accountId: 5001,
    })
    await deleteTransaction(1)
    expect(mockLogAudit).toHaveBeenCalledWith(7, "TRANSACTION_DELETED", "Transaction", 1, {
      amount: 250,
      type: "EXPENSE",
      accountId: 5001,
    })
  })
})

// --- toggleReconciled ---
describe("toggleReconciled", () => {
  it("blocks unauthenticated", async () => {
    mockSession.mockResolvedValue(null)
    const result = await toggleReconciled(1, 1)
    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("blocks AUDITOR", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "AUDITOR" } })
    const result = await toggleReconciled(1, 1)
    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("blocks VIEWER", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "VIEWER" } })
    const result = await toggleReconciled(1, 1)
    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("returns not found for missing transaction", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFindUnique.mockResolvedValue(null)
    const result = await toggleReconciled(99, 1)
    expect(result).toEqual({ error: "Not found" })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("rejects a transaction belonging to a different payment account", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFindUnique.mockResolvedValue({ id: 1, reconciled: false, paymentAccountId: 2 })
    const result = await toggleReconciled(1, 1)
    expect(result).toEqual({ error: "Not found" })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("flips false to true for ADMIN", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFindUnique.mockResolvedValue({ id: 1, reconciled: false, paymentAccountId: 1 })
    const result = await toggleReconciled(1, 1)
    expect(result).toBeUndefined()
    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: 1 }, data: { reconciled: true } })
  })

  it("flips true to false for PASTOR", async () => {
    mockSession.mockResolvedValue({ user: { role: "PASTOR", id: "2" } })
    mockFindUnique.mockResolvedValue({ id: 5, reconciled: true, paymentAccountId: 1 })
    const result = await toggleReconciled(5, 1)
    expect(result).toBeUndefined()
    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: 5 }, data: { reconciled: false } })
  })

  it("audit-logs the reconciliation state change", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFindUnique.mockResolvedValue({ id: 1, reconciled: false, paymentAccountId: 1 })
    await toggleReconciled(1, 1)
    expect(mockLogAudit).toHaveBeenCalledWith(
      1, "TRANSACTION_RECONCILED", "Transaction", 1,
      expect.objectContaining({ reconciled: true, paymentAccountId: 1 })
    )
  })

  it("revalidates both accounting paths", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFindUnique.mockResolvedValue({ id: 1, reconciled: false, paymentAccountId: 1 })
    await toggleReconciled(1, 1)
    expect(mockRevalidate).toHaveBeenCalledWith("/accounting")
    expect(mockRevalidate).toHaveBeenCalledWith("/accounting/transactions")
  })

  it("allows petty cash transactions (no petty cash guard)", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFindUnique.mockResolvedValue({ id: 7, reconciled: false, paymentAccountId: 3 })
    const result = await toggleReconciled(7, 3)
    expect(result).toBeUndefined()
    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: 7 }, data: { reconciled: true } })
  })
})

// --- reconcileMany ---
describe("reconcileMany", () => {
  it("blocks unauthenticated", async () => {
    mockSession.mockResolvedValue(null)
    const result = await reconcileMany([1, 2], 1)
    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it("blocks AUDITOR", async () => {
    mockSession.mockResolvedValue({ user: { role: "AUDITOR", id: "9" } })
    const result = await reconcileMany([1], 1)
    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it("rejects an empty selection", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    const result = await reconcileMany([], 1)
    expect(result).toEqual({ error: "Invalid selection" })
    expect(mockFindMany).not.toHaveBeenCalled()
  })

  it("rejects when a selected id is missing", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    // Asked for 2 ids, only 1 exists → whole batch rejected.
    mockFindMany.mockResolvedValue([{ id: 1, date: new Date("2026-05-01"), paymentAccountId: 1, reconciled: false }])
    const result = await reconcileMany([1, 2], 1)
    expect(result).toEqual({ error: "Not found" })
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it("rejects when a selected row belongs to a different payment account", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFindMany.mockResolvedValue([
      { id: 1, date: new Date("2026-05-01"), paymentAccountId: 1, reconciled: false },
      { id: 2, date: new Date("2026-05-02"), paymentAccountId: 2, reconciled: false },
    ])
    const result = await reconcileMany([1, 2], 1)
    expect(result).toEqual({ error: "Not found" })
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it("rejects when any selected row is in a locked period", async () => {
    const LOCK_ERR = "This date is in a locked accounting period (on or before 2026-06-30)."
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFindMany.mockResolvedValue([
      { id: 1, date: new Date("2026-05-01"), paymentAccountId: 1, reconciled: false },
    ])
    mockAssertUnlocked.mockResolvedValueOnce(LOCK_ERR)
    const result = await reconcileMany([1], 1)
    expect(result).toEqual({ error: LOCK_ERR })
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it("guards the earliest date against the lock", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFindMany.mockResolvedValue([
      { id: 1, date: new Date("2026-05-10"), paymentAccountId: 1, reconciled: false },
      { id: 2, date: new Date("2026-05-01"), paymentAccountId: 1, reconciled: false },
    ])
    await reconcileMany([1, 2], 1)
    expect(mockAssertUnlocked).toHaveBeenCalledWith(new Date("2026-05-01"))
  })

  it("reconciles only the pending rows and reports the count", async () => {
    mockSession.mockResolvedValue({ user: { role: "PASTOR", id: "2" } })
    mockFindMany.mockResolvedValue([
      { id: 1, date: new Date("2026-05-01"), paymentAccountId: 1, reconciled: false },
      { id: 2, date: new Date("2026-05-02"), paymentAccountId: 1, reconciled: true },
      { id: 3, date: new Date("2026-05-03"), paymentAccountId: 1, reconciled: false },
    ])
    const result = await reconcileMany([1, 2, 3], 1)
    expect(mockUpdateMany).toHaveBeenCalledWith({ where: { id: { in: [1, 3] } }, data: { reconciled: true } })
    expect(result).toEqual({ success: "2 transactions reconciled." })
  })

  // pl/balance-sheet/budget-vs-actual/funds aggregate ALL transactions
  // since asOfDate regardless of `reconciled` (book balance) — bulk
  // reconciling never changes those figures, so revalidating them here is
  // dead work and inconsistent with toggleReconciled (which never did either).
  it("does not revalidate the report paths", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFindMany.mockResolvedValue([
      { id: 1, date: new Date("2026-05-01"), paymentAccountId: 1, reconciled: false },
    ])
    await reconcileMany([1], 1)
    expect(mockRevalidate).not.toHaveBeenCalledWith("/accounting/reports/pl")
    expect(mockRevalidate).not.toHaveBeenCalledWith("/accounting/reports/balance-sheet")
    expect(mockRevalidate).not.toHaveBeenCalledWith("/accounting/reports/budget-vs-actual")
    expect(mockRevalidate).not.toHaveBeenCalledWith("/accounting/reports/funds")
  })

  it("audit-logs the bulk reconcile with a count", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFindMany.mockResolvedValue([
      { id: 1, date: new Date("2026-05-01"), paymentAccountId: 1, reconciled: false },
    ])
    await reconcileMany([1], 1)
    expect(mockLogAudit).toHaveBeenCalledWith(
      1, "TRANSACTION_RECONCILED", "Transaction", undefined,
      expect.objectContaining({ reconciled: true, paymentAccountId: 1, count: 1 })
    )
  })
})

describe("period lock", () => {
  const LOCK_ERR = "This date is in a locked accounting period (on or before 2026-06-30)."

  it("createTransaction rejects a date in the locked period", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockAccountFindUnique.mockResolvedValue({ id: 4001, type: "INCOME", isActive: true })
    mockAssertUnlocked.mockResolvedValueOnce(LOCK_ERR)
    const result = await createTransaction(undefined, fd(validTx))
    expect(result).toEqual({ error: LOCK_ERR })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("updateTransaction rejects when the stored txn is in the locked period", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFindUnique.mockResolvedValue({ id: 5, date: new Date("2026-05-01"), pettyCashReceiptId: null, pettyCashExpenseId: null, pettyCashTransferId: null })
    mockAssertUnlocked.mockResolvedValueOnce(LOCK_ERR)
    const result = await updateTransaction(5, undefined, fd(validTx))
    expect(result).toEqual({ error: LOCK_ERR })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("updateTransaction rejects moving an unlocked txn INTO the locked period", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFindUnique.mockResolvedValue({ id: 5, date: new Date("2026-08-01"), pettyCashReceiptId: null, pettyCashExpenseId: null, pettyCashTransferId: null })
    mockAccountFindUnique.mockResolvedValue({ type: "INCOME", isActive: true })
    mockUpdateMany.mockResolvedValue({ count: 1 })
    // Stored date unlocked (1st assertUnlocked call) → submitted date locked (2nd call)
    mockAssertUnlocked.mockResolvedValueOnce(null).mockResolvedValueOnce(LOCK_ERR)
    const result = await updateTransaction(5, undefined, fd(validTx))
    expect(result).toEqual({ error: LOCK_ERR })
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it("deleteTransaction rejects when the stored txn is in the locked period", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFindUnique.mockResolvedValue({ id: 5, date: new Date("2026-05-01"), pettyCashReceiptId: null, pettyCashExpenseId: null, pettyCashTransferId: null, amount: 10, type: "INCOME", accountId: 4001 })
    mockAssertUnlocked.mockResolvedValueOnce(LOCK_ERR)
    const result = await deleteTransaction(5)
    expect(result).toEqual({ error: LOCK_ERR })
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it("toggleReconciled rejects when the stored txn is in the locked period", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockFindUnique.mockResolvedValue({ id: 5, date: new Date("2026-05-01"), reconciled: false, paymentAccountId: 1 })
    mockAssertUnlocked.mockResolvedValueOnce(LOCK_ERR)
    const result = await toggleReconciled(5, 1)
    expect(result).toEqual({ error: LOCK_ERR })
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
