/** @jest-environment node */
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/actions/settings", () => ({
  getPettyCashDefaultCustodianId: jest.fn(),
}))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: jest.fn(),
    pettyCashSession: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    appSetting: {
      findUnique: jest.fn(),
    },
    pettyCashReceipt: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    pettyCashExpense: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    pettyCashTransfer: {
      create: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
    transaction: {
      create: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
    },
    serviceType: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    person: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    account: {
      findUnique: jest.fn(),
    },
    // Backs getCashAccount(), resolved once per action — no active cash account
    // configured, so its self-heal upserts the canonical Petty Cash (id 2) and
    // mirror rows carry paymentAccountId: 2.
    paymentAccount: {
      // findFirst null + upsert = getCashAccount()'s self-heal: a fresh
      // install with no active CASH account provisions the canonical Petty Cash.
      findFirst: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({ id: 2, name: "Petty Cash", kind: "CASH", isDefault: false, isActive: true }),
    },
  },
}))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn(), unstable_cache: (fn: (...a: unknown[]) => unknown) => fn }))
jest.mock("next/navigation", () => ({ redirect: jest.fn() }))
jest.mock("@/lib/pettyCashLedger", () => ({ calcRunningBalance: jest.fn() }))
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
import { assertUnlocked } from "@/lib/accountingLock"
import { logAudit } from "@/lib/audit"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import { calcRunningBalance } from "@/lib/pettyCashLedger"
import { createSession, closeSession, deleteSession, ensureWeeklySession } from "@/lib/actions/pettyCashSession"
import { createReceipt, updateReceipt, deleteReceipt } from "@/lib/actions/pettyCashReceipt"
import { createExpense, updateExpense, deleteExpense } from "@/lib/actions/pettyCashExpense"
import { createTransfer, deleteTransfer } from "@/lib/actions/pettyCashTransfer"
import { createServiceType, deleteServiceType } from "@/lib/actions/serviceType"
import { pettyCashTitle } from "@/lib/formatting"
import { getPettyCashDefaultCustodianId } from "@/lib/actions/settings"

const getCustodian = getPettyCashDefaultCustodianId as jest.Mock

const mockSession = auth as jest.Mock
const mockCreateSession = prisma.pettyCashSession.create as jest.Mock
const mockFindSession = prisma.pettyCashSession.findUnique as jest.Mock
const mockUpdateSession = prisma.pettyCashSession.update as jest.Mock
const mockUpdateManySession = prisma.pettyCashSession.updateMany as jest.Mock
const mockFindManySession = prisma.pettyCashSession.findMany as jest.Mock
const mockDeleteSession = prisma.pettyCashSession.delete as jest.Mock
const mockCreateReceipt = prisma.pettyCashReceipt.create as jest.Mock
const mockFindReceipt = prisma.pettyCashReceipt.findUnique as jest.Mock
const mockUpdateReceipt = prisma.pettyCashReceipt.update as jest.Mock
const mockDeleteReceipt = prisma.pettyCashReceipt.delete as jest.Mock
const mockCountReceipt = prisma.pettyCashReceipt.count as jest.Mock
const mockCreateExpense = prisma.pettyCashExpense.create as jest.Mock
const mockFindExpense = prisma.pettyCashExpense.findUnique as jest.Mock
const mockFindManyExpense = prisma.pettyCashExpense.findMany as jest.Mock
const mockFindManyReceipt = prisma.pettyCashReceipt.findMany as jest.Mock
const mockUpdateExpense = prisma.pettyCashExpense.update as jest.Mock
const mockDeleteExpense = prisma.pettyCashExpense.delete as jest.Mock
const mockUpdateManyTransaction = prisma.transaction.updateMany as jest.Mock
const mockCreateTransfer = prisma.pettyCashTransfer.create as jest.Mock
const mockFindTransfer = prisma.pettyCashTransfer.findUnique as jest.Mock
const mockDeleteTransfer = prisma.pettyCashTransfer.delete as jest.Mock
const mockCreateServiceType = prisma.serviceType.create as jest.Mock
const mockFindFirstServiceType = prisma.serviceType.findFirst as jest.Mock
const mockDeleteServiceType = prisma.serviceType.delete as jest.Mock
const mockFindPerson = prisma.person.findUnique as jest.Mock
const mockFindPersonFirst = prisma.person.findFirst as jest.Mock
const mockFindAccount = prisma.account.findUnique as jest.Mock
const mockCalcBalance = calcRunningBalance as jest.Mock
const mockRedirect = redirect as unknown as jest.Mock
const mockPrismaTransaction = prisma.$transaction as jest.Mock
const mockCreateTransaction = prisma.transaction.create as jest.Mock
const mockFindTransaction = prisma.transaction.findUnique as jest.Mock
const mockLogAudit = logAudit as jest.Mock
const mockAssertUnlocked = assertUnlocked as jest.Mock

function fd(fields: Record<string, string>) {
  const f = new FormData()
  Object.entries(fields).forEach(([k, v]) => f.set(k, v))
  return f
}

beforeEach(() => {
  jest.clearAllMocks()
  // $transaction executes the callback immediately, passing prisma as the tx object.
  mockPrismaTransaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma))
  // Default the in-tx session re-check (assertSessionOpenTx,/) to OPEN;
  // tests exercising a closed/racing session override this.
  mockFindSession.mockResolvedValue({ status: "OPEN" })
  // Default the in-tx mirror-reconciled re-check to "no row" (not
  // reconciled); tests exercising a concurrent reconcile override this. Reset
  // here because clearAllMocks() clears calls but NOT mockResolvedValue impls.
  mockFindTransaction.mockResolvedValue(null)
  // createTransfer reads the created row's id for audit logging
  mockCreateTransfer.mockResolvedValue({ id: 1 })
  mockFindManyReceipt.mockResolvedValue([])
  // closeSession now transitions via a conditional updateMany; default
  // to a winning close (one row matched). Race tests override with { count: 0 }.
  mockUpdateManySession.mockResolvedValue({ count: 1 })
  // No prior sessions by default for ensureWeeklySession's carry-forward scan
  //. Individual tests override to supply a dated prior session.
  mockFindManySession.mockResolvedValue([])
  // No likely-duplicate candidates by default — individual tests
  // override this to simulate a matching prior expense in the session.
  mockFindManyExpense.mockResolvedValue([])
  // Ample float by default so createExpense's negative-balance guard
  // stays out of the way; the transfer tests below set their own balances.
  mockCalcBalance.mockReturnValue(1000)
})

// --- createSession ---
describe("createSession", () => {
  it("creates session and redirects for PASTOR", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    mockCreateSession.mockResolvedValue({ id: 7 })
    mockFindPersonFirst.mockResolvedValue({ id: 3 })
    await createSession(undefined, fd({ sessionDate: "2026-05-22", custodianId: "3", openingBalance: "0" }))
    expect(mockCreateSession).toHaveBeenCalledWith({
      data: expect.objectContaining({ title: "22-MAY-2026", custodianId: 3 }),
    })
    expect(mockRedirect).toHaveBeenCalledWith("/accounting/petty-cash/sessions/7")
  })

  it("blocks VIEWER", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "VIEWER" } })
    const result = await createSession(undefined, fd({ sessionDate: "2026-05-22", custodianId: "1" }))
    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockCreateSession).not.toHaveBeenCalled()
  })

  it("blocks AUDITOR", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "AUDITOR" } })
    const result = await createSession(undefined, fd({ sessionDate: "2026-05-22", custodianId: "1" }))
    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockCreateSession).not.toHaveBeenCalled()
  })

  it("returns error for invalid date", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    const result = await createSession(undefined, fd({ sessionDate: "not-a-date", custodianId: "1" }))
    expect(result).toEqual({ error: "Invalid date" })
    expect(mockCreateSession).not.toHaveBeenCalled()
  })

  it("rejects an archived custodian, scoping the lookup to archivedAt: null", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindPersonFirst.mockResolvedValue(null) // archived person excluded by the where clause
    const result = await createSession(undefined, fd({ sessionDate: "2026-05-22", custodianId: "3", openingBalance: "0" }))
    expect(result).toEqual({ error: "Custodian not found" })
    expect(mockFindPersonFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 3, archivedAt: null } }),
    )
    expect(mockCreateSession).not.toHaveBeenCalled()
  })

  it("passes the validated opening-balance string to Decimal without a float round-trip", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    mockCreateSession.mockResolvedValue({ id: 7 })
    mockFindPersonFirst.mockResolvedValue({ id: 3 })
    await createSession(undefined, fd({ sessionDate: "2026-05-22", custodianId: "3", openingBalance: "12.34" }))
    expect(mockCreateSession).toHaveBeenCalledWith({
      data: expect.objectContaining({ openingBalance: "12.34" }),
    })
  })

  it("rejects an opening balance with more than 2 decimals", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    const result = await createSession(undefined, fd({ sessionDate: "2026-05-22", custodianId: "3", openingBalance: "100.123" }))
    expect(result?.error).toMatch(/2 decimal/i)
    expect(mockCreateSession).not.toHaveBeenCalled()
  })

  it.each([
    ["2026-01-01", "01-JAN-2026"],
    ["2026-07-15", "15-JUL-2026"],
    ["2026-12-31", "31-DEC-2026"],
  ])("converts %s to title %s", async (sessionDate, expectedTitle) => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockCreateSession.mockResolvedValue({ id: 1 })
    mockFindPersonFirst.mockResolvedValue({ id: 1 })
    await createSession(undefined, fd({ sessionDate, custodianId: "1" }))
    expect(mockCreateSession).toHaveBeenCalledWith({
      data: expect.objectContaining({ title: expectedTitle }),
    })
  })
})

