jest.mock("@/lib/featureFlags")
import { createReceipt, updateReceipt } from "@/lib/actions/pettyCashReceipt"
import { createExpense, updateExpense } from "@/lib/actions/pettyCashExpense"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { validateAccount } from "@/lib/actions/transaction"
import { validateFund } from "@/lib/actions/fund"
import { accountMatches } from "@/lib/accountMatches"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/generated/prisma/client", () => ({
  Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } },
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("@/lib/actor", () => ({ actorId: jest.fn(() => 1) }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn(), unstable_cache: (fn: (...a: unknown[]) => unknown) => fn }))
jest.mock("next/navigation", () => ({ redirect: jest.fn() }))
jest.mock("@/lib/accountingLock", () => ({ assertUnlocked: jest.fn(async () => null) }))
// Sibling "use server" action modules — mock wholesale so the fundId gate can
// be tested in isolation without dragging in their own prisma/zod/redirect deps.
jest.mock("@/lib/actions/transaction", () => ({ validateAccount: jest.fn() }))
jest.mock("@/lib/actions/fund", () => ({ validateFund: jest.fn() }))
jest.mock("@/lib/accountMatches", () => ({ accountMatches: jest.fn() }))
jest.mock("@/lib/paymentAccounts", () => ({ getCashAccount: jest.fn(async () => ({ id: 9 })) }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: jest.fn(),
    pettyCashSession: { findUnique: jest.fn() },
    pettyCashReceipt: { findUnique: jest.fn(), findMany: jest.fn() },
    pettyCashExpense: { findUnique: jest.fn(), findMany: jest.fn() },
    person: { findUnique: jest.fn() },
    serviceType: { findUnique: jest.fn() },
  },
}))

const mockAuth = auth as jest.Mock
const mockValidateAccount = validateAccount as jest.Mock
const mockValidateFund = validateFund as jest.Mock
const mockAccountMatches = accountMatches as jest.Mock
const mockTransaction = prisma.$transaction as jest.Mock
const mockSessionFind = prisma.pettyCashSession.findUnique as jest.Mock
const mockReceiptFind = prisma.pettyCashReceipt.findUnique as jest.Mock
const mockReceiptFindMany = prisma.pettyCashReceipt.findMany as jest.Mock
const mockExpenseFind = prisma.pettyCashExpense.findUnique as jest.Mock
const mockExpenseFindMany = prisma.pettyCashExpense.findMany as jest.Mock

function fd(fields: Record<string, string>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  mockValidateAccount.mockResolvedValue({ name: "Test Account" })
  mockValidateFund.mockResolvedValue(false)
  mockReceiptFindMany.mockResolvedValue([])
  mockExpenseFindMany.mockResolvedValue([])
})

test("createReceipt rejects an invalid fundId before any write", async () => {
  mockSessionFind.mockResolvedValue({ id: 1, status: "OPEN", title: "01-JUL-2026" })

  const res = await createReceipt(1, undefined, fd({ accountId: "1", amount: "10.00", fundId: "5" }))

  expect(res).toEqual({ error: "Invalid fund" })
  expect(mockValidateFund).toHaveBeenCalledWith(5)
  expect(mockReceiptFindMany).not.toHaveBeenCalled()
  expect(mockTransaction).not.toHaveBeenCalled()
})

test("updateReceipt rejects an invalid fundId, passing allowInactive", async () => {
  mockReceiptFind.mockResolvedValue({
    id: 1,
    sessionId: 1,
    session: { id: 1, status: "OPEN", title: "01-JUL-2026" },
    transaction: null,
  })

  const res = await updateReceipt(1, undefined, fd({ accountId: "1", amount: "10.00", fundId: "5" }))

  expect(res).toEqual({ error: "Invalid fund" })
  expect(mockValidateFund).toHaveBeenCalledWith(5, { allowInactive: true })
  expect(mockTransaction).not.toHaveBeenCalled()
})

test("createExpense rejects an invalid fundId before any write", async () => {
  mockSessionFind.mockResolvedValue({ id: 1, status: "OPEN", title: "01-JUL-2026" })

  const res = await createExpense(
    1,
    undefined,
    fd({ payee: "Vendor", accountId: "1", amount: "10.00", description: "desc", fundId: "5" })
  )

  expect(res).toEqual({ error: "Invalid fund" })
  expect(mockValidateFund).toHaveBeenCalledWith(5)
  expect(mockExpenseFindMany).not.toHaveBeenCalled()
  expect(mockTransaction).not.toHaveBeenCalled()
})

