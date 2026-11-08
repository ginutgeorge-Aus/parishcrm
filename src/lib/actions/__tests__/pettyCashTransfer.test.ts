/** @jest-environment node */

jest.mock("@/lib/featureFlags")
import { createTransfer, deleteTransfer } from "../pettyCashTransfer"
import { legsByDepositRef } from "@/lib/pettyCashAdoption"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("next/navigation", () => ({ redirect: jest.fn() }))
jest.mock("@/lib/crypto", () => ({ encrypt: jest.fn((v: string) => `enc:${v}`), decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")) }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn(), logAuditTx: jest.fn() }))
jest.mock("@/lib/actor", () => ({ actorId: jest.fn(() => 1) }))
jest.mock("@/lib/accountingLock", () => ({
  assertUnlocked: jest.fn().mockResolvedValue(null),
  getAccountingLockDate: jest.fn().mockResolvedValue(null),
  isDateLocked: jest.requireActual("@/lib/accountingLock").isDateLocked,
}))
jest.mock("@/lib/xferAccount", () => ({ getXferAccountId: jest.fn().mockResolvedValue(9) }))
jest.mock("@/lib/paymentAccounts", () => ({ getCashAccount: jest.fn().mockResolvedValue({ id: 2 }) }))
jest.mock("@/lib/prisma", () => ({ prisma: { $transaction: jest.fn(), pettyCashTransfer: { findUnique: jest.fn() }, transaction: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn().mockResolvedValue(null) } } }))

import { auth } from "@/auth"
import { assertUnlocked, getAccountingLockDate } from "@/lib/accountingLock"
import { prisma } from "@/lib/prisma"
import { logAudit, logAuditTx } from "@/lib/audit"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
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
  ;(getAccountingLockDate as jest.Mock).mockResolvedValue(null)
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
    expect(logAuditTx).toHaveBeenCalledWith(expect.anything(), 1, "PETTY_CASH_TRANSFER_CREATED", "PettyCashTransfer", 3,
      expect.objectContaining({ importedTransactionId: 7, adoptedLegId: 11 }))
    expect(logAuditTx).toHaveBeenCalledWith(expect.anything(), 1, "TRANSACTION_UPDATED", "Transaction", 11, expect.objectContaining({ action: "adopted-as-transfer-mirror" }))
  })

  it("does no writes when adoption validation fails", async () => {
    const base0 = base()
    const update = jest.fn()
    const findUnique = jest.fn().mockResolvedValueOnce(deposit).mockResolvedValueOnce({ ...okLeg, reconciled: true })
    await run({ ...base0, transaction: { findUnique, update, create: jest.fn() } })
    expect(base0.pettyCashTransfer.create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it("only sets the link when adopting (never touches reference)", async () => {
    const update = jest.fn()
    const findUnique = jest.fn().mockResolvedValueOnce(deposit).mockResolvedValueOnce(okLeg)
    await run({ ...base(), transaction: { findUnique, update, create: jest.fn() } })
    expect(update.mock.calls[0][0].data).toEqual({ pettyCashTransferId: 3 })
  })

  it("adopts a legacy leg with a null funding source and sets it to the cash account (#487)", async () => {
    const update = jest.fn().mockResolvedValue({})
    const findUnique = jest.fn().mockResolvedValueOnce(deposit).mockResolvedValueOnce({ ...okLeg, paymentAccountId: null })
    await run({ ...base(), transaction: { findUnique, update, create: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) } })
    expect(update.mock.calls[0][0].data).toEqual({ pettyCashTransferId: 3, paymentAccountId: 2 })
  })

  it("rejects adopting a legacy null-funding leg when a manual PC_T_ mirror already exists", async () => {
    const base0 = base()
    const update = jest.fn()
    const findUnique = jest.fn().mockResolvedValueOnce(deposit).mockResolvedValueOnce({ ...okLeg, paymentAccountId: null })
    const findFirst = jest.fn().mockResolvedValue({ pettyCashTransferId: 5 })
    await expect(run({ ...base0, transaction: { findUnique, update, create: jest.fn(), findFirst } }))
      .resolves.toEqual({ error: expect.stringContaining("#5") })
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ bankRef: { startsWith: "PC_T_" } }) }))
    expect(base0.pettyCashTransfer.create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
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
    for (const bad of ["0x10", "1e1", " 12 "]) {
      fd.set("importedTransactionId", bad)
      await expect(createTransfer(1, undefined, fd)).resolves.toEqual({ error: "Invalid imported deposit" })
    }
  })

  it("rejects when the leg falls on a different day than the transfer", async () => {
    const findUnique = jest.fn().mockResolvedValueOnce(deposit).mockResolvedValueOnce({ ...okLeg, date: new Date("2026-07-30") })
    await expect(run({ ...base(), transaction: { findUnique, update: jest.fn(), create: jest.fn() } }))
      .resolves.toEqual({ error: "Imported deposit's cash-out date does not match this transfer" })
  })

  it("checks the lock once, before the transaction (leg is on the transfer day)", async () => {
    const findUnique = jest.fn().mockResolvedValueOnce(deposit).mockResolvedValueOnce(okLeg)
    await run({ ...base(), transaction: { findUnique, update: jest.fn(), create: jest.fn() } })
    expect(assertUnlocked).toHaveBeenCalledTimes(1)
  })

  it("rejects an already-reconciled leg", async () => {
    const findUnique = jest.fn().mockResolvedValueOnce(deposit).mockResolvedValueOnce({ ...okLeg, reconciled: true })
    await expect(run({ ...base(), transaction: { findUnique, update: jest.fn(), create: jest.fn() } }))
      .resolves.toEqual({ error: "Imported deposit's cash-out is already reconciled" })
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
  rejects("rejects a leg on the wrong payment account", deposit, { ...okLeg, paymentAccountId: 99 }, "Imported deposit's cash-out entry does not match this transfer")
})