// --- closeSession ---
describe("closeSession", () => {
  it("closes an open session", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    mockFindSession.mockResolvedValue({ id: 1, status: "OPEN" })
    await closeSession(1, undefined, fd({ notes: "Handed to Mary" }))
    expect(mockUpdateManySession).toHaveBeenCalledWith({
      where: { id: 1, status: "OPEN" },
      data: expect.objectContaining({ status: "CLOSED", notes: "Handed to Mary" }),
    })
    expect(mockRedirect).toHaveBeenCalledWith("/accounting/petty-cash")
  })

  it("returns error for already closed session", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindSession.mockResolvedValue({ id: 1, status: "CLOSED" })
    const result = await closeSession(1, undefined, fd({}))
    expect(result).toEqual({ error: "Session already closed" })
  })

  it("blocks VIEWER", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "VIEWER" } })
    const result = await closeSession(1, undefined, fd({}))
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("blocks AUDITOR", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "AUDITOR" } })
    const result = await closeSession(1, undefined, fd({}))
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("rejects notes over 2000 chars", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    mockFindSession.mockResolvedValue({ id: 1, status: "OPEN" })
    const result = await closeSession(1, undefined, fd({ notes: "x".repeat(2001) }))
    expect(result).toEqual({ error: "Notes too long" })
    expect(mockUpdateManySession).not.toHaveBeenCalled()
  })

  it("rejects a concurrent close that loses the race, without auditing", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindSession.mockResolvedValue({ id: 1, status: "OPEN", openingBalance: "0", receipts: [], expenses: [], transfers: [] })
    mockUpdateManySession.mockResolvedValue({ count: 0 }) // conditional update matched no OPEN row
    const result = await closeSession(1, undefined, fd({ notes: "late" }))
    expect(result).toEqual({ error: "Session already closed" })
    expect(mockLogAudit).not.toHaveBeenCalled()
    expect(mockRedirect).not.toHaveBeenCalled()
  })
})

// --- deleteSession ---
describe("deleteSession", () => {
  const emptySession = {
    id: 1,
    title: "11-MAY-2026",
    status: "OPEN",
    _count: { receipts: 0, expenses: 0, transfers: 0 },
  }

  it("deletes an empty open session for ADMIN", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    mockFindSession.mockResolvedValue(emptySession)
    await deleteSession(1)
    expect(mockDeleteSession).toHaveBeenCalledWith({ where: { id: 1 } })
  })

  it("audit-logs PETTY_CASH_SESSION_DELETED", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    mockFindSession.mockResolvedValue(emptySession)
    await deleteSession(1)
    expect(mockLogAudit).toHaveBeenCalledWith(7, "PETTY_CASH_SESSION_DELETED", "PettyCashSession", 1, {
      title: "11-MAY-2026",
    })
  })

  it("blocks PASTOR", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    const result = await deleteSession(1)
    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockDeleteSession).not.toHaveBeenCalled()
  })

  it("returns error when session not found", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    mockFindSession.mockResolvedValue(null)
    const result = await deleteSession(1)
    expect(result).toEqual({ error: "Session not found" })
  })

  it("blocks closed session", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    mockFindSession.mockResolvedValue({ ...emptySession, status: "CLOSED" })
    const result = await deleteSession(1)
    expect(result).toEqual({ error: "Cannot delete a closed session" })
    expect(mockDeleteSession).not.toHaveBeenCalled()
  })

  it("blocks session with entries", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    mockFindSession.mockResolvedValue({
      ...emptySession,
      _count: { receipts: 2, expenses: 1, transfers: 0 },
    })
    const result = await deleteSession(1)
    expect(result).toEqual({
      error: "Cannot delete — session has 3 entry(ies). Delete them first.",
    })
    expect(mockDeleteSession).not.toHaveBeenCalled()
  })

  it("returns a clean error if a concurrent insert causes an FK violation", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    mockFindSession.mockResolvedValue(emptySession) // empty at check time
    mockDeleteSession.mockRejectedValue({ code: "P2003" }) // entry inserted in the race window
    const result = await deleteSession(1)
    expect(result).toEqual({ error: "Cannot delete — session has entries. Delete them first." })
  })
})

// --- createReceipt ---
describe("createReceipt", () => {
  it("creates receipt AND transaction atomically for open session", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    mockFindSession.mockResolvedValue({ id: 5, status: "OPEN", title: "11-MAY-2026" })
    mockFindAccount.mockResolvedValue({ type: "INCOME", isActive: true })
    mockCreateReceipt.mockResolvedValue({ id: 1, date: new Date("2026-05-11"), amount: 250, accountId: 1, sessionId: 5 })
    await createReceipt(5, undefined, fd({ date: "2026-05-11", accountId: "1", amount: "250.00" }))
    expect(mockPrismaTransaction).toHaveBeenCalled()
    expect(mockCreateReceipt).toHaveBeenCalledWith({
      data: expect.objectContaining({ sessionId: 5, accountId: 1, amount: "250.00" }),
    })
    expect(mockCreateTransaction).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "INCOME",
        accountId: 1,
        amount: 250,
        isGiving: false,
        paymentAccountId: 2,
        bankRef: "PC_R_1",
        pettyCashReceiptId: 1,
      }),
    })
    expect(mockRedirect).toHaveBeenCalledWith("/accounting/petty-cash/sessions/5")
  })

  it("creates receipt with optional personId — personId not set on Transaction", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    mockFindSession.mockResolvedValue({ id: 5, status: "OPEN", title: "11-MAY-2026" })
    mockFindAccount.mockResolvedValue({ type: "INCOME", isActive: true })
    mockFindPerson.mockResolvedValue({ id: 3 })
    mockCreateReceipt.mockResolvedValue({ id: 2, date: new Date("2026-05-11"), amount: 100, accountId: 2, sessionId: 5 })
    await createReceipt(5, undefined, fd({ date: "2026-05-11", accountId: "2", amount: "100.00", personId: "3" }))
    expect(mockCreateReceipt).toHaveBeenCalledWith({
      data: expect.objectContaining({ accountId: 2, personId: 3 }),
    })
    expect(mockCreateTransaction).toHaveBeenCalledWith({
      data: expect.objectContaining({ bankRef: "PC_R_2", pettyCashReceiptId: 2 }),
    })
  })

  it("returns error when accountId missing — no $transaction called", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindSession.mockResolvedValue({ id: 5, status: "OPEN", title: "11-MAY-2026" })
    const result = await createReceipt(5, undefined, fd({ date: "2026-05-11", amount: "100.00" }))
    expect(result?.error).toBeTruthy()
    expect(mockPrismaTransaction).not.toHaveBeenCalled()
    expect(mockCreateReceipt).not.toHaveBeenCalled()
  })

  it("rejects an invalid/inactive serviceTypeId — no $transaction", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    mockFindSession.mockResolvedValue({ id: 5, status: "OPEN", title: "11-MAY-2026" })
    mockFindAccount.mockResolvedValue({ type: "INCOME", isActive: true })
    ;(prisma.serviceType.findUnique as jest.Mock).mockResolvedValue(null)
    const result = await createReceipt(5, undefined, fd({ date: "2026-05-11", accountId: "1", amount: "100.00", serviceTypeId: "99" }))
    expect(result?.error).toBe("Invalid service type")
    expect(mockPrismaTransaction).not.toHaveBeenCalled()
  })

  it("returns error for closed session", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindSession.mockResolvedValue({ id: 5, status: "CLOSED", title: "11-MAY-2026" })
    const result = await createReceipt(5, undefined, fd({ date: "2026-05-11", accountId: "1", amount: "100" }))
    expect(result).toEqual({ error: "Session is closed" })
    expect(mockPrismaTransaction).not.toHaveBeenCalled()
  })

  it("returns validation error for zero amount", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindSession.mockResolvedValue({ id: 5, status: "OPEN", title: "11-MAY-2026" })
    const result = await createReceipt(5, undefined, fd({ date: "2026-05-11", accountId: "1", amount: "0" }))
    expect(result).toEqual({ error: "Amount must be positive" })
    expect(mockPrismaTransaction).not.toHaveBeenCalled()
  })

  it("rejects an amount with more than 2 decimal places instead of silently truncating", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindSession.mockResolvedValue({ id: 5, status: "OPEN", title: "11-MAY-2026" })
    mockFindAccount.mockResolvedValue({ type: "INCOME", isActive: true })
    const result = await createReceipt(5, undefined, fd({ date: "2026-05-11", accountId: "1", amount: "12.345" }))
    expect(result).toEqual({ error: "Amount: max 2 decimal places" })
    expect(mockPrismaTransaction).not.toHaveBeenCalled()
  })

  it("uses account name as transaction description", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    mockFindSession.mockResolvedValue({ id: 5, status: "OPEN", title: "11-MAY-2026" })
    mockFindAccount.mockResolvedValue({ type: "INCOME", isActive: true, name: "Offering" })
    mockCreateReceipt.mockResolvedValue({ id: 10, date: new Date("2026-05-11"), amount: 100, accountId: 1, sessionId: 5 })
    await createReceipt(5, undefined, fd({ date: "2026-05-11", accountId: "1", amount: "100.00" }))
    expect(mockCreateTransaction).toHaveBeenCalledWith({
      data: expect.objectContaining({ description: "enc:Offering" }),
    })
  })

  it("audit-logs PETTY_CASH_RECEIPT_CREATED", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    mockFindSession.mockResolvedValue({ id: 5, status: "OPEN", title: "11-MAY-2026" })
    mockFindAccount.mockResolvedValue({ type: "INCOME", isActive: true, name: "Offering" })
    mockCreateReceipt.mockResolvedValue({ id: 10, date: new Date("2026-05-11"), amount: 250, accountId: 1, sessionId: 5 })
    await createReceipt(5, undefined, fd({ date: "2026-05-11", accountId: "1", amount: "250.00" }))
    expect(mockLogAudit).toHaveBeenCalledWith(7, "PETTY_CASH_RECEIPT_CREATED", "PettyCashReceipt", 10, {
      amount: "250.00",
      accountId: 1,
      sessionId: 5,
    })
  })

  it("forces receipt date to session date from title — no date field submitted", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    mockFindSession.mockResolvedValue({ id: 5, status: "OPEN", title: "10-JAN-2026" })
    mockFindAccount.mockResolvedValue({ type: "INCOME", isActive: true, name: "Offering" })
    mockCreateReceipt.mockResolvedValue({ id: 1, date: new Date("2026-01-10T00:00:00"), amount: 250, accountId: 1, sessionId: 5 })
    await createReceipt(5, undefined, fd({ accountId: "1", amount: "250.00" }))
    expect(mockCreateReceipt).toHaveBeenCalledWith({
      data: expect.objectContaining({ date: new Date("2026-01-10T00:00:00") }),
    })
  })

  it("ignores submitted date — session date wins", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    mockFindSession.mockResolvedValue({ id: 5, status: "OPEN", title: "10-JAN-2026" })
    mockFindAccount.mockResolvedValue({ type: "INCOME", isActive: true, name: "Offering" })
    mockCreateReceipt.mockResolvedValue({ id: 1, date: new Date("2026-01-10T00:00:00"), amount: 250, accountId: 1, sessionId: 5 })
    await createReceipt(5, undefined, fd({ date: "2026-03-15", accountId: "1", amount: "250.00" }))
    expect(mockCreateReceipt).toHaveBeenCalledWith({
      data: expect.objectContaining({ date: new Date("2026-01-10T00:00:00") }),
    })
  })

  it("returns error when session title is not a parseable date", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    mockFindSession.mockResolvedValue({ id: 5, status: "OPEN", title: "garbage" })
    const result = await createReceipt(5, undefined, fd({ accountId: "1", amount: "250.00" }))
    expect(result).toEqual({ error: "Invalid session date" })
    expect(mockPrismaTransaction).not.toHaveBeenCalled()
  })
})

