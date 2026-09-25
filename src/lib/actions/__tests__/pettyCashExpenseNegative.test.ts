import { createExpense } from "@/lib/actions/pettyCashExpense"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { createExpenseEntry } from "@/lib/actions/pettyCashEntry"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/generated/prisma/client", () => ({
  Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } },
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/actor", () => ({ actorId: jest.fn(() => 1) }))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("@/lib/accountingLock", () => ({ assertUnlocked: jest.fn().mockResolvedValue(null) }))
jest.mock("@/lib/retention", () => ({ retentionFloor: jest.fn(), retentionError: jest.fn() }))
jest.mock("next/navigation", () => ({ redirect: jest.fn() }))
jest.mock("@/lib/actions/transaction", () => ({ validateAccount: jest.fn() }))
jest.mock("@/lib/actions/fund", () => ({ validateFund: jest.fn() }))
jest.mock("@/lib/paymentAccounts", () => ({ getCashAccount: jest.fn().mockResolvedValue(null) }))
jest.mock("@/lib/actions/pettyCashEntry", () => ({
  createExpenseEntry: jest.fn().mockResolvedValue(1),
  revalidatePettyCashPaths: jest.fn(),
  assertSessionOpenTx: jest.fn(),
  SessionClosedError: class SessionClosedError extends Error {},
  RECONCILED_EDIT_ERROR: "recon-edit",
  RECONCILED_DELETE_ERROR: "recon-delete",
}))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    pettyCashSession: { findUnique: jest.fn() },
    pettyCashExpense: { findMany: jest.fn() },
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb({})),
  },
}))

 
const { validateAccount } = require("@/lib/actions/transaction")
 
const { validateFund } = require("@/lib/actions/fund")

const mockAuth = auth as jest.Mock
const mockFind = prisma.pettyCashSession.findUnique as jest.Mock
const mockFindMany = prisma.pettyCashExpense.findMany as jest.Mock
const mockEntry = createExpenseEntry as jest.Mock

// Opening 50, no entries → running balance 50.00.
function openSession(overrides = {}) {
  return {
    id: 1,
    status: "OPEN",
    title: "15-MAY-2026",
    openingBalance: "50.00",
    receipts: [],
    expenses: [],
    transfers: [],
    ...overrides,
  }
}
function fd(fields: Record<string, string>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}
const base = { payee: "Bunnings", accountId: "3", description: "Screws" }

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  mockFind.mockResolvedValue(openSession())
  mockFindMany.mockResolvedValue([])
  validateAccount.mockResolvedValue({ name: "Stationery" })
  validateFund.mockResolvedValue(true)
})

test("expense exceeding the float returns a negative-balance warning, does not insert", async () => {
  const res = await createExpense(1, undefined, fd({ ...base, amount: "100.00" }))
  expect(res).toEqual(
    expect.objectContaining({ negativeBalanceWarning: true, error: expect.stringMatching(/negative/i) })
  )
  expect(mockEntry).not.toHaveBeenCalled()
})

test("expense within the float inserts without a warning", async () => {
  await createExpense(1, undefined, fd({ ...base, amount: "40.00" }))
  expect(mockEntry).toHaveBeenCalledTimes(1)
})

test("confirmNegative bypasses the warning and inserts", async () => {
  await createExpense(1, undefined, fd({ ...base, amount: "100.00", confirmNegative: "true" }))
  expect(mockEntry).toHaveBeenCalledTimes(1)
})