describe("createTransfer — manual path duplicate guard", () => {
  // legs = XFER_OUT cash-out legs (linked or not); dup = their paired INCOME deposit (null = none).
  const day = new Date("2026-07-31")
  const txMock = (dup: unknown, legs: unknown[] = dup ? [{ bankRef: "XFER_OUT_B1", pettyCashTransferId: null, date: day }] : [], depositDate: Date = day) => ({
    pettyCashSession: { findUnique: jest.fn().mockResolvedValue({ status: "OPEN", title: "S", openingBalance: 100, receipts: [], expenses: [], transfers: [] }) },
    pettyCashTransfer: { create: jest.fn().mockResolvedValue({ id: 3, date: new Date("2026-07-31"), amount: "50.00" }) },
    transaction: {
      // Leg lookup (EXPENSE) honours a `reconciled` filter like the DB would: any reconciled:false
      // filter in the guard would hide a reconciled leg. Deposit lookup (INCOME) returns the dup.
      findMany: jest.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
        where.type === "INCOME"
          ? (dup ? [{ bankRef: "B1", date: depositDate }] : [])
          : legs.filter((l) => !("reconciled" in where) || (l as { reconciled?: boolean }).reconciled === where.reconciled)),
      create: jest.fn(),
    },
  })

  // Regression (#471): a second cash-out for an already-imported deposit double-counted petty cash.
  it("rejects a manual transfer that would double-count an imported cash-out (same amount and day, paired deposit)", async () => {
    const tx = txMock({ id: 11 })
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    const res = await createTransfer(1, undefined, form())
    expect(res).toEqual({ error: expect.stringContaining("un-reconcile") })
    expect(res).toEqual({ error: expect.stringContaining("imported cash-out") })
    expect(tx.pettyCashTransfer.create).not.toHaveBeenCalled()
    const call = tx.transaction.findMany.mock.calls[0][0]
    expect(call.where).toEqual(expect.objectContaining({ amount: "50.00", accountId: 9 }))
    // Reconciled legs must still be matched (the error tells the user to un-reconcile).
    expect(call.where).not.toHaveProperty("reconciled")
    // Adopted (linked) legs must be matched too (#492).
    expect(call.where).not.toHaveProperty("pettyCashTransferId")
    // Legacy legs with a null funding source still count (#487).
    expect(call.where.OR).toEqual([{ paymentAccountId: null }, { paymentAccountId: 2 }])
    // #487 item 1: the leg lookup spans the bank import's ±7-day mirror window (inclusive), centred on the transfer date.
    expect(call.where.date).toEqual({ gte: new Date("2026-07-24"), lte: new Date("2026-08-07") })
    // #555: the deposit is matched on bankRef + amount only, so a deposit re-dated after import is still found.
    const depositWhere = tx.transaction.findMany.mock.calls[1][0].where
    expect(depositWhere).toEqual(expect.objectContaining({ type: "INCOME", amount: "50.00", bankRef: { in: ["B1"] } }))
    expect(depositWhere).not.toHaveProperty("date")
  })

  it("allows manual entry when the matching leg has no paired deposit to adopt", async () => {
    const tx = txMock(null, [{ bankRef: "XFER_OUT_B1", pettyCashTransferId: null, date: day }])
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    await createTransfer(1, undefined, form())
    expect(tx.transaction.create).toHaveBeenCalled()
    // The deposit lookup was keyed on the leg's paired deposit ref, so "no dup" is a real negative.
    expect(tx.transaction.findMany.mock.calls[1][0].where.bankRef).toEqual({ in: ["B1"] })
  })

  it("rejects when the paired leg is already reconciled (user must un-reconcile first)", async () => {
    const tx = txMock({ id: 11 }, [{ bankRef: "XFER_OUT_B1", pettyCashTransferId: null, reconciled: true, date: day }])
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    const res = await createTransfer(1, undefined, form())
    expect(res).toEqual({ error: expect.stringContaining("un-reconcile") })
    expect(tx.pettyCashTransfer.create).not.toHaveBeenCalled()
    expect(tx.transaction.create).not.toHaveBeenCalled()
  })

  // Regression (#492): the leg was already adopted by another transfer, so it is no longer unlinked.
  it("rejects a manual transfer for a deposit whose cash-out leg is already adopted by another transfer", async () => {
    const tx = txMock({ id: 11 }, [{ bankRef: "XFER_OUT_B1", pettyCashTransferId: 7, date: day }])
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    const res = await createTransfer(1, undefined, form())
    expect(res).toEqual({ error: expect.stringContaining("already recorded as a petty cash transfer") })
    expect(tx.pettyCashTransfer.create).not.toHaveBeenCalled()
    expect(tx.transaction.create).not.toHaveBeenCalled()
  })

  // Regression (#487 item 1): the import committed its deposit + leg on 07-28; a manual transfer for the
  // same deposit dated 07-31 (inside the import's ±7-day mirror window) booked a second cash-out.
  it("rejects a manual transfer dated a different day inside the mirror window of an unlinked imported cash-out", async () => {
    const legDay = new Date("2026-07-28")
    const tx = txMock({ id: 11 }, [{ bankRef: "XFER_OUT_B1", pettyCashTransferId: null, date: legDay }], legDay)
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    const res = await createTransfer(1, undefined, form())
    expect(res).toEqual({ error: expect.stringContaining("on 2026-07-28 (within 7 days of this transfer)") })
    expect(res).toEqual({ error: expect.stringContaining("set the date to 2026-07-28 and pick the imported deposit") })
    expect(tx.pettyCashTransfer.create).not.toHaveBeenCalled()
    expect(tx.transaction.create).not.toHaveBeenCalled()
  })

  it("prefers the same-day guidance when both a same-day and a different-day unlinked leg match", async () => {
    const legs = [
      { bankRef: "XFER_OUT_B0", pettyCashTransferId: null, date: new Date("2026-07-28") },
      { bankRef: "XFER_OUT_B1", pettyCashTransferId: null, date: day },
    ]
    const tx = txMock({ id: 11 }, legs)
    tx.transaction.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
      where.type === "INCOME" ? [{ bankRef: "B0", date: new Date("2026-07-28") }, { bankRef: "B1", date: day }] : legs)
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    await expect(createTransfer(1, undefined, form())).resolves.toEqual({ error: expect.stringContaining("for this amount and date already exists") })
  })

  // An adopted leg's deposit is already paired with a transfer: a same-amount transfer days later is a separate deposit.
  it("allows a manual transfer when the only different-day leg in the window is already adopted", async () => {
    const tx = txMock({ id: 11 }, [{ bankRef: "XFER_OUT_B1", pettyCashTransferId: 7, date: new Date("2026-07-28") }])
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    await createTransfer(1, undefined, form())
    expect(tx.pettyCashTransfer.create).toHaveBeenCalled()
    // The adopted different-day leg is not even looked up as a possible duplicate deposit.
    expect(tx.transaction.findMany).toHaveBeenCalledTimes(1)
  })

  describe("admin override of the cross-day window guard", () => {
    const legDay = new Date("2026-07-28")
    const setup = () => {
      const tx = txMock({ id: 11 }, [{ bankRef: "XFER_OUT_B1", pettyCashTransferId: null, date: legDay }], legDay)
      mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
      return tx
    }
    const overrideForm = () => { const fd = form(); fd.set("overrideWindowGuard", "true"); return fd }

    it("ignores the flag for a non-admin (still blocked)", async () => {
      ;(auth as jest.Mock).mockResolvedValue({ user: { role: "PASTOR", id: "2" } })
      const tx = setup()
      const res = await createTransfer(1, undefined, overrideForm())
      expect(res).toEqual({ error: expect.stringContaining("within 7 days of this transfer") })
      expect(tx.pettyCashTransfer.create).not.toHaveBeenCalled()
    })

    it("lets an admin record a different-day window match and audit-logs the override", async () => {
      const tx = setup()
      await createTransfer(1, undefined, overrideForm())
      expect(tx.pettyCashTransfer.create).toHaveBeenCalled()
      expect(logAuditTx).toHaveBeenCalledWith(
        tx, 1, "PETTY_CASH_TRANSFER_CREATED", "PettyCashTransfer", 3,
        expect.objectContaining({ windowGuardOverridden: true }),
      )
    })

    it("does not flag the audit entry when no window leg was overridden", async () => {
      const tx = txMock(null)
      mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
      await createTransfer(1, undefined, overrideForm())
      expect((logAuditTx as jest.Mock).mock.calls.at(-1)![5]).not.toHaveProperty("windowGuardOverridden")
    })

    it("does not bypass the same-day duplicate guard for an admin", async () => {
      const tx = txMock({ id: 11 })
      mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
      const res = await createTransfer(1, undefined, overrideForm())
      expect(res).toEqual({ error: expect.stringContaining("for this amount and date already exists") })
      expect(tx.pettyCashTransfer.create).not.toHaveBeenCalled()
    })

    it("does not bypass the same-day adopted-leg guard for an admin", async () => {
      const tx = txMock({ id: 11 }, [{ bankRef: "XFER_OUT_B1", pettyCashTransferId: 7, date: day }])
      mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
      const res = await createTransfer(1, undefined, overrideForm())
      expect(res).toEqual({ error: expect.stringContaining("already recorded as a petty cash transfer") })
    })
  })

  it("centres the window on the UTC day, so a date with a time component still catches a leg exactly 7 days out", async () => {
    const legDay = new Date("2026-07-24")
    const tx = txMock({ id: 11 }, [{ bankRef: "XFER_OUT_B1", pettyCashTransferId: null, date: legDay }], legDay)
    const inRange = (d: Date, r: { gte: Date; lte: Date }) => d >= r.gte && d <= r.lte
    tx.transaction.findMany.mockImplementation(async ({ where }: { where: { type: string; date?: { gte: Date; lte: Date } } }) =>
      where.type === "INCOME"
        ? [{ bankRef: "B1", date: legDay }]
        : inRange(legDay, where.date!) ? [{ bankRef: "XFER_OUT_B1", pettyCashTransferId: null, date: legDay }] : [])
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    const fd = form()
    fd.set("date", "2026-07-31T10:30:00Z")
    const res = await createTransfer(1, undefined, fd)
    expect(res).toEqual({ error: expect.stringContaining("on 2026-07-24") })
  })

  // Boundary: the mock honours where.date gte/lte like the DB, so the window is inclusive at exactly 7 days.
  describe.each([
    ["exactly 7 days from the transfer date is blocked", "2026-07-24", true],
    ["8 days from the transfer date is allowed", "2026-07-23", false],
  ])("unlinked leg %s", (_label, legDate, blocked) => {
    it(blocked ? "rejects" : "creates the transfer", async () => {
      const legDay = new Date(legDate)
      const tx = txMock({ id: 11 }, [{ bankRef: "XFER_OUT_B1", pettyCashTransferId: null, date: legDay }], legDay)
      const inRange = (d: Date, r: { gte: Date; lte: Date }) => d >= r.gte && d <= r.lte
      tx.transaction.findMany.mockImplementation(async ({ where }: { where: { type: string; date?: { gte: Date; lte: Date } } }) =>
        where.type === "INCOME"
          ? [{ bankRef: "B1", date: legDay }]
          : inRange(legDay, where.date!) ? [{ bankRef: "XFER_OUT_B1", pettyCashTransferId: null, date: legDay }] : [])
      mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
      const res = await createTransfer(1, undefined, form())
      if (blocked) {
        expect(res).toEqual({ error: expect.stringContaining(`on ${legDate}`) })
        expect(tx.pettyCashTransfer.create).not.toHaveBeenCalled()
      } else {
        expect(tx.pettyCashTransfer.create).toHaveBeenCalled()
      }
    })
  })

  // #555 item 1: a window leg in a locked period can be neither un-reconciled nor re-dated, so it is skipped.
  it("skips an unlinked window leg on or before the accounting lock date", async () => {
    ;(getAccountingLockDate as jest.Mock).mockResolvedValue(new Date("2026-07-28"))
    const legDay = new Date("2026-07-28")
    const tx = txMock({ id: 11 }, [{ bankRef: "XFER_OUT_B1", pettyCashTransferId: null, date: legDay }], legDay)
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    const res = await createTransfer(1, undefined, form())
    expect(res).toBeUndefined()
    expect(tx.pettyCashTransfer.create).toHaveBeenCalled()
  })

  it("still blocks an unlinked window leg after the lock date", async () => {
    ;(getAccountingLockDate as jest.Mock).mockResolvedValue(new Date("2026-07-27"))
    const legDay = new Date("2026-07-28")
    const tx = txMock({ id: 11 }, [{ bankRef: "XFER_OUT_B1", pettyCashTransferId: null, date: legDay }], legDay)
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    const res = await createTransfer(1, undefined, form())
    expect(res).toEqual({ error: expect.stringContaining("on 2026-07-28") })
  })

  // #555 item 2 / #562: deposit re-dated away from its cash-out, so it can't be picked (deposit day != cash-out day).
  it("catches a window leg whose paired deposit was re-dated, with a message that does not suggest an unadoptable date", async () => {
    const legDay = new Date("2026-07-28")
    const tx = txMock({ id: 11 }, [{ bankRef: "XFER_OUT_B1", pettyCashTransferId: null, date: legDay }], new Date("2026-06-01"))
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    const res = await createTransfer(1, undefined, form())
    expect(res).toEqual({ error: expect.stringContaining("re-dated to 2026-06-01") })
    expect(res).toEqual({ error: expect.stringContaining("(within 7 days of this transfer)") })
    expect(res).toEqual({ error: expect.not.stringContaining("set the date to 2026-06-01") })
    expect(tx.pettyCashTransfer.create).not.toHaveBeenCalled()
  })

  // #562: same-day cash-out, deposit re-dated away: previously an un-overridable dead end.
  it("does not dead-end a same-day cash-out whose deposit was re-dated: admin can override, non-admin is blocked", async () => {
    const mk = () => {
      const tx = txMock({ id: 11 }, [{ bankRef: "XFER_OUT_B1", pettyCashTransferId: null, date: day }], new Date("2026-06-01"))
      mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
      return tx
    }
    ;(auth as jest.Mock).mockResolvedValue({ user: { role: "PASTOR", id: "2" } })
    const blocked = mk()
    const res = await createTransfer(1, undefined, form())
    expect(res).toEqual({ error: expect.stringContaining("re-dated to 2026-06-01") })
    expect(blocked.pettyCashTransfer.create).not.toHaveBeenCalled()
    ;(auth as jest.Mock).mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    const ok = mk()
    const fd = form()
    fd.set("overrideWindowGuard", "true")
    await createTransfer(1, undefined, fd)
    expect(ok.pettyCashTransfer.create).toHaveBeenCalled()
    expect(logAuditTx).toHaveBeenCalledWith(expect.anything(), expect.anything(), "PETTY_CASH_TRANSFER_CREATED", "PettyCashTransfer", 3, expect.objectContaining({ windowGuardOverridden: true }))
  })

  // #562: locked-period legs are skipped whatever the deposit's date.
  it("skips a locked unlinked leg even when its deposit was re-dated", async () => {
    ;(getAccountingLockDate as jest.Mock).mockResolvedValue(new Date("2026-07-28"))
    const legDay = new Date("2026-07-28")
    const tx = txMock({ id: 11 }, [{ bankRef: "XFER_OUT_B1", pettyCashTransferId: null, date: legDay }], new Date("2026-08-02"))
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    expect(await createTransfer(1, undefined, form())).toBeUndefined()
    expect(tx.pettyCashTransfer.create).toHaveBeenCalled()
  })

  it("ignores a locked leg that is linked to another transfer", async () => {
    ;(getAccountingLockDate as jest.Mock).mockResolvedValue(new Date("2026-07-28"))
    const tx = txMock({ id: 11 }, [{ bankRef: "XFER_OUT_B1", pettyCashTransferId: 7, date: new Date("2026-07-28") }])
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    expect(await createTransfer(1, undefined, form())).toBeUndefined()
    expect(tx.pettyCashTransfer.create).toHaveBeenCalled()
  })

  // #562: the lock is read through the transaction client, not outside it.
  it("reads the accounting lock date through the transaction client", async () => {
    const tx = txMock(null)
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    await createTransfer(1, undefined, form())
    expect(getAccountingLockDate).toHaveBeenCalledWith(tx)
  })

  it("creates the mirror when no duplicate leg exists", async () => {
    const tx = txMock(null)
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    await createTransfer(1, undefined, form())
    expect(tx.transaction.create).toHaveBeenCalledTimes(1)
    expect(tx.transaction.create.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ amount: "50.00", pettyCashTransferId: 3 })
    )
  })
})

