/** @jest-environment node */
// #487: submission-token replay protection for petty-cash receipt/expense creates
// (same mechanism as #491 for transfers). Uses the real pettyCashEntry builders
// and serializableWrite so the token reaches the create payload.
jest.mock("@/lib/featureFlags")
import { createReceipt } from "@/lib/actions/pettyCashReceipt"
import { createExpense } from "@/lib/actions/pettyCashExpense"
import { SUBMISSION_TOKEN_REUSED_ERROR, PETTY_CASH_GONE } from "@/lib/actions/pettyCashEntry"
import { AuditWriteError, PETTY_CASH_AUDIT_FAILED_ERROR } from "@/lib/actions/pettyCashWriteErrors"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { validateAccount } from "@/lib/actions/transaction"
import { validateFund } from "@/lib/actions/fund"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { logAudit, logAuditTx } from "@/lib/audit"
import { assertUnlocked } from "@/lib/accountingLock"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/generated/prisma/client", () => ({
  Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } },
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn(), logAuditTx: jest.fn() }))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("@/lib/actor", () => ({ actorId: jest.fn(() => 1) }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("next/navigation", () => ({ redirect: jest.fn() }))
jest.mock("@/lib/accountingLock", () => ({ assertUnlocked: jest.fn(async () => null) }))
jest.mock("@/lib/actions/transaction", () => ({ validateAccount: jest.fn() }))
jest.mock("@/lib/actions/fund", () => ({ validateFund: jest.fn() }))
jest.mock("@/lib/accountMatches", () => ({ accountMatches: jest.fn(async () => ({ name: "Offering" })) }))
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

const TOKEN = "11111111-2222-4333-8444-555555555555"
const TOKEN_2 = "66666666-7777-4888-9999-aaaaaaaaaaaa"
const mock$tx = prisma.$transaction as jest.Mock
const mockReceiptFind = prisma.pettyCashReceipt.findUnique as jest.Mock
const mockReceiptFindMany = prisma.pettyCashReceipt.findMany as jest.Mock
const mockExpenseFind = prisma.pettyCashExpense.findUnique as jest.Mock
const mockExpenseFindMany = prisma.pettyCashExpense.findMany as jest.Mock

/** Builds a FormData from plain fields. */
function fd(fields: Record<string, string>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}
const receiptFields = { accountId: "1", amount: "10.00", notes: "Gift" }
const expenseFields = { payee: "Bunnings", accountId: "3", amount: "20.00", description: "Screws", receiptRef: "R1" }

/** Stored receipt matching receiptFields in session 1 (no donor/service/fund). */
const sameReceipt = { id: 7, sessionId: 1, amount: { toString: () => "10.00" }, accountId: 1, personId: null, serviceTypeId: null, fundId: null, notes: "enc:Gift" }
/** Stored expense matching expenseFields in session 1. */
const sameExpense = { id: 8, sessionId: 1, amount: { toString: () => "20.00" }, accountId: 3, payee: "enc:Bunnings", description: "enc:Screws", receiptRef: "R1", fundId: null }

/** Transaction client mock; `prior` is what the in-tx token lookup finds. */
function txMock(prior: { receipt?: unknown; expense?: unknown } = {}) {
  return {
    pettyCashSession: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), findUnique: jest.fn() },
    pettyCashReceipt: { findUnique: jest.fn().mockResolvedValue(prior.receipt ?? null), create: jest.fn().mockResolvedValue({ id: 7, date: new Date("2026-05-15"), amount: "10.00", accountId: 1 }) },
    pettyCashExpense: { findUnique: jest.fn().mockResolvedValue(prior.expense ?? null), create: jest.fn().mockResolvedValue({ id: 8, date: new Date("2026-05-15"), amount: "20.00", accountId: 3 }) },
    person: { findUnique: jest.fn() },
    transaction: { create: jest.fn() },
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  ;(validateAccount as jest.Mock).mockResolvedValue({ name: "Offering" })
  ;(validateFund as jest.Mock).mockResolvedValue(true)
  ;(prisma.pettyCashSession.findUnique as jest.Mock).mockResolvedValue({
    id: 1, status: "OPEN", title: "15-MAY-2026", openingBalance: "100.00", receipts: [], expenses: [], transfers: [],
  })
  ;(assertUnlocked as jest.Mock).mockResolvedValue(null)
  mockReceiptFind.mockResolvedValue(null)
  mockReceiptFindMany.mockResolvedValue([])
  mockExpenseFind.mockResolvedValue(null)
  mockExpenseFindMany.mockResolvedValue([])
})

