/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => {
  const account = {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  }
  const transaction = { count: jest.fn() }
  const budget = { count: jest.fn() }
  const pettyCashReceipt = { count: jest.fn() }
  const pettyCashExpense = { count: jest.fn() }
  const accountGroup = { findUnique: jest.fn() }
  return {
    prisma: {
      account,
      accountGroup,
      transaction,
      budget,
      pettyCashReceipt,
      pettyCashExpense,
      // updateAccount wraps the type-change guard + update in an interactive
      // transaction ( TOCTOU) — run the callback against the same mocks.
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn({ account, transaction })),
    },
  }
})
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("next/navigation", () => ({ redirect: jest.fn() }))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { createAccount, updateAccount, deleteAccount } from "@/lib/actions/account"

const mockSession = auth as jest.Mock
const mockFindUnique = prisma.account.findUnique as jest.Mock
const mockFindFirst = prisma.account.findFirst as jest.Mock
const mockFindMany = prisma.account.findMany as jest.Mock
const mockCreate = prisma.account.create as jest.Mock
const mockUpdate = prisma.account.update as jest.Mock
const mockDelete = prisma.account.delete as jest.Mock
const mockTxCount = prisma.transaction.count as jest.Mock
const mockBudgetCount = prisma.budget.count as jest.Mock
const mockPcReceiptCount = prisma.pettyCashReceipt.count as jest.Mock
const mockPcExpenseCount = prisma.pettyCashExpense.count as jest.Mock
const mockGroupFind = prisma.accountGroup.findUnique as jest.Mock
const mockRevalidate = revalidatePath as jest.Mock
const mockRedirect = redirect as unknown as jest.Mock

function fd(fields: Record<string, string>) {
  const f = new FormData()
  Object.entries(fields).forEach(([k, v]) => f.set(k, v))
  return f
}

const validAccount = { code: "4010", name: "Sunday Offering", type: "INCOME", groupId: "1" }

beforeEach(() => {
  jest.clearAllMocks()
  mockGroupFind.mockResolvedValue({ id: 1, type: "INCOME" }) // selected group exists, matches INCOME by default
})

// --- createAccount ---
describe("createAccount", () => {
  it("blocks unauthenticated", async () => {
    mockSession.mockResolvedValue(null)
    const result = await createAccount(undefined, fd(validAccount))
    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("blocks PASTOR role", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    const result = await createAccount(undefined, fd(validAccount))
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("blocks VIEWER role", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "VIEWER" } })
    const result = await createAccount(undefined, fd(validAccount))
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("auto-generates next INCOME code when code left blank", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindMany.mockResolvedValue([{ code: "4001" }, { code: "4018" }, { code: "MISC" }])
    mockFindUnique.mockResolvedValue(null)
    await createAccount(undefined, fd({ code: "", name: "Test", type: "INCOME", groupId: "1" }))
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { type: "INCOME" },
      select: { code: true },
    })
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ code: "4019" }),
    })
  })

  it("auto-generates 5001 for first EXPENSE account when code left blank", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindMany.mockResolvedValue([])
    mockFindUnique.mockResolvedValue(null)
    mockGroupFind.mockResolvedValue({ id: 1, type: "EXPENSE" }) // EXPENSE account needs an EXPENSE group
    await createAccount(undefined, fd({ code: "", name: "Test", type: "EXPENSE", groupId: "1" }))
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ code: "5001" }),
    })
  })

  it("returns validation error for missing name", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const result = await createAccount(undefined, fd({ code: "4010", name: "", type: "INCOME" }))
    expect(result).toEqual({ error: "Name is required" })
  })

  it("returns validation error for missing groupId", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue(null)
    const result = await createAccount(
      undefined,
      fd({ code: "4010", name: "Sunday Offering", type: "INCOME", groupId: "0" })
    )
    expect(result).toEqual({ error: "Select a group" })
  })

  it("returns error for duplicate account code", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ id: 5, code: "4010" })
    const result = await createAccount(undefined, fd(validAccount))
    expect(result).toEqual({ error: "Account code already exists" })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("rejects a non-existent accountGroup", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue(null) // code is free
    mockGroupFind.mockResolvedValue(null) // group does not exist
    const result = await createAccount(undefined, fd(validAccount))
    expect(result).toEqual({ error: "Account group not found" })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("rejects an account whose type does not match its group's type", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue(null) // code is free
    mockGroupFind.mockResolvedValue({ id: 1, type: "EXPENSE" }) // group is EXPENSE, account is INCOME
    const result = await createAccount(undefined, fd(validAccount))
    expect(result).toEqual({ error: "Account type must match its group's type" })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("creates account and redirects for ADMIN", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue(null)
    await createAccount(undefined, fd(validAccount))
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        code: "4010",
        name: "Sunday Offering",
        type: "INCOME",
        isActive: true,
        groupId: 1,
      }),
    })
    expect(mockRevalidate).toHaveBeenCalledWith("/accounting/accounts")
    expect(mockRedirect).toHaveBeenCalledWith("/accounting/accounts")
  })
})