describe("deleteTransfer — adopted leg", () => {
  const findTransfer = prisma.pettyCashTransfer.findUnique as jest.Mock
  const old = new Date("2015-01-01")
  function setup(mirror: { reconciled: boolean; bankRef: string | null }) {
    findTransfer.mockResolvedValue({
      id: 5, date: old, amount: 50, sessionId: 1,
      session: { id: 1, status: "OPEN" },
      transaction: { id: 11, reconciled: false }, // stale pre-read: not adopted
    })
    const update = jest.fn()
    const tx = {
      pettyCashSession: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      transaction: { findUnique: jest.fn().mockResolvedValue(mirror), update },
      pettyCashTransfer: { findUnique: jest.fn().mockResolvedValue({ id: 5 }), delete: jest.fn() },
    }
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    return update
  }

  it("derives adopted from the in-tx mirror read, unlinks (link only) and audits", async () => {
    const update = setup({ reconciled: false, bankRef: "XFER_OUT_ANZ_1" })
    await deleteTransfer(5)
    expect(update).toHaveBeenCalledWith({ where: { id: 11 }, data: { pettyCashTransferId: null } })
    expect(logAuditTx).toHaveBeenCalledWith(expect.anything(), 1, "TRANSACTION_UPDATED", "Transaction", 11, expect.objectContaining({ action: "unlinked-from-transfer" }))
    expect(logAudit).not.toHaveBeenCalledWith(1, "TRANSACTION_DELETED", "Transaction", 11, expect.anything())
  })

  it("treats a normal mirror as not adopted (cascade delete audited)", async () => {
    const update = setup({ reconciled: false, bankRef: "PC_T_5" })
    await deleteTransfer(5)
    expect(update).not.toHaveBeenCalled()
    expect(logAudit).toHaveBeenCalledWith(1, "TRANSACTION_DELETED", "Transaction", 11, expect.any(Object))
  })
})

