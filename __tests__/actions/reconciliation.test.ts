/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => {
  const prisma: Record<string, unknown> = {
    reconciliationStatement: {
      upsert: jest.fn(),
    },
    accountOpeningBalance: {
      findUnique: jest.fn(),
    },
    // Client-supplied FK existence check, ahead of the transaction — defaults
    // to "found" so existing tests don't all need to stub it.
    paymentAccount: {
      findUnique: jest.fn().mockResolvedValue({ id: 1 }),
    },
    // the locked-range guard reads the lock date via `tx.appSetting`,
    // not the outer prisma singleton — default no lock configured.
    appSetting: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    transaction: {
      aggregate: jest.fn(),
      updateMany: jest.fn(),
    },
    // Interactive transaction: default impl runs the callback with the same mock
    // client (tx === prisma) so per-method assertions still work. Tests that
    // exercise the retry/serialization path override this per-case.
    $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
  }
  return { prisma }
})
jest.mock("@/lib/generated/prisma/client", () => ({
  Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } },
}))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
// Keep ACCOUNTING_LOCK_DATE_KEY/isDateLocked real (pure, no DB) — only
// assertUnlocked (the statement-date pre-check) is mocked.
jest.mock("@/lib/accountingLock", () => ({
  ...jest.requireActual("@/lib/accountingLock"),
  assertUnlocked: jest.fn().mockResolvedValue(null),
}))
jest.mock("@/lib/logger", () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { saveStatementBalance } from "@/lib/actions/reconciliation"
import { assertUnlocked } from "@/lib/accountingLock"
import { logger } from "@/lib/logger"

const mockSession = auth as jest.Mock
const mockAssertUnlocked = assertUnlocked as jest.Mock
const mockUpsert = prisma.reconciliationStatement.upsert as jest.Mock
const mockLockAppSetting = prisma.appSetting.findUnique as jest.Mock
const mockRevalidate = revalidatePath as jest.Mock
const mockOpening = prisma.accountOpeningBalance.findUnique as jest.Mock
const mockAggregate = prisma.transaction.aggregate as jest.Mock
const mockUpdateMany = prisma.transaction.updateMany as jest.Mock
const mockTransaction = (prisma as unknown as { $transaction: jest.Mock }).$transaction
const mockLoggerError = logger.error as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  // Restore the default pass-through impl (tx === prisma) after any per-test override.
  mockTransaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma))
})