// --- createReceipt duplicate detection ---
describe("createReceipt duplicate detection", () => {
  const receiptFd = { accountId: "1", amount: "250.00", personId: "3", notes: "Sunday offering" }

  beforeEach(() => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    mockFindSession.mockResolvedValue({ id: 5, status: "OPEN", title: "11-MAY-2026" })
    mockFindAccount.mockResolvedValue({ type: "INCOME", isActive: true, name: "Offering" })
    mockFindPerson.mockResolvedValue({ id: 3 })
    mockCreateReceipt.mockResolvedValue({ id: 9, date: new Date("2026-05-11"), amount: 250, accountId: 1, sessionId: 5 })
  })

  it("blocks an exact duplicate (same date+amount+account+donor+notes in the session) without confirmation", async () => {
    mockFindManyReceipt.mockResolvedValue([{ notes: "enc:Sunday offering" }])
    const result = await createReceipt(5, undefined, fd(receiptFd))
    expect(result).toEqual({
      error: expect.stringMatching(/duplicate/i),
      duplicateWarning: true,
    })
    expect(mockPrismaTransaction).not.toHaveBeenCalled()
    expect(mockCreateReceipt).not.toHaveBeenCalled()
  })

  it("queries candidates scoped to sessionId+date+amount+accountId+personId", async () => {
    await createReceipt(5, undefined, fd(receiptFd))
    expect(mockFindManyReceipt).toHaveBeenCalledWith({
      where: { sessionId: 5, date: new Date("2026-05-11T00:00:00"), amount: "250.00", accountId: 1, personId: 3 },
      select: { notes: true },
    })
  })

  it("posts when a duplicate candidate exists but confirmDuplicate is set", async () => {
    mockFindManyReceipt.mockResolvedValue([{ notes: "enc:Sunday offering" }])
    await createReceipt(5, undefined, fd({ ...receiptFd, confirmDuplicate: "true" }))
    expect(mockPrismaTransaction).toHaveBeenCalled()
    expect(mockCreateReceipt).toHaveBeenCalled()
    // confirmDuplicate is a form-only flag — PettyCashReceipt has no such column.
    expect(mockCreateReceipt.mock.calls[0][0].data.confirmDuplicate).toBeUndefined()
  })

  it("does not flag a same date+amount+account+donor row with different notes", async () => {
    mockFindManyReceipt.mockResolvedValue([{ notes: "enc:Building fund" }])
    await createReceipt(5, undefined, fd(receiptFd))
    expect(mockCreateReceipt).toHaveBeenCalled()
  })

  it("matches a note-less receipt against a note-less candidate", async () => {
    mockFindManyReceipt.mockResolvedValue([{ notes: null }])
    const result = await createReceipt(5, undefined, fd({ accountId: "1", amount: "250.00", personId: "3" }))
    expect(result).toEqual({ error: expect.stringMatching(/duplicate/i), duplicateWarning: true })
    expect(mockCreateReceipt).not.toHaveBeenCalled()
  })

  it("posts normally when no candidate rows exist", async () => {
    mockFindManyReceipt.mockResolvedValue([])
    await createReceipt(5, undefined, fd(receiptFd))
    expect(mockCreateReceipt).toHaveBeenCalled()
  })

  // a corrupt/unrotated-key candidate row must not make the duplicate
  // check throw — it is skipped (treated as "not a match").
  it("does not throw when a candidate row's notes are undecryptable, and posts normally", async () => {
    mockFindManyReceipt.mockResolvedValue([{ notes: "enc:CORRUPT-ROW" }])
    await createReceipt(5, undefined, fd(receiptFd))
    expect(mockCreateReceipt).toHaveBeenCalled()
  })
})

// --- deleteReceipt ---
describe("deleteReceipt", () => {
  it("deletes receipt for ADMIN", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindReceipt.mockResolvedValue({ id: 1, sessionId: 5, session: { id: 5, status: "OPEN" } })
    await deleteReceipt(1)
    expect(mockDeleteReceipt).toHaveBeenCalledWith({ where: { id: 1 } })
  })

  it("blocks PASTOR from deleting", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    const result = await deleteReceipt(1)
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("blocks delete from closed session", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindReceipt.mockResolvedValue({ id: 1, sessionId: 5, session: { id: 5, status: "CLOSED" } })
    const result = await deleteReceipt(1)
    expect(result).toEqual({ error: "Cannot delete from closed session" })
  })

  it("audit-logs PETTY_CASH_RECEIPT_DELETED", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    mockFindReceipt.mockResolvedValue({
      id: 1,
      sessionId: 5,
      amount: { toString: () => "250" }, // Prisma Decimal mock
      accountId: 2,
      session: { id: 5, status: "OPEN" },
    })
    await deleteReceipt(1)
    expect(mockLogAudit).toHaveBeenCalledWith(7, "PETTY_CASH_RECEIPT_DELETED", "PettyCashReceipt", 1, {
      amount: 250,
      accountId: 2,
      sessionId: 5,
    })
  })

  it("audit-logs TRANSACTION_DELETED for the cascaded mirror ledger row", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    mockFindReceipt.mockResolvedValue({
      id: 1, sessionId: 5, amount: { toString: () => "250" }, accountId: 2,
      session: { id: 5, status: "OPEN" }, transaction: { id: 99 },
    })
    await deleteReceipt(1)
    expect(mockLogAudit).toHaveBeenCalledWith(
      7, "TRANSACTION_DELETED", "Transaction", 99, expect.objectContaining({ source: "petty-cash" })
    )
  })

  it("blocks delete when the mirror transaction is reconciled", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    mockFindReceipt.mockResolvedValue({
      id: 1, sessionId: 5, session: { id: 5, status: "OPEN" }, transaction: { id: 99, reconciled: true },
    })
    const result = await deleteReceipt(1)
    expect(result).toEqual({ error: expect.stringContaining("reconciled") })
    expect(mockDeleteReceipt).not.toHaveBeenCalled()
  })

  it("blocks the delete when a concurrent close flips the session CLOSED inside the transaction", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    // Outer read still sees OPEN — the close lands after this fetch...
    mockFindReceipt.mockResolvedValue({ id: 1, sessionId: 5, session: { id: 5, status: "OPEN" } })
    // ...but the in-tx re-check (assertSessionOpenTx, lock pattern) sees
    // the now-CLOSED row: its conditional updateMany matches no row.
    mockUpdateManySession.mockResolvedValue({ count: 0 })
    const result = await deleteReceipt(1)
    expect(result).toEqual({ error: "Cannot delete from closed session" })
    expect(mockDeleteReceipt).not.toHaveBeenCalled()
  })

  it("blocks the delete when a concurrent reconcile lands inside the transaction", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    // Outer read saw the mirror un-reconciled; the reconcile lands after it.
    mockFindReceipt.mockResolvedValue({ id: 1, sessionId: 5, session: { id: 5, status: "OPEN" }, transaction: { id: 99, reconciled: false } })
    mockFindTransaction.mockResolvedValue({ reconciled: true })
    const result = await deleteReceipt(1)
    expect(result).toEqual({ error: expect.stringContaining("reconciled") })
    expect(mockDeleteReceipt).not.toHaveBeenCalled()
  })

  // --- ATO 7-year retention floor ---

  it("blocks deleting a receipt dated within the 7-year retention window", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const recentDate = new Date()
    recentDate.setFullYear(recentDate.getFullYear() - 1) // 1 year ago
    mockFindReceipt.mockResolvedValue({ id: 1, sessionId: 5, date: recentDate, session: { id: 5, status: "OPEN" } })
    const result = await deleteReceipt(1)
    expect(result).toEqual({ error: expect.stringMatching(/retention/i) })
    expect(mockDeleteReceipt).not.toHaveBeenCalled()
  })

  it("allows deleting a receipt dated older than 7 years (still subject to other guards)", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const oldDate = new Date()
    oldDate.setFullYear(oldDate.getFullYear() - 8) // 8 years ago, past the floor
    mockFindReceipt.mockResolvedValue({ id: 1, sessionId: 5, date: oldDate, session: { id: 5, status: "OPEN" } })
    await deleteReceipt(1)
    expect(mockDeleteReceipt).toHaveBeenCalledWith({ where: { id: 1 } })
  })
})

