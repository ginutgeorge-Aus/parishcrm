/** @jest-environment node */

jest.mock("@/lib/featureFlags")
import { saveStatementBalance } from "../reconciliation"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn(), logAuditTx: jest.fn() }))
jest.mock("@/lib/actor", () => ({ actorId: jest.fn(() => 1) }))
jest.mock("@/lib/logger", () => ({ logger: { error: jest.fn() } }))
// Keep ACCOUNTING_LOCK_DATE_KEY/isDateLocked real (pure, no DB) — only
// assertUnlocked (the statement-date pre-check) is mocked.
jest.mock("@/lib/accountingLock", () => ({
  ...jest.requireActual("@/lib/accountingLock"),
  assertUnlocked: jest.fn().mockResolvedValue(null),
}))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: jest.fn(),
    // Existence check on the client-supplied paymentAccountId, ahead of the
    // transaction — defaults to "found" so existing tests don't all need it.
    paymentAccount: { findUnique: jest.fn().mockResolvedValue({ id: 1 }) },
  },
}))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logAuditTx } from "@/lib/audit"
const mockAuth = auth as jest.Mock
const mock$tx = prisma.$transaction as jest.Mock

// A stand-in numeric PaymentAccount.id — the FK replacing the old enum.
// Matches the id the paymentAccount.findUnique mock above resolves to.
const ANZ_CHURCH_ID = 1

// Build a transaction-client mock and wire prisma.$transaction to run the
// interactive callback against it. `opening` may be null (no opening balance).
function withTx(opts: {
  opening: { amount: string; asOfDate: Date } | null
  income?: string
  expense?: string
  updatedCount?: number
  // unreconciled rows on/before the lock date (skipped)
  skippedCount?: number
  // locked-range guard's lock-date read via tx.appSetting. Undefined →
  // no lock configured (default).
  lockDate?: string
}) {
  const tx = {
    reconciliationStatement: { upsert: jest.fn().mockResolvedValue({ id: 10 }) },
    accountOpeningBalance: { findUnique: jest.fn().mockResolvedValue(opts.opening) },
    appSetting: {
      findUnique: jest.fn().mockResolvedValue(opts.lockDate ? { value: opts.lockDate } : null),
    },
    transaction: {
      aggregate: jest
        .fn()
        .mockResolvedValueOnce({ _sum: { amount: opts.income ?? "0.00" } })
        .mockResolvedValueOnce({ _sum: { amount: opts.expense ?? "0.00" } }),
      updateMany: jest.fn().mockResolvedValue({ count: opts.updatedCount ?? 0 }),
      count: jest.fn().mockResolvedValue(opts.skippedCount ?? 0),
    },
  }
  mock$tx.mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx))
  return tx
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
})

test("rejects a non-accounting role", async () => {
  mockAuth.mockResolvedValue({ user: { role: "VIEWER", id: "1" } })
  const r = await saveStatementBalance(ANZ_CHURCH_ID, "2026-07-31", "100.00")
  expect(r).toEqual({ error: "Unauthorized" })
  expect(mock$tx).not.toHaveBeenCalled()
})

test("records the statement without reconciling when no opening balance exists", async () => {
  const tx = withTx({ opening: null })
  const r = await saveStatementBalance(ANZ_CHURCH_ID, "2026-07-31", "100.00")
  expect(r).toEqual({ success: "Saved" })
  expect(tx.transaction.updateMany).not.toHaveBeenCalled()
})

test("reconciles the period when the book balance matches to the cent", async () => {
  // 100.00 opening + 50.00 income − 20.00 expense = 130.00 book == closing.
  const tx = withTx({
    opening: { amount: "100.00", asOfDate: new Date("2026-07-01T00:00:00Z") },
    income: "50.00",
    expense: "20.00",
    updatedCount: 3,
  })
  const r = await saveStatementBalance(ANZ_CHURCH_ID, "2026-07-31", "130.00")
  expect(r).toEqual({ success: "Balanced — 3 transactions reconciled." })
  expect(tx.transaction.updateMany).toHaveBeenCalled()
  // Both audit rows are written on the transaction client, not the global prisma.
  expect(logAuditTx).toHaveBeenCalledWith(tx, 1, "RECON_STATEMENT_SAVED", "ReconciliationStatement", 10, expect.any(Object))
  expect(logAuditTx).toHaveBeenCalledWith(
    tx,
    1,
    "RECON_AUTO_RECONCILED",
    "ReconciliationStatement",
    undefined,
    expect.objectContaining({ count: 3, closingBalance: "130.00" }),
  )
})

// --- locked-period range guard ---
test("reconciles rows after the lock date when the lock is later than the opening balance", async () => {
  const tx = withTx({
    opening: { amount: "100.00", asOfDate: new Date("2024-07-01T00:00:00Z") },
    income: "50.00",
    expense: "20.00",
    updatedCount: 4,
    skippedCount: 2,
    lockDate: "2026-06-30",
  })
  const r = await saveStatementBalance(ANZ_CHURCH_ID, "2026-07-31", "130.00")
  // Book balance still uses the full range from the opening balance date.
  const aggWhere = tx.transaction.aggregate.mock.calls[0][0].where
  expect(aggWhere.date.gte).toEqual(new Date("2024-07-01T00:00:00Z"))
  expect(tx.transaction.updateMany).toHaveBeenCalled()
  expect(logAuditTx).toHaveBeenCalledWith(
    tx,
    1,
    "RECON_AUTO_RECONCILED",
    "ReconciliationStatement",
    undefined,
    expect.objectContaining({ count: 4, lockApplied: "2026-06-30" }),
  )
  expect(tx.transaction.count).toHaveBeenCalledWith({
    where: {
      paymentAccountId: ANZ_CHURCH_ID,
      reconciled: false,
      date: { gte: new Date("2024-07-01T00:00:00Z"), lte: new Date("2026-06-30T23:59:59.999Z") },
    },
  })
  expect((r as { success: string }).success).toBe(
    "Balanced — 4 transactions reconciled. (2 unreconciled transactions on or before 2026-06-30 left unchanged — locked period)",
  )
})