test("updateExpense rejects an invalid fundId, passing allowInactive", async () => {
  mockExpenseFind.mockResolvedValue({
    id: 1,
    sessionId: 1,
    session: { id: 1, status: "OPEN", title: "01-JUL-2026" },
    transaction: null,
  })

  const res = await updateExpense(
    1,
    undefined,
    fd({ payee: "Vendor", accountId: "1", amount: "10.00", description: "desc", fundId: "5" })
  )

  expect(res).toEqual({ error: "Invalid fund" })
  expect(mockValidateFund).toHaveBeenCalledWith(5, { allowInactive: true })
  expect(mockTransaction).not.toHaveBeenCalled()
})

// #350: editing a historical entry whose account was deactivated later must still
// pass both account checks (pre-tx and in-tx); create keeps rejecting inactive ones.
describe("update paths accept a deactivated account (allowInactive)", () => {
  const tx = {
    pettyCashSession: { updateMany: jest.fn(async () => ({ count: 1 })) },
    pettyCashReceipt: { update: jest.fn() },
    pettyCashExpense: { update: jest.fn() },
    person: { findUnique: jest.fn() },
    transaction: { updateMany: jest.fn() },
  }
  const editable = {
    id: 1,
    sessionId: 1,
    session: { id: 1, status: "OPEN", title: "01-JUL-2026" },
    transaction: null,
  }
  const openSession = {
    id: 1,
    status: "OPEN",
    title: "01-JUL-2026",
    openingBalance: "1000.00",
    receipts: [],
    expenses: [],
    transfers: [],
  }
  const receiptForm = () => fd({ accountId: "1", amount: "10.00" })
  const expenseForm = () => fd({ payee: "Vendor", accountId: "1", amount: "10.00", description: "desc" })

  beforeEach(() => {
    mockTransaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx))
    // The in-tx check on a now-inactive account: passes only when allowInactive is forwarded.
    mockAccountMatches.mockImplementation(async (_t, _id, _type, opts?: { allowInactive?: boolean }) =>
      opts?.allowInactive ? { name: "Retired Account" } : null
    )
  })

  test("updateReceipt saves the edit and its ledger mirror", async () => {
    mockReceiptFind.mockResolvedValue(editable)

    expect(await updateReceipt(1, undefined, receiptForm())).toBeUndefined()

    expect(mockValidateAccount).toHaveBeenCalledWith(1, "INCOME", { allowInactive: true })
    expect(mockAccountMatches).toHaveBeenCalledWith(tx, 1, "INCOME", { allowInactive: true })
    expect(tx.pettyCashReceipt.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1 } }))
    expect(tx.transaction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { pettyCashReceiptId: 1 }, data: expect.objectContaining({ accountId: 1 }) })
    )
  })

  test("updateExpense saves the edit and its ledger mirror", async () => {
    mockExpenseFind.mockResolvedValue(editable)

    expect(await updateExpense(1, undefined, expenseForm())).toBeUndefined()

    expect(mockValidateAccount).toHaveBeenCalledWith(1, "EXPENSE", { allowInactive: true })
    expect(mockAccountMatches).toHaveBeenCalledWith(tx, 1, "EXPENSE", { allowInactive: true })
    expect(tx.pettyCashExpense.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1 } }))
    expect(tx.transaction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { pettyCashExpenseId: 1 }, data: expect.objectContaining({ accountId: 1 }) })
    )
  })

  test("updateReceipt still rejects an account that is gone or retyped", async () => {
    mockReceiptFind.mockResolvedValue(editable)
    mockAccountMatches.mockResolvedValue(null)

    expect(await updateReceipt(1, undefined, receiptForm())).toEqual({ error: "Invalid account" })
    expect(tx.pettyCashReceipt.update).not.toHaveBeenCalled()
  })

  test("createReceipt checks the account without allowInactive, before and inside the tx", async () => {
    mockSessionFind.mockResolvedValue(openSession)

    expect(await createReceipt(1, undefined, receiptForm())).toEqual({ error: "Invalid account" })

    expect(mockValidateAccount).toHaveBeenCalledWith(1, "INCOME")
    expect(mockAccountMatches).toHaveBeenCalledWith(tx, 1, "INCOME")
  })

  test("createExpense checks the account without allowInactive, before and inside the tx", async () => {
    mockSessionFind.mockResolvedValue(openSession)

    expect(await createExpense(1, undefined, expenseForm())).toEqual({ error: "Invalid account" })

    expect(mockValidateAccount).toHaveBeenCalledWith(1, "EXPENSE")
    expect(mockAccountMatches).toHaveBeenCalledWith(tx, 1, "EXPENSE")
  })
})