describe("deleteTransfer", () => {
  it("deletes transfer for ADMIN", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindTransfer.mockResolvedValue({ id: 1, sessionId: 5, session: { id: 5, status: "OPEN" } })
    await deleteTransfer(1)
    expect(mockDeleteTransfer).toHaveBeenCalledWith({ where: { id: 1 } })
  })

  it("blocks PASTOR from deleting", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    const result = await deleteTransfer(1)
    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockDeleteTransfer).not.toHaveBeenCalled()
  })

  it("blocks the delete when a concurrent close flips the session CLOSED inside the transaction", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindTransfer.mockResolvedValue({ id: 1, sessionId: 5, session: { id: 5, status: "OPEN" } })
    // in-tx re-check (assertSessionOpenTx, lock pattern) sees CLOSED.
    mockUpdateManySession.mockResolvedValue({ count: 0 })
    const result = await deleteTransfer(1)
    expect(result).toEqual({ error: "Cannot delete from closed session" })
    expect(mockDeleteTransfer).not.toHaveBeenCalled()
  })

  it("returns error when transfer not found", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindTransfer.mockResolvedValue(null)
    const result = await deleteTransfer(1)
    expect(result).toEqual({ error: "Transfer not found" })
    expect(mockDeleteTransfer).not.toHaveBeenCalled()
  })

  it("blocks delete from closed session", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindTransfer.mockResolvedValue({ id: 1, sessionId: 5, session: { id: 5, status: "CLOSED" } })
    const result = await deleteTransfer(1)
    expect(result).toEqual({ error: "Cannot delete from closed session" })
    expect(mockDeleteTransfer).not.toHaveBeenCalled()
  })

  it("audit-logs PETTY_CASH_TRANSFER_DELETED", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    mockFindTransfer.mockResolvedValue({
      id: 1, sessionId: 5, amount: { toString: () => "250" },
      session: { id: 5, status: "OPEN" },
    })
    await deleteTransfer(1)
    expect(mockLogAudit).toHaveBeenCalledWith(7, "PETTY_CASH_TRANSFER_DELETED", "PettyCashTransfer", 1, {
      amount: 250,
      sessionId: 5,
    })
  })

  it("audit-logs TRANSACTION_DELETED for the cascaded mirror ledger row", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    mockFindTransfer.mockResolvedValue({
      id: 1, sessionId: 5, amount: { toString: () => "250" },
      session: { id: 5, status: "OPEN" }, transaction: { id: 99 },
    })
    await deleteTransfer(1)
    expect(mockLogAudit).toHaveBeenCalledWith(
      7, "TRANSACTION_DELETED", "Transaction", 99, expect.objectContaining({ source: "petty-cash" })
    )
  })

  it("blocks delete when the mirror transaction is reconciled", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    mockFindTransfer.mockResolvedValue({
      id: 1, sessionId: 5, session: { id: 5, status: "OPEN" }, transaction: { id: 99, reconciled: true },
    })
    const result = await deleteTransfer(1)
    expect(result).toEqual({ error: expect.stringContaining("reconciled") })
    expect(mockDeleteTransfer).not.toHaveBeenCalled()
  })

  // --- ATO 7-year retention floor ---

  it("blocks deleting a transfer dated within the 7-year retention window", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const recentDate = new Date()
    recentDate.setFullYear(recentDate.getFullYear() - 1) // 1 year ago
    mockFindTransfer.mockResolvedValue({ id: 1, sessionId: 5, date: recentDate, session: { id: 5, status: "OPEN" } })
    const result = await deleteTransfer(1)
    expect(result).toEqual({ error: expect.stringMatching(/retention/i) })
    expect(mockDeleteTransfer).not.toHaveBeenCalled()
  })

  it("allows deleting a transfer dated older than 7 years (still subject to other guards)", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const oldDate = new Date()
    oldDate.setFullYear(oldDate.getFullYear() - 8) // 8 years ago, past the floor
    mockFindTransfer.mockResolvedValue({ id: 1, sessionId: 5, date: oldDate, session: { id: 5, status: "OPEN" } })
    await deleteTransfer(1)
    expect(mockDeleteTransfer).toHaveBeenCalledWith({ where: { id: 1 } })
  })
})

// --- updateReceipt ---
describe("updateReceipt", () => {
  const openReceipt = { id: 1, sessionId: 5, serviceTypeId: null, session: { id: 5, status: "OPEN", title: "11-MAY-2026" } }
  const receiptFd = { date: "2026-05-12", accountId: "3", amount: "75.00" }

  it("updates receipt AND mirrored transaction atomically for ADMIN", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    mockFindReceipt.mockResolvedValue(openReceipt)
    mockFindAccount.mockResolvedValue({ type: "INCOME", isActive: true, name: "Tithe" })
    await updateReceipt(1, undefined, fd(receiptFd))
    expect(mockPrismaTransaction).toHaveBeenCalled()
    expect(mockUpdateReceipt).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ accountId: 3, amount: "75.00", personId: null, notes: null }),
    })
    expect(mockUpdateManyTransaction).toHaveBeenCalledWith({
      where: { pettyCashReceiptId: 1 },
      data: expect.objectContaining({
        amount: "75.00",
        accountId: 3,
        description: "enc:Tithe",
        type: "INCOME",          // defensively re-asserted on the mirror
        paymentAccountId: 2,
      }),
    })
    expect(mockRedirect).toHaveBeenCalledWith("/accounting/petty-cash/sessions/5")
  })

  it("does not spread the form-only confirmDuplicate flag into the Prisma update", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    mockFindReceipt.mockResolvedValue(openReceipt)
    mockFindAccount.mockResolvedValue({ type: "INCOME", isActive: true, name: "Tithe" })
    await updateReceipt(1, undefined, fd({ ...receiptFd, confirmDuplicate: "true" }))
    // PettyCashReceipt has no confirmDuplicate column — it must never reach Prisma.
    expect(mockUpdateReceipt.mock.calls[0][0].data.confirmDuplicate).toBeUndefined()
  })

  it("allows PASTOR to update (matches createReceipt)", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    mockFindReceipt.mockResolvedValue(openReceipt)
    mockFindAccount.mockResolvedValue({ type: "INCOME", isActive: true, name: "Tithe" })
    await updateReceipt(1, undefined, fd(receiptFd))
    expect(mockUpdateReceipt).toHaveBeenCalled()
  })

  it("encrypts notes at rest on update", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    mockFindReceipt.mockResolvedValue(openReceipt)
    mockFindAccount.mockResolvedValue({ type: "INCOME", isActive: true, name: "Tithe" })
    await updateReceipt(1, undefined, fd({ ...receiptFd, notes: "Jane Doe" }))
    expect(mockUpdateReceipt).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ notes: "enc:Jane Doe" }),
    })
  })

  it("blocks VIEWER from updating", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "VIEWER" } })
    const result = await updateReceipt(1, undefined, fd(receiptFd))
    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockUpdateReceipt).not.toHaveBeenCalled()
  })

  it("blocks update in closed session", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    mockFindReceipt.mockResolvedValue({ ...openReceipt, session: { id: 5, status: "CLOSED", title: "11-MAY-2026" } })
    const result = await updateReceipt(1, undefined, fd(receiptFd))
    expect(result).toEqual({ error: "Cannot edit in closed session" })
    expect(mockUpdateReceipt).not.toHaveBeenCalled()
  })

  it("rejects EXPENSE account on receipt", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    mockFindReceipt.mockResolvedValue(openReceipt)
    mockFindAccount.mockResolvedValue({ type: "EXPENSE", isActive: true, name: "Stationery" })
    const result = await updateReceipt(1, undefined, fd(receiptFd))
    expect(result).toEqual({ error: "Invalid account" })
    expect(mockUpdateReceipt).not.toHaveBeenCalled()
  })

  it("returns error when receipt not found", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    mockFindReceipt.mockResolvedValue(null)
    const result = await updateReceipt(99, undefined, fd(receiptFd))
    expect(result).toEqual({ error: "Receipt not found" })
  })

  it("forces date to session date on update — ignores submitted date", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    mockFindReceipt.mockResolvedValue(openReceipt)
    mockFindAccount.mockResolvedValue({ type: "INCOME", isActive: true, name: "Tithe" })
    await updateReceipt(1, undefined, fd(receiptFd))
    expect(mockUpdateReceipt).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ date: new Date("2026-05-11T00:00:00") }),
    })
    expect(mockUpdateManyTransaction).toHaveBeenCalledWith({
      where: { pettyCashReceiptId: 1 },
      data: expect.objectContaining({ date: new Date("2026-05-11T00:00:00") }),
    })
  })

  it("audit-logs PETTY_CASH_RECEIPT_UPDATED", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    mockFindReceipt.mockResolvedValue(openReceipt)
    mockFindAccount.mockResolvedValue({ type: "INCOME", isActive: true, name: "Tithe" })
    await updateReceipt(1, undefined, fd(receiptFd))
    expect(mockLogAudit).toHaveBeenCalledWith(7, "PETTY_CASH_RECEIPT_UPDATED", "PettyCashReceipt", 1, {
      amount: "75.00",
      accountId: 3,
      sessionId: 5,
    })
  })

  it("blocks edit when the mirror transaction is reconciled", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    mockFindReceipt.mockResolvedValue({ ...openReceipt, transaction: { reconciled: true } })
    const result = await updateReceipt(1, undefined, fd(receiptFd))
    expect(result).toEqual({ error: expect.stringContaining("reconciled") })
    expect(mockPrismaTransaction).not.toHaveBeenCalled()
  })

  // --- donor/family mirror sync ---
  it("mirrors the (possibly changed) donor's family + isGiving onto the ledger row", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    mockFindReceipt.mockResolvedValue(openReceipt)
    mockFindAccount.mockResolvedValue({ type: "INCOME", isActive: true, name: "Tithe" })
    mockFindPerson.mockResolvedValue({ id: 9, familyId: 42 })
    await updateReceipt(1, undefined, fd({ ...receiptFd, personId: "9" }))
    expect(mockUpdateManyTransaction).toHaveBeenCalledWith({
      where: { pettyCashReceiptId: 1 },
      data: expect.objectContaining({ personId: 9, familyId: 42, isGiving: true }),
    })
  })

  it("clears personId/familyId/isGiving on the mirror when the donor is removed", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    mockFindReceipt.mockResolvedValue(openReceipt)
    mockFindAccount.mockResolvedValue({ type: "INCOME", isActive: true, name: "Tithe" })
    await updateReceipt(1, undefined, fd(receiptFd)) // no personId in the form
    expect(mockUpdateManyTransaction).toHaveBeenCalledWith({
      where: { pettyCashReceiptId: 1 },
      data: expect.objectContaining({ personId: null, familyId: null, isGiving: false }),
    })
    expect(mockFindPerson).not.toHaveBeenCalled()
  })

  it("a donor with no family clears familyId/isGiving even though personId is set", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    mockFindReceipt.mockResolvedValue(openReceipt)
    mockFindAccount.mockResolvedValue({ type: "INCOME", isActive: true, name: "Tithe" })
    mockFindPerson.mockResolvedValue({ id: 9, familyId: null })
    await updateReceipt(1, undefined, fd({ ...receiptFd, personId: "9" }))
    expect(mockUpdateManyTransaction).toHaveBeenCalledWith({
      where: { pettyCashReceiptId: 1 },
      data: expect.objectContaining({ personId: 9, familyId: null, isGiving: false }),
    })
  })
})

