/** @jest-environment node */

jest.mock("@/lib/featureFlags")
import { createTransfer, deleteTransfer } from "../pettyCashTransfer"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("next/navigation", () => ({ redirect: jest.fn() }))
jest.mock("@/lib/crypto", () => ({ encrypt: jest.fn((v: string) => `enc:${v}`) }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn(), logAuditTx: jest.fn() }))
jest.mock("@/lib/actor", () => ({ actorId: jest.fn(() => 1) }))
jest.mock("@/lib/accountingLock", () => ({ assertUnlocked: jest.fn().mockResolvedValue(null) }))
jest.mock("@/lib/xferAccount", () => ({ getXferAccountId: jest.fn().mockResolvedValue(9), XFER_OUT_PREFIX: "XFER_OUT_" }))
jest.mock("@/lib/paymentAccounts", () => ({ getCashAccount: jest.fn().mockResolvedValue({ id: 2 }) }))
jest.mock("@/lib/prisma", () => ({ prisma: { $transaction: jest.fn(), pettyCashTransfer: { findUnique: jest.fn() } } }))

import { auth } from "@/auth"
import { assertUnlocked } from "@/lib/accountingLock"
import { prisma } from "@/lib/prisma"
import { logAudit, logAuditTx } from "@/lib/audit"
const mock$tx = prisma.$transaction as jest.Mock

function form() {
  const fd = new FormData()
  fd.set("date", "2026-07-31")
  fd.set("amount", "50.00")
  fd.set("depositedByName", "Treasurer")
  return fd
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(auth as jest.Mock).mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
})

describe("createTransfer — serialization conflicts", () => {
  it.each([
    ["P2034", { code: "P2034" }],
    // @prisma/adapter-pg sometimes surfaces Postgres 40001 unwrapped, with no `code`.
    ["unwrapped DriverAdapterError", { name: "DriverAdapterError", cause: { originalCode: "40001", kind: "TransactionWriteConflict" } }],
  ])("maps a %s to the retry prompt instead of a 500", async (_label, err) => {
    mock$tx.mockRejectedValue(err)
    await expect(createTransfer(1, undefined, form())).resolves.toEqual({ error: "Transfer conflict — please try again." })
  })

  it("rethrows an unrelated transaction error", async () => {
    mock$tx.mockRejectedValue(new Error("connection lost"))
    await expect(createTransfer(1, undefined, form())).rejects.toThrow("connection lost")
  })
})