test("does not touch rows on or before the lock date", async () => {
  const tx = withTx({
    opening: { amount: "100.00", asOfDate: new Date("2024-07-01T00:00:00Z") },
    income: "50.00",
    expense: "20.00",
    updatedCount: 1,
    lockDate: "2026-06-30",
  })
  await saveStatementBalance(ANZ_CHURCH_ID, "2026-07-31", "130.00")
  const where = tx.transaction.updateMany.mock.calls[0][0].where
  expect(where.date).toEqual({
    gt: new Date("2026-06-30T23:59:59.999Z"),
    lte: new Date("2026-07-31T23:59:59.999Z"),
  })
  expect(where.date.gte).toBeUndefined()
})

test("rejects the save when the lock covers the statement date (concurrent lock change)", async () => {
  const tx = withTx({
    opening: { amount: "100.00", asOfDate: new Date("2026-01-01T00:00:00Z") },
    lockDate: "2026-07-31",
  })
  const r = await saveStatementBalance(ANZ_CHURCH_ID, "2026-07-31", "130.00")
  expect(r).toEqual({ error: expect.stringMatching(/locked accounting period/i) })
  expect(tx.transaction.updateMany).not.toHaveBeenCalled()
  expect(logAuditTx).not.toHaveBeenCalled()
})

test("lock on the opening day: only rows after it are reconciled", async () => {
  const tx = withTx({
    opening: { amount: "100.00", asOfDate: new Date("2026-01-01T00:00:00Z") },
    income: "50.00",
    expense: "20.00",
    updatedCount: 1,
    lockDate: "2026-01-01",
  })
  await saveStatementBalance(ANZ_CHURCH_ID, "2026-07-31", "130.00")
  expect(tx.transaction.updateMany.mock.calls[0][0].where.date.gt).toEqual(new Date("2026-01-01T23:59:59.999Z"))
})

test("still reconciles when the lock date predates the opening balance", async () => {
  const tx = withTx({
    opening: { amount: "100.00", asOfDate: new Date("2026-01-01T00:00:00Z") },
    income: "50.00",
    expense: "20.00",
    updatedCount: 2,
    lockDate: "2025-12-31",
  })
  const r = await saveStatementBalance(ANZ_CHURCH_ID, "2026-07-31", "130.00")
  expect(tx.transaction.updateMany.mock.calls[0][0].where.date.gte).toEqual(
    new Date("2026-01-01T00:00:00Z"),
  )
  expect(tx.transaction.count).not.toHaveBeenCalled()
  expect(tx.transaction.aggregate.mock.calls[0][0].where.date).toEqual({
    gte: new Date("2026-01-01T00:00:00Z"),
    lte: new Date("2026-07-31T23:59:59.999Z"),
  })
  expect((r as { success: string }).success).toMatch(/reconciled/i)
})

test("does NOT reconcile when off by a single cent", async () => {
  const tx = withTx({
    opening: { amount: "100.00", asOfDate: new Date("2026-07-01T00:00:00Z") },
    income: "50.00",
    expense: "20.00",
  })
  const r = await saveStatementBalance(ANZ_CHURCH_ID, "2026-07-31", "130.01")
  expect((r as { success: string }).success).toMatch(/does not match/)
  expect(tx.transaction.updateMany).not.toHaveBeenCalled()
})

test("records only when the statement date predates the opening balance", async () => {
  const tx = withTx({
    opening: { amount: "100.00", asOfDate: new Date("2026-08-01T00:00:00Z") },
    income: "50.00",
  })
  const r = await saveStatementBalance(ANZ_CHURCH_ID, "2026-07-01", "100.00")
  expect(r).toEqual({ success: "Saved" })
  expect(tx.transaction.updateMany).not.toHaveBeenCalled()
  expect(tx.transaction.aggregate).not.toHaveBeenCalled()
})

// --- serialization-conflict retry ---

test("retries when the adapter surfaces an unwrapped serialization conflict (no P2034 code)", async () => {
  const tx = withTx({ opening: null })
  const run = mock$tx.getMockImplementation()!
  const unwrapped = { name: "DriverAdapterError", cause: { originalCode: "40001", kind: "TransactionWriteConflict" } }
  mock$tx.mockRejectedValueOnce(unwrapped).mockImplementation(run)
  const r = await saveStatementBalance(ANZ_CHURCH_ID, "2026-07-31", "100.00")
  expect(r).toEqual({ success: "Saved" })
  expect(mock$tx).toHaveBeenCalledTimes(2)
  expect(tx.reconciliationStatement.upsert).toHaveBeenCalledTimes(1)
})