// --- createExpense ---
describe("createExpense", () => {
  it("rejects an amount with more than 2 decimal places instead of silently truncating", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindSession.mockResolvedValue({ id: 5, status: "OPEN", title: "11-MAY-2026" })
    mockFindAccount.mockResolvedValue({ type: "EXPENSE", isActive: true })
    const result = await createExpense(5, undefined, fd({ date: "2026-05-11", payee: "Woolworths", accountId: "4", amount: "45.678" }))
    expect(result).toEqual({ error: "Amount: max 2 decimal places" })
    expect(mockPrismaTransaction).not.toHaveBeenCalled()
  })

  it("creates expense AND transaction atomically for open session", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    mockFindSession.mockResolvedValue({ id: 5, status: "OPEN", title: "11-MAY-2026" })
    mockFindAccount.mockResolvedValue({ type: "EXPENSE", isActive: true })
    mockCreateExpense.mockResolvedValue({ id: 3, date: new Date("2026-05-11"), amount: 45, accountId: 4, sessionId: 5, payee: "Woolworths" })
    await createExpense(5, undefined, fd({ date: "2026-05-11", payee: "Woolworths", accountId: "4", amount: "45.00", description: "Morning tea" }))
    expect(mockPrismaTransaction).toHaveBeenCalled()
    expect(mockCreateExpense).toHaveBeenCalledWith({
      data: expect.objectContaining({ sessionId: 5, payee: "enc:Woolworths", description: "enc:Morning tea", accountId: 4, amount: "45.00" }),
    })
    expect(mockCreateTransaction).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "EXPENSE",
        accountId: 4,
        amount: 45,
        isGiving: false,
        paymentAccountId: 2,
        bankRef: "PC_E_3",
        pettyCashExpenseId: 3,
      }),
    })
  })

  it("returns error when accountId missing — no $transaction called", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindSession.mockResolvedValue({ id: 5, status: "OPEN", title: "11-MAY-2026" })
    const result = await createExpense(5, undefined, fd({ date: "2026-05-11", payee: "X", amount: "10", description: "X" }))
    expect(result?.error).toBeTruthy()
    expect(mockPrismaTransaction).not.toHaveBeenCalled()
    expect(mockCreateExpense).not.toHaveBeenCalled()
  })

  it("returns error for closed session", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindSession.mockResolvedValue({ id: 5, status: "CLOSED", title: "11-MAY-2026" })
    const result = await createExpense(5, undefined, fd({ date: "2026-05-11", payee: "X", accountId: "4", amount: "10", description: "X" }))
    expect(result).toEqual({ error: "Session is closed" })
    expect(mockPrismaTransaction).not.toHaveBeenCalled()
  })

  it("uses account name as transaction description", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    mockFindSession.mockResolvedValue({ id: 5, status: "OPEN", title: "11-MAY-2026" })
    mockFindAccount.mockResolvedValue({ type: "EXPENSE", isActive: true, name: "Stationery" })
    mockCreateExpense.mockResolvedValue({ id: 7, date: new Date("2026-05-11"), amount: 20, accountId: 4, sessionId: 5, payee: "Kmart" })
    await createExpense(5, undefined, fd({ date: "2026-05-11", payee: "Kmart", accountId: "4", amount: "20.00", description: "Printer paper" }))
    expect(mockCreateTransaction).toHaveBeenCalledWith({
      data: expect.objectContaining({ description: "enc:Stationery" }),
    })
  })

  it("forces expense date to session date from title — no date field submitted", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    mockFindSession.mockResolvedValue({ id: 5, status: "OPEN", title: "10-JAN-2026" })
    mockFindAccount.mockResolvedValue({ type: "EXPENSE", isActive: true, name: "Stationery" })
    mockCreateExpense.mockResolvedValue({ id: 3, date: new Date("2026-01-10T00:00:00"), amount: 45, accountId: 4, sessionId: 5, payee: "Woolworths" })
    await createExpense(5, undefined, fd({ payee: "Woolworths", accountId: "4", amount: "45.00", description: "Morning tea" }))
    expect(mockCreateExpense).toHaveBeenCalledWith({
      data: expect.objectContaining({ date: new Date("2026-01-10T00:00:00") }),
    })
  })

  it("audit-logs PETTY_CASH_EXPENSE_CREATED", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    mockFindSession.mockResolvedValue({ id: 5, status: "OPEN", title: "11-MAY-2026" })
    mockFindAccount.mockResolvedValue({ type: "EXPENSE", isActive: true, name: "Stationery" })
    mockCreateExpense.mockResolvedValue({ id: 3, date: new Date("2026-05-11"), amount: 45, accountId: 4, sessionId: 5, payee: "Woolworths" })
    await createExpense(5, undefined, fd({ date: "2026-05-11", payee: "Woolworths", accountId: "4", amount: "45.00", description: "Morning tea" }))
    expect(mockLogAudit).toHaveBeenCalledWith(7, "PETTY_CASH_EXPENSE_CREATED", "PettyCashExpense", 3, {
      amount: "45.00",
      accountId: 4,
      sessionId: 5,
    })
  })
})

// --- createExpense duplicate detection ---
describe("createExpense duplicate detection", () => {
  const expenseFd = { date: "2026-05-11", payee: "Woolworths", accountId: "4", amount: "45.00", description: "Morning tea" }

  beforeEach(() => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindSession.mockResolvedValue({ id: 5, status: "OPEN", title: "11-MAY-2026" })
    mockFindAccount.mockResolvedValue({ type: "EXPENSE", isActive: true, name: "Stationery" })
    mockCreateExpense.mockResolvedValue({ id: 3, date: new Date("2026-05-11"), amount: 45, accountId: 4, sessionId: 5, payee: "Woolworths" })
  })

  it("blocks an exact duplicate (same date+amount+payee+description in the session) without confirmation", async () => {
    mockFindManyExpense.mockResolvedValue([{ payee: "enc:Woolworths", description: "enc:Morning tea" }])
    const result = await createExpense(5, undefined, fd(expenseFd))
    expect(result).toEqual({
      error: expect.stringMatching(/duplicate/i),
      duplicateWarning: true,
    })
    expect(mockPrismaTransaction).not.toHaveBeenCalled()
    expect(mockCreateExpense).not.toHaveBeenCalled()
  })

  it("queries candidates scoped to sessionId+date+amount", async () => {
    await createExpense(5, undefined, fd(expenseFd))
    expect(mockFindManyExpense).toHaveBeenCalledWith({
      where: { sessionId: 5, date: new Date("2026-05-11T00:00:00"), amount: "45.00" },
      select: { payee: true, description: true },
    })
  })

  it("posts when a duplicate candidate exists but confirmDuplicate is set", async () => {
    mockFindManyExpense.mockResolvedValue([{ payee: "enc:Woolworths", description: "enc:Morning tea" }])
    await createExpense(5, undefined, fd({ ...expenseFd, confirmDuplicate: "true" }))
    expect(mockPrismaTransaction).toHaveBeenCalled()
    expect(mockCreateExpense).toHaveBeenCalled()
    const arg = mockCreateExpense.mock.calls[0][0]
    // confirmDuplicate is a form-only flag — it must never leak into the
    // PettyCashExpense row (the model has no such column).
    expect(arg.data.confirmDuplicate).toBeUndefined()
  })

  it("does not flag a same date+amount row with a different payee or description", async () => {
    mockFindManyExpense.mockResolvedValue([{ payee: "enc:Kmart", description: "enc:Printer paper" }])
    await createExpense(5, undefined, fd(expenseFd))
    expect(mockCreateExpense).toHaveBeenCalled()
  })

  it("posts normally when no candidate rows exist", async () => {
    mockFindManyExpense.mockResolvedValue([])
    await createExpense(5, undefined, fd(expenseFd))
    expect(mockCreateExpense).toHaveBeenCalled()
  })

  // a corrupt/unrotated-key candidate row must not make the duplicate
  // check throw for the whole request — it should be skipped (treated as "not
  // a match") like any other non-matching row.
  it("does not throw when a candidate row's payee is undecryptable, and posts normally", async () => {
    mockFindManyExpense.mockResolvedValue([{ payee: "enc:CORRUPT-ROW", description: "enc:Morning tea" }])
    await createExpense(5, undefined, fd(expenseFd))
    expect(mockCreateExpense).toHaveBeenCalled()
  })
})