describe("createTransfer — imported deposit", () => {
  const deposit = { accountId: 9, type: "INCOME", amount: { toFixed: () => "50.00" }, date: new Date("2026-07-31"), bankRef: "ANZ_1" }
  function run(txMock: Record<string, unknown>) {
    mock$tx.mockImplementation((fn: (tx: unknown) => unknown) => fn(txMock))
    const fd = form()
    fd.set("importedTransactionId", "7")
    return createTransfer(1, undefined, fd)
  }
  const okLeg = { id: 11, type: "EXPENSE", accountId: 9, amount: { toFixed: () => "50.00" }, date: new Date("2026-07-31"), paymentAccountId: 2, pettyCashTransferId: null, reconciled: false }
  const base = () => ({
    pettyCashSession: { findUnique: jest.fn().mockResolvedValue({ status: "OPEN", title: "S", openingBalance: 100, receipts: [], expenses: [], transfers: [] }) },
    pettyCashTransfer: { create: jest.fn().mockResolvedValue({ id: 3 }) },
  })

  it("links the existing XFER_OUT leg instead of creating a mirror", async () => {
    const update = jest.fn()
    const create = jest.fn()
    const findUnique = jest.fn()
      .mockResolvedValueOnce(deposit)
      .mockResolvedValueOnce(okLeg)
    await run({ ...base(), transaction: { findUnique, update, create } })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 11 }, data: expect.objectContaining({ pettyCashTransferId: 3 }) }))
    expect(create).not.toHaveBeenCalled()
    // Audit: transfer metadata carries the deposit + leg ids; leg gets TRANSACTION_UPDATED.
    expect(logAudit).toHaveBeenCalledWith(1, "PETTY_CASH_TRANSFER_CREATED", "PettyCashTransfer", 3,
      expect.objectContaining({ importedTransactionId: 7, adoptedLegId: 11 }))
    expect(logAuditTx).toHaveBeenCalledWith(expect.anything(), 1, "TRANSACTION_UPDATED", "Transaction", 11, expect.objectContaining({ action: "adopted-as-transfer-mirror" }))
  })

  it("keeps an existing leg reference when adopting", async () => {
    const update = jest.fn()
    const findUnique = jest.fn().mockResolvedValueOnce(deposit).mockResolvedValueOnce({ ...okLeg, reference: "Orig" })
    await run({ ...base(), transaction: { findUnique, update, create: jest.fn() } })
    expect(update.mock.calls[0][0].data).toEqual({ pettyCashTransferId: 3 })
  })

  it("rejects when the leg is already linked", async () => {
    const findUnique = jest.fn()
      .mockResolvedValueOnce(deposit)
      .mockResolvedValueOnce({ ...okLeg, pettyCashTransferId: 2 })
    await expect(run({ ...base(), transaction: { findUnique, update: jest.fn(), create: jest.fn() } }))
      .resolves.toEqual({ error: "Imported deposit is not available for transfer" })
  })

  it("rejects an amount mismatch", async () => {
    const findUnique = jest.fn()
      .mockResolvedValueOnce({ ...deposit, amount: { toFixed: () => "60.00" } })
      .mockResolvedValueOnce(okLeg)
    await expect(run({ ...base(), transaction: { findUnique, update: jest.fn(), create: jest.fn() } }))
      .resolves.toEqual({ error: "Date and amount must match the imported deposit" })
  })

  it("rejects an invalid (non-positive) imported id before any transaction", async () => {
    const fd = form()
    fd.set("importedTransactionId", "0")
    await expect(createTransfer(1, undefined, fd)).resolves.toEqual({ error: "Invalid imported deposit" })
    fd.set("importedTransactionId", "99999999999")
    await expect(createTransfer(1, undefined, fd)).resolves.toEqual({ error: "Invalid imported deposit" })
  })

  it("rejects when the leg falls on a different day than the transfer", async () => {
    const findUnique = jest.fn().mockResolvedValueOnce(deposit).mockResolvedValueOnce({ ...okLeg, date: new Date("2026-07-30") })
    await expect(run({ ...base(), transaction: { findUnique, update: jest.fn(), create: jest.fn() } }))
      .resolves.toEqual({ error: "Imported deposit's cash-out date does not match this transfer" })
  })

  it("rejects when the leg's period is locked", async () => {
    ;(assertUnlocked as jest.Mock).mockResolvedValueOnce(null).mockResolvedValueOnce("Period locked")
    const findUnique = jest.fn().mockResolvedValueOnce(deposit).mockResolvedValueOnce(okLeg)
    await expect(run({ ...base(), transaction: { findUnique, update: jest.fn(), create: jest.fn() } }))
      .resolves.toEqual({ error: "Period locked" })
  })

  const rejects = (name: string, dep: unknown, leg: unknown, error: string) =>
    it(name, async () => {
      const findUnique = jest.fn().mockResolvedValueOnce(dep).mockResolvedValueOnce(leg)
      await expect(run({ ...base(), transaction: { findUnique, update: jest.fn(), create: jest.fn() } })).resolves.toEqual({ error })
    })
  const NA = "Imported deposit is not available for transfer"
  rejects("rejects a missing deposit", null, null, NA)
  rejects("rejects a deposit on the wrong account", { ...deposit, accountId: 4 }, okLeg, NA)
  rejects("rejects a non-INCOME deposit", { ...deposit, type: "EXPENSE" }, okLeg, NA)
  rejects("rejects a deposit with no bankRef", { ...deposit, bankRef: null }, null, NA)
  rejects("rejects a date mismatch", { ...deposit, date: new Date("2026-07-30") }, okLeg, "Date and amount must match the imported deposit")
  rejects("rejects a reconciled leg", deposit, { ...okLeg, reconciled: true }, "Imported deposit's cash-out is already reconciled")
  rejects("rejects a leg on the wrong payment account", deposit, { ...okLeg, paymentAccountId: null }, "Imported deposit's cash-out entry does not match this transfer")
})

describe("deleteTransfer — adopted leg", () => {
  const findTransfer = prisma.pettyCashTransfer.findUnique as jest.Mock
  const old = new Date("2015-01-01")
  function setup(mirror: { reconciled: boolean; bankRef: string | null; reference: string | null }) {
    findTransfer.mockResolvedValue({
      id: 5, date: old, amount: 50, sessionId: 1,
      session: { id: 1, status: "OPEN", title: "Sess" },
      transaction: { id: 11, reconciled: false }, // stale pre-read: not adopted
    })
    const update = jest.fn()
    const tx = {
      pettyCashSession: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      transaction: { findUnique: jest.fn().mockResolvedValue(mirror), update },
      pettyCashTransfer: { delete: jest.fn() },
    }
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    return update
  }

  it("derives adopted from the in-tx mirror read, unlinks, clears title reference and audits", async () => {
    const update = setup({ reconciled: false, bankRef: "XFER_OUT_ANZ_1", reference: "Sess" })
    await deleteTransfer(5)
    expect(update).toHaveBeenCalledWith({ where: { id: 11 }, data: { pettyCashTransferId: null, reference: null } })
    expect(logAuditTx).toHaveBeenCalledWith(expect.anything(), 1, "TRANSACTION_UPDATED", "Transaction", 11, expect.objectContaining({ action: "unlinked-from-transfer" }))
    expect(logAudit).not.toHaveBeenCalledWith(1, "TRANSACTION_DELETED", "Transaction", 11, expect.anything())
  })

  it("leaves a different original reference untouched", async () => {
    const update = setup({ reconciled: false, bankRef: "XFER_OUT_ANZ_1", reference: "Orig" })
    await deleteTransfer(5)
    expect(update).toHaveBeenCalledWith({ where: { id: 11 }, data: { pettyCashTransferId: null } })
  })

  it("treats a normal mirror as not adopted (cascade delete audited)", async () => {
    const update = setup({ reconciled: false, bankRef: "PC_T_5", reference: "Sess" })
    await deleteTransfer(5)
    expect(update).not.toHaveBeenCalled()
    expect(logAudit).toHaveBeenCalledWith(1, "TRANSACTION_DELETED", "Transaction", 11, expect.any(Object))
  })
})