describe("createReceipt — submission token (#487)", () => {
  it("stores the token on a first submit and creates one mirror", async () => {
    const tx = txMock()
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    await createReceipt(1, undefined, fd({ ...receiptFields, submissionToken: TOKEN }))
    expect(mockReceiptFind).toHaveBeenCalledWith(expect.objectContaining({ where: { submissionToken: TOKEN } }))
    expect(tx.pettyCashReceipt.create).toHaveBeenCalledTimes(1)
    expect(tx.pettyCashReceipt.create.mock.calls[0][0].data.submissionToken).toBe(TOKEN)
    expect(tx.transaction.create).toHaveBeenCalledTimes(1)
    expect(redirect).toHaveBeenCalledWith("/accounting/petty-cash/sessions/1")
  })

  it("a replayed token redirects without a second receipt, mirror, duplicate warning or audit", async () => {
    mockReceiptFind.mockResolvedValue(sameReceipt)
    const res = await createReceipt(1, undefined, fd({ ...receiptFields, submissionToken: TOKEN }))
    expect(res).toBeUndefined()
    expect(mock$tx).not.toHaveBeenCalled()
    expect(mockReceiptFindMany).not.toHaveBeenCalled()
    expect(logAuditTx).not.toHaveBeenCalled()
    expect(revalidatePath).toHaveBeenCalled()
    expect(redirect).toHaveBeenCalledWith("/accounting/petty-cash/sessions/1")
  })

  it("a replay after the session closed or the period locked still redirects (#556)", async () => {
    mockReceiptFind.mockResolvedValue(sameReceipt)
    ;(prisma.pettyCashSession.findUnique as jest.Mock).mockResolvedValue({ id: 1, status: "CLOSED", title: "15-MAY-2026" })
    ;(assertUnlocked as jest.Mock).mockResolvedValue("Period locked")
    const res = await createReceipt(1, undefined, fd({ ...receiptFields, submissionToken: TOKEN }))
    expect(res).toBeUndefined()
    expect(redirect).toHaveBeenCalledWith("/accounting/petty-cash/sessions/1")
  })

  it("a first submit audits inside the write transaction, so the entry never commits unaudited (#563)", async () => {
    const tx = txMock()
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    await createReceipt(1, undefined, fd({ ...receiptFields, submissionToken: TOKEN }))
    expect(logAuditTx).toHaveBeenCalledWith(tx, 1, "PETTY_CASH_RECEIPT_CREATED", "PettyCashReceipt", 7, { amount: "10.00", accountId: 1, sessionId: 1 })
    expect(logAudit).not.toHaveBeenCalled()
  })


  it("a twin whose duplicate warning was tripped by the committed twin redirects (#556)", async () => {
    mockReceiptFind.mockResolvedValueOnce(null).mockResolvedValue(sameReceipt)
    mockReceiptFindMany.mockResolvedValue([{ notes: "enc:Gift" }])
    const res = await createReceipt(1, undefined, fd({ ...receiptFields, submissionToken: TOKEN }))
    expect(res).toBeUndefined()
    expect(mock$tx).not.toHaveBeenCalled()
    expect(redirect).toHaveBeenCalledWith("/accounting/petty-cash/sessions/1")
  })

  it("a twin that commits after the pre-check is caught inside the transaction", async () => {
    const tx = txMock({ receipt: sameReceipt })
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    const res = await createReceipt(1, undefined, fd({ ...receiptFields, submissionToken: TOKEN }))
    expect(res).toBeUndefined()
    expect(tx.pettyCashReceipt.create).not.toHaveBeenCalled()
    expect(tx.transaction.create).not.toHaveBeenCalled()
    expect(logAuditTx).not.toHaveBeenCalled()
    expect(redirect).toHaveBeenCalledWith("/accounting/petty-cash/sessions/1")
  })

  it.each([
    ["amount", { ...sameReceipt, amount: { toString: () => "11.00" } }],
    ["notes", { ...sameReceipt, notes: "enc:Other" }],
    ["session", { ...sameReceipt, sessionId: 2 }],
    ["donor", { ...sameReceipt, personId: 4 }],
  ])("a token reused for a different receipt (%s differs) is rejected, not dropped", async (_l, prior) => {
    mockReceiptFind.mockResolvedValue(prior)
    const res = await createReceipt(1, undefined, fd({ ...receiptFields, submissionToken: TOKEN }))
    expect(res).toEqual({ error: SUBMISSION_TOKEN_REUSED_ERROR })
    expect(mock$tx).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })

  it("different tokens create two receipts", async () => {
    const tx = txMock()
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    await createReceipt(1, undefined, fd({ ...receiptFields, submissionToken: TOKEN }))
    await createReceipt(1, undefined, fd({ ...receiptFields, submissionToken: TOKEN_2, confirmDuplicate: "true" }))
    expect(tx.pettyCashReceipt.create).toHaveBeenCalledTimes(2)
    expect(tx.pettyCashReceipt.create.mock.calls.map((c) => c[0].data.submissionToken)).toEqual([TOKEN, TOKEN_2])
    expect(tx.transaction.create).toHaveBeenCalledTimes(2)
  })

  it("no token still creates (no token stored, no token lookup)", async () => {
    const tx = txMock()
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    await createReceipt(1, undefined, fd(receiptFields))
    expect(mockReceiptFind).not.toHaveBeenCalled()
    expect(tx.pettyCashReceipt.findUnique).not.toHaveBeenCalled()
    expect(tx.pettyCashReceipt.create.mock.calls[0][0].data).not.toHaveProperty("submissionToken")
    expect(redirect).toHaveBeenCalledWith("/accounting/petty-cash/sessions/1")
  })

  it("rejects a malformed token before any write", async () => {
    const res = await createReceipt(1, undefined, fd({ ...receiptFields, submissionToken: "not-a-uuid" }))
    expect(res).toEqual({ error: expect.stringContaining("reload the page") })
    expect(mock$tx).not.toHaveBeenCalled()
  })

  it("a P2002 from a concurrent twin with the same receipt is treated as done", async () => {
    mock$tx.mockRejectedValue({ code: "P2002" })
    mockReceiptFind.mockResolvedValueOnce(null).mockResolvedValueOnce(sameReceipt)
    const res = await createReceipt(1, undefined, fd({ ...receiptFields, submissionToken: TOKEN }))
    expect(res).toBeUndefined()
    expect(redirect).toHaveBeenCalledWith("/accounting/petty-cash/sessions/1")
  })

  it("rethrows a P2002 when the form carried no token", async () => {
    const err = { code: "P2002" }
    mock$tx.mockRejectedValue(err)
    await expect(createReceipt(1, undefined, fd(receiptFields))).rejects.toBe(err)
    expect(mockReceiptFind).not.toHaveBeenCalled()
  })

  it("a twin that committed after the first lookup redirects when the session is now closed or locked (#563)", async () => {
    mockReceiptFind.mockResolvedValueOnce(null).mockResolvedValue(sameReceipt)
    ;(prisma.pettyCashSession.findUnique as jest.Mock).mockResolvedValue({ id: 1, status: "CLOSED", title: "15-MAY-2026" })
    expect(await createReceipt(1, undefined, fd({ ...receiptFields, submissionToken: TOKEN }))).toBeUndefined()
    expect(redirect).toHaveBeenCalledWith("/accounting/petty-cash/sessions/1")
    jest.clearAllMocks()
    mockReceiptFind.mockResolvedValueOnce(null).mockResolvedValue(sameReceipt)
    ;(prisma.pettyCashSession.findUnique as jest.Mock).mockResolvedValue({ id: 1, status: "OPEN", title: "15-MAY-2026" })
    ;(assertUnlocked as jest.Mock).mockResolvedValue("Period locked")
    expect(await createReceipt(1, undefined, fd({ ...receiptFields, submissionToken: TOKEN }))).toBeUndefined()
    expect(redirect).toHaveBeenCalledWith("/accounting/petty-cash/sessions/1")
  })

  it("error order for a non-replay: validation first, then session-closed, then period lock (#563)", async () => {
    ;(prisma.pettyCashSession.findUnique as jest.Mock).mockResolvedValue({ id: 1, status: "CLOSED", title: "15-MAY-2026" })
    expect(await createReceipt(1, undefined, fd({ ...receiptFields, amount: "0", submissionToken: TOKEN }))).toEqual({ error: "Amount must be positive" })
    expect(await createReceipt(1, undefined, fd({ ...receiptFields, submissionToken: TOKEN }))).toEqual({ error: "Session is closed" })
    ;(prisma.pettyCashSession.findUnique as jest.Mock).mockResolvedValue({ id: 1, status: "OPEN", title: "15-MAY-2026" })
    ;(assertUnlocked as jest.Mock).mockResolvedValue("Period locked")
    expect(await createReceipt(1, undefined, fd({ ...receiptFields, submissionToken: TOKEN }))).toEqual({ error: "Period locked" })
    expect(redirect).not.toHaveBeenCalled()
  })

  describe("receipt: no replay path writes an audit row — the original's in-tx row stands (#563)", () => {
    it("pre-check replay", async () => {
      mockReceiptFind.mockResolvedValue(sameReceipt)
      await createReceipt(1, undefined, fd({ ...receiptFields, submissionToken: TOKEN }))
      expect(redirect).toHaveBeenCalledTimes(1)
      expect(logAudit).not.toHaveBeenCalled()
      expect(logAuditTx).not.toHaveBeenCalled()
    })

    it("P2002 from a concurrent twin", async () => {
      mockReceiptFind.mockReset().mockResolvedValueOnce(null).mockResolvedValue(sameReceipt)
      mock$tx.mockRejectedValue({ code: "P2002" })
      await createReceipt(1, undefined, fd({ ...receiptFields, submissionToken: TOKEN }))
      expect(redirect).toHaveBeenCalledTimes(1)
      expect(logAudit).not.toHaveBeenCalled()
      expect(logAuditTx).not.toHaveBeenCalled()
    })

    it("in-tx token re-check", async () => {
      const tx = txMock({ receipt: sameReceipt })
      mock$tx.mockReset().mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
      mockReceiptFind.mockReset().mockResolvedValue(null)
      await createReceipt(1, undefined, fd({ ...receiptFields, submissionToken: TOKEN }))
      expect(redirect).toHaveBeenCalledTimes(1)
      expect(logAudit).not.toHaveBeenCalled()
      expect(logAuditTx).not.toHaveBeenCalled()
    })
  })
})