describe("saveStatementBalance", () => {
  it("saveStatementBalance rejects a statement date in the locked period", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    const LOCK_ERR = "This date is in a locked accounting period (on or before 2026-06-30)."
    mockAssertUnlocked.mockResolvedValueOnce(LOCK_ERR)
    const result = await saveStatementBalance(1, "2026-05-01", "100.00")
    expect(result).toEqual({ error: LOCK_ERR })
  })

  it("returns Unauthorized for unauthenticated user", async () => {
    mockSession.mockResolvedValue(null)
    const result = await saveStatementBalance(1, "2026-05-31", "12820.00")
    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it("returns Unauthorized for VIEWER role", async () => {
    mockSession.mockResolvedValue({ user: { role: "VIEWER", id: "1" } })
    const result = await saveStatementBalance(1, "2026-05-31", "12820.00")
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("returns Unauthorized for AUDITOR role", async () => {
    mockSession.mockResolvedValue({ user: { role: "AUDITOR", id: "1" } })
    const result = await saveStatementBalance(1, "2026-05-31", "12820.00")
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("returns error for invalid paymentAccount", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    const result = await saveStatementBalance("INVALID" as any, "2026-05-31", "12820.00")
    expect(result && "error" in result ? result.error : undefined).toBeDefined()
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it("returns error for invalid date", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    const result = await saveStatementBalance(1, "not-a-date", "12820.00")
    expect(result && "error" in result ? result.error : undefined).toBeDefined()
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it("returns error for invalid amount", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    const result = await saveStatementBalance(1, "2026-05-31", "abc")
    expect(result && "error" in result ? result.error : undefined).toBeDefined()
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it("upserts and returns success for ADMIN", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockUpsert.mockResolvedValue({ id: 42 })
    const result = await saveStatementBalance(1, "2026-05-31", "12820.00")
    expect(result).toEqual({ success: "Saved" })
    expect(mockUpsert).toHaveBeenCalledWith({
      where: {
        paymentAccountId_statementDate: {
          paymentAccountId: 1,
          statementDate: new Date("2026-05-31"),
        },
      },
      create: {
        paymentAccountId: 1,
        statementDate: new Date("2026-05-31"),
        closingBalance: "12820.00",
      },
      update: { closingBalance: "12820.00" },
    })
    expect(mockRevalidate).toHaveBeenCalledWith("/accounting/reconciliation")
    // Reconcile-on-save can change dashboard balances → /accounting too.
    expect(mockRevalidate).toHaveBeenCalledWith("/accounting")
  })

  it("accepts a negative closing balance (overdrawn account)", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockUpsert.mockResolvedValue({ id: 43 })
    const result = await saveStatementBalance(1, "2026-05-31", "-150.25")
    expect(result).toEqual({ success: "Saved" })
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ closingBalance: "-150.25" }),
        update: { closingBalance: "-150.25" },
      })
    )
  })

  it("rejects a too-large negative balance", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    const result = await saveStatementBalance(1, "2026-05-31", "-100000000.00")
    expect(result && "error" in result ? result.error : undefined).toBeDefined()
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it("upserts for PASTOR role", async () => {
    mockSession.mockResolvedValue({ user: { role: "PASTOR", id: "2" } })
    mockUpsert.mockResolvedValue({ id: 7 })
    const result = await saveStatementBalance(2, "2026-04-30", "5000.00")
    expect(result).toEqual({ success: "Saved" })
  })

  it("returns error on DB failure", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockUpsert.mockRejectedValue(new Error("DB down"))
    const result = await saveStatementBalance(1, "2026-05-31", "12820.00")
    expect(result).toEqual({ error: "Failed to save" })
  })

  // the catch around finalizeReconciliation swallowed the error with no
  // logging — a real DB failure was indistinguishable from any other cause.
  it("logs the caught error on DB failure", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockUpsert.mockRejectedValue(new Error("DB down"))
    await saveStatementBalance(1, "2026-05-31", "12820.00")
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.stringMatching(/saveStatementBalance/i),
      expect.objectContaining({ error: expect.stringMatching(/DB down/) })
    )
  })

  // --- reconcile-on-balance-save (#xxx) ---
  // With no opening balance the action cannot compute a book balance, so it just
  // saves the statement and reconciles nothing — matches existing success tests.
  it("saves without reconciling when no opening balance is set", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockUpsert.mockResolvedValue({ id: 1 })
    mockOpening.mockResolvedValue(null)
    const result = await saveStatementBalance(1, "2026-05-31", "12820.00")
    expect(result).toEqual({ success: "Saved" })
    expect(mockAggregate).not.toHaveBeenCalled()
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it("marks all period transactions reconciled when the book balance matches the statement", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockUpsert.mockResolvedValue({ id: 1 })
    mockOpening.mockResolvedValue({ amount: 1000, asOfDate: new Date("2026-01-01") })
    // book = 1000 + 2000 income - 180 expense = 2820 == statement
    mockAggregate
      .mockResolvedValueOnce({ _sum: { amount: 2000 } }) // INCOME
      .mockResolvedValueOnce({ _sum: { amount: 180 } }) // EXPENSE
    mockUpdateMany.mockResolvedValue({ count: 5 })

    const result = await saveStatementBalance(1, "2026-05-31", "2820.00")

    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          paymentAccountId: 1,
          reconciled: false,
        }),
        data: { reconciled: true },
      })
    )
    expect(result && "success" in result ? result.success : "").toMatch(/5 transaction.*reconciled/i)
  })

  it("does NOT reconcile when the book balance does not match the statement", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockUpsert.mockResolvedValue({ id: 1 })
    mockOpening.mockResolvedValue({ amount: 1000, asOfDate: new Date("2026-01-01") })
    // book = 1000 + 2000 - 0 = 3000 != 2820 statement → off by 180
    mockAggregate
      .mockResolvedValueOnce({ _sum: { amount: 2000 } })
      .mockResolvedValueOnce({ _sum: { amount: 0 } })

    const result = await saveStatementBalance(1, "2026-05-31", "2820.00")

    expect(mockUpdateMany).not.toHaveBeenCalled()
    expect(result && "success" in result ? result.success : "").toMatch(/not reconciled/i)
  })

  // --- locked-period range guard ---
  it("does not reconcile when the range [opening.asOfDate, statementDate] crosses a locked accounting period", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockUpsert.mockResolvedValue({ id: 1 })
    // Opening balance predates the lock date — part of the range about to be
    // reconciled is locked, even though the statement date itself is not.
    mockOpening.mockResolvedValue({ amount: 1000, asOfDate: new Date("2026-01-01") })
    mockLockAppSetting.mockResolvedValue({ value: "2026-03-31" })

    const result = await saveStatementBalance(1, "2026-05-31", "2820.00")

    expect(mockAggregate).not.toHaveBeenCalled()
    expect(mockUpdateMany).not.toHaveBeenCalled()
    expect(result && "success" in result ? result.success : "").toMatch(/locked accounting period/i)
  })

  it("still reconciles when the lock date predates the opening balance (no part of the range is locked)", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockUpsert.mockResolvedValue({ id: 1 })
    mockOpening.mockResolvedValue({ amount: 1000, asOfDate: new Date("2026-01-01") })
    // Lock date is before opening.asOfDate — the whole reconcile range is
    // after the lock, so it must proceed normally.
    mockLockAppSetting.mockResolvedValue({ value: "2025-12-31" })
    mockAggregate
      .mockResolvedValueOnce({ _sum: { amount: 2000 } })
      .mockResolvedValueOnce({ _sum: { amount: 180 } })
    mockUpdateMany.mockResolvedValue({ count: 5 })

    const result = await saveStatementBalance(1, "2026-05-31", "2820.00")

    expect(mockUpdateMany).toHaveBeenCalled()
    expect(result && "success" in result ? result.success : "").toMatch(/reconciled/i)
  })

  // --- atomicity + serialization ---
  it("runs upsert + reconcile in one Serializable transaction", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockUpsert.mockResolvedValue({ id: 1 })
    mockOpening.mockResolvedValue(null)
    await saveStatementBalance(1, "2026-05-31", "12820.00")
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockTransaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: "Serializable" }
    )
  })

  it("retries the whole transaction on a P2034 serialization conflict", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockUpsert.mockResolvedValue({ id: 1 })
    mockOpening.mockResolvedValue(null)
    // First attempt aborts with a serialization conflict; second succeeds.
    mockTransaction
      .mockRejectedValueOnce(Object.assign(new Error("write conflict"), { code: "P2034" }))
      .mockImplementationOnce((fn: (tx: unknown) => unknown) => fn(prisma))
    const result = await saveStatementBalance(1, "2026-05-31", "12820.00")
    expect(result).toEqual({ success: "Saved" })
    expect(mockTransaction).toHaveBeenCalledTimes(2)
  })

  it("gives up after MAX_TX_ATTEMPTS serialization conflicts", async () => {
    mockSession.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    mockUpsert.mockResolvedValue({ id: 1 })
    mockOpening.mockResolvedValue(null)
    const conflict = Object.assign(new Error("write conflict"), { code: "P2034" })
    mockTransaction.mockRejectedValue(conflict)
    const result = await saveStatementBalance(1, "2026-05-31", "12820.00")
    expect(result).toEqual({ error: "Failed to save" })
    expect(mockTransaction).toHaveBeenCalledTimes(3)
  })
})
