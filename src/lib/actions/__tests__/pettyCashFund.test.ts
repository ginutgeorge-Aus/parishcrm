import { createReceipt, updateReceipt } from "@/lib/actions/pettyCashReceipt"
import { createExpense, updateExpense } from "@/lib/actions/pettyCashExpense"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { validateAccount } from "@/lib/actions/transaction"
import { validateFund } from "@/lib/actions/fund"

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