describe("createExpense — submission token (#487)", () => {
  it("a twin that committed after the first lookup redirects when the session is now closed or locked (#563)", async () => {
    mockExpenseFind.mockResolvedValueOnce(null).mockResolvedValue(sameExpense)
    ;(prisma.pettyCashSession.findUnique as jest.Mock).mockResolvedValue({ id: 1, status: "CLOSED", title: "15-MAY-2026" })
    expect(await createExpense(1, undefined, fd({ ...expenseFields, submissionToken: TOKEN }))).toBeUndefined()
    expect(redirect).toHaveBeenCalledWith("/accounting/petty-cash/sessions/1")
    jest.clearAllMocks()
    mockExpenseFind.mockResolvedValueOnce(null).mockResolvedValue(sameExpense)
    ;(prisma.pettyCashSession.findUnique as jest.Mock).mockResolvedValue({ id: 1, status: "OPEN", title: "15-MAY-2026" })
    ;(assertUnlocked as jest.Mock).mockResolvedValue("Period locked")
    expect(await createExpense(1, undefined, fd({ ...expenseFields, submissionToken: TOKEN }))).toBeUndefined()
    expect(redirect).toHaveBeenCalledWith("/accounting/petty-cash/sessions/1")
  })

  it("a negative-float warning falls back to the warning when the re-check throws, and returns reused when the token was reused (#563)", async () => {
    ;(prisma.pettyCashSession.findUnique as jest.Mock).mockResolvedValue({
      id: 1, status: "OPEN", title: "15-MAY-2026", openingBalance: "5.00", receipts: [], expenses: [], transfers: [],
    })
    const spy = jest.spyOn(console, "error").mockImplementation(() => {})
    mockExpenseFind.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("db down"))
    expect(await createExpense(1, undefined, fd({ ...expenseFields, submissionToken: TOKEN }))).toEqual(expect.objectContaining({ negativeBalanceWarning: true }))
    mockExpenseFind.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...sameExpense, payee: "enc:Other" })
    expect(await createExpense(1, undefined, fd({ ...expenseFields, submissionToken: TOKEN }))).toEqual({ error: SUBMISSION_TOKEN_REUSED_ERROR })
    spy.mockRestore()
  })

  it("a session closed mid-flight (SessionClosedError) redirects when a twin committed (#563)", async () => {
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn({ ...txMock(), pettyCashSession: { updateMany: jest.fn().mockResolvedValue({ count: 0 }), findUnique: jest.fn().mockResolvedValue({ status: "CLOSED" }) } }))
    mockExpenseFind.mockResolvedValueOnce(null).mockResolvedValue(sameExpense)
    expect(await createExpense(1, undefined, fd({ ...expenseFields, submissionToken: TOKEN }))).toBeUndefined()
    expect(redirect).toHaveBeenCalledWith("/accounting/petty-cash/sessions/1")
  })

  it("error order for a non-replay: validation first, then session-closed, then period lock (#563)", async () => {
    ;(prisma.pettyCashSession.findUnique as jest.Mock).mockResolvedValue({ id: 1, status: "CLOSED", title: "15-MAY-2026" })
    expect(await createExpense(1, undefined, fd({ ...expenseFields, amount: "0", submissionToken: TOKEN }))).toEqual({ error: "Amount must be positive" })
    expect(await createExpense(1, undefined, fd({ ...expenseFields, submissionToken: TOKEN }))).toEqual({ error: "Session is closed" })
    ;(prisma.pettyCashSession.findUnique as jest.Mock).mockResolvedValue({ id: 1, status: "OPEN", title: "15-MAY-2026" })
    ;(assertUnlocked as jest.Mock).mockResolvedValue("Period locked")
    expect(await createExpense(1, undefined, fd({ ...expenseFields, submissionToken: TOKEN }))).toEqual({ error: "Period locked" })
    expect(redirect).not.toHaveBeenCalled()
  })

  it("stores the token on a first submit and creates one mirror", async () => {
    const tx = txMock()
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    await createExpense(1, undefined, fd({ ...expenseFields, submissionToken: TOKEN }))
    expect(tx.pettyCashExpense.create).toHaveBeenCalledTimes(1)
    expect(tx.pettyCashExpense.create.mock.calls[0][0].data.submissionToken).toBe(TOKEN)
    expect(tx.transaction.create).toHaveBeenCalledTimes(1)
    expect(redirect).toHaveBeenCalledWith("/accounting/petty-cash/sessions/1")
  })

  it("a replayed token redirects before the duplicate and negative-float warnings", async () => {
    mockExpenseFind.mockResolvedValue(sameExpense)
    // Balance 5.00 < 20.00 would otherwise trip the negative-float warning.
    ;(prisma.pettyCashSession.findUnique as jest.Mock).mockResolvedValue({
      id: 1, status: "OPEN", title: "15-MAY-2026", openingBalance: "5.00", receipts: [], expenses: [], transfers: [],
    })
    const res = await createExpense(1, undefined, fd({ ...expenseFields, submissionToken: TOKEN }))
    expect(res).toBeUndefined()
    expect(mock$tx).not.toHaveBeenCalled()
    expect(mockExpenseFindMany).not.toHaveBeenCalled()
    expect(logAuditTx).not.toHaveBeenCalled()
    expect(redirect).toHaveBeenCalledWith("/accounting/petty-cash/sessions/1")
  })

  it("a replay after the session closed still redirects (#556)", async () => {
    mockExpenseFind.mockResolvedValue(sameExpense)
    ;(prisma.pettyCashSession.findUnique as jest.Mock).mockResolvedValue({ id: 1, status: "CLOSED", title: "15-MAY-2026" })
    const res = await createExpense(1, undefined, fd({ ...expenseFields, submissionToken: TOKEN }))
    expect(res).toBeUndefined()
    expect(redirect).toHaveBeenCalledWith("/accounting/petty-cash/sessions/1")
  })

  it("a first submit audits inside the write transaction; a replay writes no audit row (#563)", async () => {
    const tx = txMock()
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    await createExpense(1, undefined, fd({ ...expenseFields, submissionToken: TOKEN }))
    expect(logAuditTx).toHaveBeenCalledWith(tx, 1, "PETTY_CASH_EXPENSE_CREATED", "PettyCashExpense", 8, { amount: "20.00", accountId: 3, sessionId: 1 })
    jest.clearAllMocks()
    mockExpenseFind.mockResolvedValue(sameExpense)
    await createExpense(1, undefined, fd({ ...expenseFields, submissionToken: TOKEN }))
    expect(redirect).toHaveBeenCalledWith("/accounting/petty-cash/sessions/1")
    expect(logAudit).not.toHaveBeenCalled()
    expect(logAuditTx).not.toHaveBeenCalled()
  })


  it("a twin whose negative-float warning fires redirects when the token now replays (#556)", async () => {
    mockExpenseFind.mockResolvedValueOnce(null).mockResolvedValue(sameExpense)
    ;(prisma.pettyCashSession.findUnique as jest.Mock).mockResolvedValue({
      id: 1, status: "OPEN", title: "15-MAY-2026", openingBalance: "5.00", receipts: [], expenses: [], transfers: [],
    })
    const res = await createExpense(1, undefined, fd({ ...expenseFields, submissionToken: TOKEN }))
    expect(res).toBeUndefined()
    expect(mock$tx).not.toHaveBeenCalled()
    expect(redirect).toHaveBeenCalledWith("/accounting/petty-cash/sessions/1")
  })

  it("a twin that commits after the pre-check is caught inside the transaction", async () => {
    const tx = txMock({ expense: sameExpense })
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    const res = await createExpense(1, undefined, fd({ ...expenseFields, submissionToken: TOKEN }))
    expect(res).toBeUndefined()
    expect(tx.pettyCashExpense.create).not.toHaveBeenCalled()
    expect(tx.transaction.create).not.toHaveBeenCalled()
    expect(redirect).toHaveBeenCalledWith("/accounting/petty-cash/sessions/1")
  })

  it.each([
    ["payee", { ...sameExpense, payee: "enc:Other" }],
    ["description", { ...sameExpense, description: "enc:Nails" }],
    ["receiptRef", { ...sameExpense, receiptRef: null }],
    ["amount", { ...sameExpense, amount: { toString: () => "21.00" } }],
  ])("a token reused for a different expense (%s differs) is rejected, not dropped", async (_l, prior) => {
    mockExpenseFind.mockResolvedValue(prior)
    const res = await createExpense(1, undefined, fd({ ...expenseFields, submissionToken: TOKEN }))
    expect(res).toEqual({ error: SUBMISSION_TOKEN_REUSED_ERROR })
    expect(mock$tx).not.toHaveBeenCalled()
  })

  it("different tokens create two expenses", async () => {
    const tx = txMock()
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    await createExpense(1, undefined, fd({ ...expenseFields, submissionToken: TOKEN }))
    await createExpense(1, undefined, fd({ ...expenseFields, submissionToken: TOKEN_2 }))
    expect(tx.pettyCashExpense.create.mock.calls.map((c) => c[0].data.submissionToken)).toEqual([TOKEN, TOKEN_2])
  })

  it("no token still creates without storing one", async () => {
    const tx = txMock()
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    await createExpense(1, undefined, fd(expenseFields))
    expect(mockExpenseFind).not.toHaveBeenCalled()
    expect(tx.pettyCashExpense.create.mock.calls[0][0].data).not.toHaveProperty("submissionToken")
  })

  it("a P2002 from a concurrent twin with the same expense is treated as done", async () => {
    mock$tx.mockRejectedValue({ code: "P2002" })
    mockExpenseFind.mockResolvedValueOnce(null).mockResolvedValueOnce(sameExpense)
    const res = await createExpense(1, undefined, fd({ ...expenseFields, submissionToken: TOKEN }))
    expect(res).toBeUndefined()
    expect(redirect).toHaveBeenCalledWith("/accounting/petty-cash/sessions/1")
  })

  it("rethrows a P2002 whose token no expense carries", async () => {
    const err = { code: "P2002" }
    mock$tx.mockRejectedValue(err)
    await expect(createExpense(1, undefined, fd({ ...expenseFields, submissionToken: TOKEN }))).rejects.toBe(err)
  })

  describe("expense: no replay path writes an audit row — the original's in-tx row stands (#563)", () => {
    it("pre-check replay", async () => {
      mockExpenseFind.mockResolvedValue(sameExpense)
      await createExpense(1, undefined, fd({ ...expenseFields, submissionToken: TOKEN }))
      expect(redirect).toHaveBeenCalledTimes(1)
      expect(logAudit).not.toHaveBeenCalled()
      expect(logAuditTx).not.toHaveBeenCalled()
    })

    it("P2002 from a concurrent twin", async () => {
      mockExpenseFind.mockReset().mockResolvedValueOnce(null).mockResolvedValue(sameExpense)
      mock$tx.mockRejectedValue({ code: "P2002" })
      await createExpense(1, undefined, fd({ ...expenseFields, submissionToken: TOKEN }))
      expect(redirect).toHaveBeenCalledTimes(1)
      expect(logAudit).not.toHaveBeenCalled()
      expect(logAuditTx).not.toHaveBeenCalled()
    })

    it("in-tx token re-check", async () => {
      const tx = txMock({ expense: sameExpense })
      mock$tx.mockReset().mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
      mockExpenseFind.mockReset().mockResolvedValue(null)
      await createExpense(1, undefined, fd({ ...expenseFields, submissionToken: TOKEN }))
      expect(redirect).toHaveBeenCalledTimes(1)
      expect(logAudit).not.toHaveBeenCalled()
      expect(logAuditTx).not.toHaveBeenCalled()
    })
  })
})