// --- deleteExpense ---
describe("deleteExpense", () => {
  it("deletes expense for ADMIN", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindExpense.mockResolvedValue({ id: 1, sessionId: 5, session: { id: 5, status: "OPEN" } })
    await deleteExpense(1)
    expect(mockDeleteExpense).toHaveBeenCalledWith({ where: { id: 1 } })
  })

  it("blocks the delete when a concurrent close flips the session CLOSED inside the transaction", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindExpense.mockResolvedValue({ id: 1, sessionId: 5, session: { id: 5, status: "OPEN" } })
    // in-tx re-check (assertSessionOpenTx, lock pattern) sees CLOSED.
    mockUpdateManySession.mockResolvedValue({ count: 0 })
    const result = await deleteExpense(1)
    expect(result).toEqual({ error: "Cannot delete from closed session" })
    expect(mockDeleteExpense).not.toHaveBeenCalled()
  })

  it("blocks PASTOR from deleting", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    const result = await deleteExpense(1)
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("blocks delete from closed session", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindExpense.mockResolvedValue({ id: 1, sessionId: 5, session: { id: 5, status: "CLOSED" } })
    const result = await deleteExpense(1)
    expect(result).toEqual({ error: "Cannot delete from closed session" })
  })

  it("audit-logs PETTY_CASH_EXPENSE_DELETED", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    mockFindExpense.mockResolvedValue({
      id: 1,
      sessionId: 5,
      amount: { toString: () => "45" }, // Prisma Decimal mock
      accountId: 4,
      session: { id: 5, status: "OPEN" },
    })
    await deleteExpense(1)
    expect(mockLogAudit).toHaveBeenCalledWith(7, "PETTY_CASH_EXPENSE_DELETED", "PettyCashExpense", 1, {
      amount: 45,
      accountId: 4,
      sessionId: 5,
    })
  })

  it("audit-logs TRANSACTION_DELETED for the cascaded mirror ledger row", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    mockFindExpense.mockResolvedValue({
      id: 1, sessionId: 5, amount: { toString: () => "45" }, accountId: 4,
      session: { id: 5, status: "OPEN" }, transaction: { id: 88 },
    })
    await deleteExpense(1)
    expect(mockLogAudit).toHaveBeenCalledWith(
      7, "TRANSACTION_DELETED", "Transaction", 88, expect.objectContaining({ source: "petty-cash" })
    )
  })

  it("blocks delete when the mirror transaction is reconciled", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    mockFindExpense.mockResolvedValue({
      id: 1, sessionId: 5, session: { id: 5, status: "OPEN" }, transaction: { id: 88, reconciled: true },
    })
    const result = await deleteExpense(1)
    expect(result).toEqual({ error: expect.stringContaining("reconciled") })
    expect(mockDeleteExpense).not.toHaveBeenCalled()
  })

  // --- ATO 7-year retention floor ---

  it("blocks deleting an expense dated within the 7-year retention window", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const recentDate = new Date()
    recentDate.setFullYear(recentDate.getFullYear() - 1) // 1 year ago
    mockFindExpense.mockResolvedValue({ id: 1, sessionId: 5, date: recentDate, session: { id: 5, status: "OPEN" } })
    const result = await deleteExpense(1)
    expect(result).toEqual({ error: expect.stringMatching(/retention/i) })
    expect(mockDeleteExpense).not.toHaveBeenCalled()
  })

  it("allows deleting an expense dated older than 7 years (still subject to other guards)", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const oldDate = new Date()
    oldDate.setFullYear(oldDate.getFullYear() - 8) // 8 years ago, past the floor
    mockFindExpense.mockResolvedValue({ id: 1, sessionId: 5, date: oldDate, session: { id: 5, status: "OPEN" } })
    await deleteExpense(1)
    expect(mockDeleteExpense).toHaveBeenCalledWith({ where: { id: 1 } })
  })
})

// --- updateExpense ---
describe("updateExpense", () => {
  const openExpense = { id: 3, sessionId: 5, session: { id: 5, status: "OPEN", title: "11-MAY-2026" } }
  const expenseFd = { date: "2026-05-12", payee: "Kmart", accountId: "4", amount: "30.00", description: "Printer paper" }

  it("updates expense AND mirrored transaction atomically for ADMIN", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    mockFindExpense.mockResolvedValue(openExpense)
    mockFindAccount.mockResolvedValue({ type: "EXPENSE", isActive: true, name: "Stationery" })
    await updateExpense(3, undefined, fd(expenseFd))
    expect(mockPrismaTransaction).toHaveBeenCalled()
    expect(mockUpdateExpense).toHaveBeenCalledWith({
      where: { id: 3 },
      // payee + description encrypted at rest
      data: expect.objectContaining({ payee: "enc:Kmart", description: "enc:Printer paper", accountId: 4, amount: "30.00", receiptRef: null }),
    })
    expect(mockUpdateManyTransaction).toHaveBeenCalledWith({
      where: { pettyCashExpenseId: 3 },
      data: expect.objectContaining({
        amount: "30.00",
        accountId: 4,
        description: "enc:Stationery",
        type: "EXPENSE",          // defensively re-asserted on the mirror
        paymentAccountId: 2,
      }),
    })
    expect(mockRedirect).toHaveBeenCalledWith("/accounting/petty-cash/sessions/5")
  })

  it("allows PASTOR to update (matches createExpense)", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    mockFindExpense.mockResolvedValue(openExpense)
    mockFindAccount.mockResolvedValue({ type: "EXPENSE", isActive: true, name: "Stationery" })
    await updateExpense(3, undefined, fd(expenseFd))
    expect(mockUpdateExpense).toHaveBeenCalled()
  })

  it("blocks VIEWER from updating", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "VIEWER" } })
    const result = await updateExpense(3, undefined, fd(expenseFd))
    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockUpdateExpense).not.toHaveBeenCalled()
  })

  it("blocks update in closed session", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    mockFindExpense.mockResolvedValue({ ...openExpense, session: { id: 5, status: "CLOSED", title: "11-MAY-2026" } })
    const result = await updateExpense(3, undefined, fd(expenseFd))
    expect(result).toEqual({ error: "Cannot edit in closed session" })
    expect(mockUpdateExpense).not.toHaveBeenCalled()
  })

  it("rejects INCOME account on expense", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    mockFindExpense.mockResolvedValue(openExpense)
    mockFindAccount.mockResolvedValue({ type: "INCOME", isActive: true, name: "Tithe" })
    const result = await updateExpense(3, undefined, fd(expenseFd))
    expect(result).toEqual({ error: "Invalid account" })
    expect(mockUpdateExpense).not.toHaveBeenCalled()
  })

  it("forces date to session date on update — ignores submitted date", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    mockFindExpense.mockResolvedValue(openExpense)
    mockFindAccount.mockResolvedValue({ type: "EXPENSE", isActive: true, name: "Stationery" })
    await updateExpense(3, undefined, fd(expenseFd))
    expect(mockUpdateExpense).toHaveBeenCalledWith({
      where: { id: 3 },
      data: expect.objectContaining({ date: new Date("2026-05-11T00:00:00") }),
    })
    expect(mockUpdateManyTransaction).toHaveBeenCalledWith({
      where: { pettyCashExpenseId: 3 },
      data: expect.objectContaining({ date: new Date("2026-05-11T00:00:00") }),
    })
  })

  it("audit-logs PETTY_CASH_EXPENSE_UPDATED", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    mockFindExpense.mockResolvedValue(openExpense)
    mockFindAccount.mockResolvedValue({ type: "EXPENSE", isActive: true, name: "Stationery" })
    await updateExpense(3, undefined, fd(expenseFd))
    expect(mockLogAudit).toHaveBeenCalledWith(7, "PETTY_CASH_EXPENSE_UPDATED", "PettyCashExpense", 3, {
      amount: "30.00",
      accountId: 4,
      sessionId: 5,
    })
  })

  it("blocks edit when the mirror transaction is reconciled", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    mockFindExpense.mockResolvedValue({ ...openExpense, transaction: { reconciled: true } })
    const result = await updateExpense(3, undefined, fd(expenseFd))
    expect(result).toEqual({ error: expect.stringContaining("reconciled") })
    expect(mockPrismaTransaction).not.toHaveBeenCalled()
  })

  it("never leaks confirmDuplicate into the Prisma update payload", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    mockFindExpense.mockResolvedValue(openExpense)
    mockFindAccount.mockResolvedValue({ type: "EXPENSE", isActive: true, name: "Stationery" })
    // confirmDuplicate is a form-only flag — PettyCashExpense has no such column,
    // so it must be stripped before the spread or Prisma throws on every edit.
    await updateExpense(3, undefined, fd({ ...expenseFd, confirmDuplicate: "true" }))
    const arg = mockUpdateExpense.mock.calls[0][0]
    expect(arg.data).not.toHaveProperty("confirmDuplicate")
  })
})