describe("createTransfer — submission token replay (#491)", () => {
  const TOKEN = "11111111-2222-4333-8444-555555555555"
  const tokenForm = () => {
    const fd = form()
    fd.set("submissionToken", TOKEN)
    return fd
  }
  const same = { id: 3, sessionId: 1, amount: { toString: () => "50.00" }, date: new Date("2026-07-31"), retainedFloat: { toString: () => "0" }, depositSlipRef: null, depositedByName: "enc:Treasurer", notes: null }
  const txMock = (prior: unknown) => ({
    pettyCashTransfer: {
      findUnique: jest.fn().mockResolvedValue(prior),
      create: jest.fn().mockResolvedValue({ id: 3, date: new Date("2026-07-31"), amount: "50.00" }),
    },
    pettyCashSession: { findUnique: jest.fn().mockResolvedValue({ status: "OPEN", title: "S", openingBalance: 100, receipts: [], expenses: [], transfers: [] }) },
    transaction: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
  })

  it("stores the token on a first submit", async () => {
    const tx = txMock(null)
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    await createTransfer(1, undefined, tokenForm())
    expect(tx.pettyCashTransfer.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { submissionToken: TOKEN } }))
    expect(tx.pettyCashTransfer.create.mock.calls[0][0].data.submissionToken).toBe(TOKEN)
    expect(redirect).toHaveBeenCalledWith("/accounting/petty-cash/sessions/1")
  })

  it("a replayed token redirects to the session without creating a second transfer", async () => {
    const tx = txMock(same)
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    const res = await createTransfer(1, undefined, tokenForm())
    expect(res).toBeUndefined()
    expect(revalidatePath).toHaveBeenCalled()
    expect(tx.pettyCashTransfer.create).not.toHaveBeenCalled()
    expect(tx.transaction.create).not.toHaveBeenCalled()
    // Replay runs before the balance check (the first attempt already reduced it).
    expect(tx.pettyCashSession.findUnique).not.toHaveBeenCalled()
    expect(logAuditTx).not.toHaveBeenCalled()
    expect(redirect).toHaveBeenCalledWith("/accounting/petty-cash/sessions/1")
  })

  it("a P2002 from a concurrent submit of the same token is treated as done", async () => {
    mock$tx.mockRejectedValue({ code: "P2002" })
    ;(prisma.pettyCashTransfer.findUnique as jest.Mock).mockResolvedValue(same)
    const res = await createTransfer(1, undefined, tokenForm())
    expect(res).toBeUndefined()
    expect(prisma.pettyCashTransfer.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { submissionToken: TOKEN } }))
    expect(revalidatePath).toHaveBeenCalled()
    expect(redirect).toHaveBeenCalledWith("/accounting/petty-cash/sessions/1")
  })

  it("a double-click race surfacing as P2034 redirects once the winner committed the same transfer", async () => {
    mock$tx.mockRejectedValue({ code: "P2034" })
    ;(prisma.pettyCashTransfer.findUnique as jest.Mock).mockResolvedValue(same)
    const res = await createTransfer(1, undefined, tokenForm())
    expect(res).toBeUndefined()
    expect(revalidatePath).toHaveBeenCalled()
    expect(redirect).toHaveBeenCalledWith("/accounting/petty-cash/sessions/1")
  })

  it("a P2034 whose winner commits just after the first read is re-read and treated as done", async () => {
    mock$tx.mockRejectedValue({ code: "P2034" })
    ;(prisma.pettyCashTransfer.findUnique as jest.Mock).mockReset().mockResolvedValueOnce(null).mockResolvedValueOnce(same)
    const res = await createTransfer(1, undefined, tokenForm())
    expect(res).toBeUndefined()
    expect(prisma.pettyCashTransfer.findUnique).toHaveBeenCalledTimes(2)
    expect(redirect).toHaveBeenCalledWith("/accounting/petty-cash/sessions/1")
  })

  it.each([
    ["depositedByName", { ...same, depositedByName: "enc:Other" }],
    ["notes", { ...same, notes: "enc:changed" }],
    ["retainedFloat", { ...same, retainedFloat: { toString: () => "5.00" } }],
    ["depositSlipRef", { ...same, depositSlipRef: "SLIP9" }],
  ])("a reused token with an edited %s is rejected, not faked as success", async (_l, prior) => {
    const tx = txMock(prior)
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    const res = await createTransfer(1, undefined, tokenForm())
    expect(res).toEqual({ error: expect.stringContaining("already submitted") })
    expect(tx.pettyCashTransfer.create).not.toHaveBeenCalled()
  })

  it("a reused token for an adopted transfer submitted manually is rejected", async () => {
    const tx = txMock(same)
    tx.transaction.findFirst.mockResolvedValue({ bankRef: "XFER_OUT:abc" })
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    const res = await createTransfer(1, undefined, tokenForm())
    expect(res).toEqual({ error: expect.stringContaining("already submitted") })
  })

  it("a P2034 with an unused token still shows the retry prompt", async () => {
    mock$tx.mockRejectedValue({ code: "P2034" })
    ;(prisma.pettyCashTransfer.findUnique as jest.Mock).mockResolvedValue(null)
    await expect(createTransfer(1, undefined, tokenForm())).resolves.toEqual({ error: "Transfer conflict — please try again." })
    expect(redirect).not.toHaveBeenCalled()
  })

  it.each([
    ["amount", { ...same, amount: { toString: () => "60.00" } }],
    ["date", { ...same, date: new Date("2026-07-30") }],
    ["session", { ...same, sessionId: 2 }],
  ])("a token reused for a different transfer (%s differs) is rejected, not dropped", async (_l, prior) => {
    const tx = txMock(prior)
    mock$tx.mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
    const res = await createTransfer(1, undefined, tokenForm())
    expect(res).toEqual({ error: expect.stringContaining("already submitted") })
    expect(tx.pettyCashTransfer.create).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })

  it("rethrows a P2002 that is not the token (no transfer carries it)", async () => {
    const err = { code: "P2002" }
    mock$tx.mockRejectedValue(err)
    ;(prisma.pettyCashTransfer.findUnique as jest.Mock).mockResolvedValue(null)
    await expect(createTransfer(1, undefined, tokenForm())).rejects.toBe(err)
    expect(redirect).not.toHaveBeenCalled()
  })

  it("rethrows a P2002 when the form carried no token", async () => {
    const err = { code: "P2002" }
    mock$tx.mockRejectedValue(err)
    await expect(createTransfer(1, undefined, form())).rejects.toBe(err)
    expect(prisma.pettyCashTransfer.findUnique).not.toHaveBeenCalled()
  })
})

describe("legsByDepositRef", () => {
  const day = new Date("2026-07-31")
  const other = new Date("2026-07-28")

  it("maps each leg to its deposit ref with linked/sameDay flags", () => {
    const legs = [
      { bankRef: "XFER_OUT_B1", pettyCashTransferId: null, date: day },
      { bankRef: "XFER_OUT_B2", pettyCashTransferId: 7, date: day },
      { bankRef: "XFER_OUT_B3", pettyCashTransferId: null, date: other },
    ]
    const m = legsByDepositRef(legs, "2026-07-31")
    expect(m.get("B1")).toEqual({ linked: false, sameDay: true, day: "2026-07-31" })
    expect(m.get("B2")).toEqual({ linked: true, sameDay: true, day: "2026-07-31" })
    expect(m.get("B3")).toEqual({ linked: false, sameDay: false, day: "2026-07-28" })
  })

  it("ignores different-day adopted legs", () => {
    expect(legsByDepositRef([{ bankRef: "XFER_OUT_B1", pettyCashTransferId: 7, date: other }], "2026-07-31").size).toBe(0)
  })
})