/**
 * Runs each `$transaction` callback against a fresh tx client and records what the
 * callback threw (Prisma rolls the tx back on a throw), so a test can prove the
 * entry insert and the audit insert ran in the SAME callback and the audit failure
 * escaped it rather than being swallowed.
 */
function recordingTx() {
  const txs: ReturnType<typeof txMock>[] = []
  const thrown: unknown[] = []
  mock$tx.mockImplementation(async (fn: (t: unknown) => unknown) => {
    const tx = txMock()
    txs.push(tx)
    try {
      return await fn(tx)
    } catch (e) {
      thrown.push(e)
      throw e
    }
  })
  return { txs, thrown }
}

describe.each([
  ["receipt", () => createReceipt(1, undefined, fd({ ...receiptFields, submissionToken: TOKEN })), "pettyCashReceipt" as const],
  ["expense", () => createExpense(1, undefined, fd({ ...expenseFields, submissionToken: TOKEN })), "pettyCashExpense" as const],
])("create %s — in-transaction audit failure (#563, #582)", (_label, run, model) => {
  it("a failed audit write throws out of the same tx callback as the insert (rollback) and surfaces the audit error", async () => {
    const boom = new Error("audit down")
    ;(logAuditTx as jest.Mock).mockRejectedValueOnce(boom)
    const spy = jest.spyOn(console, "error").mockImplementation(() => {})
    const { txs, thrown } = recordingTx()
    expect(await run()).toEqual({ error: PETTY_CASH_AUDIT_FAILED_ERROR })
    expect(mock$tx).toHaveBeenCalledTimes(1)
    const [tx] = txs
    expect(tx[model].create).toHaveBeenCalledTimes(1)
    expect((logAuditTx as jest.Mock).mock.calls[0][0]).toBe(tx)
    expect(tx[model].create.mock.invocationCallOrder[0]).toBeLessThan((logAuditTx as jest.Mock).mock.invocationCallOrder[0])
    // Not swallowed inside the callback: it threw, so the tx (insert included) rolls back.
    expect(thrown).toHaveLength(1)
    expect(thrown[0]).toBeInstanceOf(AuditWriteError)
    expect((thrown[0] as Error).cause).toBe(boom)
    expect(redirect).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it("an FK failure on the audit insert (deleted actor) is not retried or reported as 'removed'", async () => {
    ;(logAuditTx as jest.Mock).mockRejectedValue({ code: "P2003" })
    const spy = jest.spyOn(console, "error").mockImplementation(() => {})
    recordingTx()
    const res = await run()
    expect(res).toEqual({ error: PETTY_CASH_AUDIT_FAILED_ERROR })
    expect(res).not.toEqual(PETTY_CASH_GONE)
    expect(mock$tx).toHaveBeenCalledTimes(1)
    ;(logAuditTx as jest.Mock).mockReset()
    spy.mockRestore()
  })

  it("a serialization conflict on the audit insert still retries the whole transaction", async () => {
    ;(logAuditTx as jest.Mock).mockRejectedValueOnce({ code: "P2034" })
    const { txs } = recordingTx()
    expect(await run()).toBeUndefined()
    expect(mock$tx).toHaveBeenCalledTimes(2)
    expect(txs[1][model].create).toHaveBeenCalledTimes(1)
    expect(redirect).toHaveBeenCalledWith("/accounting/petty-cash/sessions/1")
  })
})