// --- updateAccount ---
describe("updateAccount", () => {
  it("returns validation error for missing code", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const result = await updateAccount(1, undefined, fd({ ...validAccount, code: "" }))
    expect(result).toEqual({ error: "Code is required" })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("blocks PASTOR", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    const result = await updateAccount(1, undefined, fd(validAccount))
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("rejects invalid id before any DB call", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    for (const bad of [0, -1, 2147483648, 1.5]) {
      const result = await updateAccount(bad, undefined, fd(validAccount))
      expect(result).toEqual({ error: "Invalid ID" })
    }
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("returns error when account not found", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue(null)
    const result = await updateAccount(99, undefined, fd(validAccount))
    expect(result).toEqual({ error: "Account not found" })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("returns error for code collision with different account", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ id: 1 })
    mockFindFirst.mockResolvedValue({ id: 99, code: "4010" })
    const result = await updateAccount(1, undefined, fd(validAccount))
    expect(result).toEqual({ error: "Account code already exists" })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("blocks type change while transactions exist", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ id: 1, type: "INCOME" })
    mockFindFirst.mockResolvedValue(null)
    mockGroupFind.mockResolvedValue({ id: 1, type: "EXPENSE" }) // matching EXPENSE group so the tx-count guard is what fires
    mockTxCount.mockResolvedValue(2)
    const result = await updateAccount(1, undefined, fd({ ...validAccount, type: "EXPENSE" }))
    expect(result).toEqual({ error: "Cannot change account type while transactions exist" })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("allows type change when no transactions exist", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ id: 1, type: "INCOME" })
    mockFindFirst.mockResolvedValue(null)
    mockGroupFind.mockResolvedValue({ id: 1, type: "EXPENSE" }) // new type lands in a matching EXPENSE group
    mockTxCount.mockResolvedValue(0)
    await updateAccount(1, undefined, fd({ ...validAccount, type: "EXPENSE" }))
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ type: "EXPENSE" }),
    })
    expect(mockRedirect).toHaveBeenCalledWith("/accounting/accounts")
  })

  it("rejects an update whose type does not match its group's type", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ id: 1, type: "INCOME" })
    mockFindFirst.mockResolvedValue(null)
    mockGroupFind.mockResolvedValue({ id: 1, type: "EXPENSE" }) // INCOME account, EXPENSE group
    const result = await updateAccount(1, undefined, fd(validAccount))
    expect(result).toEqual({ error: "Account type must match its group's type" })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("rejects a non-existent accountGroup on update", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ id: 1, type: "INCOME" })
    mockFindFirst.mockResolvedValue(null)
    mockGroupFind.mockResolvedValue(null)
    const result = await updateAccount(1, undefined, fd(validAccount))
    expect(result).toEqual({ error: "Account group not found" })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("updates account for ADMIN", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ id: 1, type: "INCOME" })
    mockFindFirst.mockResolvedValue(null)
    await updateAccount(1, undefined, fd({ ...validAccount, name: "Changed" }))
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ name: "Changed", groupId: 1 }),
    })
    expect(mockRedirect).toHaveBeenCalledWith("/accounting/accounts")
  })

  it("clears an existing description when submitted blank", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ id: 1, type: "INCOME" })
    mockFindFirst.mockResolvedValue(null)
    await updateAccount(1, undefined, fd({ ...validAccount, description: "" }))
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ description: null }),
    })
  })

  it("maps a concurrent-edit P2002 to the friendly duplicate error", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ id: 1, type: "INCOME" })
    mockFindFirst.mockResolvedValue(null) // TOCTOU: pre-check passes, race loses at write
    mockUpdate.mockRejectedValue({ code: "P2002" })
    const result = await updateAccount(1, undefined, fd(validAccount))
    expect(result).toEqual({ error: "Account code already exists" })
    expect(mockRedirect).not.toHaveBeenCalled()
  })
})

// --- deleteAccount ---
describe("deleteAccount", () => {
  it("blocks PASTOR", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    const result = await deleteAccount(1)
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("rejects invalid id before any DB call", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const result = await deleteAccount(0)
    expect(result).toEqual({ error: "Invalid ID" })
    expect(mockTxCount).not.toHaveBeenCalled()
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it("returns error when transactions linked", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockTxCount.mockResolvedValue(3)
    const result = await deleteAccount(1)
    expect(result?.error).toMatch(/3 transaction/)
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it("returns error when a budget is linked", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockTxCount.mockResolvedValue(0)
    mockBudgetCount.mockResolvedValue(1)
    mockPcReceiptCount.mockResolvedValue(0)
    mockPcExpenseCount.mockResolvedValue(0)
    const result = await deleteAccount(1)
    expect(result?.error).toMatch(/1 budget/)
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it("returns error when petty-cash entries are linked", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockTxCount.mockResolvedValue(0)
    mockBudgetCount.mockResolvedValue(0)
    mockPcReceiptCount.mockResolvedValue(2)
    mockPcExpenseCount.mockResolvedValue(1)
    const result = await deleteAccount(1)
    expect(result?.error).toMatch(/3 petty-cash/)
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it("deletes account and revalidates for ADMIN", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockTxCount.mockResolvedValue(0)
    mockBudgetCount.mockResolvedValue(0)
    mockPcReceiptCount.mockResolvedValue(0)
    mockPcExpenseCount.mockResolvedValue(0)
    await deleteAccount(1)
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: 1 } })
    expect(mockRevalidate).toHaveBeenCalledWith("/accounting/accounts")
  })
})

// --- input bounds ---
describe("createAccount input bounds", () => {
  beforeEach(() => mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } }))

  it("rejects an over-long name", async () => {
    const result = await createAccount(undefined, fd({ ...validAccount, name: "x".repeat(201) }))
    expect(result?.error).toMatch(/too long/i)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("rejects an over-long description", async () => {
    const result = await createAccount(undefined, fd({ ...validAccount, description: "x".repeat(2001) }))
    expect(result?.error).toMatch(/too long/i)
    expect(mockCreate).not.toHaveBeenCalled()
  })
})
