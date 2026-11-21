/**
 * AUD-3-04 part C: editing an entry so the float would go negative returns the
 * same soft warning as the create path; confirmNegative records it anyway.
 */
jest.mock("@/lib/featureFlags")
import { updateExpense } from "@/lib/actions/pettyCashExpense"
import { updateReceipt } from "@/lib/actions/pettyCashReceipt"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/generated/prisma/client", () => ({
  Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } },
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn(), logAuditTx: jest.fn() }))
jest.mock("@/lib/actor", () => ({ actorId: jest.fn(() => 1) }))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("@/lib/accountingLock", () => ({ assertUnlocked: jest.fn().mockResolvedValue(null) }))
jest.mock("@/lib/retention", () => ({ retentionFloor: jest.fn(), retentionError: jest.fn() }))
jest.mock("next/navigation", () => ({ redirect: jest.fn() }))
jest.mock("@/lib/actions/transaction", () => ({ validateAccount: jest.fn().mockResolvedValue({ name: "Cat" }) }))
jest.mock("@/lib/accountMatches", () => ({ accountMatches: jest.fn().mockResolvedValue({ name: "Cat" }) }))
jest.mock("@/lib/actions/fund", () => ({ validateFund: jest.fn().mockResolvedValue(true) }))
jest.mock("@/lib/paymentAccounts", () => ({ getCashAccount: jest.fn().mockResolvedValue(null) }))
jest.mock("@/lib/actions/pettyCashEntry", () => ({
  revalidatePettyCashPaths: jest.fn(),
  assertSessionOpenTx: jest.fn(),
  PETTY_CASH_BUSY: { error: "busy" },
  PETTY_CASH_GONE: { error: "gone" },
  SessionClosedError: class SessionClosedError extends Error {},
  RECONCILED_EDIT_ERROR: "recon-edit",
  RECONCILED_DELETE_ERROR: "recon-delete",
  SUBMISSION_TOKEN_REUSED_ERROR: "token-reused",
  parseSubmissionToken: jest.fn(() => ({ token: undefined })),
}))
jest.mock("@/lib/prisma", () => {
  const db = {
    pettyCashSession: { findUnique: jest.fn() },
    pettyCashExpense: { findUnique: jest.fn(), update: jest.fn() },
    pettyCashReceipt: { findUnique: jest.fn(), update: jest.fn() },
    person: { findUnique: jest.fn() },
    serviceType: { findUnique: jest.fn() },
    transaction: { updateMany: jest.fn() },
    $transaction: jest.fn(),
  }
  return { prisma: db }
})

const mockAuth = auth as jest.Mock
const db = prisma as unknown as {
  pettyCashSession: { findUnique: jest.Mock }
  pettyCashExpense: { findUnique: jest.Mock; update: jest.Mock }
  pettyCashReceipt: { findUnique: jest.Mock; update: jest.Mock }
  $transaction: jest.Mock
}

function fd(fields: Record<string, string>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma))
})

describe("updateExpense", () => {
  // Opening 50, this 30 expense → running balance 20. Raising it to 60 leaves -10.
  beforeEach(() => {
    db.pettyCashExpense.findUnique.mockResolvedValue({
      id: 9, sessionId: 1, amount: "30.00",
      session: { id: 1, status: "OPEN", title: "15-MAY-2026" },
      transaction: null,
    })
    db.pettyCashSession.findUnique.mockResolvedValue({
      openingBalance: "50.00", receipts: [], expenses: [{ id: 9, amount: "30.00" }], transfers: [],
    })
  })
  const base = { payee: "Bunnings", accountId: "3", description: "Screws" }

  test("updating an expense that drives the float negative returns the warning", async () => {
    const res = await updateExpense(9, undefined, fd({ ...base, amount: "60.00" }))
    expect(res).toEqual(expect.objectContaining({
      negativeBalanceWarning: true,
      error: expect.stringMatching(/exceeds the running balance of 50\.00 and would make the float negative/),
    }))
    expect(db.pettyCashExpense.update).not.toHaveBeenCalled()
  })

  test("an edit that stays within the float saves without a warning", async () => {
    await updateExpense(9, undefined, fd({ ...base, amount: "45.00" }))
    expect(db.pettyCashExpense.update).toHaveBeenCalledTimes(1)
  })

  test("confirmNegative records the edit anyway", async () => {
    await updateExpense(9, undefined, fd({ ...base, amount: "60.00", confirmNegative: "true" }))
    expect(db.pettyCashExpense.update).toHaveBeenCalledTimes(1)
  })
})

describe("updateReceipt", () => {
  // Opening 0, this 50 receipt, a 40 expense → balance 10. Cutting the receipt to 20 leaves -20.
  beforeEach(() => {
    db.pettyCashReceipt.findUnique.mockResolvedValue({
      id: 4, sessionId: 1, amount: "50.00",
      session: { id: 1, status: "OPEN", title: "15-MAY-2026" },
      transaction: null,
    })
    db.pettyCashSession.findUnique.mockResolvedValue({
      openingBalance: "0.00", receipts: [{ id: 4, amount: "50.00" }], expenses: [{ amount: "40.00" }], transfers: [],
    })
  })

  test("reducing a receipt so the float goes negative returns the warning", async () => {
    const res = await updateReceipt(4, undefined, fd({ accountId: "2", amount: "20.00" }))
    expect(res).toEqual(expect.objectContaining({ negativeBalanceWarning: true, error: expect.stringMatching(/negative/i) }))
    expect(db.pettyCashReceipt.update).not.toHaveBeenCalled()
  })

  test("raising a receipt never warns", async () => {
    await updateReceipt(4, undefined, fd({ accountId: "2", amount: "60.00" }))
    expect(db.pettyCashReceipt.update).toHaveBeenCalledTimes(1)
  })

  test("confirmNegative records the reduction anyway, and the flag never reaches Prisma", async () => {
    await updateReceipt(4, undefined, fd({ accountId: "2", amount: "20.00", confirmNegative: "true" }))
    expect(db.pettyCashReceipt.update).toHaveBeenCalledTimes(1)
    expect(db.pettyCashReceipt.update.mock.calls[0][0].data).not.toHaveProperty("confirmNegative")
  })
})
