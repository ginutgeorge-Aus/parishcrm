/** @jest-environment node */
/**
 * AUD-3-04 part B: updateTransfer corrects a mis-keyed transfer and its mirror
 * ledger row together, inside one Serializable transaction.
 */
jest.mock("@/lib/featureFlags")
import { updateTransfer } from "../pettyCashTransfer"
import { RECONCILED_EDIT_ERROR } from "../pettyCashEntry"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("next/navigation", () => ({ redirect: jest.fn() }))
jest.mock("@/lib/crypto", () => ({ encrypt: jest.fn((v: string) => `enc:${v}`), decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")) }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn(), logAuditTx: jest.fn() }))
jest.mock("@/lib/actor", () => ({ actorId: jest.fn(() => 1) }))
jest.mock("@/lib/accountingLock", () => ({ assertUnlockedTx: jest.fn(async () => null),
  assertUnlocked: jest.fn().mockResolvedValue(null),
  getAccountingLockDate: jest.fn().mockResolvedValue(null),
  isDateLocked: jest.requireActual("@/lib/accountingLock").isDateLocked,
}))
jest.mock("@/lib/xferAccount", () => ({ getXferAccountId: jest.fn().mockResolvedValue(9) }))
jest.mock("@/lib/paymentAccounts", () => ({ getCashAccount: jest.fn().mockResolvedValue({ id: 2 }) }))
jest.mock("@/lib/prisma", () => ({ prisma: { $transaction: jest.fn() } }))

import { auth } from "@/auth"
import { assertUnlockedTx, getAccountingLockDate, isDateLocked } from "@/lib/accountingLock"
import { prisma } from "@/lib/prisma"
import { logAuditTx } from "@/lib/audit"
import { redirect } from "next/navigation"

const mock$tx = prisma.$transaction as jest.Mock

// Transfer #5 keyed as 1,500.00 instead of 1,050.00. Session: opening 2,000, no
// other entries → running balance 500 after the transfer, 2,000 available to it.
function makeTx(over: { transfer?: Record<string, unknown>; sessionOpen?: boolean; legs?: unknown[]; deposits?: unknown[] } = {}) {
  const transfer = {
    id: 5,
    sessionId: 1,
    amount: "1500.00",
    date: new Date("2026-07-31T00:00:00.000Z"),
    transaction: { id: 77, reconciled: false, bankRef: "PC_T_5" },
    ...over.transfer,
  }
  return {
    pettyCashTransfer: { findUnique: jest.fn().mockResolvedValue(transfer), update: jest.fn() },
    pettyCashSession: {
      updateMany: jest.fn().mockResolvedValue({ count: over.sessionOpen === false ? 0 : 1 }),
      findUnique: jest.fn().mockResolvedValue({
        id: 1, openingBalance: "2000.00", receipts: [], expenses: [], transfers: [{ amount: "1500.00" }],
      }),
    },
    transaction: {
      findMany: jest.fn()
        .mockResolvedValueOnce(over.legs ?? [])
        .mockResolvedValueOnce(over.deposits ?? []),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    // assertMirrorNotReconciledTx's FOR UPDATE read of the mirror row.
    $queryRaw: jest.fn().mockResolvedValue([{ reconciled: false }]),
  }
}
let tx: ReturnType<typeof makeTx>
function useTx(t: ReturnType<typeof makeTx>) {
  tx = t
  mock$tx.mockImplementation((fn: (tx: unknown) => unknown) => fn(tx))
}

function form(fields: Record<string, string> = {}) {
  const fd = new FormData()
  fd.set("date", "2026-08-01")
  fd.set("amount", "1050.00")
  fd.set("notes", "re-keyed")
  fd.set("expectedAmount", "1500.00")
  fd.set("expectedDate", "2026-07-31")
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(auth as jest.Mock).mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
  ;(getAccountingLockDate as jest.Mock).mockResolvedValue(null)
  ;(assertUnlockedTx as jest.Mock).mockResolvedValue(null)
  useTx(makeTx())
})

describe("updateTransfer", () => {
  it("updateTransfer changes transfer and mirror together", async () => {
    await updateTransfer(5, undefined, form())
    const newDate = new Date("2026-08-01")
    expect(mock$tx).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" })
    expect(tx.pettyCashTransfer.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { amount: "1050.00", date: newDate, notes: "enc:re-keyed" },
    })
    expect(tx.transaction.updateMany).toHaveBeenCalledWith({
      where: { pettyCashTransferId: 5, reconciled: false },
      data: { amount: "1050.00", date: newDate },
    })
    expect(logAuditTx).toHaveBeenCalledWith(expect.anything(), 1, "PETTY_CASH_TRANSFER_UPDATED", "PettyCashTransfer", 5,
      expect.objectContaining({
        sessionId: 1, oldAmount: "1500.00", newAmount: "1050.00", oldDate: "2026-07-31", newDate: "2026-08-01",
      }))
    expect(logAuditTx).toHaveBeenCalledWith(expect.anything(), 1, "TRANSACTION_UPDATED", "Transaction", 77,
      expect.objectContaining({ source: "petty-cash", pettyCashTransferId: 5 }))
    expect(redirect).toHaveBeenCalledWith("/accounting/petty-cash/sessions/1")
  })

  it("PASTOR may correct a transfer", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { role: "PASTOR", id: "1" } })
    await updateTransfer(5, undefined, form())
    expect(tx.pettyCashTransfer.update).toHaveBeenCalledTimes(1)
  })

  it.each(["OFFICE_ADMIN", "AUDITOR", "VIEWER"])("updateTransfer is Unauthorized for %s", async (role) => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { role, id: "1" } })
    await expect(updateTransfer(5, undefined, form())).resolves.toEqual({ error: "Unauthorized" })
    expect(mock$tx).not.toHaveBeenCalled()
  })

  it("rejects an invalid id before any read", async () => {
    await expect(updateTransfer(0, undefined, form())).resolves.toEqual({ error: "Invalid ID" })
    expect(mock$tx).not.toHaveBeenCalled()
  })

  it("rejects an amount with more than 2 decimals", async () => {
    await expect(updateTransfer(5, undefined, form({ amount: "1050.005" }))).resolves.toEqual({ error: "Amount: max 2 decimal places" })
    expect(mock$tx).not.toHaveBeenCalled()
  })

  it("updateTransfer is refused when the session is closed", async () => {
    useTx(makeTx({ sessionOpen: false }))
    await expect(updateTransfer(5, undefined, form())).resolves.toEqual({ error: "Cannot edit in closed session" })
    expect(tx.pettyCashTransfer.update).not.toHaveBeenCalled()
  })

  it("updateTransfer is refused when the mirror is reconciled", async () => {
    useTx(makeTx({ transfer: { transaction: { id: 77, reconciled: true, bankRef: "PC_T_5" } } }))
    await expect(updateTransfer(5, undefined, form())).resolves.toEqual({ error: RECONCILED_EDIT_ERROR })
    expect(tx.pettyCashTransfer.update).not.toHaveBeenCalled()
  })

  it.each([
    ["the old date", "2026-07-31", "2026-08-01", new Date("2026-07-31T00:00:00.000Z")],
    // Old date (Aug 1) is unlocked; only the submitted new date (Jul 31) is in the locked period.
    ["the new date", "2026-08-01", "2026-07-31", new Date("2026-07-31T00:00:00.000Z")],
  ])("updateTransfer is refused when %s is locked", async (_label, oldDate, newDate, lock) => {
    useTx(makeTx({ transfer: { date: new Date(`${oldDate}T00:00:00.000Z`) } }))
    ;(assertUnlockedTx as jest.Mock).mockImplementation(async (_tx: unknown, d: Date) =>
      isDateLocked(d, lock) ? "This date is in a locked accounting period (on or before 2026-07-31)." : null)
    await expect(updateTransfer(5, undefined, form({ date: newDate, expectedDate: oldDate }))).resolves.toEqual({ error: expect.stringMatching(/locked accounting period/) })
    // The lock is checked inside the transaction (AUD-3-08), through the tx-scoped helper.
    expect(assertUnlockedTx).toHaveBeenCalledWith(tx, new Date(`${oldDate}T00:00:00.000Z`))
    expect(tx.pettyCashTransfer.update).not.toHaveBeenCalled()
  })

  it("updateTransfer is refused when the mirror was reconciled after the read (row-locked re-check)", async () => {
    const t = makeTx()
    t.$queryRaw.mockResolvedValue([{ reconciled: true }])
    useTx(t)
    await expect(updateTransfer(5, undefined, form())).resolves.toEqual({ error: RECONCILED_EDIT_ERROR })
    expect(tx.pettyCashTransfer.update).not.toHaveBeenCalled()
  })

  it("rolls the edit back when the mirror update matches no unreconciled row", async () => {
    const t = makeTx()
    t.transaction.updateMany.mockResolvedValue({ count: 0 })
    useTx(t)
    await expect(updateTransfer(5, undefined, form())).resolves.toEqual({ error: RECONCILED_EDIT_ERROR })
    expect(logAuditTx).not.toHaveBeenCalled()
  })

  it("updateTransfer is refused when the transfer adopted an imported bank cash-out", async () => {
    useTx(makeTx({ transfer: { transaction: { id: 77, reconciled: false, bankRef: "XFER_OUT_ANZ_1" } } }))
    await expect(updateTransfer(5, undefined, form())).resolves.toEqual({ error: expect.stringMatching(/imported bank deposit/) })
    expect(tx.pettyCashTransfer.update).not.toHaveBeenCalled()
  })

  it("refuses a new amount larger than the cash available to this transfer", async () => {
    await expect(updateTransfer(5, undefined, form({ amount: "2000.01" }))).resolves.toEqual({
      error: "Transfer amount exceeds balance of 2000.00",
    })
    expect(tx.pettyCashTransfer.update).not.toHaveBeenCalled()
  })

  it("refuses an edit that would double-count an unlinked imported cash-out for the new amount and day", async () => {
    useTx(makeTx({
      legs: [{ bankRef: "XFER_OUT_ANZ_1", pettyCashTransferId: null, date: new Date("2026-08-01T00:00:00.000Z") }],
      deposits: [{ bankRef: "ANZ_1", date: new Date("2026-08-01T00:00:00.000Z") }],
    }))
    const res = await updateTransfer(5, undefined, form())
    expect(res).toEqual({ error: expect.stringMatching(/imported cash-out for this amount and date already exists/) })
    // Edit form has no deposit picker: the message must not send the user to one (#856).
    expect((res as { error: string }).error).not.toMatch(/picker|pick the imported/i)
    expect(tx.pettyCashTransfer.update).not.toHaveBeenCalled()
  })

  it("rejects a stale edit form whose loaded amount no longer matches", async () => {
    await expect(updateTransfer(5, undefined, form({ expectedAmount: "100.00" }))).resolves.toEqual({
      error: expect.stringMatching(/changed by someone else/),
    })
    expect(tx.pettyCashTransfer.update).not.toHaveBeenCalled()
  })

  it("rejects a stale edit form whose loaded date no longer matches", async () => {
    await expect(updateTransfer(5, undefined, form({ expectedDate: "2026-07-30" }))).resolves.toEqual({
      error: expect.stringMatching(/changed by someone else/),
    })
    expect(tx.pettyCashTransfer.update).not.toHaveBeenCalled()
  })

  it("refuses moving a transfer inside the retention period to before it", async () => {
    await expect(updateTransfer(5, undefined, form({ date: "2000-01-01" }))).resolves.toEqual({
      error: expect.stringMatching(/retention period/),
    })
    expect(tx.pettyCashTransfer.update).not.toHaveBeenCalled()
  })

  it("keeps the stored note when the submitted note is the decryption placeholder", async () => {
    await updateTransfer(5, undefined, form({ notes: "[decryption error]" }))
    expect(tx.pettyCashTransfer.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { amount: "1050.00", date: new Date("2026-08-01") },
    })
  })

  it("clears the note when the submitted note is empty", async () => {
    await updateTransfer(5, undefined, form({ notes: "" }))
    expect(tx.pettyCashTransfer.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { amount: "1050.00", date: new Date("2026-08-01"), notes: null },
    })
  })

  it("returns 'Transfer not found' for a missing transfer", async () => {
    const t = makeTx()
    t.pettyCashTransfer.findUnique.mockResolvedValue(null)
    useTx(t)
    await expect(updateTransfer(5, undefined, form())).resolves.toEqual({ error: "Transfer not found" })
  })
})