// --- createTransfer ---
describe("createTransfer", () => {
  it("returns 'Invalid date' for a malformed date and never opens the balance transaction", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    const result = await createTransfer(5, undefined, fd({ date: "not-a-date", amount: "400", depositedByName: "John" }))
    expect(result).toEqual({ error: "Invalid date" })
    expect(mockFindSession).not.toHaveBeenCalled()
    expect(mockCreateTransfer).not.toHaveBeenCalled()
  })

  it("creates transfer when amount does not exceed balance", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    mockFindSession.mockResolvedValue({
      id: 5,
      status: "OPEN",
      openingBalance: { toString: () => "0" },
      receipts: [{ amount: { toString: () => "500" } }],
      expenses: [],
      transfers: [],
    })
    mockCalcBalance.mockReturnValue(500)
    await createTransfer(5, undefined, fd({ date: "2026-05-12", amount: "400", depositedByName: "John" }))
    expect(mockCreateTransfer).toHaveBeenCalledWith({
      data: expect.objectContaining({ sessionId: 5, amount: "400" }),
    })
  })

  it("encrypts depositedByName and notes at rest", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    mockFindSession.mockResolvedValue({
      id: 5,
      status: "OPEN",
      openingBalance: { toString: () => "0" },
      receipts: [{ amount: { toString: () => "500" } }],
      expenses: [],
      transfers: [],
    })
    mockCalcBalance.mockReturnValue(500)
    await createTransfer(5, undefined, fd({ date: "2026-05-12", amount: "400", depositedByName: "John", notes: "May deposit" }))
    expect(mockCreateTransfer).toHaveBeenCalledWith({
      data: expect.objectContaining({ depositedByName: "enc:John", notes: "enc:May deposit" }),
    })
  })

  it("returns error when transfer exceeds balance", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    mockFindSession.mockResolvedValue({
      id: 5,
      status: "OPEN",
      openingBalance: { toString: () => "0" },
      receipts: [{ amount: { toString: () => "200" } }],
      expenses: [],
      transfers: [],
    })
    mockCalcBalance.mockReturnValue(200)
    const result = await createTransfer(5, undefined, fd({ date: "2026-05-12", amount: "300", depositedByName: "John" }))
    expect(result?.error).toMatch(/exceeds balance/)
  })

  it("rejects depositedByName over 200 chars", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    const result = await createTransfer(
      5,
      undefined,
      fd({ date: "2026-05-12", amount: "100", depositedByName: "A".repeat(201) })
    )
    expect(result?.error).toBeTruthy()
    expect(mockCreateTransfer).not.toHaveBeenCalled()
  })

  it("rejects a malformed date instead of passing Invalid Date to Prisma", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    const result = await createTransfer(
      5,
      undefined,
      fd({ date: "not-a-date", amount: "100", depositedByName: "John" })
    )
    expect(result).toEqual({ error: "Invalid date" })
    expect(mockCreateTransfer).not.toHaveBeenCalled()
  })

  it("audit-logs PETTY_CASH_TRANSFER_CREATED", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    mockFindSession.mockResolvedValue({
      id: 5,
      status: "OPEN",
      openingBalance: { toString: () => "0" },
      receipts: [{ amount: { toString: () => "500" } }],
      expenses: [],
      transfers: [],
    })
    mockCalcBalance.mockReturnValue(500)
    mockCreateTransfer.mockResolvedValue({ id: 3 })
    await createTransfer(5, undefined, fd({ date: "2026-05-12", amount: "400", depositedByName: "John" }))
    expect(mockLogAudit).toHaveBeenCalledWith(7, "PETTY_CASH_TRANSFER_CREATED", "PettyCashTransfer", 3, {
      amount: "400",
      sessionId: 5,
    })
  })

  it("reads balance, validates and inserts inside one transaction", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    mockFindSession.mockResolvedValue({
      id: 5,
      status: "OPEN",
      openingBalance: { toString: () => "0" },
      receipts: [{ amount: { toString: () => "500" } }],
      expenses: [],
      transfers: [],
    })
    mockCalcBalance.mockReturnValue(500)
    await createTransfer(5, undefined, fd({ date: "2026-05-12", amount: "400", depositedByName: "John" }))
    expect(mockPrismaTransaction).toHaveBeenCalled()
  })

  it("returns a clean retry error on a Serializable conflict (P2034)", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    mockPrismaTransaction.mockRejectedValue({ code: "P2034" }) // serialization failure from the race
    const result = await createTransfer(5, undefined, fd({ date: "2026-05-12", amount: "400", depositedByName: "John" }))
    expect(result?.error).toMatch(/try again/i)
  })

  it("writes a PETTY_CASH mirror transaction linked to the transfer", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "7" } })
    mockFindAccount.mockResolvedValue({ id: 7 }) // XFER account
    mockFindSession.mockResolvedValue({
      id: 5,
      status: "OPEN",
      title: "12-MAY-2026",
      openingBalance: { toString: () => "0" },
      receipts: [{ amount: { toString: () => "500" } }],
      expenses: [],
      transfers: [],
    })
    mockCalcBalance.mockReturnValue(500)
    mockCreateTransfer.mockResolvedValue({ id: 42, amount: "400", date: new Date("2026-05-12") })
    await createTransfer(5, undefined, fd({ date: "2026-05-12", amount: "400", depositedByName: "John" }))
    expect(mockCreateTransaction).toHaveBeenCalledWith({
      data: expect.objectContaining({
        paymentAccountId: 2,
        type: "EXPENSE",
        accountId: 7,
        pettyCashTransferId: 42,
        bankRef: "PC_T_42",
      }),
    })
  })
})

// --- createServiceType ---
describe("createServiceType", () => {
  it("creates service type for ADMIN", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindFirstServiceType.mockResolvedValue(null)
    await createServiceType(undefined, fd({ name: "Sunday Service" }))
    expect(mockCreateServiceType).toHaveBeenCalledWith({ data: { name: "Sunday Service" } })
  })

  it("blocks duplicate name", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindFirstServiceType.mockResolvedValue({ id: 1, name: "Sunday Service" })
    const result = await createServiceType(undefined, fd({ name: "Sunday Service" }))
    expect(result).toEqual({ error: "Service type already exists" })
  })

  it("blocks PASTOR", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    const result = await createServiceType(undefined, fd({ name: "X" }))
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("rejects name over 100 chars", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const result = await createServiceType(undefined, fd({ name: "x".repeat(101) }))
    expect(result).toEqual({ error: "Name is too long" })
    expect(mockCreateServiceType).not.toHaveBeenCalled()
  })
})

// --- deleteServiceType ---
describe("deleteServiceType", () => {
  it("deletes when no receipts linked", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockCountReceipt.mockResolvedValue(0)
    await deleteServiceType(1)
    expect(mockDeleteServiceType).toHaveBeenCalledWith({ where: { id: 1 } })
  })

  it("blocks delete when receipts exist", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockCountReceipt.mockResolvedValue(3)
    const result = await deleteServiceType(1)
    expect(result?.error).toMatch(/3 receipt/)
  })
})

describe("pettyCashTitle", () => {
  it("formats YYYY-MM-DD as DD-MMM-YYYY", () => {
    expect(pettyCashTitle("2026-06-14")).toBe("14-JUN-2026")
    expect(pettyCashTitle("2025-12-28")).toBe("28-DEC-2025")
    expect(pettyCashTitle("2026-01-04")).toBe("04-JAN-2026")
  })
})

