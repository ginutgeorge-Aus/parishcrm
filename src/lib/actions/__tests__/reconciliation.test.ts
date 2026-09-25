/** @jest-environment node */

import { saveStatementBalance } from "../reconciliation"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
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
})

// --- locked-period range guard ---
test("does not reconcile when the range [opening.asOfDate, statementDate] crosses a locked accounting period", async () => {
  const tx = withTx({
    opening: { amount: "100.00", asOfDate: new Date("2026-01-01T00:00:00Z") },
    lockDate: "2026-03-31",
  })
  const r = await saveStatementBalance(ANZ_CHURCH_ID, "2026-07-31", "130.00")
  expect(tx.transaction.aggregate).not.toHaveBeenCalled()
  expect(tx.transaction.updateMany).not.toHaveBeenCalled()
  expect((r as { success: string }).success).toMatch(/locked accounting period/i)
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
  expect(tx.transaction.updateMany).toHaveBeenCalled()
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