describe("ensureWeeklySession", () => {
  beforeEach(() => jest.clearAllMocks())

  it("returns not-editor and does nothing for a non-editor", async () => {
    mockSession.mockResolvedValue({ user: { role: "AUDITOR", id: "1" } })
    const res = await ensureWeeklySession()
    expect(res).toEqual({ status: "not-editor" })
    expect(getCustodian).not.toHaveBeenCalled()
    expect(prisma.pettyCashSession.create).not.toHaveBeenCalled()
  })

  it("returns skipped-no-custodian when no default is configured", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    getCustodian.mockResolvedValue(null)
    const res = await ensureWeeklySession()
    expect(res).toEqual({ status: "skipped-no-custodian" })
    expect(prisma.pettyCashSession.create).not.toHaveBeenCalled()
  })

  it("returns skipped-missing-custodian when the configured person no longer exists", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    getCustodian.mockResolvedValue(5)
    ;(prisma.person.findFirst as jest.Mock).mockResolvedValue(null)
    const res = await ensureWeeklySession()
    expect(res).toEqual({ status: "skipped-missing-custodian" })
    expect(prisma.pettyCashSession.create).not.toHaveBeenCalled()
  })

  // an already-stored custodian setting can point at a person archived
  // afterward — the lookup must exclude them, not just check existence.
  it("treats an archived configured custodian as missing", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    getCustodian.mockResolvedValue(5)
    // findFirst scoped to archivedAt: null — an archived person resolves to
    // null, same as a deleted one.
    ;(prisma.person.findFirst as jest.Mock).mockResolvedValue(null)
    const res = await ensureWeeklySession()
    expect(res).toEqual({ status: "skipped-missing-custodian" })
    expect(prisma.person.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 5, archivedAt: null } })
    )
    expect(prisma.pettyCashSession.create).not.toHaveBeenCalled()
  })

  it("returns exists and does not create when a session for that Sunday already exists", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    getCustodian.mockResolvedValue(5)
    ;(prisma.person.findFirst as jest.Mock).mockResolvedValue({ id: 5 })
    ;(prisma.pettyCashSession.findFirst as jest.Mock).mockResolvedValue({ id: 42 })
    const res = await ensureWeeklySession()
    expect(res).toEqual({ status: "exists" })
    expect(prisma.pettyCashSession.create).not.toHaveBeenCalled()
  })

  it("creates a zero-balance session with the default custodian when none exists", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    getCustodian.mockResolvedValue(5)
    ;(prisma.person.findFirst as jest.Mock).mockResolvedValue({ id: 5 })
    ;(prisma.pettyCashSession.findFirst as jest.Mock).mockResolvedValue(null)
    mockFindManySession.mockResolvedValue([]) // no prior sessions to carry from
    ;(prisma.pettyCashSession.create as jest.Mock).mockResolvedValue({ id: 99 })
    const res = await ensureWeeklySession()
    expect(res).toEqual({ status: "created" })
    expect(prisma.pettyCashSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ custodianId: 5, openingBalance: 0 }),
    })
    // Called during the page's server render — revalidatePath there is
    // unsupported by Next.js; the page lists after ensure anyway.
    expect(jest.requireMock("next/cache").revalidatePath).not.toHaveBeenCalled()
  })

  it("carries forward the prior session's closing balance as the opening balance", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    getCustodian.mockResolvedValue(5)
    ;(prisma.person.findFirst as jest.Mock).mockResolvedValue({ id: 5 })
    ;(prisma.pettyCashSession.findFirst as jest.Mock).mockResolvedValue(null) // dedup: no session for this Sunday yet
    // One prior session dated well before any real "this Sunday" — its title
    // (not openedAt) makes it the carry-forward source.
    mockFindManySession.mockResolvedValue([
      { id: 7, title: "05-JAN-2020", openedAt: new Date("2020-01-06T00:00:00Z") },
    ])
    ;(prisma.pettyCashSession.findUnique as jest.Mock).mockResolvedValue({
      openingBalance: { toString: () => "10" },
      receipts: [],
      expenses: [],
      transfers: [],
    })
    mockCalcBalance.mockReturnValue(42.5)
    ;(prisma.pettyCashSession.create as jest.Mock).mockResolvedValue({ id: 99 })
    const res = await ensureWeeklySession()
    expect(res).toEqual({ status: "created" })
    // Loaded the chosen prior by its id, not by an openedAt sort.
    expect(prisma.pettyCashSession.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 7 } })
    )
    expect(prisma.pettyCashSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ custodianId: 5, openingBalance: 42.5 }),
    })
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.anything(),
      "PETTY_CASH_SESSION_AUTO_OPENED",
      "PettyCashSession",
      99,
      expect.objectContaining({ openingBalance: 42.5 })
    )
  })

  it("ignores a later-backfilled older-dated session as the float source", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    getCustodian.mockResolvedValue(5)
    ;(prisma.person.findFirst as jest.Mock).mockResolvedValue({ id: 5 })
    ;(prisma.pettyCashSession.findFirst as jest.Mock).mockResolvedValue(null)
    // Session #8 is dated LATEST but was backfilled last (newest openedAt).
    // Session #9 is dated earlier but is the true chronological predecessor of
    // #8. The pre-fix openedAt sort would pick #8; the date sort must pick #8's
    // predecessor by date — here #8 has the greatest date < this Sunday, so #8
    // wins over #9. Verify selection is by title date, not openedAt.
    mockFindManySession.mockResolvedValue([
      { id: 9, title: "05-JAN-2020", openedAt: new Date("2020-01-06T00:00:00Z") },
      { id: 8, title: "12-JAN-2020", openedAt: new Date("2024-09-01T00:00:00Z") },
    ])
    ;(prisma.pettyCashSession.findUnique as jest.Mock).mockResolvedValue({
      openingBalance: { toString: () => "0" },
      receipts: [],
      expenses: [],
      transfers: [],
    })
    mockCalcBalance.mockReturnValue(0)
    ;(prisma.pettyCashSession.create as jest.Mock).mockResolvedValue({ id: 99 })
    await ensureWeeklySession()
    // #8 has the latest session DATE (12-JAN over 05-JAN) → chosen despite the
    // two rows' openedAt order being irrelevant.
    expect(prisma.pettyCashSession.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 8 } })
    )
  })

  it("treats a P2002 create as exists, not a 500 ( race)", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    getCustodian.mockResolvedValue(5)
    ;(prisma.person.findFirst as jest.Mock).mockResolvedValue({ id: 5 })
    ;(prisma.pettyCashSession.findFirst as jest.Mock).mockResolvedValue(null)
    mockFindManySession.mockResolvedValue([])
    ;(prisma.pettyCashSession.create as jest.Mock).mockRejectedValue(
      Object.assign(new Error("Unique constraint"), { code: "P2002" })
    )
    const res = await ensureWeeklySession()
    expect(res).toEqual({ status: "exists" })
  })

  it("rethrows a non-P2002 create error", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    getCustodian.mockResolvedValue(5)
    ;(prisma.person.findFirst as jest.Mock).mockResolvedValue({ id: 5 })
    ;(prisma.pettyCashSession.findFirst as jest.Mock).mockResolvedValue(null)
    mockFindManySession.mockResolvedValue([])
    ;(prisma.pettyCashSession.create as jest.Mock).mockRejectedValue(
      Object.assign(new Error("boom"), { code: "P2003" })
    )
    await expect(ensureWeeklySession()).rejects.toThrow("boom")
  })
})

describe("OFFICE_ADMIN blocked from petty-cash mutations", () => {
  beforeEach(() => jest.clearAllMocks())

  it("blocks OFFICE_ADMIN from creating a petty-cash receipt", async () => {
    mockSession.mockResolvedValue({ user: { id: "1", role: "OFFICE_ADMIN" } })
    const result = await createReceipt(5, undefined, fd({ accountId: "1", amount: "100.00" }))
    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockPrismaTransaction).not.toHaveBeenCalled()
  })

  it("blocks OFFICE_ADMIN from creating a session", async () => {
    mockSession.mockResolvedValue({ user: { id: "1", role: "OFFICE_ADMIN" } })
    const result = await createSession(undefined, fd({ sessionDate: "2026-05-22", custodianId: "1" }))
    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockCreateSession).not.toHaveBeenCalled()
  })

  it("returns not-editor for OFFICE_ADMIN in ensureWeeklySession", async () => {
    mockSession.mockResolvedValue({ user: { id: "1", role: "OFFICE_ADMIN" } })
    const result = await ensureWeeklySession()
    expect(result).toEqual({ status: "not-editor" })
    expect(getCustodian).not.toHaveBeenCalled()
  })
})

describe("period lock", () => {
  const LOCK_ERR = "This date is in a locked accounting period (on or before 2026-06-30)."

  beforeEach(() => jest.clearAllMocks())

  it("createReceipt rejects when the session date is locked", async () => {
    mockSession.mockResolvedValue({ user: { id: "7", role: "ADMIN" } })
    mockFindSession.mockResolvedValue({ id: 1, status: "OPEN", title: "15-JUN-2026" })
    mockAssertUnlocked.mockResolvedValueOnce(LOCK_ERR)
    const result = await createReceipt(1, undefined, fd({ accountId: "1", amount: "100.00" }))
    expect(result).toEqual({ error: LOCK_ERR })
    expect(mockPrismaTransaction).not.toHaveBeenCalled()
  })

  it("createExpense rejects when the session date is locked", async () => {
    mockSession.mockResolvedValue({ user: { id: "7", role: "ADMIN" } })
    mockFindSession.mockResolvedValue({ id: 1, status: "OPEN", title: "15-JUN-2026" })
    mockAssertUnlocked.mockResolvedValueOnce(LOCK_ERR)
    const result = await createExpense(1, undefined, fd({ payee: "Shop", accountId: "4", amount: "20.00", description: "Supplies" }))
    expect(result).toEqual({ error: LOCK_ERR })
    expect(mockPrismaTransaction).not.toHaveBeenCalled()
  })

  it("createTransfer rejects when the transfer date is locked", async () => {
    mockSession.mockResolvedValue({ user: { id: "7", role: "ADMIN" } })
    mockAssertUnlocked.mockResolvedValueOnce(LOCK_ERR)
    const result = await createTransfer(1, undefined, fd({ date: "2026-06-15", amount: "100.00", depositedByName: "John" }))
    expect(result).toEqual({ error: LOCK_ERR })
    expect(mockPrismaTransaction).not.toHaveBeenCalled()
  })

  it("deleteReceipt rejects when the session date is locked", async () => {
    mockSession.mockResolvedValue({ user: { id: "7", role: "ADMIN" } })
    mockFindReceipt.mockResolvedValue({
      id: 1, sessionId: 5, amount: { toString: () => "50" }, accountId: 1,
      session: { id: 5, status: "OPEN", title: "15-JUN-2026" },
    })
    mockAssertUnlocked.mockResolvedValueOnce(LOCK_ERR)
    const result = await deleteReceipt(1)
    expect(result).toEqual({ error: LOCK_ERR })
    expect(mockDeleteReceipt).not.toHaveBeenCalled()
  })

  it("deleteExpense rejects when the session date is locked", async () => {
    mockSession.mockResolvedValue({ user: { id: "7", role: "ADMIN" } })
    mockFindExpense.mockResolvedValue({
      id: 1, sessionId: 5, amount: { toString: () => "20" }, accountId: 4,
      session: { id: 5, status: "OPEN", title: "15-JUN-2026" },
    })
    mockAssertUnlocked.mockResolvedValueOnce(LOCK_ERR)
    const result = await deleteExpense(1)
    expect(result).toEqual({ error: LOCK_ERR })
    expect(mockDeleteExpense).not.toHaveBeenCalled()
  })

  it("deleteTransfer rejects when the transfer date is locked", async () => {
    mockSession.mockResolvedValue({ user: { id: "7", role: "ADMIN" } })
    mockFindTransfer.mockResolvedValue({
      id: 1, sessionId: 5, amount: { toString: () => "100" },
      date: new Date("2026-06-15"),
      session: { id: 5, status: "OPEN" },
    })
    mockAssertUnlocked.mockResolvedValueOnce(LOCK_ERR)
    const result = await deleteTransfer(1)
    expect(result).toEqual({ error: LOCK_ERR })
    expect(mockDeleteTransfer).not.toHaveBeenCalled()
  })
})

describe("createSession — duplicate title", () => {
  beforeEach(() => jest.clearAllMocks())

  it("returns a friendly error on P2002 instead of throwing", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    ;(prisma.person.findUnique as jest.Mock).mockResolvedValue({ id: 5 })
    ;(prisma.pettyCashSession.create as jest.Mock).mockRejectedValue(
      Object.assign(new Error("Unique constraint"), { code: "P2002" })
    )
    const fd = new FormData()
    fd.set("sessionDate", "2026-06-14")
    fd.set("custodianId", "5")
    fd.set("openingBalance", "0")
    const res = await createSession(undefined, fd)
    expect(res).toEqual({ error: expect.stringContaining("already exists") })
  })
})
